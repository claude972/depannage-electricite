import {
  ApiError, apiError, assertOrigin, authenticatedClient, dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  coverageCommand, coverageEditor, coverageReceipt,
} from "@/lib/features/coverage/contract";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

function failed(error: unknown) {
  const response = apiError(error);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const result = await db.rpc("read_coverage_editor");
    dbError(result.error);
    const state = coverageEditor.safeParse(result.data);
    if (!state.success)
      throw new ApiError(503, "La zone publiée doit être vérifiée.");
    return Response.json(state.data, { headers });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, coverageCommand);
    const codes = input.action === "publish" ? [...input.postal_codes].sort() : [];
    const result = await db.rpc("write_coverage", {
      p_command_id: input.command_id,
      p_expected_version: input.expected_version,
      p_action: input.action,
      p_postal_codes: input.action === "publish" ? codes : null,
    });
    dbError(result.error);
    const receipt = coverageReceipt.safeParse(result.data);
    if (!receipt.success || receipt.data.version !== input.expected_version + 1 ||
        receipt.data.postal_codes.join(",") !== codes.join(","))
      throw new ApiError(503, "Vérifiez la publication avant de réessayer.");
    return Response.json(receipt.data, { headers });
  } catch (error) {
    return failed(error);
  }
}
