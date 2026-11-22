import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  ApiError,
  apiError,
  assertOrigin,
  authenticatedClient,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";

const revokeOthers = z.object({
  action: z.literal("revoke_others"),
  user_id: z.string().uuid(),
}).strict();

const cacheControl = "private, no-store";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    const input = await validated(request, revokeOthers);

    if (user.is_anonymous || input.user_id !== user.id) {
      throw new ApiError(403, "L’action doit être confirmée depuis votre compte actuel.");
    }

    // getUser verified the identity. The same request's session supplies the bearer
    // for the provider logout operation, without using any service credentials.
    const { data: { session }, error: sessionError } = await db.auth.getSession();
    if (sessionError || !session?.access_token || session.user.id !== user.id) {
      throw new ApiError(401, "Reconnectez-vous pour gérer vos sessions.");
    }

    // Use the explicit bearer method so provider refusals reach the caller.
    const { error } = await db.auth.admin.signOut(session.access_token, "others");
    if (isAuthSessionMissingError(error) || error?.status === 401 || error?.status === 403 || error?.status === 404) {
      throw new ApiError(401, "Reconnectez-vous pour gérer vos sessions.");
    }
    if (error?.status === 429) {
      throw new ApiError(429, "Trop de tentatives. Patientez puis réessayez.");
    }
    if (error) {
      throw new ApiError(503, "La fermeture des autres sessions est indisponible. Réessayez.");
    }

    return Response.json({ revoked_other_sessions: true }, {
      headers: { "Cache-Control": cacheControl },
    });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", cacheControl);
    return response;
  }
}
