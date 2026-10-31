// Explicit validity semantics mirrored from migration 015 (quote_validity_state):
// null → "unspecified" (never expired), past UTC date → "expired", else "valid".
import type { ValidityState } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function validityState(validUntil: string | null | undefined, now: Date = new Date()): ValidityState {
  if (!validUntil) return "unspecified";
  if (!isIsoDate(validUntil)) return "unspecified";
  return validUntil < todayUtc(now) ? "expired" : "valid";
}
/** Form rule: a validity may be cleared, or set to today (UTC) or later. Never in the past. */
export function validateValidUntil(raw: string, now: Date = new Date()): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (!isIsoDate(value)) return { ok: false, message: "Indiquez une date au format AAAA-MM-JJ." };
  if (value < todayUtc(now)) return { ok: false, message: "La date de validité ne peut pas être déjà passée." };
  return { ok: true, value };
}
