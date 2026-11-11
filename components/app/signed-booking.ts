// Signed-in client request ⇒ booking draft (ROOT decision). Pure, no React, no network.
// Neutral service slug `demande-<catégorie>` (no catalogue service, price or service invented);
// the contact comes from the profile WITHOUT inventing a last name: a single-word full name leaves
// the last name empty for the client to complete on BookingConfirm (existing validation).
import type { BookingDraft } from "./booking-draft";
import type { Profile, RequestValues } from "./types";

export const signedSlug = (category: RequestValues["category"]) => `demande-${category}`;

export function splitFullName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first_name: parts[0] ?? "", last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function bookingFromSignedRequest(values: RequestValues, profile: Pick<Profile, "full_name" | "phone" | "first_name" | "last_name"> | null): BookingDraft {
  const first = profile?.first_name?.trim(), last = profile?.last_name?.trim();
  const name = first && last ? { first_name: first, last_name: last } : splitFullName(profile?.full_name ?? "");
  return {
    slug: signedSlug(values.category),
    urgent: values.urgency === "urgent",
    slot: null,
    notes: "",
    contact: { civility: "", first_name: name.first_name, last_name: name.last_name, email: "", phone: values.contact_phone ?? profile?.phone ?? "", company: false },
  };
}

export function bookingForEditedRequest(current: BookingDraft, previousCategory: RequestValues["category"], values: RequestValues): BookingDraft {
  const urgent = values.urgency === "urgent";
  return {
    ...current,
    slug: previousCategory === values.category ? current.slug : signedSlug(values.category),
    urgent,
    slot: urgent ? null : current.slot,
    contact: { ...current.contact, phone: values.contact_phone ?? current.contact.phone },
  };
}

/** Number of photos chosen before confirmation (File objects themselves are never stored). */
export const PHOTO_COUNT_KEY = "courant-booking-photos-v1";
export function writePhotoCount(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, count: number): void {
  try {
    if (!storage) return;
    if (count > 0) storage.setItem(PHOTO_COUNT_KEY, String(Math.min(count, 99)));
    else storage.removeItem(PHOTO_COUNT_KEY);
  } catch {
    /* best effort: only used to announce lost photos */
  }
}
export function readPhotoCount(storage: Pick<Storage, "getItem"> | null | undefined): number {
  try {
    const n = Number(storage?.getItem(PHOTO_COUNT_KEY));
    return Number.isInteger(n) && n > 0 && n < 100 ? n : 0;
  } catch {
    return 0;
  }
}
