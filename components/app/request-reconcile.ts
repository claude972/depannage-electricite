// Unknown outcome of « create request » (lost reply, cut connection, unusable 2xx): the server may
// already have stored the dossier. Before ANY resend, the app re-reads the workspace and looks for
// that dossier; a resend is allowed only when the read SUCCEEDED and found nothing. Never two POSTs
// for one send. Pure, no React; the marker kept in the tab holds no personal data (digest only).
import type { Intervention, RequestValues } from "./types";

export const PENDING_CREATE_KEY = "courant-pending-create";
/** A dossier created more than this before the send cannot be the one we sent. */
const CLOCK_SKEW_MS = 2 * 60 * 1000;
const MARKER_TTL_MS = 24 * 60 * 60 * 1000;

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Non-reversible short digest of the request fields (FNV-1a), stored instead of the values. */
export function requestDigest(values: RequestValues): string {
  const text = [values.category, values.urgency, values.site_id ?? "", values.description, values.address, values.postal_code, values.city].map(norm).join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type PendingCreate = { userId: string; sentAt: number; digest: string };

/** The dossier this user's interrupted send created, if the workspace shows it. */
export function findCommittedRequest(interventions: Intervention[], values: RequestValues, userId: string, sentAt: number): Intervention | null {
  const digest = requestDigest(values);
  const match = interventions
    .filter((i) => (!i.client_id || i.client_id === userId) && Date.parse(i.created_at) >= sentAt - CLOCK_SKEW_MS)
    .filter((i) => requestDigest({ category: i.category, urgency: i.urgency, site_id: i.site_id ?? undefined, description: i.description, address: i.address, postal_code: i.postal_code, city: i.city }) === digest)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return match[0] ?? null;
}

/** Errors whose outcome is UNKNOWN for a mutation (the server may have committed). */
export function outcomeUnknown(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  return status === 0 || status === 502 || status === 504;
}

export function readPendingCreate(storage: Pick<Storage, "getItem"> | null, now = Date.now()): PendingCreate | null {
  try {
    const raw = storage?.getItem(PENDING_CREATE_KEY);
    if (!raw || raw.length > 512) return null;
    const p = JSON.parse(raw) as Partial<PendingCreate>;
    if (typeof p.userId !== "string" || typeof p.digest !== "string" || !/^[0-9a-f]{8}$/.test(p.digest) || !Number.isSafeInteger(p.sentAt)) return null;
    if (now - (p.sentAt as number) > MARKER_TTL_MS) return null;
    return { userId: p.userId, sentAt: p.sentAt as number, digest: p.digest };
  } catch {
    return null;
  }
}
export function writePendingCreate(storage: Pick<Storage, "setItem"> | null, marker: PendingCreate): void {
  try {
    storage?.setItem(PENDING_CREATE_KEY, JSON.stringify(marker));
  } catch {
    /* memory marker still protects this page */
  }
}
export function clearPendingCreate(storage: Pick<Storage, "removeItem"> | null): void {
  try {
    storage?.removeItem(PENDING_CREATE_KEY);
  } catch {
    /* nothing */
  }
}

export const UNKNOWN_OUTCOME_MESSAGE =
  "La connexion a été interrompue pendant l’envoi. Nous vérifions si votre demande a été enregistrée avant tout nouvel envoi.";
export const VERIFY_FAILED_MESSAGE =
  "Nous n’avons pas pu vérifier si votre demande a été enregistrée. Rien ne sera renvoyé tant que ce n’est pas vérifié : réessayez dans un instant.";
