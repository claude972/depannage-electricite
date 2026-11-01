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
  slug: string;
  urgent: boolean;
  /** Wished slot when not urgent; null when urgent. A wish, never a booked appointment. */
  slot: Slot | null;
  /** Free, NON-personal notes about the fault (optional). */
  notes: string;
  contact: BookingContact;
};
export type StoredBooking = { savedAt: number; booking: BookingDraft };

const LIMITS = { slug: 80, notes: 1500, first_name: 60, last_name: 60, email: 254, phone: 30 } as const;
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);

export function parseBooking(input: unknown): BookingDraft | null {
  if (!isObject(input) || !isObject(input.contact)) return null;
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
  return { slug, urgent: input.urgent, slot, notes, contact: { civility, first_name, last_name, email, phone, company: Boolean(c.company) } };
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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) errors.email = "Indiquez un email valide.";
  if (!/^\+?[0-9 .()-]{6,30}$/.test(c.phone.trim())) errors.phone = "Indiquez un numéro de téléphone valide.";
  return errors;
}
