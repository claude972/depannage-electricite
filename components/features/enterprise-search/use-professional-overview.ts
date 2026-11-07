"use client";
// React binding of the enterprise professional overview (logic in ./professional-overview). Inactive
// in demo (zero call). One controller per identity while a scope exists; the shown figures are bound
// AT RENDER to identity + organization + site — another key renders as loading, never old figures.
import { useEffect, useRef, useState } from "react";
import { PRO_INITIAL, createProApi, createProController, proKey, proView, type ProApi, type ProState } from "./professional-overview";

export function useProfessionalOverview({ enabled, context, organizationId, siteId, api }: { enabled: boolean; context: { generation(): number; userId(): string | null }; organizationId: string | null; siteId: string | null; api?: ProApi }) {
  const [state, setState] = useState<ProState>(PRO_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = proKey(context, organizationId, siteId);
  const active = enabled && organizationId !== null;
  const ctrl = useRef<ReturnType<typeof createProController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: ProApi | null = null;
    const c = createProController({ api: () => (client ??= latest.current.api ?? createProApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(PRO_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(organizationId, siteId);
  }, [active, identity, organizationId, siteId]);
  return { state: enabled ? proView(state, key) : PRO_INITIAL, retry: () => ctrl.current?.retry(key) };
}
