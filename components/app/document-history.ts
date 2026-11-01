// Paginated documents history (documents centre was capped at the 100 workspace rows). Pure
// merge/order helpers, strict page validation and a small fetch client for
// GET /api/documents/history; no React, no cache. Covered by tests/ui/document-history.test.ts.
//
// Contract: GET /api/documents/history?limit=25&cursor=OPAQUE&intervention_id=UUID(optional) → 200
// { documents: [{ id, intervention_id, owner_id, name, mime_type, created_at }],
//   page: { limit, has_more, next_cursor } }. The cursor is bound to user + scope: it is sent back
// unchanged and only with the same intervention_id filter. 503 carries Retry-After (seconds).
import type { StoredDocument } from "./types";

export const DOCUMENT_PAGE_SIZE = 25;
const DEFAULT_RETRY_AFTER_S = 2;

/** Newest first: created_at DESC, then id DESC (total, stable order). */
export function compareDocuments(a: StoredDocument, b: StoredDocument): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Documents in the scope (all, or one dossier), deduplicated by id, newest first. */
export function mergeDocuments(filter: string, ...sources: readonly (readonly StoredDocument[])[]): StoredDocument[] {
  const byId = new Map<string, StoredDocument>();
  for (const list of sources)
    for (const d of list) if ((!filter || d.intervention_id === filter) && !byId.has(d.id)) byId.set(d.id, d);
  return [...byId.values()].sort(compareDocuments);
}

/** State key: a history never survives a change of identity or of filter (cursor scope). */
export const documentHistoryKey = (profileId: string, filter: string) => `${profileId}|${filter}`;

export function documentHistoryUrl(filter: string, cursor: string | null, limit = DOCUMENT_PAGE_SIZE): string {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  if (filter) q.set("intervention_id", filter);
  return `/api/documents/history?${q.toString()}`;
}

export type DocumentPage = { documents: StoredDocument[]; hasMore: boolean; nextCursor: string | null };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length > 0;

/** Validates a 200 body for the requested scope; null when unusable (nothing is applied then). */
export function parseDocumentPage(raw: unknown, filter: string): DocumentPage | null {
  if (!isObject(raw) || !Array.isArray(raw.documents) || !isObject(raw.page)) return null;
  const { has_more, next_cursor } = raw.page;
  if (typeof has_more !== "boolean" || !(next_cursor === null || str(next_cursor))) return null;
  if (has_more && next_cursor === null) return null;
  const documents: StoredDocument[] = [];
  for (const d of raw.documents) {
    if (!isObject(d) || !str(d.id) || !str(d.name) || !str(d.mime_type) || !str(d.created_at)) return null;
    if (!(d.intervention_id === null || d.intervention_id === undefined || str(d.intervention_id))) return null;
    // A row outside the requested dossier means the reply is not for this scope: refuse the page.
    if (filter && d.intervention_id !== filter) return null;
    // Only the displayed fields are kept (never a storage path or anything else the body may carry).
    documents.push({
      id: d.id as string,
      intervention_id: (d.intervention_id as string | null | undefined) ?? null,
      ...(str(d.owner_id) ? { owner_id: d.owner_id as string } : {}),
      name: d.name as string,
      mime_type: d.mime_type as string,
      created_at: d.created_at as string,
    });
  }
  return { documents, hasMore: has_more, nextCursor: has_more ? (next_cursor as string) : null };
}

export type DocumentOutcome =
  | ({ kind: "loaded" } & DocumentPage)
  /** 404: scope unavailable (foreign or nonexistent dossier) — uniform, nothing shown about it. */
  | { kind: "not_found" }
  /** 401: session expired; never retried automatically. */
  | { kind: "signed_out" }
  /** 503 / other status / transport / invalid body (200); retry with the same cursor after retryAfterS. */
  | { kind: "failed"; status: number; retryAfterS: number }
  | { kind: "aborted" };

export type DocumentFetch = (url: string, init: RequestInit) => Promise<Response>;

function retryAfter(res: Response): number {
  const n = Number(res.headers.get("retry-after"));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 120) : DEFAULT_RETRY_AFTER_S;
}

export async function fetchDocumentPage(
  fetchImpl: DocumentFetch,
  filter: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<DocumentOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(documentHistoryUrl(filter, cursor), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failed", status: 0, retryAfterS: DEFAULT_RETRY_AFTER_S };
  }
  if (signal.aborted) return { kind: "aborted" };
  if (res.status === 401) return { kind: "signed_out" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "failed", status: res.status, retryAfterS: retryAfter(res) };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failed", status: 200, retryAfterS: DEFAULT_RETRY_AFTER_S };
  }
  if (signal.aborted) return { kind: "aborted" };
  const page = parseDocumentPage(raw, filter);
  return page ? { kind: "loaded", ...page } : { kind: "failed", status: 200, retryAfterS: DEFAULT_RETRY_AFTER_S };
}

/** History state of the displayed scope. `cursor` is the one to request next (null = newest page). */
export type DocumentHistoryState = {
  key: string;
  pages: StoredDocument[];
  cursor: string | null;
  hasMore: boolean;
  loaded: boolean;
  status: "idle" | "loading" | "error" | "not_found" | "signed_out";
  errorStatus?: number;
  /** Epoch ms before which a retry is refused (Retry-After). */
  retryAt?: number;
};
export const initialDocumentHistory = (key: string): DocumentHistoryState => ({ key, pages: [], cursor: null, hasMore: false, loaded: false, status: "idle" });

/** Applies an outcome to the state it was requested for; a reply for another key is ignored. */
export function applyDocumentOutcome(state: DocumentHistoryState, key: string, outcome: DocumentOutcome, now: number): DocumentHistoryState {
  if (state.key !== key || outcome.kind === "aborted") return state;
  // 401 and 404 are terminal for this identity + scope: only a new key (reset) leaves them.
  if (state.status === "signed_out" || state.status === "not_found") return state;
  if (outcome.kind === "loaded")
    return { key, pages: [...state.pages, ...outcome.documents], cursor: outcome.nextCursor, hasMore: outcome.hasMore, loaded: true, status: "idle" };
  if (outcome.kind === "failed")
    return { ...state, status: "error", errorStatus: outcome.status, retryAt: now + outcome.retryAfterS * 1000 }; // cursor kept
  return { ...state, status: outcome.kind };
}

/** Whether « Charger les documents plus anciens » is offered: never as a dead control after a 401/404. */
export const offersOlderDocuments = (state: DocumentHistoryState) =>
  state.hasMore && state.status !== "signed_out" && state.status !== "not_found";

/**
 * Whether the offered older-page button can be used now: not while a read runs, and not before a
 * Retry-After delay ends (load() refuses then, so an enabled button would be a dead control).
 */
export const olderDocumentsUsable = (state: DocumentHistoryState, now: number) =>
  offersOlderDocuments(state) && state.status !== "loading" && !(state.status === "error" && state.retryAt !== undefined && now < state.retryAt);
