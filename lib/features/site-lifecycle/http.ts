import { ApiError, apiError } from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";

export type RouteContext = { params: Promise<{ id: string }> };
export const privateHeaders = { "Cache-Control": "private, no-store" };
export async function routeId(context: RouteContext) {
  const result = uuid.safeParse((await context.params).id);
  if (!result.success) throw new ApiError(422, "Identifiant invalide.");
  return result.data.toLowerCase();
}
export function fail(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
  if (response.status === 503) response.headers.set("Retry-After", "2");
  return response;
}
export const unavailable = () => new ApiError(503, "Les données du site doivent être vérifiées. Réessayez.");
