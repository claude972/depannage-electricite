"use client";
// SYS-04 / M62 — read state of ONE thread for the current account. Reads in batches of 100 on open,
// on window focus and on demand (never polling); guarded on account (uid + generation) + thread:
// a change aborts the in-flight reads and late replies are dropped. Never any call in demo.
import { useCallback, useEffect, useRef, useState } from "react";
import { chunks, postReadState, statusFor, threadIds, type Context, type ReadMessage, type ReadStatus } from "./model";

export type MessageReadState = {
  statusOf: (messageId: string) => ReadStatus;
  canMarkRead: boolean;
  markRead: () => Promise<void>;
  refresh: () => void;
  error: string | null;
  loading: boolean;
  marking: boolean;
};

export function useMessageReadState({ context, interventionId, messages, demo, fetcher }: { context: Context; interventionId: string | null | undefined; messages: readonly ReadMessage[]; demo: boolean; fetcher?: typeof fetch }): MessageReadState {
  const uid = context.userId();
  const scope = !demo && uid && interventionId ? `${uid}|${context.generation()}|${interventionId.toLowerCase()}` : null;
  const ids = scope && interventionId ? threadIds(messages, interventionId) : [];
  const idsKey = ids.join(",");
  const [state, setState] = useState<{ scope: string | null; map: Map<string, boolean> }>({ scope: null, map: new Map() });
  const [status, setStatus] = useState<{ scope: string | null; loading: boolean; marking: boolean; error: string | null }>({ scope: null, loading: false, marking: false, error: null });
  const latest = useRef({ context, fetcher, scope, ids, messages, interventionId });
  latest.current = { context, fetcher, scope, ids, messages, interventionId };
  const seq = useRef(0);
  const flight = useRef<AbortController | null>(null);
  const marking = useRef(false);
  const currentScope = () => {
    const c = latest.current.context, u = c.userId();
    return !demo && u && latest.current.interventionId ? `${u}|${c.generation()}|${latest.current.interventionId.toLowerCase()}` : null;
  };
  const f = () => latest.current.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const refresh = useCallback(() => {
    const at = latest.current.scope, list = latest.current.ids, thread = latest.current.interventionId;
    if (!at || !thread || !list.length) return;
    flight.current?.abort();
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    flight.current = ctl;
    const my = ++seq.current;
    setStatus((s) => ({ scope: at, loading: true, marking: s.scope === at ? s.marking : false, error: null }));
    void (async () => {
      const found = new Map<string, boolean>();
      for (const batch of chunks(list)) {
        const rows = await postReadState(f(), "state", thread, batch, ctl?.signal);
        if (my !== seq.current || currentScope() !== at) return; // late / other scope: dropped
        if (!rows) {
          setStatus((s) => ({ ...s, scope: at, loading: false, error: "failed" }));
          return; // an error confirms nothing new; earlier proofs stay
        }
        for (const r of rows) found.set(r.message_id, r.read);
      }
      setState((prev) => {
        const map = new Map(prev.scope === at ? prev.map : []);
        for (const [k, v] of found) map.set(k, v || map.get(k) === true); // a proven « read » is never undone
        return { scope: at, map };
      });
      setStatus((s) => ({ ...s, scope: at, loading: false, error: null }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  // On open, on a new thread / account, when the thread gains messages, and on window focus.
  useEffect(() => {
    if (!scope) return;
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      flight.current?.abort();
      seq.current++;
    };
  }, [scope, idsKey, refresh]);

  const map = state.scope === scope ? state.map : new Map<string, boolean>();
  const st = status.scope === scope ? status : { scope, loading: false, marking: false, error: null };
  const byId = new Map(messages.map((m) => [m.id.toLowerCase(), m]));
  const statusOf = (messageId: string) => statusFor(byId.get(messageId.toLowerCase()), uid, map);
  const unread = ids.filter((id) => {
    const m = byId.get(id);
    return m && uid && m.author_id.toLowerCase() !== uid.toLowerCase() && map.get(id) === false;
  });

  const markRead = async () => {
    const at = scope, thread = interventionId;
    if (!at || !thread || marking.current || !unread.length) return;
    marking.current = true;
    setStatus((s) => ({ ...s, scope: at, marking: true, error: null }));
    try {
      for (const batch of chunks(unread)) {
        const rows = await postReadState(f(), "mark_read", thread, batch);
        if (currentScope() !== at) return;
        if (!rows) {
          setStatus((s) => ({ ...s, scope: at, error: "mark" }));
          return; // only server rows mark a message read
        }
        setState((prev) => {
          const map2 = new Map(prev.scope === at ? prev.map : []);
          for (const r of rows) if (r.read) map2.set(r.message_id, true);
          return { scope: at, map: map2 };
        });
      }
    } finally {
      marking.current = false;
      if (currentScope() === at) setStatus((s) => ({ ...s, scope: at, marking: false }));
    }
  };

  return {
    statusOf,
    canMarkRead: Boolean(scope) && unread.length > 0 && !st.marking,
    markRead,
    refresh,
    error: st.error,
    loading: st.loading,
    marking: st.marking,
  };
}
