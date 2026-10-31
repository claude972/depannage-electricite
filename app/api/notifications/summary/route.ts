import { authenticatedClient, apiError, ApiError, dbError } from "@/lib/supabase/server";
// Lightweight poll for the bell: unread count and latest timestamp under the recipient's RLS.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Aucun paramètre n’est attendu.");
    const result = await db.rpc("notification_summary");
    dbError(result.error);
    const data = result.data as { unread_count?: unknown; latest_created_at?: unknown } | null;
    if (!data || typeof data !== "object" || !Number.isSafeInteger(data.unread_count) || (data.unread_count as number) < 0) throw new ApiError(503, "Le comptage des notifications est indisponible.");
    return Response.json({ unread_count: data.unread_count, latest_created_at: data.latest_created_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
