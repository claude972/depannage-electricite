import { z } from "zod";
import {
  authenticatedClient,
  adminClient,
  apiError,
  assertOrigin,
  ApiError,
  dbError,
} from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { stripeClient, appUrl, commissionBps } from "@/lib/supabase/stripe";
const schema = z.object({ quote_id: uuid }).strict();
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    const { quote_id } = await validated(request, schema);
    const stripe = stripeClient();
    const base = appUrl();
    const feeBps = commissionBps();
    const { data: quote, error: quoteError } = await db
      .from("quotes")
      .select("*")
      .eq("id", quote_id)
      .single();
    dbError(quoteError);
    if (!quote || quote.status !== "accepted")
      throw new ApiError(409, "Le devis doit être accepté avant de payer.");
    const { data: job, error: jobError } = await db
      .from("interventions")
      .select("id,client_id,artisan_id,status")
      .eq("id", quote.intervention_id)
      .single();
    dbError(jobError);
    if (!job || job.client_id !== user.id)
      throw new ApiError(
        403,
        "Seul le demandeur peut régler cette intervention.",
      );
    if (job.status !== "completed")
      throw new ApiError(
        409,
        "Le paiement sera disponible après la fin de l’intervention.",
      );
    const admin = adminClient();
    const { data: artisan, error: artisanError } = await admin
      .from("profiles")
      .select("stripe_account_id,artisan_approved")
      .eq("id", job.artisan_id)
      .single();
    dbError(artisanError);
    if (!artisan?.artisan_approved || !artisan.stripe_account_id)
      throw new ApiError(
        409,
        "L’artisan doit finaliser son compte de règlement Stripe.",
      );
    // Accounts v2 recipient configuration: https://docs.stripe.com/connect/marketplace/tasks/create
    const account = await stripe.v2.core.accounts.retrieve(
      artisan.stripe_account_id,
      { include: ["configuration.recipient"] },
    );
    if (
      account.configuration?.recipient?.capabilities?.stripe_balance
        ?.stripe_transfers?.status !== "active"
    )
      throw new ApiError(
        409,
        "Stripe doit encore valider le compte de règlement de l’artisan.",
      );
    const previous = await admin
      .from("payments")
      .select("session_id,status")
      .eq("quote_id", quote_id)
      .maybeSingle();
    dbError(previous.error);
    if (previous.data?.status === "paid")
      throw new ApiError(409, "Ce devis a déjà été réglé.");
    if (previous.data) {
      const existing = await stripe.checkout.sessions.retrieve(
        previous.data.session_id,
      );
      if (existing.status === "open" && existing.url)
        return Response.json({ url: existing.url });
      if (existing.status === "complete")
        throw new ApiError(
          409,
          "Le paiement est en cours de confirmation. Actualisez le suivi dans un instant.",
        );
    }
    // Browser amounts and destinations are never accepted. The accepted immutable quote is authoritative.
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        allowed_payment_method_types: ["card"],
        locale: "fr",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: quote.total_cents,
              product_data: {
                name: "Intervention électrique — devis accepté",
                metadata: { quote_id },
              },
            },
          },
        ],
        client_reference_id: quote_id,
        metadata: { quote_id, intervention_id: job.id },
        payment_intent_data: {
          application_fee_amount: Math.round(
            (quote.total_cents * feeBps) / 10000,
          ),
          transfer_data: { destination: artisan.stripe_account_id },
          metadata: { quote_id },
        },
        success_url: `${base}/?payment=pending&intervention=${job.id}`,
        cancel_url: `${base}/?payment=cancelled&intervention=${job.id}`,
      },
      {
        idempotencyKey: `checkout-${quote_id}-${previous.data?.session_id ?? "initial"}`,
      },
    );
    if (!session.url)
      throw new ApiError(
        503,
        "Stripe n’a pas fourni de page de paiement. Réessayez.",
      );
    if (previous.data) {
      const update = await admin
        .from("payments")
        .update({ session_id: session.id, status: "pending" })
        .eq("quote_id", quote_id)
        .eq("session_id", previous.data.session_id)
        .select("session_id");
      dbError(update.error);
      if (!update.data?.length) {
        const current = await admin
          .from("payments")
          .select("session_id")
          .eq("quote_id", quote_id)
          .single();
        dbError(current.error);
        if (current.data?.session_id !== session.id)
          throw new ApiError(
            409,
            "Une autre tentative de paiement est déjà en cours.",
          );
      }
    } else {
      const inserted = await admin
        .from("payments")
        .upsert(
          {
            quote_id,
            session_id: session.id,
            total_cents: quote.total_cents,
            currency: "eur",
            status: "pending",
          },
          { onConflict: "quote_id", ignoreDuplicates: true },
        );
      dbError(inserted.error);
      const current = await admin
        .from("payments")
        .select("session_id")
        .eq("quote_id", quote_id)
        .single();
      dbError(current.error);
      if (current.data?.session_id !== session.id)
        throw new ApiError(
          409,
          "Une autre tentative de paiement est déjà en cours.",
        );
    }
    return Response.json({ url: session.url });
  } catch (error) {
    return apiError(error);
  }
}
