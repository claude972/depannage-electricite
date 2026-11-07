"use client";
// React binding of the « Mes demandes » server search (logic in ./model). Inactive (zero call) when
// `enabled` is false — the demo keeps its local filtering. One controller per identity (uid +
// generation): an identity change drops it and resets the results. StrictMode-safe (one controller
// per effect run, stopped on cleanup).
import { useEffect, useRef, useState } from "react";
import { SEARCH_INITIAL, createSearchApi, createSearchController, type Context, type Filter, type SearchApi, type SearchState } from "./model";

export { COPY as SEARCH_COPY, toListRows } from "./model";

export function useRequestsSearch({ enabled, context, filter, search, api, delayMs }: { enabled: boolean; context: Context; filter: Filter; search: string; api?: SearchApi; delayMs?: number }) {
  const [state, setState] = useState<SearchState>(SEARCH_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
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
  return { state: enabled ? state : SEARCH_INITIAL, more: () => void ctrl.current?.more(), retry: () => ctrl.current?.retry() };
}
