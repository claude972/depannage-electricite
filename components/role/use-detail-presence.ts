"use client";
// Deep-link presence for detail views (WEB-DEEPLINK-REFRESH-001). An id absent from the cached
// workspace triggers ONE causal refresh for this context before « introuvable » is shown; a
// failed refresh shows an error with an explicit, user-triggered retry — never « introuvable ».
import { useCallback, useEffect, useState } from "react";
import type { Session } from "../app/session-types";
import { DetailAttemptMemory, decideDetail, detailAttemptKey, type DetailDecision } from "../app/detail-resolution";

// One bounded memory for the tab; keys carry the context, and a context change clears it.
const memory = new DetailAttemptMemory(32);

export function useDetailPresence(
  session: Pick<Session, "mode" | "ensureFresh" | "refreshContext">,
  view: string,
  id: string,
  present: boolean,
): { decision: DetailDecision; retry: () => void; retrying: boolean } {
  const live = session.mode === "live";
  const context = session.refreshContext;
  memory.useContext(context);
  const key = detailAttemptKey(context, view, id);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  const attemptRefresh = useCallback(() => {
    memory.set(key, { state: "pending" });
    rerender();
    void session.ensureFresh().then((outcome) => {
      // A result for another context (identity, role, organisation or site changed) is not
      // proof for this one: no attempt is consumed, the new context will ask for itself.
      // A changed context reads under a NEW key, so marking this key never shows anything;
      // with an unchanged context it stops a superseded read from re-triggering in a loop.
      if (outcome.kind === "signed_out") {
        if (memory.get(key)?.state === "pending") memory.delete(key);
      } else if (outcome.kind === "superseded") memory.set(key, { state: "failed", status: 0 });
      else if (outcome.kind === "failed") memory.set(key, { state: "failed", status: outcome.status });
      else memory.set(key, { state: "loaded" });
      rerender();
    });
    // session.ensureFresh is stable; key identifies the attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rerender]);

  const decision = decideDetail({ present, live, attempt: live && id ? memory.get(key) : undefined });

  useEffect(() => {
    if (decision === "refresh" && id) attemptRefresh();
  }, [decision, id, attemptRefresh]);

  return {
    // Before the effect runs, « refresh » renders as loading: never « introuvable » first.
    decision: decision === "refresh" ? "loading" : decision,
    retry: attemptRefresh,
    retrying: memory.get(key)?.state === "pending",
  };
}
