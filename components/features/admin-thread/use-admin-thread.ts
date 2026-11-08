"use client";
// ADM-07 — admin dossier thread read from the paginated GET /api/messages (RLS messages_read →
// can_access_intervention, which includes is_admin). Reuses the shared history client and
// reducer (components/app/message-history.ts, the one MessageCenter uses); no workspace cache.
// Key = identity (uid|generation) + dossier: no frame of another key is ever shown, a reply of
// another key is ignored. 401/403/404 are terminal for the key and hide every message.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "../../app/types";
import {
  applyOutcome,
  fetchHistoryPage,
  historyKey,
  initialHistory,
  mergeMessages,
  offersOlder,
  type HistoryFetch,
  type HistoryOutcome,
  type HistoryState,
} from "../../app/message-history";

export type ThreadView =
  | { phase: "loading"; messages: Message[] }
  | { phase: "ready"; messages: Message[]; older: boolean; loadingOlder: boolean; olderError: boolean; headError: boolean }
  | { phase: "refused"; reason: "signed_out" | "forbidden" | "not_found" }
  | { phase: "error" };

const browserFetch: HistoryFetch = (url, init) => fetch(url, init);

export function useAdminThread(
  context: { generation(): number; userId(): string | null },
  interventionId: string,
  sent: readonly Message[],
  /** false in demo: no read at all (the caller keeps its local thread). */
  enabled: boolean,
  /** Refreshed workspace messages: only a SIGNAL. An unknown id of this dossier triggers a re-read
   *  of the newest page (page 1); workspace rows themselves are never shown. */
  workspace: readonly Message[] = [],
  fetchImpl: HistoryFetch = browserFetch,
) {
  const uid = context.userId();
  const key = enabled && uid ? historyKey(`${uid}|${context.generation()}`, interventionId) : "";
  const [state, setState] = useState<HistoryState>(() => initialHistory(key));
  const stateRef = useRef(state);
  const flight = useRef<AbortController | null>(null);
  const [reload, setReload] = useState(0);
  const update = useCallback((next: (s: HistoryState) => HistoryState) => {
    stateRef.current = next(stateRef.current);
    setState(stateRef.current);
  }, []);
  const fetchRef = useRef(fetchImpl);
  useEffect(() => {
    fetchRef.current = fetchImpl;
  });
  const load = useCallback(() => {
    const from = stateRef.current;
    if (!key || from.key !== key || from.status === "loading" || from.status === "not_found" || from.status === "signed_out") return;
    if (from.status === "error" && from.errorStatus === 403) return;
    if (from.loaded && !from.hasMore) return;
    flight.current?.abort();
    const ctl = new AbortController();
    flight.current = ctl;
    update((s) => ({ ...s, status: "loading" }));
    void fetchHistoryPage(fetchRef.current, interventionId, from.cursor, ctl.signal).then((outcome: HistoryOutcome) => {
      if (flight.current !== ctl) return; // superseded (dossier, identity or reload)
      flight.current = null;
      update((s) => applyOutcome(s, key, outcome));
    });
  }, [key, interventionId, update]);
  useEffect(() => {
    flight.current?.abort();
    flight.current = null;
    update(() => initialHistory(key));
    if (key) load();
    return () => {
      flight.current?.abort();
      flight.current = null;
    };
  }, [key, reload, load, update]);

  const h = state.key === key ? state : initialHistory(key);

  // Newest-page re-read (« head »), kept apart from the older pages and their cursor.
  type Head = { key: string; messages: Message[]; tried: string; status: "idle" | "loading" | "error" };
  const [headRaw, setHead] = useState<Head>({ key, messages: [], tried: "", status: "idle" });
  const head = headRaw.key === key ? headRaw : { key, messages: [], tried: "", status: "idle" as const };
  const headFlight = useRef<AbortController | null>(null);
  const headRef = useRef(head.messages);
  useEffect(() => {
    headRef.current = head.messages;
  });
  const [headNonce, setHeadNonce] = useState(0);
  const verified = [...h.pages, ...head.messages, ...sent];
  const known = new Set(verified.map((m) => m.id));
  const newest = verified.reduce((t, m) => Math.max(t, Date.parse(m.created_at) || 0), 0);
  // Only rows newer than the newest verified one are a signal: older workspace rows outside the
  // verified pagination never trigger anything and are never shown.
  const unknown = workspace
    .filter((m) => m.intervention_id === interventionId && !known.has(m.id) && (Date.parse(m.created_at) || 0) >= newest)
    .map((m) => m.id)
    .sort()
    .join(",");
  const refused = h.status === "signed_out" || h.status === "not_found" || (h.status === "error" && h.errorStatus === 403);
  const signal = key && h.loaded && !refused && unknown ? `${unknown}#${headNonce}` : "";
  useEffect(() => {
    if (!signal || head.tried === signal) return;
    headFlight.current?.abort();
    const ctl = new AbortController();
    headFlight.current = ctl;
    setHead((x) => ({ ...(x.key === key ? x : { key, messages: [] }), tried: signal, status: "loading" }));
    void fetchHistoryPage(fetchRef.current, interventionId, null, ctl.signal).then((outcome: HistoryOutcome) => {
      if (headFlight.current !== ctl) return; // superseded (dossier, identity or a newer signal)
      headFlight.current = null;
      if (outcome.kind === "aborted") return;
      if (outcome.kind === "loaded") {
        const cur = stateRef.current;
        if (cur.key !== key) return;
        // Already verified and contiguous: the loaded pages plus earlier head re-reads.
        const loadedIds = new Set([...cur.pages, ...headRef.current].map((m) => m.id));
        const overlap = outcome.messages.some((m) => loadedIds.has(m.id));
        if (outcome.hasMore && !overlap) {
          // A burst larger than one page: a gap would remain between this head and the old cursor.
          // Restart from this page as page 1 with ITS cursor; the older pages and cursor are dropped.
          flight.current?.abort();
          flight.current = null;
          update(() => ({ key, pages: outcome.messages, cursor: outcome.nextCursor, hasMore: true, loaded: true, status: "idle" }));
          setHead((x) => (x.key === key ? { ...x, messages: [], status: "idle" } : x));
          return;
        }
        setHead((x) => (x.key === key ? { ...x, messages: mergeMessages(interventionId, x.messages, outcome.messages), status: "idle" } : x));
        return;
      }
      if (outcome.kind === "failed" && outcome.status !== 403) {
        // 503 / invalid: the verified pages stay; « Réessayer » re-reads page 1.
        setHead((x) => (x.key === key ? { ...x, status: "error" } : x));
        return;
      }
      // 401 / 403 / 404: terminal for this key, every row is cleared (applyOutcome keeps the reason).
      setHead((x) => (x.key === key ? { ...x, messages: [], status: "idle" } : x));
      flight.current?.abort();
      flight.current = null;
      update((st) => applyOutcome({ ...st, status: st.status === "loading" ? "idle" : st.status }, key, outcome));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal, key]);
  useEffect(
    () => () => {
      headFlight.current?.abort();
      headFlight.current = null;
    },
    [key],
  );

  let view: ThreadView;
  if (!enabled) view = { phase: "loading", messages: [] };
  else if (!key || h.status === "signed_out") view = { phase: "refused", reason: "signed_out" };
  else if (h.status === "not_found") view = { phase: "refused", reason: "not_found" };
  else if (h.status === "error" && h.errorStatus === 403) view = { phase: "refused", reason: "forbidden" };
  else if (!h.loaded) view = h.status === "error" ? { phase: "error" } : { phase: "loading", messages: [] };
  else {
    // Server pages + replies confirmed by the server for this dossier, deduplicated by id.
    view = {
      phase: "ready",
      messages: mergeMessages(interventionId, h.pages, head.messages, sent),
      older: offersOlder(h),
      loadingOlder: h.status === "loading",
      olderError: h.status === "error",
      headError: head.status === "error",
    };
  }
  return { view, loadOlder: load, retry: () => setReload((n) => n + 1), retryHead: () => setHeadNonce((n) => n + 1) };
}
