import { authenticatedClient, ApiError, apiError, dbError } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/supabase/stripe";
import { projectPayout, type PayoutsReport } from "@/lib/features/artisan-payouts/model";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** FIN-06: the signed-in artisan's own payouts, read from the payment provider for THEIR settlement
 * account only (the account id comes from their own profile row, never from the request). Read-only. */
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient(request);
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const profile = await db.from("profiles").select("role,stripe_account_id").eq("id", user.id).single();
    dbError(profile.error);
    if (profile.data?.role !== "artisan") throw new ApiError(403, "Réservé aux artisans.");
    const read_at = new Date().toISOString();
    const account: unknown = profile.data.stripe_account_id;
    if (typeof account !== "string" || !/^acct_[A-Za-z0-9]{1,200}$/.test(account))
      return Response.json({ state: "no_account", livemode: null, payouts: [], has_more: false, read_at } satisfies PayoutsReport, { headers });
    try {
      const list = await stripeClient().payouts.list({ limit: 20 }, { stripeAccount: account });
      const payouts = (Array.isArray(list.data) ? list.data : []).map(projectPayout).filter((p): p is NonNullable<typeof p> => p !== null);
      const livemode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
      return Response.json({ state: "available", livemode, payouts, has_more: list.has_more === true, read_at } satisfies PayoutsReport, { headers });
    } catch {
      // Provider not configured here or unreachable: stated as such, never as « no payout ».
      return Response.json({ state: "provider_unavailable", livemode: null, payouts: [], has_more: false, read_at } satisfies PayoutsReport, { headers });
    }
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}
