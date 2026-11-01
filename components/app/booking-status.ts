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

/** Honest wording: on site ⇒ planned, nothing collected; card ⇒ recorded at a date, not a charge, not forever. */
export function bookingPaymentText(p: BookingPayment, formatDate: (iso: string) => string): string {
  if (p.method === "on_site") return "Règlement sur place prévu après l’intervention. Aucun encaissement n’a été confirmé.";
  const when = p.checked_at ? ` (vérifiée le ${formatDate(p.checked_at)})` : "";
  return `Empreinte bancaire enregistrée${when}. Ce n’est pas un débit ; seul le montant du devis accepté pourra être prélevé, et une empreinte n’est pas valable indéfiniment.`;
}

/** Checkout URL from the server: strict HTTPS on the provider origin only (never anything else). */
export function safeCheckoutUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.origin === "https://checkout.stripe.com" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}
