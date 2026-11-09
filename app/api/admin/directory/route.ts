import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const kinds = z.enum(["artisans", "clients", "organizations"]);
type Kind = z.infer<typeof kinds>;
type DirectoryRow = { id: string; created_at: string; [key: string]: unknown };
type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const cursorSchema = z.object({ v: z.literal(1), kind: kinds, created_at: timestamp, id: uuid, filters: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
type Cursor = z.infer<typeof cursorSchema>;
type Filters = { q: string | null; approved: boolean | null; role: "client" | "manager" | null; owner_id: string | null };
const columns = {
  artisans: "id,full_name,phone,artisan_approved,created_at",
  clients: "id,full_name,phone,role,created_at",
  organizations: "id,name,owner_id,created_at",
} as const;
function invalid(): never { throw new ApiError(422, "Vérifiez les filtres ou rechargez l’annuaire sans son ancien curseur."); }
function filtersFor(kind: Kind, params: URLSearchParams): Filters {
  if (kind !== "artisans" && params.has("approved") || kind !== "clients" && params.has("role") || kind !== "organizations" && params.has("owner_id")) invalid();
  const raw = params.get("q")?.normalize("NFKC").replace(/\s+/gu, " ").trim() || null;
  if (raw && (raw.length < 2 || raw.length > 80 || !/^[\p{L}\p{M}\p{N} '\u2019-]+$/u.test(raw))) invalid();
  const q = raw && uuid.safeParse(raw).success ? raw.toLowerCase() : raw;
  const approved = params.get("approved");
  if (approved !== null && approved !== "true" && approved !== "false") invalid();
  const role = params.get("role");
  if (role !== null && role !== "client" && role !== "manager") invalid();
  const owner = params.get("owner_id");
  if (owner !== null && !uuid.safeParse(owner).success) invalid();
  return { q, approved: approved === null ? null : approved === "true", role, owner_id: owner?.toLowerCase() ?? null };
}
function fingerprint(kind: Kind, filters: Filters) { return createHash("sha256").update(JSON.stringify({ kind, ...filters })).digest("hex"); }
function readCursor(raw: string | null, kind: Kind, hash: string): Cursor | null {
  if (raw === null) return null;
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) invalid();
    const parsed = cursorSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success || parsed.data.kind !== kind || parsed.data.filters !== hash) invalid();
    return parsed.data;
  } catch { return invalid(); }
}
function encodeCursor(row: { id: unknown; created_at: unknown }, kind: Kind, hash: string) {
  const parsed = cursorSchema.safeParse({ v: 1, kind, id: row.id, created_at: row.created_at, filters: hash });
  if (!parsed.success) throw new ApiError(503, "Le curseur de l’annuaire est momentanément indisponible.");
  return Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
}
function queryFor(db: Database, kind: Kind, filters: Filters, head = false, cursor: Cursor | null = null) {
  let query = db.from(kind === "organizations" ? "organizations" : "profiles").select(columns[kind], { count: "exact", head });
  if (kind === "artisans") query = query.eq("role", "artisan");
  else if (kind === "clients") query = query.in("role", ["client", "manager"]);
  if (filters.approved !== null) query = query.eq("artisan_approved", filters.approved);
  if (filters.role) query = query.eq("role", filters.role);
  if (filters.owner_id) query = query.eq("owner_id", filters.owner_id);
  if (filters.q) {
    if (uuid.safeParse(filters.q).success) query = query.eq("id", filters.q);
    else query = query.ilike(kind === "organizations" ? "name" : "directory_profile_name", `%${filters.q}%`);
  }
  // Only validated timestamp/UUID enter PostgREST's raw logical expression. Search is a
  // separate literal column filter, ANDed by PostgREST, never client-provided filter syntax.
  if (cursor) query = query.or(`created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})`);
  return query;
}
function count(value: number | null): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "Le comptage de l’annuaire est momentanément indisponible.");
  return value;
}
async function enrichArtisans(db: Database, items: { id: unknown; [key: string]: unknown }[]) {
  if (!items.length) return [];
  const result = await db.from("artisan_profiles").select("user_id,company_name,application_status", { count: "exact" }).in("user_id", items.map(row => String(row.id))).limit(100);
  dbError(result.error);
  if (count(result.count) !== (result.data ?? []).length) throw new ApiError(503, "Les dossiers artisans n’ont pas tous été renvoyés. Réessayez.");
  const dossiers = new Map((result.data ?? []).map(row => [row.user_id, row]));
  return items.map(row => ({ ...row, company_name: dossiers.get(row.id)?.company_name ?? null, application_status: dossiers.get(row.id)?.application_status ?? null }));
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(actor.error);
    if (actor.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
    const params = new URL(request.url).searchParams;
    const allowed = new Set(["kind", "id", "limit", "cursor", "q", "approved", "role", "owner_id"]);
    for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) invalid();
    if (request.url.length > 4096) invalid();
    const parsedKind = kinds.safeParse(params.get("kind"));
    if (!parsedKind.success) invalid();
    const kind = parsedKind.data;
    const filters = filtersFor(kind, params);
    if (params.has("id")) {
      if (params.size !== 2 || !uuid.safeParse(params.get("id")).success) invalid();
      const result = await queryFor(db, kind, filters).eq("id", params.get("id")!).maybeSingle().overrideTypes<DirectoryRow | null, { merge: false }>();
      dbError(result.error);
      if (!result.data) throw new ApiError(404, "Cette entrée est introuvable.");
      const item = kind === "artisans" ? (await enrichArtisans(db, [result.data]))[0] : result.data;
      return Response.json({ kind, item }, { headers });
    }
    const rawLimit = params.get("limit") ?? "25";
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(rawLimit)) invalid();
    const limit = Number(rawLimit), hash = fingerprint(kind, filters);
    const cursor = readCursor(params.get("cursor"), kind, hash);
    const [page, total] = await Promise.all([
      queryFor(db, kind, filters, false, cursor).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1).overrideTypes<DirectoryRow[], { merge: false }>(),
      queryFor(db, kind, filters, true),
    ]);
    dbError(page.error); dbError(total.error);
    const rows = (page.data ?? []).slice(0, limit);
    const hasMore = count(page.count) > rows.length;
    if (hasMore && !rows.length) throw new ApiError(503, "Le fournisseur n’a pas renvoyé la page attendue. Réessayez.");
    const items = kind === "artisans" ? await enrichArtisans(db, rows) : rows;
    return Response.json({ kind, items, page: { limit, has_more: hasMore, next_cursor: hasMore ? encodeCursor(rows[rows.length - 1], kind, hash) : null, total: count(total.count) }, filters }, { headers });
  } catch (error) {
    const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response;
  }
}
