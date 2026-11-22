// Booking payment status of a dossier (GET /api/bookings/status?intervention_id=…, owner only,
// uniform 404 for legacy/foreign dossiers). Pure parsing + a small fetch client; no React.
// A return URL (?booking_return=success) never proves anything: only this server status does.
import { api, ApiRequestError } from "./api";

export type BookingPayment =
  | { method: "on_site"; status: "due_on_site" }
  | { method: "card_hold"; status: "authorization_recorded" | "authorized"; checked_at: string | null };
export type BookingStatus =
  | { kind: "booking"; payment: BookingPayment }
  | { kind: "legacy" } // 404: not a booking dossier (or not ours) — keep the legacy payment UI
  | { kind: "unavailable" };

export function parseBookingStatus(raw: unknown): BookingStatus {
  const v = raw as { status?: unknown; payment?: { method?: unknown; status?: unknown; checked_at?: unknown } };
  if (!v || v.status !== "confirmed" || !v.payment) return { kind: "unavailable" };
  const { method, status, checked_at } = v.payment;
  if (method === "on_site" && status === "due_on_site") return { kind: "booking", payment: { method, status } };
  if (method === "card_hold" && (status === "authorization_recorded" || status === "authorized"))
    return { kind: "booking", payment: { method, status, checked_at: typeof checked_at === "string" ? checked_at : null } };
  return { kind: "unavailable" };
}

export async function fetchBookingStatus(interventionId: string, call: typeof api = api): Promise<BookingStatus> {
  try {
    return parseBookingStatus(await call<unknown>(`/api/bookings/status?intervention_id=${encodeURIComponent(interventionId)}`));
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return { kind: "legacy" };
    return { kind: "unavailable" };
  }
}

export const CANCELLED_HOLD_TEXT = "Demande annulée : l’empreinte bancaire ne sera pas débitée. Sa libération est demandée au prestataire de paiement à l’annulation ; à défaut, elle expire d’elle-même. Le délai de disparition sur votre relevé dépend de votre banque.";
/** FIN-04: notice after « Annuler la demande », from the server's verified release outcome (never assumed). */
export function cancelHoldNotice(outcome: unknown): string | null {
  if (outcome === "released") return "Demande annulée. L’empreinte bancaire a été libérée auprès du prestataire de paiement : rien n’est débité. Le délai de disparition sur votre relevé dépend de votre banque.";
  if (outcome === "release_failed") return "Demande annulée. La libération de l’empreinte bancaire n’a pas pu être confirmée : rien ne sera débité et l’autorisation expirera d’elle-même. Si elle reste visible plusieurs jours, contactez l’assistance.";
  return null;
}
/** Honest wording: on site ⇒ planned, nothing collected; card ⇒ recorded at a date, not a charge, not forever. */
export function bookingPaymentText(p: BookingPayment, formatDate: (iso: string) => string, cancelled = false): string {
  // FIN-04: a cancelled dossier is never settled — no « paiement prévu », no « pourra être prélevé ».
  // The server status does not carry the release of the hold, so nothing is claimed about it here
  // beyond what holds in every case (a cancelled dossier cannot be captured; a hold expires).
  if (cancelled) return p.method === "on_site" ? "Demande annulée : aucun paiement n’est dû." : CANCELLED_HOLD_TEXT;
  if (p.method === "on_site") return "Paiement prévu après l’intervention, sur la plateforme (par carte depuis le suivi du dossier). Aucun paiement n’a encore été confirmé ; ne réglez jamais l’artisan directement.";
  const when = p.checked_at ? ` (vérifiée le ${formatDate(p.checked_at)})` : "";
  return `Empreinte bancaire enregistrée${when}. Ce n’est pas un débit ; seul le montant du devis accepté pourra être prélevé, et une empreinte n’est pas valable indéfiniment.`;
}

export { safeCheckoutUrl } from "../../lib/shared/stripe-checkout-url";

/** Payment provenance: « on_site_declared » = received in cash/on site as DECLARED by the assigned
 *  artisan (business « paid », never a bank confirmation). Read loosely: the projection field is
 *  added by ROOT (Payment.method); anything else is treated as the legacy bank payment. */
export function isDeclaredOnSite(payment: object | null | undefined): boolean {
  return !!payment && (payment as { method?: unknown }).method === "on_site_declared";
}
