"use client";
// ADM-10 / PUB-06 — paged warranty history hook (live only; demo never reads). The state is shown
// only under its key (identity + dossier + reload nonce): no old frame after a switch, late replies
// dropped. `reload()` after a write invalidates every older read and starts again at page 1.
import { useCallback, useEffect, useRef, useState } from "react";
import { createHistory, historyInitial, identityKey, type Context, type HistoryState } from "./warranty-history";

export function useWarrantyHistory(context: Context, interventionId: string | null, live: boolean, fetcher?: typeof fetch) {
  const base = live ? identityKey(context, interventionId) : null;
  const [nonce, setNonce] = useState(0);
  const key = base ? `${base}|${nonce}` : null;
  const [state, setRaw] = useState<HistoryState>(() => historyInitial(""));
  const ref = useRef(state);
  const set = useCallback((s: HistoryState) => {
    ref.current = s;
    setRaw(s);
  }, []);
  const latest = useRef({ context, fetcher });
  useEffect(() => {
    latest.current = { context, fetcher };
  });
  const ctrl = useRef<{ key: string; c: ReturnType<typeof createHistory> } | null>(null);
  useEffect(() => {
    if (!key) return;
    const c = createHistory({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      interventionId,
      key,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = { key, c };
    void c.load();
    return () => c.dispose();
    // key carries identity + dossier + nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const s = key && state.key === key ? state : historyInitial(key ?? "");
  const c = ctrl.current && ctrl.current.key === key ? ctrl.current.c : null;
  return {
    state: s,
    /** No identity in live: nothing is read (honest refusal state). */
    signedOut: live && !base,
    more: () => void c?.more(),
    reload: () => setNonce((n) => n + 1),
  };
}
