"use client";
// React binding of the on-screen enterprise report (logic in ./model). Inactive in demo (zero call).
// One controller per identity; the shown report is bound AT RENDER to identity + organization + site.
import { useEffect, useRef, useState } from "react";
import { REPORT_INITIAL, createReportApi, createReportController, reportKey, reportView, type ReportApi, type ReportState } from "./model";

export { REPORT_COPY, reportQuery } from "./model";
export type { Report } from "./model";

export function useEnterpriseReport({ enabled, context, organizationId, siteId, api }: { enabled: boolean; context: { generation(): number; userId(): string | null }; organizationId: string | null; siteId: string | null; api?: ReportApi }) {
  const [state, setState] = useState<ReportState>(REPORT_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = reportKey(context, organizationId, siteId);
  const ctrl = useRef<ReturnType<typeof createReportController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  const active = enabled && organizationId !== null;
  useEffect(() => {
    if (!active) return;
    let client: ReportApi | null = null;
    const c = createReportController({ api: () => (client ??= latest.current.api ?? createReportApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(REPORT_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(organizationId, siteId);
  }, [active, identity, organizationId, siteId]);
  return { state: enabled ? reportView(state, key) : REPORT_INITIAL, retry: () => ctrl.current?.retry(key) };
}
