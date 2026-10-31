import Stripe from "stripe";
import { ApiError } from "./server";
export function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key)
    throw new ApiError(
      503,
      "Le paiement Stripe est en cours de configuration. Aucun montant n’a été débité.",
    );
  if (
    /^(sk|rk)_live_/.test(key) &&
    process.env.STRIPE_LIVE_PAYMENTS_ENABLED !== "true"
  )
    throw new ApiError(503, "Les paiements réels ne sont pas encore activés.");
  return new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 });
}
export function appUrl() {
  const value = process.env.NEXT_PUBLIC_APP_URL;
  if (!value)
    throw new ApiError(
      503,
      "L’adresse de retour du paiement est en cours de configuration.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new ApiError(503, "L’adresse de retour sécurisée est invalide.");
  return url.origin;
}
export function commissionBps() {
  const raw = process.env.PLATFORM_FEE_BPS;
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 0 || value > 10000)
    throw new ApiError(
      503,
      "Les conditions de commission doivent être configurées avant paiement.",
    );
  return value;
}
