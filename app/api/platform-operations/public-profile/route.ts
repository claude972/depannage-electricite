import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, ok, requireScope } from "@/lib/features/platform-operations/http";
import { command, editor } from "@/lib/features/public-operator-profile/contract";

export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.size) invalidQuery();
    const { db } = await authenticatedClient();
    await requireScope(db, "super_admin");
    const result = await db.rpc("read_operator_profile_editor");
    dbError(result.error);
    const parsed = editor.safeParse(result.data);
    if (!parsed.success) throw new ApiError(503, "La configuration doit être vérifiée.");
    return ok(parsed.data);
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (new URL(request.url).searchParams.size) invalidQuery();
    const { db } = await authenticatedClient();
    await requireScope(db, "super_admin");
    const input = await validated(request, command);
    const result = await db.rpc("write_operator_profile", {
      p_command_id: input.command_id,
      p_expected_version: input.expected_version,
      p_action: input.action,
      p_profile: input.action === "save" ? input.profile : null,
    });
    dbError(result.error);
    const parsed = z.object({ version: z.number().int(), action: z.enum(["save", "publish", "withdraw"]) }).strict().safeParse(result.data);
    if (!parsed.success || parsed.data.version !== input.expected_version + 1 || parsed.data.action !== input.action) {
      throw new ApiError(503, "L’enregistrement doit être vérifié. Rechargez la configuration.");
    }
    return ok(parsed.data);
  } catch (error) {
    return failed(error);
  }
}
