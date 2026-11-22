import { z } from "zod";
import { ApiError, adminClient, authenticatedClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import { count, failed, listRows, ok, requireScope } from "@/lib/features/platform-operations/http";
import type { AuditEntry } from "@/lib/features/platform-operations/types";
import { SENSITIVE_DOSSIER_CODES } from "@/lib/features/platform-operations/audit-labels";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const targetKind = z.enum(["operator", "super_admin", "setting", "reconciliation", "ledger", "invoice", "refund_request", "dispute", "review", "public_callback"]);
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "audit_read");
    if (new URL(request.url).searchParams.has("journal")) return ok(await unifiedJournal(request));
    const list = await listRows<AuditEntry>(db, request, { table: "platform_audit", fields: "id,actor_id,action,target_kind,target_id,details,created_at", order: "id", allowed: ["target_kind", "target_id", "actor_id"], filters: { target_kind: targetKind.nullable(), target_id: z.string().max(80).regex(/^[A-Za-z0-9:_-]*$/).nullable(), actor_id: uuid.nullable() } });
    return ok({ entries: list.rows, page: list.page, filters: list.filters });
  } catch (error) { return failed(error); }
}

// ---- ADM-09: one journal for both sources, paginated beyond the 100 rows of the settings screen ----
// `journal=all` merges the platform journal (platform_audit: finance, rights, moderation, support)
// with the dossier and account journal (audit_log); `journal=sensitive` keeps, from the second one,
// only administrative decisions (reassignment, approvals, warranty decisions, published settings).
// Both tables are append-only with increasing ids: the cursor carries one exclusive id bound per
// source, so a page never repeats or skips a row even when several rows share a timestamp. Read with
// the service client AFTER the `audit_read` scope check above (audit_log is otherwise limited by RLS
// to administrators); only ids, codes, dates and the actors' names and roles are returned.
const journalKind = z.enum(["all", "sensitive", "platform", "dossiers"]);
const journalCursor = /^(\d{1,15})-(\d{1,15})$/;
type UnifiedEntry = AuditEntry & { source: "platform" | "dossier"; intervention_id: string | null; actor_name: string | null; actor_role: string | null };
async function unifiedJournal(request: Request) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!["journal", "limit", "cursor", "actor_id"].includes(key) || params.getAll(key).length !== 1) throw new ApiError(422, "Vérifiez les filtres ou rechargez la liste sans son ancien curseur.");
  const kind = journalKind.safeParse(params.get("journal"));
  const limitText = params.get("limit") ?? "25";
  const actor = uuid.nullable().safeParse(params.get("actor_id"));
  const cursorText = params.get("cursor");
  const bounds = cursorText === null ? ["0", "0"] : journalCursor.exec(cursorText)?.slice(1);
  if (!kind.success || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText) || !actor.success || !bounds) throw new ApiError(422, "Vérifiez les filtres ou rechargez la liste sans son ancien curseur.");
  const limit = Number(limitText), platformBound = Number(bounds[0]), dossierBound = Number(bounds[1]);
  const admin = adminClient();
  const withPlatform = kind.data !== "dossiers", withDossiers = kind.data !== "platform";
  const platformQuery = (head: boolean, bounded: boolean) => {
    let q = admin.from("platform_audit").select("id,actor_id,action,target_kind,target_id,details,created_at", { count: "exact", head });
    if (actor.data) q = q.eq("actor_id", actor.data);
    if (bounded && platformBound) q = q.lt("id", platformBound);
    return q;
  };
  const dossierQuery = (head: boolean, bounded: boolean) => {
    let q = admin.from("audit_log").select("id,actor_id,intervention_id,action,created_at", { count: "exact", head });
    if (kind.data === "sensitive") q = q.or(SENSITIVE_DOSSIER_CODES.map(code => `action.eq.${code},action.like.${code}:*`).join(","));
    if (actor.data) q = q.eq("actor_id", actor.data);
    if (bounded && dossierBound) q = q.lt("id", dossierBound);
    return q;
  };
  const none = { data: [] as Record<string, unknown>[], count: 0, error: null };
  const [platform, dossiers, platformTotal, dossierTotal] = await Promise.all([
    withPlatform ? platformQuery(false, true).order("id", { ascending: false }).limit(limit + 1) : none,
    withDossiers ? dossierQuery(false, true).order("id", { ascending: false }).limit(limit + 1) : none,
    withPlatform ? platformQuery(true, false) : none,
    withDossiers ? dossierQuery(true, false) : none,
  ]);
  if (platform.error || dossiers.error || platformTotal.error || dossierTotal.error) throw new ApiError(503, "Le journal d’audit est momentanément indisponible. Réessayez.");
  const merged: UnifiedEntry[] = [
    ...((platform.data ?? []) as unknown as AuditEntry[]).map(row => ({ ...row, source: "platform" as const, intervention_id: null, actor_name: null, actor_role: null })),
    ...((dossiers.data ?? []) as unknown as { id: number; actor_id: string | null; intervention_id: string | null; action: string; created_at: string }[]).map(row => ({ id: row.id, actor_id: row.actor_id, action: row.action, target_kind: "intervention", target_id: row.intervention_id ?? "", details: {}, created_at: row.created_at, source: "dossier" as const, intervention_id: row.intervention_id, actor_name: null, actor_role: null })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.source === b.source ? b.id - a.id : a.source === "platform" ? -1 : 1));
  const entries = merged.slice(0, limit);
  const remaining = count(platform.count ?? 0) + count(dossiers.count ?? 0);
  const hasMore = remaining > entries.length;
  const lastOf = (source: "platform" | "dossier", previous: number) => entries.filter(e => e.source === source).reduce((min, e) => (min === 0 || e.id < min ? e.id : min), previous);
  const actorIds = [...new Set(entries.map(e => e.actor_id).filter((id): id is string => typeof id === "string"))];
  if (actorIds.length) {
    const [people, grants] = await Promise.all([
      admin.from("profiles").select("id,full_name,role").in("id", actorIds).limit(actorIds.length),
      admin.from("platform_operator_grants").select("user_id").in("user_id", actorIds).limit(1000),
    ]);
    // Names are a convenience: when they cannot be read the entries keep the actor's identifier.
    const byId = new Map(((people.error ? [] : people.data) ?? []).map(person => [person.id as string, person]));
    // A platform operator keeps its base role in `profiles`; having (or having had) an operator
    // grant is what explains its presence in this journal.
    const operators = new Set(((grants.error ? [] : grants.data) ?? []).map(grant => grant.user_id as string));
    for (const e of entries) { const person = e.actor_id ? byId.get(e.actor_id) : undefined; if (person) { e.actor_name = typeof person.full_name === "string" ? person.full_name : null; e.actor_role = person.role !== "admin" && operators.has(e.actor_id!) ? "operator" : typeof person.role === "string" ? person.role : null; } }
  }
  return {
    entries,
    journal: kind.data,
    page: { limit, total: count(platformTotal.count ?? 0) + count(dossierTotal.count ?? 0), has_more: hasMore, next_cursor: hasMore ? `${lastOf("platform", platformBound)}-${lastOf("dossier", dossierBound)}` : null },
  };
}
