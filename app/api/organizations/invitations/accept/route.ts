import { z } from "zod";
import { authenticatedClient, apiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";

const schema = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const data = await validated(request, schema);
    // SQL derives verified recipient identity from auth.users/auth.uid, not this body.
    const result = await db.rpc("accept_organization_invitation", { p_token: data.token });
    dbError(result.error);
    return Response.json(result.data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
