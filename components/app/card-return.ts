// Card-hold provider return (?booking_request_id&booking_return), kept in a DEDICATED state that
// survives without a booking draft (new tab, expired TTL): the URL proves nothing, so the user can
// « Réessayer la vérification » (server finalize) or « Annuler la réservation » (server cancel)
// with the same key. Cleared ONLY on 201 « confirmed » or « cancelled », or when the identity
// changes (bound to the UID that was current when the return was read). Pure, no React.
import { ApiRequestError } from "./api";

export type CardReturnPhase = "checking" | "needs_action" | "cancelling";
export type CardReturn = { requestId: string; userId: string; phase: CardReturnPhase; message: string };
export type Receipt = { status?: string; intervention?: { id?: string } };
type Api = <T>(path: string, body?: unknown) => Promise<T>;

export const CARD_RETURN_COPY = {
  checking: "Vérification de votre empreinte auprès du service de paiement…",
  interrupted: "Retour du paiement interrompu : le statut de votre empreinte est à vérifier. Rien n’est confirmé tant que ce n’est pas vérifié.",
  failed: "La vérification de votre empreinte n’a pas abouti. Rien n’est confirmé ; réessayez ou annulez la réservation.",
  conflict: "Cette réservation ne peut pas être confirmée avec cette empreinte. Vérifiez « Mes demandes » ou annulez la réservation.",
  cancelFailed: "L’annulation n’a pas pu être confirmée. Réessayez.",
} as const;

/** One finalize; « confirmed » with a dossier id is the only success. */
export async function verifyCardReturn(api: Api, requestId: string): Promise<{ ok: true; interventionId: string } | { ok: false; message: string }> {
  try {
    const r = await api<Receipt>("/api/bookings/finalize", { request_id: requestId });
    if (r?.status === "confirmed" && typeof r.intervention?.id === "string") return { ok: true, interventionId: r.intervention.id };
    return { ok: false, message: CARD_RETURN_COPY.failed };
  } catch (e) {
    return { ok: false, message: e instanceof ApiRequestError && e.status === 409 ? CARD_RETURN_COPY.conflict : CARD_RETURN_COPY.failed };
  }
}

/** One server cancel; only « cancelled » ends the return. */
export async function cancelCardReturn(api: Api, requestId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const r = await api<{ status?: string }>("/api/bookings/cancel", { request_id: requestId });
    return r?.status === "cancelled" ? { ok: true } : { ok: false, message: CARD_RETURN_COPY.cancelFailed };
  } catch {
    return { ok: false, message: CARD_RETURN_COPY.cancelFailed };
  }
}

/** A reply applies only to the return of the SAME request and identity still current. */
export function sameReturn(current: CardReturn | null, requestId: string, userId: string | null): current is CardReturn {
  return !!current && !!userId && current.requestId === requestId && current.userId === userId;
}

// ---- Pending card attempt lookup (GET /api/bookings/pending, owner only, no PII / provider id) ---
export type PendingAttempt = { request_id: string; method: "card_hold"; status: "prepared" | "checkout_open" | "authorized" | "cancelling"; expected_max_cents: number; created_at: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parsePending(raw: unknown): { ok: true; pending: PendingAttempt | null } | { ok: false } {
  const v = raw as { pending?: unknown };
  if (!v || typeof v !== "object" || !("pending" in v)) return { ok: false };
  if (v.pending === null) return { ok: true, pending: null };
  const p = v.pending as Partial<PendingAttempt>;
  if (!p || typeof p.request_id !== "string" || !UUID.test(p.request_id) || p.method !== "card_hold" || !["prepared", "checkout_open", "authorized", "cancelling"].includes(p.status as string) || !Number.isSafeInteger(p.expected_max_cents) || typeof p.created_at !== "string")
    return { ok: false };
  return { ok: true, pending: { request_id: p.request_id.toLowerCase(), method: "card_hold", status: p.status as PendingAttempt["status"], expected_max_cents: p.expected_max_cents as number, created_at: p.created_at } };
}
/** One lookup; an error is NOT « no pending attempt » (the UI shows an error with retry). */
export async function lookupPending(api: Api): Promise<{ ok: true; pending: PendingAttempt | null } | { ok: false }> {
  try {
    return parsePending(await api<unknown>("/api/bookings/pending"));
  } catch {
    return { ok: false };
  }
}
export const PENDING_COPY = {
  found: "Une réservation par carte est en attente. Vérifiez votre empreinte ou annulez la réservation.",
  error: "Impossible de vérifier vos réservations par carte en attente pour le moment.",
} as const;

// ---- Single flight + context check for card verify/cancel (they don't go through run(ctx)) ---------
export type CardFlight = { current: boolean };
/** Runs ONE card action at a time (a second one in the same tick is refused, even before React
 *  re-renders). `still()` is true only while the identity generation AND the UID captured before the
 *  first await are unchanged: check it after EVERY await (provider call AND refresh) before touching
 *  state, storage or navigation. The flight is released in finally, so a retry after 503 works. */
export async function cardAction<T>(
  flight: CardFlight,
  context: { generation(): number; userId(): string | null },
  action: (still: () => boolean, me: string) => Promise<T>,
): Promise<T | false> {
  if (flight.current) return false;
  const me = context.userId();
  if (!me) return false;
  flight.current = true;
  const generation = context.generation();
  const still = () => context.generation() === generation && context.userId() === me;
  try {
    return await action(still, me);
  } finally {
    flight.current = false;
  }
}
