"use client";
// One keyset-paginated list of the provider-teams contract (teams, received invitations, or one
// section of a team). Each list keeps its own `next_after`, reads at most once per page, appends
// with a dedupe by id, and fails locally (Réessayer re-reads the exact failed cursor). A local
// generation fences every reply: `reset()` (after a successful write, or on mount for a new team /
// identity) bumps it, so a page that was still in flight is dropped and page 1 is re-read.
import { useEffect, useRef, useState } from "react";
import type { Context } from "./model";

export type PageReply = { status: number; body: unknown };
export type ParsedPage<T> = { records: T[]; next_after: string | null };
export type PagesState<T> = {
  phase: "loading" | "ready" | "error" | "forbidden";
  records: T[];
  next: string | null;
  /** The read in flight for this list: page 1 ("first") or the next page ("next"). */
  reading: "first" | "next" | null;
  /** Cursor of a next page whose read failed (local error, the list already read stays). */
  failed: string | null;
};
export const PAGES_INITIAL: PagesState<never> = { phase: "loading", records: [], next: null, reading: null, failed: null };
const lower = (s: string) => s.toLowerCase();

/** Appends `page` to `records`, skipping ids already listed (case-insensitive). */
export function appendUnique<T extends { id: string }>(records: T[], page: T[]): T[] {
  const seen = new Set(records.map((r) => lower(r.id)));
  const out = [...records];
  for (const r of page) if (!seen.has(lower(r.id))) (seen.add(lower(r.id)), out.push(r));
  return out;
}

export function usePages<P extends ParsedPage<{ id: string }>>(opts: {
  context: Context;
  fetchPage: (after: string | null) => Promise<PageReply>;
  parse: (body: unknown, after: string | null) => P | null;
  onPage?: (page: P, after: string | null) => void;
  /** Read page 1 on mount (default true). */
  auto?: boolean;
}) {
  type T = P["records"][number];
  const [state, setRaw] = useState<PagesState<T>>(PAGES_INITIAL);
  const ref = useRef<PagesState<T>>(state);
  const put = (next: PagesState<T>) => {
    ref.current = next;
    setRaw(next);
  };
  const cb = useRef(opts);
  cb.current = opts;
  const gen = useRef(0);
  const inflight = useRef<string | null>(null);

  const read = async (after: string | null): Promise<void> => {
    const g = gen.current;
    const key = `${g}|${after ?? ""}`;
    if (inflight.current === key) return; // one read per page
    inflight.current = key;
    const { context } = cb.current;
    const cg = context.generation(), who = context.userId();
    const s0 = ref.current;
    put({ ...s0, phase: after === null && s0.phase !== "ready" ? "loading" : s0.phase, reading: after === null ? "first" : "next", failed: null });
    let r: PageReply;
    try {
      r = await cb.current.fetchPage(after);
    } catch {
      r = { status: 0, body: null };
    }
    // A write, a team or identity switch happened meanwhile: this reply is stale, drop it.
    if (gen.current !== g || context.generation() !== cg || context.userId() !== who) return;
    inflight.current = null;
    // 401/403/404 (a revoked member reads `no_data_found` ⇒ 404): a refusal, never a local error.
    if (r.status === 401 || r.status === 403 || r.status === 404) return put({ ...PAGES_INITIAL, phase: "forbidden" });
    if (r.status === 422 && after !== null) return reset(); // cursor refused: restart at page 1
    const p = r.status === 200 ? cb.current.parse(r.body, after) : null;
    const s = ref.current;
    if (!p) return put(after === null ? { ...PAGES_INITIAL, phase: "error" } : { ...s, reading: null, failed: after });
    cb.current.onPage?.(p, after);
    put({ phase: "ready", records: after === null ? p.records : appendUnique(s.records, p.records), next: p.next_after, reading: null, failed: null });
  };
  const reset = (): Promise<void> => {
    gen.current++;
    inflight.current = null;
    return read(null);
  };
  const more = (): Promise<void> => {
    const s = ref.current;
    return s.phase === "ready" && s.next && s.reading === null ? read(s.next) : Promise.resolve();
  };
  const retry = (): Promise<void> => {
    const s = ref.current;
    return s.failed !== null && s.phase === "ready" ? read(s.failed) : reset();
  };
  useEffect(() => {
    if (cb.current.auto !== false) void reset();
    return () => {
      gen.current++; // unmounted (team / identity switch): late replies are dropped
      inflight.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** The server refused this identity (a write answered 401/403): drop every read, show the refusal. */
  const forbid = () => {
    gen.current++;
    inflight.current = null;
    put({ ...PAGES_INITIAL, phase: "forbidden" });
  };
  return { state, reset, more, retry, forbid };
}
