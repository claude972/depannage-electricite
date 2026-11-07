import {
  authenticatedClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { eventId, page, detail, reviewCommand, receipt } from "./contract";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export type Context = { params: Promise<{ id: string }> };
function fail(e: unknown) {
  const status =
    e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : "Le rapprochement financier doit être vérifié. Réessayez.",
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
async function id(context: Context) {
  const p = eventId.safeParse((await context.params).id);
  if (!p.success) throw new ApiError(422, "Événement invalide.");
  return p.data;
}
export async function list(request: Request) {
  try {
    const { db } = await authenticatedClient(),
      q = new URL(request.url).searchParams;
    if (
      request.url.length > 2048 ||
      [...q.keys()].some(
        (k) => !["after", "state"].includes(k) || q.getAll(k).length !== 1,
      )
    )
      throw new ApiError(422, "Filtres invalides.");
    const after = q.get("after"),
      state = q.get("state");
    if (
      (after !== null && !eventId.safeParse(after).success) ||
      (state !== null && !["matched", "needs_review"].includes(state))
    )
      throw new ApiError(422, "Filtres invalides.");
    const r = await db.rpc("stripe_financial_observations_page", {
      p_after: after,
      p_state: state,
    });
    dbError(r.error);
    const data = page.parse(r.data);
    if (
      data.records.some(
        (r, i) =>
          (after !== null && r.event.id <= after) ||
          (i > 0 && r.event.id <= data.records[i - 1].event.id) ||
          (state !== null && r.result.state !== state),
      ) ||
      (data.next_after !== null &&
        (data.records.length !== 50 ||
          data.next_after !== data.records.at(-1)?.event.id))
    )
      throw Error("Page");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
export async function read(request: Request, context: Context) {
  try {
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Filtres invalides.");
    const key = await id(context);
    const r = await db.rpc("stripe_financial_observation_detail", {
      p_event_id: key,
    });
    dbError(r.error);
    const data = detail.parse(r.data);
    if (
      data.record.event.id !== key ||
      data.history.some(
        (v, i) =>
          v.version > data.record.version ||
          (i > 0 && v.version >= data.history[i - 1].version),
      )
    )
      throw Error("Detail");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
export async function write(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Filtres invalides.");
    const key = await id(context),
      c = await validated(request, reviewCommand);
    const r = await db.rpc("review_stripe_financial_observation", {
      p_event_id: key,
      p_command_id: c.command_id,
      p_expected_version: c.expected_version,
      p_note: c.note,
    });
    dbError(r.error);
    const data = receipt.parse(r.data);
    if (data.event_id !== key || data.version !== c.expected_version + 1)
      throw Error("Receipt");
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}
