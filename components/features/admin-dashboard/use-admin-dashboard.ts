"use client";
// ADM-01: reads the bounded admin snapshot in live mode only. The view carries the role + identity it
// was read for; the host shows it only when that matches the CURRENT role + identity at render (no
// old frame). Sequence-guarded; 401/403 ⇒ cleared. « Actualiser » = reload(). Demo: never called.
import { useCallback, useEffect, useRef, useState } from "react";
import { COPY, fetchSnapshot, parseSnapshot, type SnapshotView } from "./model";

export function useAdminDashboard({ live, ident, fetcher }: { live: boolean; ident: string; fetcher?: typeof fetch }) {
  const [view, setView] = useState<SnapshotView>({ ident, phase: "loading", data: null, error: "" });
  const seq = useRef(0);
  const current = useRef(ident);
  current.current = ident;
  const latest = useRef(fetcher);
  latest.current = fetcher;
  const reload = useCallback(async () => {
    if (!live) return;
    const my = ++seq.current;
    const asked = current.current;
    setView((v) => (v.ident === asked ? { ...v, phase: v.data ? v.phase : "loading", error: "" } : { ident: asked, phase: "loading", data: null, error: "" }));
    const r = await fetchSnapshot(latest.current ?? ((...a) => fetch(...a)));
    if (my !== seq.current || current.current !== asked) return; // stale or another identity: dropped
    if (r.status === 401 || r.status === 403) return setView({ ident: asked, phase: "forbidden", data: null, error: r.status === 401 ? COPY.session : COPY.forbidden });
    const d = r.status === 200 ? parseSnapshot(r.body) : null;
    setView(d ? { ident: asked, phase: "ready", data: d, error: "" } : { ident: asked, phase: "error", data: null, error: COPY.failed });
  }, [live]);
  useEffect(() => {
    void reload();
    return () => {
      seq.current++;
    };
  }, [reload, ident]);
  return { view, reload };
}
