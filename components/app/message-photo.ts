// Private photo in an intervention conversation (SYS-04 / M62), browser side. No React.
//   1) POST /api/documents (existing multipart: file + intervention_id; JPEG, PNG, WebP) — the
//      document must be CONFIRMED before the message is sent; an unknown upload outcome is never
//      retried automatically.
//   2) POST /api/messages/photo { id, intervention_id, document_id, body } — `id` is a stable send
//      UUID created before the first emission; a lost reply replays the SAME command (same id, same
//      confirmed document). 201 { message: { id, intervention_id, author_id, body, created_at,
//      attachment_id } } with attachment_id === document_id; exact replay ⇒ same message; collision
//      ⇒ refused.
//   3) GET /api/messages/photo?message_id=UUID → { url } (short-lived signed URL), on demand only,
//      never stored with the messages.
import { ApiRequestError, PHOTO_TYPES, uploadDocument, validateUpload } from "./api";
import type { Message } from "./types";

export const PHOTO_CAPTION_MAX = 2000;
export const PHOTO_TIMEOUT_MS = 20_000;
export type PhotoFetch = (url: string, init: RequestInit) => Promise<Response>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
export const newSendId = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID().toLowerCase() : null);

export const PHOTO_COPY = {
  attach: "Joindre une photo",
  caption: "Légende (facultative)",
  send: "Envoyer la photo",
  cancel: "Annuler",
  uploading: "Enregistrement de la photo…",
  sending: "Envoi du message…",
  done: "Photo envoyée.",
  uploadUnknown: "La connexion a été interrompue pendant l’enregistrement de la photo : elle a pu être enregistrée. Rien n’est renvoyé automatiquement. Vous pouvez la renvoyer, au risque d’en garder deux exemplaires dans les documents.",
  reupload: "Renvoyer la photo",
  sendRetry: "Le message n’a pas été confirmé. La photo est bien enregistrée : « Réessayer l’envoi » renvoie exactement le même message, sans doublon.",
  retrySend: "Réessayer l’envoi",
  collision: "Ce message a déjà été envoyé avec un autre contenu : rien n’a été modifié. Recommencez un nouvel envoi.",
  refused: "L’envoi de cette photo est refusé pour ce dossier.",
  unavailable: "L’envoi de photo n’est pas disponible pour le moment.",
  signedOut: "Votre session a expiré. Reconnectez-vous pour envoyer la photo.",
  stale: "Le dossier ou le compte a changé : cet envoi n’est plus affiché ici.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant d’envoi sécurisé : aucun envoi n’est possible ici.",
  open: "Voir la photo",
  close: "Masquer la photo",
  opening: "Ouverture…",
  openFailed: "La photo n’a pas pu être ouverte. Réessayez.",
  openGone: "Cette photo n’est plus accessible.",
} as const;

export type UploadOutcome = { kind: "ok"; documentId: string } | { kind: "unknown"; message: string } | { kind: "failed"; message: string };

/** Client pre-check (photo types only) then the existing private upload; the receipt is required. */
export async function uploadPhoto(file: File, interventionId: string, fetchImpl: PhotoFetch): Promise<UploadOutcome> {
  const invalid = validateUpload(file, PHOTO_TYPES);
  if (invalid) return { kind: "failed", message: invalid };
  try {
    const doc = await uploadDocument(file, interventionId, fetchImpl);
    if (!isUuid(doc.id) || (doc.mime_type && !PHOTO_TYPES.includes(doc.mime_type))) return { kind: "unknown", message: PHOTO_COPY.uploadUnknown };
    return { kind: "ok", documentId: doc.id.toLowerCase() };
  } catch (error) {
    // status 0 (transport) or 502 (no receipt): the file may exist — outcome unknown.
    if (error instanceof ApiRequestError && (error.status === 0 || error.status === 502 || error.status >= 500)) return { kind: "unknown", message: PHOTO_COPY.uploadUnknown };
    return { kind: "failed", message: error instanceof Error && error.message ? error.message : PHOTO_COPY.refused };
  }
}

export type PhotoCommand = { id: string; intervention_id: string; document_id: string; body: string };
export type SendOutcome = { kind: "ok"; message: Message } | { kind: "retry" } | { kind: "collision" } | { kind: "refused"; message: string } | { kind: "signed_out" } | { kind: "unavailable" };

/** The 201 must answer exactly this command (same id, dossier, document, caption). */
export function parsePhotoMessage(raw: unknown, cmd: PhotoCommand): Message | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = (raw as { message?: unknown }).message;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const r = m as Record<string, unknown>;
  if (!isUuid(r.id) || r.id.toLowerCase() !== cmd.id) return null;
  if (r.intervention_id !== cmd.intervention_id || typeof r.author_id !== "string" || !r.author_id || typeof r.created_at !== "string" || !r.created_at) return null;
  if (typeof r.body !== "string" || r.body !== cmd.body) return null;
  if (!isUuid(r.attachment_id) || r.attachment_id.toLowerCase() !== cmd.document_id) return null;
  return { id: cmd.id, intervention_id: cmd.intervention_id, author_id: r.author_id, body: r.body, created_at: r.created_at, attachment_id: cmd.document_id };
}

async function timed(fetchImpl: PhotoFetch, url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), PHOTO_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendPhotoMessage(fetchImpl: PhotoFetch, cmd: PhotoCommand): Promise<SendOutcome> {
  const r = await timed(fetchImpl, "/api/messages/photo", {
    method: "POST",
    headers: { accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ id: cmd.id, intervention_id: cmd.intervention_id, document_id: cmd.document_id, body: cmd.body }),
  });
  if (r.status === 201 || r.status === 200) {
    const message = parsePhotoMessage(r.body, cmd);
    return message ? { kind: "ok", message } : { kind: "retry" }; // unverifiable receipt: same command again
  }
  if (r.status === 409) return { kind: "collision" };
  if (r.status === 401) return { kind: "signed_out" };
  if (r.status === 405 || (r.status === 404 && !(r.body && typeof r.body === "object"))) return { kind: "unavailable" };
  if (r.status === 400 || r.status === 403 || r.status === 404 || r.status === 422) {
    const text = r.body && typeof r.body === "object" && typeof (r.body as { error?: unknown }).error === "string" ? (r.body as { error: string }).error : PHOTO_COPY.refused;
    return { kind: "refused", message: text };
  }
  return { kind: "retry" }; // 0, timeout, 429, 5xx: the outcome is unknown — explicit replay, same id
}

export type OpenOutcome = { kind: "ok"; url: string } | { kind: "gone" } | { kind: "signed_out" } | { kind: "failed" };
/** Short-lived signed URL, fetched on demand; the caller keeps it in memory only while shown. */
export async function openPhoto(fetchImpl: PhotoFetch, messageId: string): Promise<OpenOutcome> {
  if (!isUuid(messageId)) return { kind: "gone" };
  const r = await timed(fetchImpl, `/api/messages/photo?message_id=${encodeURIComponent(messageId)}`, { method: "GET", headers: { accept: "application/json" } });
  if (r.status === 401) return { kind: "signed_out" };
  if (r.status === 403 || r.status === 404) return { kind: "gone" };
  if (r.status !== 200 || !r.body || typeof r.body !== "object") return { kind: "failed" };
  const url = (r.body as { url?: unknown }).url;
  if (typeof url !== "string") return { kind: "failed" };
  try {
    const parsed = new URL(url, typeof location !== "undefined" ? location.href : "http://localhost");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
  return { kind: "ok", url };
}
