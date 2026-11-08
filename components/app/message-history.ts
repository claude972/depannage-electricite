// Paginated message history of one dossier (FASTSPLIT-MESSAGE-HISTORY-001). Pure merge/order
// helpers and a small fetch client for GET /api/messages; no React, no cache. Covered by
// tests/ui/message-history.test.ts.
//
// Contract: GET /api/messages?intervention_id=UUID&limit=25&cursor=OPAQUE → 200
// { messages: Message[] (created_at DESC, id DESC), page: { limit, has_more, next_cursor } }.
// The cursor is opaque: sent back unchanged, and only for the dossier that produced it.
import type { Message } from "./types";

export const HISTORY_PAGE_SIZE = 25;

/** Chronological order (oldest first); ties broken by id so the order is total and stable. */
export function compareMessages(a: Message, b: Message): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Messages of ONE dossier from several sources (workspace preview, history pages), deduplicated
 * by id and in chronological order. Rows of any other dossier are dropped, never mixed in.
 */
export function mergeMessages(interventionId: string, ...sources: readonly (readonly Message[])[]): Message[] {
  const byId = new Map<string, Message>();
  for (const list of sources)
    for (const m of list) if (m.intervention_id === interventionId && !byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

/** State key: a history never survives a change of dossier or of identity. */
export const historyKey = (profileId: string, interventionId: string) => `${profileId}|${interventionId}`;

export function historyUrl(interventionId: string, cursor: string | null, limit = HISTORY_PAGE_SIZE): string {
  const q = new URLSearchParams({ intervention_id: interventionId, limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return `/api/messages?${q.toString()}`;
}

export type HistoryPage = { messages: Message[]; hasMore: boolean; nextCursor: string | null };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length > 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates a 200 body for the requested dossier; null when unusable (nothing is applied then). */
export function parseHistoryPage(raw: unknown, interventionId: string): HistoryPage | null {
  if (!isObject(raw) || !Array.isArray(raw.messages) || !isObject(raw.page)) return null;
  const { has_more, next_cursor } = raw.page;
  if (typeof has_more !== "boolean" || !(next_cursor === null || str(next_cursor))) return null;
  if (has_more && next_cursor === null) return null;
  const messages: Message[] = [];
  for (const m of raw.messages) {
    if (!isObject(m) || !str(m.id) || !str(m.author_id) || typeof m.body !== "string" || !str(m.created_at)) return null;
    // A row of another dossier means the reply is not for this request: refuse the whole page.
    if (m.intervention_id !== interventionId) return null;
    // attachment_id (SYS-04 / M62): UUID | null; older rows omit it (⇒ null). Anything else refuses the page.
    const attachment = m.attachment_id === undefined || m.attachment_id === null ? null : typeof m.attachment_id === "string" && UUID.test(m.attachment_id) ? m.attachment_id.toLowerCase() : undefined;
    if (attachment === undefined) return null;
    messages.push({ id: m.id as string, intervention_id: interventionId, author_id: m.author_id as string, body: m.body, created_at: m.created_at as string, ...(attachment ? { attachment_id: attachment } : {}) });
  }
  return { messages, hasMore: has_more, nextCursor: has_more ? (next_cursor as string) : null };
}

export type HistoryOutcome =
  | ({ kind: "loaded" } & HistoryPage)
  /** 404: foreign or nonexistent dossier — uniform, nothing about it is shown. */
  | { kind: "not_found" }
  /** 401: the session expired; never retried automatically. */
  | { kind: "signed_out" }
  /** 503, other status, transport error or invalid body (status 200); retryable with the same cursor. */
  | { kind: "failed"; status: number }
  /** Aborted (dossier or identity changed): the caller ignores it. */
  | { kind: "aborted" };

export type HistoryFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function fetchHistoryPage(
  fetchImpl: HistoryFetch,
  interventionId: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<HistoryOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(historyUrl(interventionId, cursor), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failed", status: 0 };
  }
  if (signal.aborted) return { kind: "aborted" };
  if (res.status === 401) return { kind: "signed_out" };
  if (res.status === 404) return { kind: "not_found" };
  if (!res.ok) return { kind: "failed", status: res.status };
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    return signal.aborted ? { kind: "aborted" } : { kind: "failed", status: 200 };
  }
  if (signal.aborted) return { kind: "aborted" };
  const page = parseHistoryPage(raw, interventionId);
  return page ? { kind: "loaded", ...page } : { kind: "failed", status: 200 };
}

/** History state of the displayed dossier. `cursor` is the one to request next (null = newest page). */
export type HistoryState = {
  key: string;
  pages: Message[];
  cursor: string | null;
  hasMore: boolean;
  /** At least one page loaded for this key. */
  loaded: boolean;
  status: "idle" | "loading" | "error" | "not_found" | "signed_out";
  errorStatus?: number;
};
export const initialHistory = (key: string): HistoryState => ({ key, pages: [], cursor: null, hasMore: false, loaded: false, status: "idle" });

/** Applies an outcome to the state it was requested for; a reply for another key is ignored. */
export function applyOutcome(state: HistoryState, key: string, outcome: HistoryOutcome): HistoryState {
  if (state.key !== key || outcome.kind === "aborted") return state;
  // 401 and 404 are terminal for this identity + dossier: only a new key (reset) leaves them.
  if (state.status === "signed_out" || state.status === "not_found") return state;
  if (outcome.kind === "loaded")
    return { key, pages: [...state.pages, ...outcome.messages], cursor: outcome.nextCursor, hasMore: outcome.hasMore, loaded: true, status: "idle" };
  if (outcome.kind === "failed") return { ...state, status: "error", errorStatus: outcome.status }; // cursor kept: resume there
  return { ...state, status: outcome.kind };
}

/**
 * Whether « Charger les messages plus anciens » is offered. A 401 is terminal for this identity
 * (the session handles the logout): the button disappears instead of staying as a dead control,
 * and the messages already loaded stay shown. A 404 hides the whole conversation.
 */
export const offersOlder = (state: HistoryState) => state.hasMore && state.status !== "signed_out" && state.status !== "not_found";

/** Compose draft of one identity + dossier (memory only, never persisted). */
export type ComposeDraft = { key: string; text: string };
/** The draft text for the open thread: another thread's draft is never shown nor sent. */
export const draftText = (draft: ComposeDraft, key: string) => (draft.key === key ? draft.text : "");
/**
 * After a successful send, clear the draft only if it is still exactly what was sent, in the same
 * thread: text typed while the request was in flight (or another thread's draft) is kept.
 */
export const clearSentDraft = (draft: ComposeDraft, sentKey: string, sentText: string): ComposeDraft =>
  draft.key === sentKey && draft.text === sentText ? { key: sentKey, text: "" } : draft;

/**
 * Conversation to keep open: the current one while it is in the list or is the explicit target;
 * otherwise (it left the scope, rights removed) the explicit target, else the first listed one.
 */
export function openThread(current: string, target: string, listed: readonly string[]): string {
  if (!current || current === target || listed.includes(current)) return current || target || listed[0] || "";
  return target || listed[0] || "";
}

/**
 * Messages shown in a LIVE conversation. The workspace preview may carry hundreds of messages;
 * pre-filling the view with all of them would make the first « Charger les messages plus anciens »
 * clicks look useless. So:
 * - before any history page has loaded: only the `window` most recent preview messages;
 * - once pages exist: the pages, plus only the preview messages at or after the OLDEST paged one
 *   (new realtime arrivals stay; older preview items never pre-fill what the pages will bring).
 * Deduplicated by id, one dossier only, chronological (compareMessages: created_at then id).
 */
export function visibleHistoryMessages(
  interventionId: string,
  preview: readonly Message[],
  pages: readonly Message[],
  window = HISTORY_PAGE_SIZE,
): Message[] {
  const paged = mergeMessages(interventionId, pages);
  const own = mergeMessages(interventionId, preview);
  if (!paged.length) return own.slice(-window);
  const oldest = paged[0];
  return mergeMessages(interventionId, paged, own.filter((m) => compareMessages(m, oldest) >= 0));
}
