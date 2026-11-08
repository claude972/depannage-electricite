"use client";
// React bindings of the ENT-12 approvals reads (logic in ./model). Inactive in demo (zero call) and
// without an organization. One controller per identity; state bound AT RENDER to its key.
import { useEffect, useRef, useState } from "react";
import { LIST_INITIAL, POINT_INITIAL, createApprovalsApi, createListController, createPointController, listKey, listView, pointKey, pointView, type ApprovalsApi, type ListState, type PointState, type StatusFilter } from "./model";

export { APPROVALS_COPY } from "./model";
export type { ApprovalPoint, ApprovalRow, StatusFilter } from "./model";
type Ctx = { generation(): number; userId(): string | null };

export function useApprovalsList({ enabled, context, organizationId, siteId, status, api }: { enabled: boolean; context: Ctx; organizationId: string | null; siteId: string | null; status: StatusFilter; api?: ApprovalsApi }) {
  const [state, setState] = useState<ListState>(LIST_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = listKey(context, organizationId, siteId, status);
  const active = enabled && organizationId !== null;
  const ctrl = useRef<ReturnType<typeof createListController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: ApprovalsApi | null = null;
    const c = createListController({ api: () => (client ??= latest.current.api ?? createApprovalsApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(LIST_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(organizationId, siteId, status);
  }, [active, identity, organizationId, siteId, status]);
  return { state: active ? listView(state, key) : LIST_INITIAL, more: () => void ctrl.current?.more(key), retry: () => ctrl.current?.retry(key), refresh: () => ctrl.current?.refresh(key) };
}

export function useApprovalPoint({ enabled, context, approvalId, organizationId, siteId, api }: { enabled: boolean; context: Ctx; approvalId: string | null; organizationId: string | null; siteId: string | null; api?: ApprovalsApi }) {
  const [state, setState] = useState<PointState>(POINT_INITIAL);
  const identity = `${context.userId() ?? "-"}|${context.generation()}`;
  const key = pointKey(context, approvalId, organizationId, siteId);
  const active = enabled && organizationId !== null && approvalId !== null;
  const ctrl = useRef<ReturnType<typeof createPointController> | null>(null);
  const latest = useRef({ api, context });
  latest.current = { api, context };
  useEffect(() => {
    if (!active) return;
    let client: ApprovalsApi | null = null;
    const c = createPointController({ api: () => (client ??= latest.current.api ?? createApprovalsApi()), context: latest.current.context, set: setState });
    ctrl.current = c;
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(POINT_INITIAL);
    };
  }, [active, identity]);
  useEffect(() => {
    if (active) ctrl.current?.query(approvalId, organizationId, siteId);
  }, [active, identity, approvalId, organizationId, siteId]);
  return { state: active ? pointView(state, key) : POINT_INITIAL, retry: () => ctrl.current?.retry(key), refresh: () => ctrl.current?.refresh(key) };
}
