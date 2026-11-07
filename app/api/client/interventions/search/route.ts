import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";
import { clientInterventionInput, clientInterventionRow, clientInterventionSnapshot } from "@/lib/features/client-interventions/contract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const positionSchema = z.object({ id: z.uuid(), created_at: clientInterventionRow.shape.created_at }).strict();
const cursorSchema = positionSchema.extend({ scope: z.string().regex(/^[a-f0-9]{64}$/) });
type Position = z.infer<typeof positionSchema>;

function earlier(row: Position, previous: Position) {
  const ms = Date.parse(row.created_at) - Date.parse(previous.created_at);
  if (ms) return ms < 0;
  const fraction = (stamp: string) => (stamp.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] ?? "").slice(3).padEnd(3, "0");
  const a = fraction(row.created_at), b = fraction(previous.created_at);
  return a < b || (a === b && row.id < previous.id);
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.search || Number(request.headers.get("content-length") ?? 0) > 4096) throw new ApiError(422, "Requête de recherche invalide.");
    if (request.headers.get("origin") !== url.origin) throw new ApiError(403, "Origine de la requête non autorisée.");
    const { db, user } = await authenticatedClient();
    const input = clientInterventionInput.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new ApiError(422, "Vérifiez votre recherche.");
    const { filter, cursor } = input.data, search = input.data.search.toLowerCase();
    const scope = createHash("sha256").update(JSON.stringify([user.id, filter, search])).digest("hex");
    let after: Position | null = null;
    if (cursor !== null) {
      try {
        const bytes = Buffer.from(cursor, "base64url");
        if (bytes.toString("base64url") !== cursor) throw Error();
        const decoded = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
        if (decoded.scope !== scope) throw Error();
        after = { id: decoded.id.toLowerCase(), created_at: decoded.created_at };
      } catch { throw new ApiError(422, "La recherche a changé. Revenez à la première page."); }
    }
    const result = await db.rpc("client_intervention_search", { p_filter: filter, p_search: search,
      p_after_at: after?.created_at ?? null, p_after_id: after?.id ?? null });
    dbError(result.error);
    const data = clientInterventionSnapshot.parse(result.data);
    if (data.total < data.items.length || (!after && data.items.length !== Math.min(data.total, 51)) ||
      new Set(data.items.map(row => row.id)).size !== data.items.length) throw Error("Invalid private request page");
    let previous = after;
    for (const row of data.items) {
      if (previous && !earlier(row, previous)) throw Error("Unordered private request page");
      previous = row;
    }
    const items = data.items.slice(0, 50), hasMore = data.items.length > 50, last = items.at(-1);
    const next = hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, created_at: last.created_at, scope })).toString("base64url") : null;
    return Response.json({ items, total: data.total, page: { limit: 50, has_more: hasMore, next_cursor: next } }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({ error: error instanceof ApiError ? error.message : "Les demandes n’ont pas pu être chargées. Réessayez." },
      { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}
