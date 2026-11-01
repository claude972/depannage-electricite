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
