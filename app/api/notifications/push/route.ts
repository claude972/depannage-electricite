import { z } from "zod";
import { handlePushEnrollment } from "@/lib/features/notifications/external-delivery/web-push";
import { adminClient, ApiError, authenticatedClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const sessionId = z.uuid();

function handler(request: Request) {
  return handlePushEnrollment(request, {
    env: process.env,
    admin: adminClient,
    async authenticate() {
      const { user, db } = await authenticatedClient();
      const { data, error } = await db.auth.getClaims();
      const session = sessionId.safeParse(data?.claims.session_id);
      if (error || data?.claims.sub !== user.id || !session.success) throw new ApiError(401, "Session indisponible.");
      return { actor: user.id, session: session.data };
    },
  });
}

export const GET = handler;
export const POST = handler;
