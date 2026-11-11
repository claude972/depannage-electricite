export type PublicDraftValues = {
  category: "outage" | "panel" | "socket" | "lighting" | "diagnostic";
  description: string;
  address: string;
  postal_code: string;
  city: string;
  urgency: "urgent" | "scheduled";
  site_id?: string;
  contact_phone?: string;
  location?: import("../shared/booking-location").BookingLocation;
};
export type PublicDraft = { savedAt: number; values: PublicDraftValues };
export const PUBLIC_DRAFT_KEY: "courant-request-draft";
export const PUBLIC_DRAFT_TTL_MS: number;
export function parsePublicDraftValues(input: unknown): PublicDraftValues | null;
export function readPublicDraft(raw: unknown, now?: number): PublicDraft | null;
export function savePublicDraft(storage: Pick<Storage, "setItem"> | null | undefined, input: unknown, now?: number): { ok: true; draft: PublicDraft } | { ok: false; reason: "invalid" | "unavailable" };
export function clearPublicDraft(storage: Pick<Storage, "removeItem"> | null | undefined): boolean;
