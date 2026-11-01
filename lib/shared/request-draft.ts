// One canonical format for the public offline page and online boot. Importing this module
// never attaches offline DOM behaviour unless the actual static offline page is mounted.
export { PUBLIC_DRAFT_KEY, PUBLIC_DRAFT_TTL_MS, parsePublicDraftValues, readPublicDraft, savePublicDraft, clearPublicDraft } from "../../public/offline-request.js";
export type { PublicDraft, PublicDraftValues } from "../../public/offline-request.js";
