import { testSmsRecipients } from "./test-sms-recipients";

/** Configuration is a capability hint, never evidence of a card authorization or SMS delivery. */
export function cardHoldConfigured(env: Record<string, string | undefined>): boolean {
  const key = env.STRIPE_SECRET_KEY ?? "";
  return /^(sk|rk)_test_/.test(key) ||
    (/^(sk|rk)_live_/.test(key) && env.STRIPE_LIVE_PAYMENTS_ENABLED === "true");
}

export async function bookingOptions(
  env: Record<string, string | undefined>,
  fetcher: typeof fetch = fetch,
) {
  const recipients = testSmsRecipients(env);
  let phoneAvailable: boolean | null = recipients?.length === 0 ? false : null;
  if (phoneAvailable === null && env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    try {
      const response = await fetcher(new URL("/auth/v1/settings", env.NEXT_PUBLIC_SUPABASE_URL), {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      if (response.status === 200) {
        const data: unknown = await response.json();
        if (data && typeof data === "object" && "external" in data) {
          const external = data.external;
          if (external && typeof external === "object" && "phone" in external && typeof external.phone === "boolean")
            phoneAvailable = external.phone;
        }
      }
    } catch { /* An unavailable provider is unknown, never a working SMS channel. */ }
  }
  const card = cardHoldConfigured(env);
  return {
    payment_methods: [
      { id: "on_site", available: true, label: "Après intervention — paiement sur la plateforme", description: "Réglez après les travaux sur notre plateforme, par carte via votre suivi, un lien sécurisé ou un QR code. Aucun paiement direct à l’artisan." },
      { id: "card_hold", available: card, label: "Empreinte de carte", description: "Préautorisation bancaire, sans débit à la réservation.",
        ...(!card ? { reason: "L’empreinte bancaire n’est pas encore configurée. Vous pouvez choisir de payer sur la plateforme après l’intervention." } : {}) },
    ],
    phone_auth: { available: phoneAvailable,
      ...(phoneAvailable !== true ? { reason: phoneAvailable === false
        ? "La vérification par SMS n’est pas encore activée. Vous pouvez préparer votre demande ; rien n’est encore envoyé."
        : "La disponibilité du service SMS n’a pas pu être vérifiée. Réessayez." } : {}) },
    currency: "eur",
  };
}
