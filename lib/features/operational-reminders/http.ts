import {
  authenticatedClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { uuid, command, state, receipt } from "./contract";
export type Context = { params: Promise<{ id: string }> };
type Kind = "credential" | "compliance";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
function fail(e: unknown) {
  const status =
    e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : "Le rappel doit être vérifié. Réessayez.",
    },
    {
      status,
      headers: {
        ...headers,
        ...(status === 503 ? { "Retry-After": "2" } : {}),
      },
    },
  );
}
async function target(r: Request, c: Context) {
  const id = uuid.safeParse((await c.params).id);
  if (!id.success || new URL(r.url).searchParams.size)
    throw new ApiError(422, "Référence invalide.");
  return id.data;
}
export async function read(request: Request, context: Context, kind: Kind) {
  try {
    const { db } = await authenticatedClient();
    const id = await target(request, context);
    const r = await db.rpc("read_operational_reminder", {
      p_kind: kind,
      p_record_id: id,
    });
    dbError(r.error);
    const data = state.parse(r.data);
    if (
      data.kind !== kind ||
      data.record_id !== id ||
      (data.record &&
        (data.record.kind !== kind || data.record.record_id !== id))
    )
      throw Error("Scope");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
export async function write(request: Request, context: Context, kind: Kind) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    const id = await target(request, context),
      c = await validated(request, command);
    const r = await db.rpc("write_operational_reminder", {
      p_kind: kind,
      p_record_id: id,
      p_command_id: c.command_id,
      p_action: c.action,
      p_expected_version: c.expected_version,
      p_source_version: c.action === "schedule" ? c.source_version : null,
      p_due_on: c.action === "schedule" ? c.due_on : null,
      p_remind_at: c.action === "schedule" ? c.remind_at : null,
    });
    dbError(r.error);
    const data = receipt.parse(r.data),
      v = data.record;
    if (
      v.kind !== kind ||
      v.record_id !== id ||
      v.version !== (c.expected_version ?? 0) + 1 ||
      v.status !== (c.action === "schedule" ? "scheduled" : "cancelled") ||
      (c.action === "schedule" &&
        (v.source_version !== c.source_version ||
          v.due_on !== c.due_on ||
          Date.parse(v.remind_at) !== Date.parse(c.remind_at)))
    )
      throw Error("Unconfirmed receipt");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
