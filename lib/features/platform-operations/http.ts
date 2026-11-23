import { env } from 'node:process';
import { refundPolicy } from '../refund-execution/policy';
// Server helpers shared by app/api/platform-operations/** routes.
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, apiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { platformMfaRefusal } from "./mfa";
import { uuid } from "@/lib/supabase/validation";
import type { PlatformAccess, PlatformScopeKey } from "./types";
import { INVOICE_RENDERING_AVAILABLE, financeConfig } from "./config";

export const privateHeaders = { "Cache-Control": "private, no-store" };
// Column lists shared by list and detail routes (route files may only export handlers/config).
export const invoiceFields = "id,request_id,kind,basis,number,issuer_key,issuer,recipient,payment_id,quote_id,intervention_id,related_invoice_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,currency,reason,issued_by,issued_at";
export const refundFields = "id,request_id,payment_id,amount_cents,currency,reason,status,version,requested_by,created_at,updated_at,decided_by,decided_at,decision_note,provider_reference,settled_event_id,settled_at";
export type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];
export function failed(error: unknown) {
  const mfa = platformMfaRefusal(error);
  if (mfa) return Response.json(mfa, { status: 403, headers: privateHeaders });
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export function invalidQuery(): never { throw new ApiError(422, "Vérifiez les filtres ou rechargez la liste sans son ancien curseur."); }
export function count(value: number | null, label = "Le comptage"): number { if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, `${label} est indisponible.`); return value; }
export function ok(data: unknown, status = 200) { return Response.json(data, { status, headers: privateHeaders }); }

/** Reads the caller's own server-side access; the only source of truth for scopes. */
export async function platformAccess(db: Database): Promise<{ super_admin: boolean; scopes: PlatformScopeKey[]; super_admin_count: number | null }> {
  const result = await db.rpc("platform_access");
  dbError(result.error);
  const data = result.data as { super_admin?: unknown; scopes?: unknown; super_admin_count?: unknown } | null;
  if (!data || typeof data !== "object" || typeof data.super_admin !== "boolean" || !Array.isArray(data.scopes)) throw new ApiError(503, "Les droits de l’espace plateforme sont indisponibles.");
  return { super_admin: data.super_admin, scopes: data.scopes.filter((s): s is PlatformScopeKey => typeof s === "string") as PlatformScopeKey[], super_admin_count: typeof data.super_admin_count === "number" ? data.super_admin_count : null };
}
export function hasScope(access: { super_admin: boolean; scopes: PlatformScopeKey[] }, scope: PlatformScopeKey): boolean { return access.super_admin || access.scopes.includes(scope); }
export async function requireScope(db: Database, scope: PlatformScopeKey | "super_admin") {
  const access = await platformAccess(db);
  if (scope === "super_admin" ? !access.super_admin : !hasScope(access, scope)) throw new ApiError(403, "Vous n’avez pas accès à cette action.");
  return access;
}
export async function describeAccess(db: Database): Promise<PlatformAccess> {
  const access = await platformAccess(db);
  const finance = hasScope(access, "finance_read");
  let setting: { bps: number; version: number } | null = null, issuer = false;
  if (finance) {
    const rows = await db.from("platform_settings").select("key,value,version").in("key", ["commission_bps", "invoice_issuer"]);
    dbError(rows.error);
    for (const row of rows.data ?? []) {
      if (row.key === "commission_bps" && row.value && typeof row.value === "object" && typeof (row.value as { bps?: unknown }).bps === "number") setting = { bps: (row.value as { bps: number }).bps, version: row.version };
      if (row.key === "invoice_issuer") issuer = true;
    }
  }
  let refundExecution=false;
  if(finance&&hasScope(access,"finance_write")&&refundPolicy(env)!==null){
    // The RPC is installed by the execution migration. A flag/key alone never enables money actions.
    const capability=await db.rpc("refund_execution_capability");
    refundExecution=!capability.error&&capability.data===true;
  }
  return {
    ...access,
    capabilities: { support: hasScope(access, "support_read"), support_reply: hasScope(access, "support_read") && hasScope(access, "support_reply"), support_status: hasScope(access, "support_read") && hasScope(access, "support_status"), operators: access.super_admin, audit: hasScope(access, "audit_read"), finance, reviews_moderation: hasScope(access, "reviews_moderate"), refund_execution: refundExecution, invoice_rendering: INVOICE_RENDERING_AVAILABLE },
    config: financeConfig(env, setting, issuer),
  };
}

// ---- Lists: exact counts, filter-bound cursors ------------------------------------------
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const timeCursor = z.object({ v: z.literal(1), created_at: timestamp, id: uuid, filters: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const idCursor = z.object({ v: z.literal(1), id: z.number().int().min(1), filters: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type FilterSpec = z.ZodType<unknown> | { schema: z.ZodType<unknown>; apply: (query: FilterableQuery, value: unknown) => FilterableQuery };
export type FilterableQuery = { eq(column: string, value: string): FilterableQuery; not(column: string, operator: string, value: string): FilterableQuery };
export type ListSpec = { table: string; fields: string; order: "created_at" | "issued_at" | "granted_at" | "id"; allowed: string[]; filters: Record<string, FilterSpec> };
export async function listRows<T>(db: Database, request: Request, spec: ListSpec): Promise<{ rows: T[]; page: { limit: number; total: number; has_more: boolean; next_cursor: string | null }; filters: Record<string, unknown> }> {
  const params = new URL(request.url).searchParams;
  if (request.url.length > 4096) invalidQuery();
  const allowed = new Set(["limit", "cursor", ...spec.allowed]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) invalidQuery();
  const limitText = params.get("limit") ?? "25"; if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(limitText)) invalidQuery(); const limit = Number(limitText);
  const filters: Record<string, unknown> = {};
  for (const key of spec.allowed) { const raw = params.get(key); const spec_ = spec.filters[key]; const schema = "schema" in spec_ ? spec_.schema : spec_; const parsed = schema.safeParse(raw); if (!parsed.success) invalidQuery(); filters[key] = parsed.data; }
  const fingerprint = createHash("sha256").update(JSON.stringify(filters)).digest("hex");
  const byId = spec.order === "id";
  let cursor: z.infer<typeof timeCursor> | z.infer<typeof idCursor> | null = null;
  if (params.has("cursor")) {
    const raw = params.get("cursor")!;
    if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalidQuery();
    try {
      const bytes = Buffer.from(raw, "base64url"); if (bytes.toString("base64url") !== raw) invalidQuery();
      const parsed = (byId ? idCursor : timeCursor).safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success || parsed.data.filters !== fingerprint) invalidQuery(); cursor = parsed.data;
    } catch { invalidQuery(); }
  }
  function query(head = false) {
    let result = db.from(spec.table).select(spec.fields, { count: "exact", head });
    for (const [key, value] of Object.entries(filters)) {
      if (value === null || value === undefined) continue;
      const spec_ = spec.filters[key];
      result = ("schema" in spec_ ? spec_.apply(result as unknown as FilterableQuery, value) : (result as unknown as FilterableQuery).eq(key, value as string)) as unknown as typeof result;
    }
    return result;
  }
  let pageQuery = query();
  if (cursor) pageQuery = byId ? pageQuery.lt("id", (cursor as z.infer<typeof idCursor>).id) : pageQuery.or(`${spec.order}.lt."${(cursor as z.infer<typeof timeCursor>).created_at}",and(${spec.order}.eq."${(cursor as z.infer<typeof timeCursor>).created_at}",id.lt.${(cursor as z.infer<typeof timeCursor>).id})`);
  if (!byId) pageQuery = pageQuery.order(spec.order, { ascending: false });
  const [page, total] = await Promise.all([pageQuery.order("id", { ascending: false }).limit(limit + 1), query(true)]);
  dbError(page.error); dbError(total.error);
  const rows = ((page.data ?? []) as unknown as T[]).slice(0, limit), hasMore = count(page.count) > rows.length;
  let next: string | null = null;
  if (hasMore) {
    const last = rows.at(-1) as Record<string, unknown> | undefined;
    const parsed = byId ? idCursor.safeParse({ v: 1, id: last?.id, filters: fingerprint }) : timeCursor.safeParse({ v: 1, id: last?.id, created_at: last?.[spec.order], filters: fingerprint });
    if (!parsed.success) throw new ApiError(503, "Le curseur de suivi est indisponible.");
    next = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  }
  return { rows, page: { limit, total: count(total.count), has_more: hasMore, next_cursor: next }, filters };
}
/** FIN-06: the reconciliation also writes an estimate for a payment whose commission is already
 *  withheld (confirmed by the provider). Those estimates are not an outstanding « non prélevée »
 *  amount: they are totalled here so the report can leave them out. Read under the caller's RLS;
 *  null whenever either list is unreadable or incomplete (the raw totals are then kept). */
export async function supersededEstimates(db: Database): Promise<{ count: number; cents: number } | null> {
  const read = (kind: "commission_estimated" | "commission_withheld") =>
    db.from("platform_ledger_entries").select("payment_id,amount_cents", { count: "exact" }).eq("entry_kind", kind).limit(1000);
  const [estimated, withheld] = await Promise.all([read("commission_estimated"), read("commission_withheld")]);
  for (const list of [estimated, withheld]) if (list.error || !Array.isArray(list.data) || list.count !== list.data.length) return null;
  const confirmed = new Set((withheld.data as { payment_id: unknown }[]).map((entry) => entry.payment_id));
  let count = 0, cents = 0;
  for (const entry of estimated.data as { payment_id: unknown; amount_cents: unknown }[]) {
    if (!confirmed.has(entry.payment_id)) continue;
    if (typeof entry.amount_cents !== "number" || !Number.isSafeInteger(entry.amount_cents) || entry.amount_cents < 0) return null;
    count += 1; cents += entry.amount_cents;
  }
  return Number.isSafeInteger(cents) ? { count, cents } : null;
}
/** The same total as computed by the database over the whole ledger (migration 20261122120000);
 *  null when the database does not report it yet or the value is unusable. */
export function reportedSupersededEstimates(value: unknown): { count: number; cents: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { count, cents } = value as { count?: unknown; cents?: unknown };
  const amount = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  return amount(count) && amount(cents) ? { count, cents } : null;
}
export function objectResult(data: unknown, message: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiError(503, message);
  return data as Record<string, unknown>;
}
