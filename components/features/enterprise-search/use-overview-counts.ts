"use client";
// React binding of the enterprise overview counters (logic in ./overview-counts). Inactive in demo
// (zero call). One controller per identity; the shown value is bound AT RENDER to identity +
// organization + site — another key renders as loading, never an old figure.
import { useEffect, useRef, useState } from "react";
import { COUNTS_INITIAL, countsKey, countsView, createCountsApi, createCountsController, type CountsApi, type CountsState } from "./overview-counts";

export function useOverviewCounts({ enabled, context, organizationId, siteId, api }: { enabled: boolean; context: { generation(): number; userId(): string | null }; organizationId: string | null; siteId: string | null; api?: CountsApi }) {
  const [state, setState] = useState<CountsState>(COUNTS_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = countsKey(context, organizationId, siteId);
  const ctrl = useRef<ReturnType<typeof createCountsController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!enabled) return;
    let client: CountsApi | null = null;
    const c = createCountsController({ api: () => (client ??= latest.current.api ?? createCountsApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(COUNTS_INITIAL);
    };
  }, [enabled, identity]);
  useEffect(() => {
    if (enabled) ctrl.current?.query(organizationId, siteId);
  }, [enabled, identity, organizationId, siteId]);
  return { state: enabled ? countsView(state, key) : COUNTS_INITIAL, retry: () => ctrl.current?.retry(key) };
}
