// Boot read of the public request draft (OFFLINE-DRAFT-001). One canonical format, shared with the
// static offline page: lib/shared/request-draft.ts. A malformed, foreign or expired (30 min) entry
// is ignored — never deleted here: only an explicit user action or a successful submission clears it.
import { PUBLIC_DRAFT_KEY, readPublicDraft } from "../../lib/shared/request-draft";
import type { RequestValues } from "./types";

export function readBootDraft(storage: Pick<Storage, "getItem"> | null | undefined, now = Date.now()): RequestValues | null {
  let raw: string | null;
  try {
    raw = storage ? storage.getItem(PUBLIC_DRAFT_KEY) : null;
  } catch {
    return null; // storage refused (private mode, policy): no draft, no crash
  }
  const draft = readPublicDraft(raw, now);
  if (!draft) return null;
  const { site_id, ...rest } = draft.values;
  return site_id ? { ...rest, site_id } : rest;
}

/** Honest notice after « save draft »: never claims a browser save that did not happen. */
export const DRAFT_SAVED_NOTICE =
  "Votre brouillon est conservé dans ce navigateur. Connectez-vous ou créez votre compte pour enregistrer cette demande.";
export const DRAFT_MEMORY_ONLY_NOTICE =
  "Votre saisie est gardée sur cette page uniquement : le navigateur refuse l’enregistrement local. Ne fermez pas cet onglet, connectez-vous ou créez votre compte pour envoyer cette demande.";
export function draftNotice(result: { ok: boolean }): string {
  return result.ok ? DRAFT_SAVED_NOTICE : DRAFT_MEMORY_ONLY_NOTICE;
}
