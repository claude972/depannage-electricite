"use client";
// React binding of the « Mes demandes » server search (logic in ./model). Inactive (zero call) when
// `enabled` is false — the demo keeps its local filtering. One controller per identity (uid +
// generation). The returned state is bound AT RENDER to identity + filter + trimmed search: if the
// stored state belongs to another key (first render after a prop change, before any effect), the
// view is loading/empty — old rows are never shown, not even for one frame. Commands carry the same
// key. `signal` (workspace row fingerprint) triggers a bounded re-read of page 1 when it changes.
import { useEffect, useRef, useState } from "react";
import { SEARCH_INITIAL, createSearchApi, createSearchController, identityOf, viewKey, viewOf, type Context, type Filter, type SearchApi, type SearchState } from "./model";

export { COPY as SEARCH_COPY, rowsSignal, toListRows } from "./model";

export function useRequestsSearch({ enabled, context, filter, search, signal = "", api, delayMs }: { enabled: boolean; context: Context; filter: Filter; search: string; signal?: string; api?: SearchApi; delayMs?: number }) {
  const [state, setState] = useState<SearchState>(SEARCH_INITIAL);
  const identity = identityOf(context);
  const key = viewKey(context, filter, search);
  const ctrl = useRef<ReturnType<typeof createSearchController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!enabled) return;
    let client: SearchApi | null = null;
    const c = createSearchController({ api: () => (client ??= latest.current.api ?? createSearchApi()), context: latest.current.context, set: setState, timers: { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }, delayMs });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(SEARCH_INITIAL);
    };
  }, [enabled, identity, delayMs]);
  useEffect(() => {
    if (enabled) ctrl.current?.query(filter, search);
  }, [enabled, identity, filter, search]);
  // Real row-change signal of the mounted workspace, same identity only (the controller is per identity).
  const seenSignal = useRef<{ identity: string; signal: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const prev = seenSignal.current;
    seenSignal.current = { identity, signal };
    if (prev && prev.identity === identity && prev.signal !== signal) ctrl.current?.revalidate();
  }, [enabled, identity, signal]);
  const view = enabled ? viewOf(state, key) : SEARCH_INITIAL;
  return {
    state: view,
    /** True only when the shown rows belong to this render's key (guard for row actions). */
    owns: (k: string) => enabled && view.key === k && view.phase === "ready",
    key,
    more: () => void ctrl.current?.more(key),
    retry: () => ctrl.current?.retry(key),
    refresh: () => ctrl.current?.refresh(key),
  };
}
