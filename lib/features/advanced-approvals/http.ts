import {
  authenticatedClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  uuid,
  policyCommand,
  workflowCommand,
  policyStatus,
  policyReceipt,
  workflowStatus,
  workflowReceipt,
} from "./contract";
export type Context = { params: Promise<{ id: string }> };
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
          : "Le circuit d’approbation doit être vérifié. Réessayez.",
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
async function scope(
  request: Request,
  context: Context,
  afterAllowed: boolean,
) {
  const id = uuid.safeParse((await context.params).id),
    q = new URL(request.url).searchParams;
  if (
    !id.success ||
    request.url.length > 2048 ||
    [...q.keys()].some(
      (k) => !afterAllowed || k !== "after" || q.getAll(k).length !== 1,
    )
  )
    throw new ApiError(422, "Référence invalide.");
  const a = q.get("after") ?? "0";
  if (!/^\d{1,10}$/.test(a) || Number(a) > 2147483647)
    throw new ApiError(422, "Page invalide.");
  return { id: id.data, after: Number(a) };
}
export async function read(
  request: Request,
  context: Context,
  mode: "policy" | "workflow",
) {
  try {
    const { db } = await authenticatedClient(request);
    const { id, after } = await scope(request, context, mode === "workflow");
    const r = await db.rpc(
      mode === "policy"
        ? "advanced_approval_policy_status"
        : "advanced_approval_status",
      mode === "policy"
        ? { p_site_id: id }
        : { p_quote_id: id, p_after: after },
    );
    dbError(r.error);
    const data =
      mode === "policy"
        ? policyStatus.parse(r.data)
        : workflowStatus.parse(r.data);
    if (
      ("site_id" in data && mode === "policy"
        ? data.site_id
        : "quote_id" in data
          ? data.quote_id
          : null) !== id
    )
      throw Error("Scope");
    if ("events" in data) {
      if (
        data.events.some(
          (e, i) =>
            e.version <= after ||
            (i > 0 && e.version <= data.events[i - 1].version),
        ) ||
        (data.next_after !== null &&
          (data.events.length !== 50 ||
            data.next_after !== data.events.at(-1)?.version)) ||
        (data.workflow &&
          data.workflow.current_step > data.workflow.steps.length)
      )
        throw Error("Page");
    }
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
export async function write(
  request: Request,
  context: Context,
  mode: "policy" | "workflow",
) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const { id } = await scope(request, context, false);
    if (mode === "policy") {
      const c = await validated(request, policyCommand);
      const r = await db.rpc("set_advanced_approval_policy", {
        p_site_id: id,
        p_command_id: c.command_id,
        p_expected_version: c.expected_version,
        p_enabled: c.enabled,
        p_threshold_cents: c.threshold_cents,
        p_steps: c.steps,
      });
      dbError(r.error);
      const data = policyReceipt.parse(r.data);
      if (data.site_id !== id || data.version !== (c.expected_version ?? 0) + 1)
        throw Error("Receipt");
      return Response.json(data, { headers });
    }
    const c = await validated(request, workflowCommand);
    const r = await db.rpc("advanced_approval_command", {
      p_quote_id: id,
      p_command_id: c.command_id,
      p_action: c.action,
      p_expected_version: c.expected_version,
      p_note: c.note,
    });
    dbError(r.error);
    const data = workflowReceipt.parse(r.data);
    const allowed =
      c.action === "approve"
        ? ["pending", "approved"]
        : [
            c.action === "reject"
              ? "rejected"
              : c.action === "request_information"
                ? "changes_requested"
                : "pending",
          ];
    if (
      data.quote_id !== id ||
      data.version !== (c.expected_version ?? 0) + 1 ||
      !allowed.includes(data.state)
    )
      throw Error("Receipt");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
