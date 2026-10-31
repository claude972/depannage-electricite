import {
  authenticatedClient,
  adminClient,
  apiError,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { stripeClient, appUrl } from "@/lib/supabase/stripe";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    const profile = await db
      .from("profiles")
      .select("role,full_name,artisan_approved,stripe_account_id")
      .eq("id", user.id)
      .single();
    dbError(profile.error);
    if (profile.data?.role !== "artisan" || !profile.data.artisan_approved)
      throw new ApiError(
        403,
        "Votre candidature artisan doit être validée avant le règlement Stripe.",
      );
    const stripe = stripeClient();
    const base = appUrl();
    let accountId: string | null = profile.data.stripe_account_id;
    const admin = adminClient();
    if (!accountId) {
      const country = process.env.STRIPE_CONNECT_COUNTRY;
      if (!country || !/^[A-Z]{2}$/.test(country))
        throw new ApiError(
          503,
          "Le pays juridique des comptes artisans doit être configuré.",
        );
      // Current Accounts v2 pattern, verified against installed Stripe 23.1.0 types and official marketplace guide.
      const account = await stripe.v2.core.accounts.create(
        {
          contact_email: user.email,
          display_name: profile.data.full_name,
          dashboard: "express",
          identity: { country },
          defaults: {
            responsibilities: {
              fees_collector: "application",
              losses_collector: "application",
            },
          },
          configuration: {
            recipient: {
              capabilities: {
                stripe_balance: { stripe_transfers: { requested: true } },
              },
            },
          },
          metadata: { artisan_id: user.id },
        },
        { idempotencyKey: `artisan-connect-${user.id}` },
      );
      accountId = account.id;
      const save = await admin
        .from("profiles")
        .update({ stripe_account_id: accountId })
        .eq("id", user.id);
      dbError(save.error);
    }
    const link = await stripe.v2.core.accountLinks.create({
      account: accountId,
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          refresh_url: `${base}/?connect=refresh`,
          return_url: `${base}/?connect=returned`,
        },
      },
    });
    return Response.json({ url: link.url });
  } catch (error) {
    return apiError(error);
  }
}
