// PUB-02 (ROOT final contract) — reviewed booking submission, shared by the app and its tests.
// A NEW booking, or a key refused with estimate_review_required and explicitly re-confirmed, is
// reviewed against the version RENDERED by BookingConfirm (forced re-read just before the POST). The
// version is stored IN the booking draft next to its key (same storage / TTL / fence); a retry of the
// same key resends it unchanged; the key never changes. Identity is re-checked after the async read and
// before any persist or POST. Only the response code estimate_review_required marks the key for review.
import { ApiRequestError } from "../../app/api";
import { ensureRequestId, saveBooking, type BookingDraft } from "../../app/booking-draft";
import { ESTIMATE_REVIEW_CODE, REVIEW_SCOPES, getPricesState, loadPrices, reviewDecision, shownVersion, type PriceCategory } from "./model";

export const REVIEW_STORAGE_ERROR = "Votre demande n’a pas été envoyée : ce navigateur n’a pas pu enregistrer votre confirmation. Réessayez.";
export const KEY_STORAGE_ERROR =
  "Votre demande n’a pas été envoyée : ce navigateur n’a pas pu préparer son envoi en toute sécurité. Réessayez ; si cela persiste, rechargez la page.";

export async function sendReviewedBooking<T>({
  current,
  category,
  storage,
  alive,
  onKeyed,
  buildBody,
  post,
  fetcher,
}: {
  current: BookingDraft;
  category: PriceCategory;
  storage: Storage | null;
  /** Same identity / still mounted (checked after every await, before any persist or POST). */
  alive: () => boolean;
  onKeyed: (booking: BookingDraft) => void;
  buildBody: (request_id: string, booking: BookingDraft) => Record<string, unknown>;
  post: (body: Record<string, unknown>) => Promise<T>;
  fetcher?: typeof fetch;
}): Promise<T | undefined> {
  let next: BookingDraft = current;
  // A NEW booking, or a key refused with estimate_review_required (durable flag in the draft), is
  // reviewed now; any other retry resends the stored version unchanged with the same key.
  const needsReview = !current.request_id || current.estimate_review_required === true;
  if (needsReview) {
    const rendered = shownVersion(REVIEW_SCOPES.bookingConfirm);
    await loadPrices(fetcher, true);
    if (!alive()) return undefined; // identity changed during the read: no persist, no POST
    const fresh = getPricesState();
    const decision = reviewDecision(rendered, fresh);
    if (decision.kind === "block") throw new Error(decision.message);
    const { reviewed_estimate_version: _v, reviewed_estimate_range: _r, estimate_review_required: _f, ...rest } = current;
    void _v, void _r, void _f;
    next =
      decision.kind === "send" && fresh.data
        ? { ...rest, reviewed_estimate_version: decision.version, reviewed_estimate_range: { ...fresh.data.ranges[category] } }
        : rest;
    if (current.request_id && !saveBooking(storage, next)) throw new Error(REVIEW_STORAGE_ERROR);
  }
  if (!alive()) return undefined;
  const keyed = ensureRequestId(storage, next);
  if (!keyed) throw new Error(KEY_STORAGE_ERROR);
  if (keyed.booking !== current) onKeyed(keyed.booking);
  const version = keyed.booking.reviewed_estimate_version;
  const body = { ...buildBody(keyed.request_id, keyed.booking), ...(version !== undefined ? { reviewed_estimate_version: version } : {}) };
  try {
    return await post(body);
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 409 && e.code === ESTIMATE_REVIEW_CODE) {
      // Same key kept; the refusal is persisted in the draft (recoverable after a reload); the new
      // range is re-read for display; only an explicit new click changes the version.
      if (alive()) {
        const flagged: BookingDraft = { ...keyed.booking, estimate_review_required: true };
        if (saveBooking(storage, flagged)) onKeyed(flagged);
        void loadPrices(fetcher, true);
      }
      throw new Error(e.message);
    }
    throw e;
  }
}
