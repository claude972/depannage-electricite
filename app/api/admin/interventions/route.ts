import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const listFields = "id,client_id,artisan_id,site_id,category,city,postal_code,urgency,status,created_at,updated_at";
const detailFields = `${listFields},description,address,estimate_min_cents,estimate_max_cents,travel_stage,completed_at,paid_at`;
const quoteFields = "id,intervention_id,artisan_id,lines,subtotal_cents,tax_rate,tax_cents,total_cents,status,created_at,accepted_at";
const timestamp = z.iso.datetime({ offset: true }).regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const filtersSchema = z.object({
  status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]).nullable(),
  category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]).nullable(),
  urgency: z.enum(["urgent", "scheduled"]).nullable(),
  site_id: uuid.nullable(),
  artisan_id: uuid.nullable(),
  client_id: uuid.nullable(),
  created_from: timestamp.nullable(),
  created_to: timestamp.nullable(),
  q: z.string().max(80).nullable(),
}).strict();
type Filters = z.infer<typeof filtersSchema>;
type Database = Awaited<ReturnType<typeof authenticatedClient>>["db"];
const cursorSchema = z.object({ v: z.literal(1), created_at: timestamp, id: uuid, filters: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

function invalidQuery(): never {
  throw new ApiError(422, "Vérifiez les filtres ou rechargez la liste sans son ancien curseur.");
}
function exactMicroseconds(value: string): bigint {
  const fraction = /\.(\d{1,6})/.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.slice(3).padEnd(3, "0") || "0");
}
function readFilters(params: URLSearchParams): Filters {
  const search = params.get("q")?.normalize("NFKC").replace(/\s+/gu, " ").trim() || null;
  // Raw PostgREST `or` filters are not escaped by the SDK. Only a literal alphabet
  // without filter delimiters/wildcards is accepted, never a browser-built expression.
  // https://supabase.com/docs/reference/javascript/or
  if (search && (search.length < 2 || search.length > 80 || !/^[\p{L}\p{M}\p{N} '\u2019-]+$/u.test(search))) invalidQuery();
  const parsed = filtersSchema.safeParse({
    status: params.get("status"), category: params.get("category"), urgency: params.get("urgency"),
    site_id: params.get("site_id"), artisan_id: params.get("artisan_id"), client_id: params.get("client_id"),
    created_from: params.get("created_from"), created_to: params.get("created_to"),
    q: search && uuid.safeParse(search).success ? search.toLowerCase() : search,
  });
  if (!parsed.success) invalidQuery();
  if (parsed.data.created_from && parsed.data.created_to && exactMicroseconds(parsed.data.created_from) > exactMicroseconds(parsed.data.created_to)) invalidQuery();
  return parsed.data;
}
function filterFingerprint(filters: Filters): string {
  return createHash("sha256").update(JSON.stringify(filters)).digest("hex");
}
function readCursor(raw: string | null, fingerprint: string) {
  if (raw === null) return null;
  if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalidQuery();
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) invalidQuery();
    const parsed = cursorSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success || parsed.data.filters !== fingerprint) invalidQuery();
    return parsed.data;
  } catch { return invalidQuery(); }
}
function nextCursor(row: { id: unknown; created_at: unknown }, fingerprint: string): string {
  const parsed = cursorSchema.safeParse({ v: 1, id: row.id, created_at: row.created_at, filters: fingerprint });
  if (!parsed.success) throw new ApiError(503, "Le curseur de suivi n’a pas pu être créé. Rechargez la liste.");
  return Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
}
function filteredQuery(db: Database, filters: Filters, head = false, cursor: z.infer<typeof cursorSchema> | null = null) {
  let query = db.from("interventions").select(listFields, { count: "exact", head });
  for (const field of ["status", "category", "urgency", "site_id", "artisan_id", "client_id"] as const) {
    if (filters[field]) query = query.eq(field, filters[field]);
  }
  if (filters.created_from) query = query.gte("created_at", filters.created_from);
  if (filters.created_to) query = query.lte("created_at", filters.created_to);
  let searchExpression: string | null = null;
  if (filters.q) {
    if (uuid.safeParse(filters.q).success) query = query.eq("id", filters.q);
    else searchExpression = `description.ilike.%${filters.q}%,city.ilike.%${filters.q}%,postal_code.ilike.%${filters.q}%`;
  }
  // A single explicit logical tree keeps literal search AND cursor filtering distinct.
  // Cursor values are validated; quoting preserves the exact timestamp including microseconds.
  const cursorExpression = cursor ? `created_at.lt."${cursor.created_at}",and(created_at.eq."${cursor.created_at}",id.lt.${cursor.id})` : null;
  if (searchExpression && cursorExpression) query = query.or(`and(or(${searchExpression}),or(${cursorExpression}))`);
  else if (searchExpression || cursorExpression) query = query.or((searchExpression || cursorExpression)!);
  return query;
}
function exactCount(value: number | null): number {
  if (value === null || !Number.isSafeInteger(value) || value < 0) throw new ApiError(503, "Le comptage des dossiers est momentanément indisponible.");
  return value;
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = await db.from("profiles").select("role").eq("id", user.id).single();
    dbError(actor.error);
    if (actor.data?.role !== "admin") throw new ApiError(403, "Accès réservé à l’administration.");
    const params = new URL(request.url).searchParams;
    const allowed = new Set(["id", "limit", "cursor", ...Object.keys(filtersSchema.shape)]);
    for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length !== 1) invalidQuery();
    if (request.url.length > 4096) invalidQuery();

    if (params.has("id")) {
      const id = params.get("id");
      if (params.size !== 1 || !uuid.safeParse(id).success) invalidQuery();
      const job = await db.from("interventions").select(detailFields).eq("id", id).maybeSingle();
      dbError(job.error);
      if (!job.data) throw new ApiError(404, "Ce dossier est introuvable.");
      const quotes = await db.from("quotes").select(quoteFields, { count: "exact" }).eq("intervention_id", id)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50);
      dbError(quotes.error);
      return Response.json({ intervention: job.data, quotes: quotes.data ?? [], quotes_limit: 50, quotes_limited: exactCount(quotes.count) > (quotes.data?.length ?? 0) }, { headers: privateHeaders });
    }

    const rawLimit = params.get("limit") ?? "25";
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(rawLimit)) invalidQuery();
    const limit = Number(rawLimit);
    const filters = readFilters(params);
    const fingerprint = filterFingerprint(filters);
    const cursor = readCursor(params.get("cursor"), fingerprint);
    let pageQuery = filteredQuery(db, filters, false, cursor);
    pageQuery = pageQuery.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    const [page, total] = await Promise.all([pageQuery, filteredQuery(db, filters, true)]);
    dbError(page.error); dbError(total.error);
    const rows = (page.data ?? []).slice(0, limit);
    const remaining = exactCount(page.count);
    const hasMore = remaining > rows.length;
    if (hasMore && rows.length === 0) throw new ApiError(503, "Le fournisseur n’a pas renvoyé la page attendue. Réessayez.");
    return Response.json({
      interventions: rows,
      page: { limit, has_more: hasMore, next_cursor: hasMore ? nextCursor(rows[rows.length - 1], fingerprint) : null, total: exactCount(total.count) },
      filters,
    }, { headers: privateHeaders });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
