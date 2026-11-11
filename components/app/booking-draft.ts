import { parseBookingLocation, type BookingLocation } from "../../shared/booking-location";
import { normalizeBookingPhone as normalizePhone } from "../../shared/booking-contact";
// Service booking flow (FASTSPLIT-SERVICE-BOOKING-FLOW-001). Pure, no React, no network.
//
// The request itself travels in the canonical public draft (lib/shared/request-draft.ts:
// category, description, address, postal_code, city, urgency). The booking EXTRAS live in a
// separate tab-scoped entry, same 30 min TTL:
//  - the chosen service slug and the wished slot (non-personal, may be written in the description);
//  - the contact details (civility, names, email, phone, company flag): PRIVATE — never written
//    into the description (offers can read it). After login they go to PATCH /api/profile
//    {full_name, phone}; the email is the Auth email.
export const BOOKING_DRAFT_KEY = "courant-booking-draft";
export const BOOKING_TTL_MS = 30 * 60 * 1000;
const MAX_RAW = 8192;

export const SLOTS = ["tomorrow", "day_after", "next_days"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT_LABEL: Record<Slot, string> = {
  tomorrow: "Demain",
  day_after: "Après-demain",
  next_days: "Dans les prochains jours",
};
export const CIVILITIES = ["mme", "m", ""] as const;
export type Civility = (typeof CIVILITIES)[number];

export type BookingContact = {
  civility: Civility;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  company: boolean;
};
export type BookingDraft = {
  location?: BookingLocation;
  slug: string;
  urgent: boolean;
  /** Wished slot when not urgent; null when urgent. A wish, never a booked appointment. */
  slot: Slot | null;
  /** Free, NON-personal notes about the fault (optional). */
  notes: string;
  contact: BookingContact;
  /** Idempotency key of the ONE request this booking creates (UUID, stable for the tab's draft
   *  lifetime, carried across login/reload/back/errors). Legacy drafts may lack it: a key is then
   *  created and PROVEN persisted before the first POST. */
  request_id?: string;
  /** Guest checkout: the customer's choice. « on_site » (historical code) = pay AFTER the
   *  intervention ON THE PLATFORM (card via the follow-up, secure link or QR code) — never a direct
   *  payment to the artisan; « card_hold » = card authorisation (empreinte, NOT a charge).
   *  Optional for legacy drafts (then asked again). */
  payment?: PaymentChoice;
  /** PUB-02: indicative estimate version reviewed and sent with THIS request_id (same storage, TTL and
   *  fence as the draft). A retry of the same key resends it; it changes only after an explicit
   *  re-confirmation following a 409 estimate_review_required. */
  reviewed_estimate_version?: number;
  /** PUB-02: amounts of that reviewed version for this request's category (what the user confirmed;
   *  shown instead of any later tariff). */
  reviewed_estimate_range?: { min_cents: number; max_cents: number };
  /** PUB-02: this key was refused with estimate_review_required; survives a reload until the user
   *  explicitly re-confirms with the SAME key. */
  estimate_review_required?: true;
};
export const PAYMENT_CHOICES = ["on_site", "card_hold"] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];
export const PAYMENT_LABEL: Record<PaymentChoice, string> = {
  on_site: "Après intervention — paiement sur la plateforme",
  card_hold: "Empreinte bancaire (aucun débit à la réservation)",
};

export { normalizePhone };
export type StoredBooking = { savedAt: number; booking: BookingDraft };

const LIMITS = { slug: 80, notes: 1500, first_name: 60, last_name: 60, email: 254, phone: 30 } as const;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

export function parseBooking(input: unknown): BookingDraft | null {
  if (!isObject(input) || !isObject(input.contact)) return null;
  const location = input.location === undefined ? undefined : parseBookingLocation(input.location);
  if (location === null) return null;
  const slug = str(input.slug, LIMITS.slug);
  const notes = str(input.notes ?? "", LIMITS.notes);
  if (!slug || !/^[a-z0-9-]+$/.test(slug) || notes === null || typeof input.urgent !== "boolean") return null;
  const slot = input.slot === null || input.slot === undefined ? null : SLOTS.includes(input.slot as Slot) ? (input.slot as Slot) : undefined;
  if (slot === undefined || (input.urgent && slot !== null)) return null;
  const c = input.contact;
  const civility = (c.civility ?? "") as Civility;
  if (!CIVILITIES.includes(civility) || typeof (c.company ?? false) !== "boolean") return null;
  const first_name = str(c.first_name ?? "", LIMITS.first_name);
  const last_name = str(c.last_name ?? "", LIMITS.last_name);
  const email = str(c.email ?? "", LIMITS.email);
  const phone = str(c.phone ?? "", LIMITS.phone);
  if (first_name === null || last_name === null || email === null || phone === null) return null;
  let request_id: string | undefined;
  if (input.request_id !== undefined) {
    if (typeof input.request_id !== "string" || !REQUEST_ID.test(input.request_id)) return null;
    request_id = input.request_id.toLowerCase();
  }
  let payment: PaymentChoice | undefined;
  if (input.payment !== undefined) {
    if (!PAYMENT_CHOICES.includes(input.payment as PaymentChoice)) return null;
    payment = input.payment as PaymentChoice;
  }
  let reviewed: number | undefined;
  if (input.reviewed_estimate_version !== undefined) {
    const v = input.reviewed_estimate_version;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 2147483647 || !request_id) return null;
    reviewed = v;
  }
  let range: { min_cents: number; max_cents: number } | undefined;
  if (input.reviewed_estimate_range !== undefined) {
    const r = input.reviewed_estimate_range as { min_cents?: unknown; max_cents?: unknown } | null;
    const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 2147483647;
    if (!r || typeof r !== "object" || !ok(r.min_cents) || !ok(r.max_cents) || r.max_cents < r.min_cents || reviewed === undefined) return null;
    range = { min_cents: r.min_cents, max_cents: r.max_cents };
  }
  if (input.estimate_review_required !== undefined && (input.estimate_review_required !== true || !request_id)) return null;
  return { ...(location ? { location } : {}), slug, urgent: input.urgent, slot, notes, contact: { civility, first_name, last_name, email, phone, company: Boolean(c.company) }, ...(request_id ? { request_id } : {}), ...(payment ? { payment } : {}), ...(reviewed !== undefined ? { reviewed_estimate_version: reviewed } : {}), ...(range ? { reviewed_estimate_range: range } : {}), ...(input.estimate_review_required === true ? { estimate_review_required: true as const } : {}) };
}

export const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** The booking and its key are proven in this tab's storage before any POST, so a reload
 *  can recover the same reviewed estimate. An existing key is never replaced.
 *  null ⇒ not provable (no storage, refused write, readback mismatch): the caller sends nothing. */
export function ensureRequestId(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  booking: BookingDraft,
  now = Date.now(),
): { booking: BookingDraft; request_id: string } | null {
  if (!storage) return null;
  const existing = booking.request_id && REQUEST_ID.test(booking.request_id) ? booking.request_id.toLowerCase() : null;
  const request_id = existing ?? newRequestId();
  const next = existing ? booking : { ...booking, request_id };
  const expected = parseBooking(next);
  if (!expected) return null;
  const matchesStorage = () => {
    try {
      const stored = readBooking(storage.getItem(BOOKING_DRAFT_KEY), now)?.booking;
      return JSON.stringify(stored) === JSON.stringify(expected);
    } catch {
      return false;
    }
  };
  if (existing && matchesStorage()) return { booking: next, request_id };
  if (!saveBooking(storage, next, now) || !matchesStorage()) return null;
  return { booking: next, request_id };
}

export function readBooking(raw: unknown, now = Date.now()): StoredBooking | null {
  if (typeof raw !== "string" || raw.length > MAX_RAW) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Number.isSafeInteger(parsed.savedAt)) return null;
    const savedAt = parsed.savedAt as number;
    if (savedAt > now + 30_000 || now - savedAt >= BOOKING_TTL_MS) return null;
    const booking = parseBooking(parsed.booking);
    return booking ? { savedAt, booking } : null;
  } catch {
    return null;
  }
}

export function saveBooking(storage: Pick<Storage, "setItem"> | null | undefined, booking: BookingDraft, now = Date.now()): boolean {
  const parsed = parseBooking(booking);
  if (!parsed || !storage) return false;
  try {
    storage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({ savedAt: now, booking: parsed }));
    return true;
  } catch {
    return false;
  }
}
export function clearBooking(storage: Pick<Storage, "removeItem"> | null | undefined): void {
  try {
    storage?.removeItem(BOOKING_DRAFT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Request description from NON-personal parts only: service title, urgency/slot wish, notes. */
export function bookingDescription(serviceTitle: string, booking: Pick<BookingDraft, "urgent" | "slot" | "notes">): string {
  const wish = booking.urgent ? "Intervention souhaitée en urgence." : booking.slot ? `Créneau souhaité : ${SLOT_LABEL[booking.slot].toLowerCase()}.` : "";
  const notes = booking.notes.trim();
  return [`Prestation choisie : ${serviceTitle.trim()}.`, wish, notes].filter(Boolean).join("\n").slice(0, 2000);
}

/** Private profile fields for PATCH /api/profile after login (never sent with the request). */
/** PATCH /api/profile limits: full_name 1..120, phone ≤ 30 (never truncated: refused instead). */
export const FULL_NAME_MAX = 120;
export const PHONE_MAX = 30;
export const fullName = (c: Pick<BookingContact, "first_name" | "last_name">) => `${c.first_name.trim()} ${c.last_name.trim()}`.trim();
export function profilePatch(contact: BookingContact): { full_name: string; phone: string } | null {
  const full_name = fullName(contact);
  const phone = contact.phone.trim();
  if (!full_name || full_name.length > FULL_NAME_MAX || phone.length > PHONE_MAX) return null;
  return { full_name, phone };
}

/** Minimal client-side checks of the contact step (the server re-validates everything). */
export function contactErrors(c: BookingContact): Partial<Record<"first_name" | "last_name" | "email" | "phone", string>> {
  const errors: Partial<Record<"first_name" | "last_name" | "email" | "phone", string>> = {};
  if (!c.first_name.trim()) errors.first_name = "Indiquez votre prénom.";
  if (!c.last_name.trim()) errors.last_name = "Indiquez votre nom.";
  else if (fullName(c).length > FULL_NAME_MAX) errors.last_name = `Prénom et nom : ${FULL_NAME_MAX} caractères au plus.`;
  // Email is OPTIONAL (guest checkout: account optional); when given it must be valid, ≤ 254.
  const email = c.email.trim();
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = "Indiquez un email valide, ou laissez ce champ vide.";
  // Same E.164 normalisation as the server contract (0696/0697 → +596, 06/07 → +33, « + » kept).
  if (!normalizePhone(c.phone)) errors.phone = "Indiquez un numéro de mobile valide (ex. 0696 12 34 56).";
  return errors;
}
