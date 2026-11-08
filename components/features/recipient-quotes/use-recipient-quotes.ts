"use client";
// React bindings of the recipient quote reads (logic in ./model). Inactive in demo (zero call). One
// controller per identity; state bound AT RENDER to identity (+ organization + site) + quote / filter.
import { useEffect, useRef, useState } from "react";
import { DETAIL_INITIAL, LIST_INITIAL, createDetailController, createListController, createQuotesApi, detailKey, detailView, listKey, listView, type DetailState, type ListState, type QuoteFilter, type QuotesApi } from "./model";

export { QUOTES_COPY } from "./model";
export type { ExactQuote, QuoteDetail, QuoteFilter, QuoteItem } from "./model";
type Ctx = { generation(): number; userId(): string | null };

export function useRecipientQuotes({ enabled, context, status, api }: { enabled: boolean; context: Ctx; status: QuoteFilter; api?: QuotesApi }) {
  const [state, setState] = useState<ListState>(LIST_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = listKey(context, status);
  const ctrl = useRef<ReturnType<typeof createListController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!enabled) return;
    let client: QuotesApi | null = null;
    const c = createListController({ api: () => (client ??= latest.current.api ?? createQuotesApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(LIST_INITIAL);
    };
  }, [enabled, identity]);
  useEffect(() => {
    if (enabled) ctrl.current?.query(status);
  }, [enabled, identity, status]);
  return { state: enabled ? listView(state, key) : LIST_INITIAL, more: () => void ctrl.current?.more(key), retry: () => ctrl.current?.retry(key) };
}

/** `scope` null = client (owner read); otherwise the manager's organization (required) + site. */
export function useRecipientQuote({ enabled, context, quoteId, scope, api }: { enabled: boolean; context: Ctx; quoteId: string | null; scope: { org: string | null; site: string | null } | null; api?: QuotesApi }) {
  const [state, setState] = useState<DetailState>(DETAIL_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = detailKey(context, quoteId, scope);
  const active = enabled && key !== "";
  const ctrl = useRef<ReturnType<typeof createDetailController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: QuotesApi | null = null;
    const c = createDetailController({ api: () => (client ??= latest.current.api ?? createQuotesApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(DETAIL_INITIAL);
    };
  }, [active, identity]);
  const scopeKey = scope ? `${scope.org ?? ""}|${scope.site ?? ""}` : "client";
  useEffect(() => {
    if (active) ctrl.current?.query(quoteId, scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, identity, quoteId, scopeKey]);
  return { state: active ? detailView(state, key) : DETAIL_INITIAL, retry: () => ctrl.current?.retry(key), refresh: () => ctrl.current?.refresh(key) };
}
