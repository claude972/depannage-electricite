"use client";
// React binding of the enterprise intervention search (logic in ./model). Inactive (zero call) when
// `enabled` is false — the demo keeps its local list. One controller per identity (uid +
// generation). The returned state is bound AT RENDER to identity + filters + page: a stored state of
// another key renders as loading (never an old frame). Commands carry the same key. StrictMode-safe.
import { useEffect, useRef, useState } from "react";
import { SEARCH_INITIAL, createSearchApi, createSearchController, identityOf, viewKey, viewOf, type Context, type Filters, type SearchApi, type SearchState } from "./model";

export { COPY as ENTERPRISE_SEARCH_COPY } from "./model";
export { ExportFeedback } from "./export-feedback";
export { useOverviewCounts } from "./use-overview-counts";
export { COUNTS_COPY } from "./overview-counts";
export type { EnterpriseRow, Filters as EnterpriseSearchFilters } from "./model";

export function useEnterpriseSearch({ enabled, context, filters, page, api }: { enabled: boolean; context: Context; filters: Filters | null; page: number; api?: SearchApi }) {
  const [state, setState] = useState<SearchState>(SEARCH_INITIAL);
  const identity = identityOf(context);
  const viewK = viewKey(context, filters, page);
  const ctrl = useRef<ReturnType<typeof createSearchController> | null>(null);
  const latest = useRef({ api, context, filters });
  latest.current = { api, context, filters };
  // No scope (filters null) ⇒ no controller at all: leaving the scope stops it, so an export in flight
  // is dropped and A → none → A never saves the original file.
  const active = enabled && filters !== null;
  useEffect(() => {
    if (!active) return;
    let client: SearchApi | null = null;
    const c = createSearchController({ api: () => (client ??= latest.current.api ?? createSearchApi()), context: latest.current.context, set: setState, timers: { set: (f, ms) => setTimeout(f, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) } });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(SEARCH_INITIAL);
    };
  }, [active, identity]);
  const key = filters ? JSON.stringify([filters.organization_id, filters.site_id, filters.category, filters.status, filters.search.trim(), filters.sort, page]) : "";
  useEffect(() => {
    if (enabled && filters) ctrl.current?.query(filters, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, identity, key]);
  return {
    // Bound AT RENDER: a state of another identity / filters / page is never shown (loading instead).
    state: enabled ? viewOf(state, viewK) : SEARCH_INITIAL,
    retry: () => ctrl.current?.retry(viewK),
    /** Snapshot of the filters at the click; the file is kept only if they still match after the await. */
    exportCsv: () => (filters && ctrl.current ? ctrl.current.exportCsv(filters, () => latest.current.filters, viewK) : Promise.resolve(false)),
  };
}
