// Idempotency key of a NON-booking request creation (manager / enterprise POST /api/interventions,
// server create_intervention_once). Pure, no React, no network.
//
// The key and the exact payload are PERSISTED in the tab BEFORE the POST. While the outcome is
// uncertain (lost reply, 5xx, offline, 401, 409), the next submit replays the ORIGINAL frozen
// payload with the SAME key — never a new UUID, never the edited values. The entry is dropped only
// once the outcome is known: created (2xx) or definitively refused (400/403/422).
import { REQUEST_ID, newRequestId } from "./booking-draft";
import type { RequestValues } from "./types";

export const REQUEST_KEY_STORAGE = "courant-request-key-v1";
export const REQUEST_KEY_TTL_MS = 24 * 60 * 60 * 1000;

export type StoredRequestKey = { request_id: string; payload: RequestValues; savedAt: number };
export type PreparedRequest = { request_id: string; payload: RequestValues; replayed: boolean };

const canonical = (v: RequestValues) =>
  JSON.stringify(Object.keys(v).sort().reduce<Record<string, unknown>>((o, k) => ((o[k] = (v as Record<string, unknown>)[k]), o), {}));

export function readRequestKey(raw: string | null, now = Date.now()): StoredRequestKey | null {
  if (!raw || raw.length > 16384) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredRequestKey>;
    if (typeof v.request_id !== "string" || !REQUEST_ID.test(v.request_id)) return null;
    if (!v.payload || typeof v.payload !== "object" || typeof v.savedAt !== "number") return null;
    if (now - v.savedAt > REQUEST_KEY_TTL_MS || v.savedAt > now + 60_000) return null;
    return { request_id: v.request_id.toLowerCase(), payload: v.payload as RequestValues, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

/** Key + frozen payload to send, PROVEN stored first; null ⇒ storage unusable ⇒ send nothing. */
export function prepareRequestKey(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  values: RequestValues,
  newId: () => string = newRequestId,
  now = Date.now(),
): PreparedRequest | null {
  if (!storage) return null;
  let stored: StoredRequestKey | null = null;
  try {
    stored = readRequestKey(storage.getItem(REQUEST_KEY_STORAGE), now);
  } catch {
    return null;
  }
  // Uncertain earlier attempt: replay it exactly (same key, original payload).
  if (stored) return { request_id: stored.request_id, payload: stored.payload, replayed: canonical(stored.payload) !== canonical(values) };
  const request_id = newId();
  if (!REQUEST_ID.test(request_id)) return null;
  const entry: StoredRequestKey = { request_id, payload: values, savedAt: now };
  try {
    storage.setItem(REQUEST_KEY_STORAGE, JSON.stringify(entry));
    const back = readRequestKey(storage.getItem(REQUEST_KEY_STORAGE), now);
    return back?.request_id === request_id ? { request_id, payload: values, replayed: false } : null;
  } catch {
    return null;
  }
}

/** Outcome known for THIS key: forget it (another key is never removed). */
export function settleRequestKey(storage: Pick<Storage, "getItem" | "removeItem"> | null | undefined, request_id: string, now = Date.now()): void {
  if (!storage) return;
  try {
    if (readRequestKey(storage.getItem(REQUEST_KEY_STORAGE), now)?.request_id === request_id.toLowerCase()) storage.removeItem(REQUEST_KEY_STORAGE);
  } catch {
    /* nothing to settle */
  }
}

/** PUB-02 (ROOT final contract): after a 409 estimate_review_required and an EXPLICIT new click,
 *  ONLY the frozen payload's reviewed_estimate_version of THIS key changes (same key, same content,
 *  same savedAt); proven by read-back. Any other field or key is never touched. */
export function updateFrozenVersion(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  request_id: string,
  version: number,
  now = Date.now(),
): boolean {
  if (!storage || !Number.isInteger(version) || version < 1) return false;
  try {
    const stored = readRequestKey(storage.getItem(REQUEST_KEY_STORAGE), now);
    if (!stored || stored.request_id !== request_id.toLowerCase()) return false;
    const entry: StoredRequestKey = { ...stored, payload: { ...stored.payload, reviewed_estimate_version: version } as RequestValues };
    storage.setItem(REQUEST_KEY_STORAGE, JSON.stringify(entry));
    const back = readRequestKey(storage.getItem(REQUEST_KEY_STORAGE), now);
    // Same key, same savedAt, EXACT frozen payload with only the version changed.
    return !!back && back.request_id === stored.request_id && back.savedAt === stored.savedAt && canonical(back.payload) === canonical(entry.payload);
  } catch {
    return false;
  }
}

/** HTTP outcomes after which the request is known NOT to exist (key may be dropped). */
export const DEFINITIVE_REFUSAL = new Set([400, 403, 422]);
