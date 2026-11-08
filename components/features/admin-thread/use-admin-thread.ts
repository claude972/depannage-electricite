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
  | { phase: "ready"; messages: Message[]; older: boolean; loadingOlder: boolean; olderError: boolean }
  | { phase: "refused"; reason: "signed_out" | "forbidden" | "not_found" }
  | { phase: "error" };

const browserFetch: HistoryFetch = (url, init) => fetch(url, init);

export function useAdminThread(
  context: { generation(): number; userId(): string | null },
  interventionId: string,
  sent: readonly Message[],
  /** false in demo: no read at all (the caller keeps its local thread). */
  enabled: boolean,
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
      messages: mergeMessages(interventionId, h.pages, sent),
      older: offersOlder(h),
      loadingOlder: h.status === "loading",
      olderError: h.status === "error",
    };
  }
  return { view, loadOlder: load, retry: () => setReload((n) => n + 1) };
}
