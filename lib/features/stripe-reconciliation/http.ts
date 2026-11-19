import {
  authenticatedClient,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { adminClient } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { env } from "node:process";
import { z } from "zod";
import { eventId, page, detail, reviewCommand, receipt } from "./contract";
import { CheckoutLinkError, reconcileCheckoutLink, reconcileObservedCheckoutEvent } from "./checkout-link";
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
type UserDb = Awaited<ReturnType<typeof authenticatedClient>>["db"];
/** Finance read AND write are re-checked with the operator's own session right before the server writes. */
async function requireFinanceWrite(db: UserDb) {
  for (const scope of ["finance_read", "finance_write"]) {
    const r = await db.rpc("has_platform_scope", { p_scope: scope });
    dbError(r.error);
    if (r.data !== true) throw new ApiError(403, "Droits finance insuffisants.");
  }
}
const live = () => /^(sk|rk)_live_/.test(env.STRIPE_SECRET_KEY ?? "");
/** Right before the privileged SQL write: a FRESH session must be the same operator, still finance read+write. */
const reauthenticate = (userId: string) => async () => {
  const current = await authenticatedClient();
  if (current.user.id !== userId) throw new ApiError(403, "La session a changé : reprenez depuis votre espace.");
  await requireFinanceWrite(current.db);
};

export async function write(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
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
    // Rights and version are verified by the review command (also on replay after a lost answer).
    // The same server Checkout reconciliation then re-reads the provider chain for this signed
    // Transfer/Fee. The receipt stays the review's; the client re-reads the detail afterwards.
    const d = await db.rpc("stripe_financial_observation_detail", { p_event_id: key });
    dbError(d.error);
    const observed = detail.parse(d.data).record.event;
    if (observed.id !== key) throw Error("Detail");
    if (observed.source_account === null && (observed.family === "transfer" || observed.family === "fee")) try {
      await reconcileObservedCheckoutEvent(observed, adminClient(), stripeClient(), live(), user.id, reauthenticate(user.id));
    } catch (e) {
      // Inconsistent references: nothing linked, the observation remains to be reviewed.
      if (!(e instanceof CheckoutLinkError)) throw e;
    }
    return Response.json(data, { headers });
  } catch (e) {
    return fail(e);
  }
}

const relinkCommand = z.object({ command_id: z.uuid() }).strict();
export const relinkReceipt = z
  .object({
    payment_id: z.uuid(),
    state: z.enum(["awaiting_provider", "linked", "needs_review"]),
    review_reason: z.enum(["transfer_reversal", "fee_refunded"]).nullable(),
    commission: z.enum(["none", "existing", "recorded"]),
    rematched: z.array(eventId),
  })
  .strict();
/** Explicit operator relink of one paid Checkout payment: provider reads only, same server step. */
export async function relinkPayment(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Filtres invalides.");
    const payment = z.uuid().safeParse((await context.params).id);
    if (!payment.success) throw new ApiError(422, "Paiement invalide.");
    const c = await validated(request, relinkCommand);
    await requireFinanceWrite(db);
    let out: unknown;
    try {
      out = await reconcileCheckoutLink(adminClient(), stripeClient(), live(), { paymentId: payment.data.toLowerCase() }, user.id, reauthenticate(user.id));
    } catch (e) {
      if (e instanceof CheckoutLinkError) throw new ApiError(409, "Le rapprochement n’est pas complet. Réessayez ; si le problème persiste, examinez les références Stripe.");
      throw e;
    }
    if (out === null) throw new ApiError(404, "Aucun paiement Checkout de la plateforme ne correspond à cet identifiant.");
    const r = relinkReceipt.parse(out);
    if (r.payment_id !== payment.data.toLowerCase()) throw Error("Receipt");
    return Response.json({ ...r, command_id: c.command_id }, { headers });
  } catch (e) {
    return fail(e);
  }
}
