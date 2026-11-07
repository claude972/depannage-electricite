import process from "node:process";
import {
  authenticatedClient,
  ApiError,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  command,
  editor,
  receipt,
} from "@/lib/features/warranty-policy/contract";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
function failed(e: unknown) {
  const r = apiError(e);
  r.headers.set("Cache-Control", headers["Cache-Control"]);
  r.headers.set("Referrer-Policy", "no-referrer");
  return r;
}
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const result = await db.rpc("read_warranty_policy_editor");
    dbError(result.error);
    const data = editor.safeParse(result.data);
    if (!data.success)
      throw new ApiError(503, "Les conditions doivent être vérifiées.");
    return Response.json(
      {
        ...data.data,
        environment_enabled: process.env.WARRANTY_REQUESTS_ENABLED === "true",
        enabled:
          data.data.operator_enabled &&
          process.env.WARRANTY_REQUESTS_ENABLED === "true",
      },
      { headers },
    );
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const c = await validated(request, command);
    const result = await db.rpc("write_warranty_policy", {
      p_command_id: c.command_id,
      p_expected_version: c.expected_version,
      p_action: c.action,
      p_title: c.action === "save" ? c.title : null,
      p_body: c.action === "save" ? c.body : null,
      p_published_version: c.action === "enable" ? c.published_version : null,
    });
    dbError(result.error);
    const data = receipt.safeParse(result.data);
    if (
      !data.success ||
      data.data.version !== c.expected_version + 1 ||
      data.data.action !== c.action
    )
      throw new ApiError(
        503,
        "La modification doit être vérifiée avant une nouvelle commande.",
      );
    return Response.json(data.data, { headers });
  } catch (e) {
    return failed(e);
  }
}
