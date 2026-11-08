"use client";
// React binding of the exact enterprise quote decision context (logic in ./model). Inactive in demo /
// without organization; bound AT RENDER to identity + organization + site + quote.
import { useEffect, useRef, useState } from "react";
import { CONTEXT_INITIAL, contextKey, contextView, createContextApi, createContextController, type ContextApi, type ContextState } from "./model";

export { DECISION_COPY, simplePending } from "./model";
export type { DecisionContext } from "./model";

export function useDecisionContext({ enabled, context, quoteId, organizationId, siteId, api }: { enabled: boolean; context: { generation(): number; userId(): string | null }; quoteId: string | null; organizationId: string | null; siteId: string | null; api?: ContextApi }) {
  const [state, setState] = useState<ContextState>(CONTEXT_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = contextKey(context, quoteId, organizationId, siteId);
  const active = enabled && key !== "";
  const ctrl = useRef<ReturnType<typeof createContextController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: ContextApi | null = null;
    const c = createContextController({ api: () => (client ??= latest.current.api ?? createContextApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(CONTEXT_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(quoteId, organizationId, siteId);
  }, [active, identity, quoteId, organizationId, siteId]);
  return { state: active ? contextView(state, key) : CONTEXT_INITIAL, key, retry: () => ctrl.current?.retry(key), refresh: () => ctrl.current?.refresh(key) };
}
