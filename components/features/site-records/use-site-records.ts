"use client";
// React binding of the site sheet paginated records (logic in ./model). Inactive when `enabled` is
// false (demo, or a kind not shown): zero call. One controller per identity while a site exists; the
// rows are bound AT RENDER to identity + site + kind — another key renders as loading, never old rows.
import { useEffect, useRef, useState } from "react";
import { RECORDS_INITIAL, createRecordsApi, createRecordsController, recordsKey, recordsView, type Kind, type RecordsApi, type RecordsState } from "./model";

export { RECORDS_COPY, isJobKind } from "./model";
export type { DueRow, JobRow, Kind } from "./model";

export function useSiteRecords({ enabled, context, siteId, kind, api }: { enabled: boolean; context: { generation(): number; userId(): string | null }; siteId: string | null; kind: Kind; api?: RecordsApi }) {
  const [state, setState] = useState<RecordsState>(RECORDS_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = recordsKey(context, siteId, kind);
  const active = enabled && siteId !== null;
  const ctrl = useRef<ReturnType<typeof createRecordsController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: RecordsApi | null = null;
    const c = createRecordsController({ api: () => (client ??= latest.current.api ?? createRecordsApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(RECORDS_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(siteId, kind);
  }, [active, identity, siteId, kind]);
  return {
    state: active ? recordsView(state, key) : RECORDS_INITIAL,
    more: () => void ctrl.current?.more(key),
    retry: () => ctrl.current?.retry(key),
    refresh: () => ctrl.current?.refresh(key),
  };
}
