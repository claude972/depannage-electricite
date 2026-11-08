// SUP — exact recovery of a support request after a lost or unverifiable reply (pure, no React).
// The EDITABLE draft and the IMMUTABLE submitted snapshot are separate:
//   - the snapshot { request_id, subject, body, intervention_id } is frozen at the first real send,
//     written to tab storage and READ BACK before the POST (else 0 POST);
//   - a retry after an uncertain outcome re-sends exactly that snapshot (same id, same content);
//   - editing the draft never touches it; a new request is a separate explicit action.
// Keys carry the `courant-private-` prefix (central purge on identity change) and are bound to
// mode + uid ONLY, so the same account finds its snapshot again after a reload (the runtime
// generation changes); the generation is kept for the reply fence. A record is restored only by
// strict parse for the SAME account and mode. The legacy pending record
// (`courant-support-pending-<profile>`, no marker / version) is never sent automatically: a provable
// tuple becomes the snapshot (same request_id, same content) offered for an explicit resend; an
// unprovable one is offered for review or explicit abandon only.
import { z } from "zod";

export const SNAPSHOT_MARKER = "courant-support-snapshot";
export const SNAPSHOT_VERSION = 1;
export const snapshotKey = (mode: string, uid: string) => `courant-private-support-snapshot:${mode}:${uid}`;
export const draftKey = (mode: string, uid: string) => `courant-private-support-draft:${mode}:${uid}`;
export const legacyKey = (profileId: string) => `courant-support-pending-${profileId}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const snapshotSchema = z
  .object({
    marker: z.literal(SNAPSHOT_MARKER),
    v: z.literal(SNAPSHOT_VERSION),
    mode: z.string().min(1),
    uid: z.string().min(1),
    /** "legacy" = recovered from the old record: the outcome of its first send is unknown. */
    origin: z.enum(["form", "legacy"]),
    request_id: z.string().regex(UUID),
    subject: z.string().min(4).max(160),
    body: z.string().min(10).max(4000),
    intervention_id: z.string().regex(UUID).nullable(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
const draftSchema = z
  .object({ marker: z.literal("courant-support-draft"), v: z.literal(1), subject: z.string().max(4000), body: z.string().max(8000), intervention_id: z.string().max(64) })
  .strict();
export type Draft = { subject: string; body: string; intervention_id: string };

export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

/** Same validation as the form and the server: trimmed subject 4–160, message 10–4000. */
export function validate(d: Draft): { subject?: string; body?: string } {
  const s = d.subject.trim();
  const b = d.body.trim();
  const e: { subject?: string; body?: string } = {};
  if (s.length < 4 || s.length > 160) e.subject = "Le sujet doit faire entre 4 et 160 caractères.";
  if (b.length < 10 || b.length > 4000) e.body = "Le message doit faire entre 10 et 4000 caractères.";
  return e;
}

export function freeze(d: Draft, mode: string, uid: string, requestId: string): Snapshot {
  return { marker: SNAPSHOT_MARKER, v: SNAPSHOT_VERSION, mode, uid, origin: "form", request_id: requestId, subject: d.subject.trim(), body: d.body.trim(), intervention_id: d.intervention_id || null };
}

/** Strict restore for this exact identity; anything else (tampered, other account) is ignored. */
export function readSnapshot(store: Store | null, mode: string, uid: string): Snapshot | null {
  if (!store) return null;
  try {
    const raw = store.get(snapshotKey(mode, uid));
    if (!raw) return null;
    const r = snapshotSchema.safeParse(JSON.parse(raw));
    return r.success && r.data.uid === uid && r.data.mode === mode ? r.data : null;
  } catch {
    return null;
  }
}

/** Write then read back; true only when the stored record is exactly the snapshot. */
export function writeSnapshot(store: Store | null, s: Snapshot): boolean {
  if (!store) return false;
  try {
    store.set(snapshotKey(s.mode, s.uid), JSON.stringify(s));
    const back = readSnapshot(store, s.mode, s.uid);
    return back !== null && sameSnapshot(back, s);
  } catch {
    return false;
  }
}
export const sameSnapshot = (a: Snapshot, b: Snapshot) =>
  a.uid === b.uid && a.mode === b.mode && a.origin === b.origin && a.request_id === b.request_id && a.subject === b.subject && a.body === b.body && a.intervention_id === b.intervention_id;
export function clearSnapshot(store: Store | null, mode: string, uid: string) {
  try {
    store?.remove(snapshotKey(mode, uid));
  } catch {}
}

export function readDraft(store: Store | null, mode: string, uid: string): Draft | null {
  if (!store) return null;
  try {
    const raw = store.get(draftKey(mode, uid));
    if (!raw) return null;
    const r = draftSchema.safeParse(JSON.parse(raw));
    return r.success ? { subject: r.data.subject, body: r.data.body, intervention_id: r.data.intervention_id } : null;
  } catch {
    return null;
  }
}
export function writeDraft(store: Store | null, mode: string, uid: string, d: Draft) {
  try {
    if (!d.subject && !d.body) store?.remove(draftKey(mode, uid));
    else store?.set(draftKey(mode, uid), JSON.stringify({ marker: "courant-support-draft", v: 1, ...d }));
  } catch {}
}

/**
 * Legacy record (no marker / version), as the old form sent it (trimmed text, "" ⇒ no dossier):
 *   - "tuple": every field provable ⇒ the EXACT old command, offered for an explicit resend;
 *   - "unproven": present but missing / malformed fields ⇒ review or explicit abandon only;
 *   - null: nothing stored. Never sent automatically, never given a new id.
 */
export type Legacy = { kind: "tuple"; snapshot: Snapshot } | { kind: "unproven" } | null;
export function readLegacy(store: Store | null, profileId: string, mode: string, uid: string): Legacy {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.get(legacyKey(profileId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return { kind: "unproven" };
    const iid = v.intervention_id === undefined || v.intervention_id === null || v.intervention_id === "" ? null : v.intervention_id;
    const candidate = {
      marker: SNAPSHOT_MARKER, v: SNAPSHOT_VERSION, mode, uid, origin: "legacy",
      request_id: v.request_id,
      subject: typeof v.subject === "string" ? v.subject.trim() : v.subject,
      body: typeof v.body === "string" ? v.body.trim() : v.body,
      intervention_id: iid,
    };
    const r = snapshotSchema.safeParse(candidate);
    return r.success ? { kind: "tuple", snapshot: r.data } : { kind: "unproven" };
  } catch {
    return { kind: "unproven" };
  }
}
/** Drops the legacy record only if it is EXACTLY this command (same request_id + content). */
export function dropLegacyIfSame(store: Store | null, profileId: string, snap: Snapshot) {
  const legacy = readLegacy(store, profileId, snap.mode, snap.uid);
  if (legacy?.kind === "tuple" && sameSnapshot({ ...legacy.snapshot, origin: snap.origin }, snap)) dropLegacy(store, profileId);
}
export function dropLegacy(store: Store | null, profileId: string) {
  try {
    store?.remove(legacyKey(profileId));
  } catch {}
}

export const RECOVERY_COPY = {
  pendingTitle: "Envoi précédent non confirmé",
  pending:
    "La réponse à votre envoi précédent n’a pas pu être vérifiée. Renvoyez exactement la même demande : si elle a déjà été enregistrée, aucun doublon ne sera créé.",
  resend: "Renvoyer la demande précédente",
  abandon: "Abandonner cet envoi",
  abandonConfirm:
    "Abandonner l’envoi précédent ? S’il a déjà été enregistré, il restera visible dans vos demandes. Votre texte en cours est conservé.",
  blocked: "Renvoyez d’abord la demande précédente ou abandonnez-la : une nouvelle demande serait créée en plus.",
  editNote: "Les modifications du formulaire ne changent pas la demande précédente.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Réessayez ou utilisez un autre onglet.",
  uncertain: "L’envoi n’a pas pu être confirmé. Votre demande est conservée telle quelle pour être renvoyée.",
  legacyPending:
    "Une demande précédente a été retrouvée sur cet appareil ; son envoi n’a peut-être pas été confirmé. Elle n’a pas été renvoyée : vous pouvez la renvoyer à l’identique (aucun doublon si elle a déjà été enregistrée) ou l’abandonner.",
  unprovenTitle: "Demande précédente non vérifiable",
  unproven:
    "Une demande précédente a été retrouvée, mais son contenu ne peut pas être vérifié. Rien n’a été envoyé. Consultez vos demandes pour savoir si elle a été enregistrée, ou abandonnez-la.",
  review: "Consulter mes demandes",
  abandonUnproven: "Abandonner cette demande",
} as const;
