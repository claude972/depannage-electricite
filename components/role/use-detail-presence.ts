"use client";
// Deep-link presence for detail views (WEB-DEEPLINK-REFRESH-001 + FASTSPLIT-DETAIL-CONSUMER-001).
// 1. An id absent from the cached workspace triggers ONE causal refresh before anything else.
// 2. Still absent after a loaded refresh: if the workspace says its intervention window was
//    truncated (`limits.interventions.limited`), ONE point read of that dossier is made
//    automatically; otherwise « introuvable » is shown with an explicit « Ouvrir quand même ».
// 3. Point read: 200 ⇒ read-only detail; 404 ⇒ « introuvable » (proven); 503/transport/invalid ⇒
//    error with a retry that honours Retry-After — never « introuvable ».
// Every result is keyed by the full refresh context; a reply for another context is dropped.
import { useCallback, useEffect, useState } from "react";
import { api } from "../app/api";
import type { Session } from "../app/session-types";
import { DetailAttemptMemory, decideDetail, detailAttemptKey, type DetailDecision } from "../app/detail-resolution";
import { DetailCache } from "../app/detail-cache";
import { readDetail, type DetailFetch } from "../app/detail-read-client";
import type { DetailRead } from "../../lib/features/workspace/detail-read";

// One bounded memory for the tab; keys carry the context, and a context change clears it.
const memory = new DetailAttemptMemory(32);
const cache = new DetailCache(20, 60_000);
type PointState =
  | { state: "pending" }
  | { state: "not_found" }
  | { state: "failed"; status: number; retryAt: number }
  /** 401 on the point read: the session handles it; never re-read automatically. */
  | { state: "signed_out" };
const points = new Map<string, PointState>();
/** Focus/visibility revalidation never re-reads a copy younger than this. */
const FOCUS_MIN_AGE_MS = 15_000;
/** Ids point-read successfully in this context: revalidated on focus and when the cache expires. */
const loadedOnce = new Set<string>();
let pointsContext = "";
const usePointsContext = (context: string) => {
  if (context !== pointsContext) {
    pointsContext = context;
    points.clear();
    loadedOnce.clear();
  }
};

export type PresenceDecision = DetailDecision | "detail" | "detail_error" | "detail_loading";

export function useDetailPresence(
  session: Pick<Session, "mode" | "ensureFresh" | "refreshContext"> & { data?: { limits?: { interventions: { limited: boolean } } } },
  view: string,
  id: string,
  present: boolean,
  fetchJson: DetailFetch = (path) => api<unknown>(path),
): {
  decision: PresenceDecision;
  retry: () => void;
  retrying: boolean;
  /** Read-only dossier from the point read (decision « detail »). */
  detail?: DetailRead;
  /** Available when the absence is not proven by a point read and the window was not truncated:
   *  the view must then use NON-definitive wording (not « introuvable »). */
  openAnyway?: () => void;
  /** Seconds before a point-read retry is allowed (Retry-After). */
  retryInS?: number;
} {
  const live = session.mode === "live";
  const context = session.refreshContext;
  memory.useContext(context);
  cache.useContext(context);
  usePointsContext(context);
  const key = detailAttemptKey(context, view, id);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick((n) => n + 1), []);

  const attemptRefresh = useCallback(() => {
    memory.set(key, { state: "pending" });
    rerender();
    void session.ensureFresh().then((outcome) => {
      // A result for another context is not proof for this one; with an unchanged context a
      // superseded read is recorded as failed so it cannot re-trigger in a loop.
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

  const pointRead = useCallback(() => {
    const current = id ? points.get(id) : undefined;
    if (!id || current?.state === "pending") return; // single flight per id and context
    if (current?.state === "failed" && Date.now() < current.retryAt) return; // honour Retry-After
    const startedIn = context;
    points.set(id, { state: "pending" });
    rerender();
    void readDetail(fetchJson, id).then((outcome) => {
      if (pointsContext !== startedIn) return; // identity/role/org/site changed: drop the reply
      if (outcome.kind === "loaded") {
        cache.set(id, outcome.detail);
        loadedOnce.add(id);
        points.delete(id);
      } else if (outcome.kind === "not_found") {
        cache.delete(id); // a revalidation that proves the dossier gone removes the cached copy
        loadedOnce.delete(id);
        points.set(id, { state: "not_found" });
      } else if (outcome.kind === "signed_out") {
        // Terminal for this id: let the session's own workspace read handle the 401 (sign-out).
        points.set(id, { state: "signed_out" });
        void session.ensureFresh();
      } else points.set(id, { state: "failed", status: outcome.status, retryAt: Date.now() + outcome.retryAfterS * 1000 });
      rerender();
    });
    // fetchJson is a test seam; context/id identify the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, context, rerender]);

  const base = decideDetail({ present, live, attempt: live && id ? memory.get(key) : undefined });
  const limited = session.data?.limits?.interventions.limited === true;
  const cached = live && id && !present ? cache.get(id) : undefined;
  const point = live && id ? points.get(id) : undefined;

  useEffect(() => {
    if (base === "refresh" && id) attemptRefresh();
  }, [base, id, attemptRefresh]);
  useEffect(() => {
    // Automatic point read when the absence may be due to the 100-dossier window, or to revalidate
    // a dossier already opened whose cached copy expired. Never after a 401 or a proven 404.
    if (base !== "not_found" || !live || !id || cached || point) return;
    if (limited || loadedOnce.has(id)) pointRead();
  }, [base, live, limited, id, cached, point, pointRead]);
  // Revalidation independent of Realtime: when the cached copy expires (TTL) and on window focus.
  // A 1 s check (not a single long timer) so a clock jump or a device wake-up after sleep never
  // leaves an expired private copy on screen: once expired it is dropped and re-read.
  useEffect(() => {
    if (!cached) return;
    const t = window.setInterval(() => {
      if (cache.expiresInMs(id) <= 0) rerender();
    }, 1000);
    // Background revalidation (the cached copy stays visible meanwhile), at most once per 15 s;
    // pointRead itself refuses while a Retry-After delay runs.
    const revalidate = () => {
      if (cache.ageMs(id) >= FOCUS_MIN_AGE_MS) pointRead();
    };
    const onFocus = () => revalidate();
    const onVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cached, id, rerender, pointRead]);
  // Re-render when a Retry-After delay elapses so the retry becomes available.
  const retryInS = point?.state === "failed" ? Math.max(0, Math.ceil((point.retryAt - Date.now()) / 1000)) : undefined;
  useEffect(() => {
    if (!retryInS) return;
    const t = window.setTimeout(rerender, retryInS * 1000);
    return () => window.clearTimeout(t);
  }, [retryInS, rerender]);

  if (base === "not_found" && live) {
    // A failed revalidation is shown as an error (with Retry-After), never as a fresh-looking copy.
    if (point?.state === "failed") return { decision: "detail_error", retry: pointRead, retrying: false, retryInS };
    // 401 (also over a cached copy): terminal for automatic reads (the session handles the expired session); the user may
    // retry explicitly — never shown as a proven « introuvable », never retried in a loop.
    if (point?.state === "signed_out") return { decision: "detail_error", retry: pointRead, retrying: false, retryInS: 0 };
    if (cached) return { decision: "detail", detail: cached, retry: pointRead, retrying: point?.state === "pending" };
    if (point?.state === "pending") return { decision: "detail_loading", retry: pointRead, retrying: true };
    if (point?.state === "not_found") return { decision: "not_found", retry: attemptRefresh, retrying: false };
    if (limited) return { decision: "detail_loading", retry: pointRead, retrying: true }; // effect is starting the read
    return { decision: "not_found", retry: attemptRefresh, retrying: false, openAnyway: pointRead };
  }
  return {
    // Before the effect runs, « refresh » renders as loading: never « introuvable » first.
    decision: base === "refresh" ? "loading" : base,
    retry: attemptRefresh,
    retrying: memory.get(key)?.state === "pending",
  };
}
