// SYS-07 data erasure requests — API + controllers (no React). Contract: ./contract (mirror of c0df158).
import { z } from "zod";
import { DATA_REQUESTS_COPY as COPY, commandSchema, parseAdminPage, parseDecision, parseDetail, parsePersonalPage, type DecisionCommand, type ErasureDetail, type ErasureRequest } from "./contract";

export const PERSONAL_PATH = "/api/profile/data?section=erasure_requests";
export const ADMIN_PATH = "/api/admin/data-requests";
export const ADMIN_LIMIT = 25;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export type Context = { generation(): number; userId(): string | null };
const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? -1 : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export const personalUrl = (after: string | null) => `${PERSONAL_PATH}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
export const adminListUrl = (after: string | null, limit = ADMIN_LIMIT) => `${ADMIN_PATH}?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
export const adminItemUrl = (id: string) => `${ADMIN_PATH}/${encodeURIComponent(id)}`;

// ---- Paged list (personal or operator): identity-guarded, appended only when valid -------------------
export type ListState = { phase: "loading" | "ready" | "error" | "forbidden"; rows: ErasureRequest[]; next: string | null; loadingMore: boolean; error: string; moreError: string };
export const LIST_INITIAL: ListState = { phase: "loading", rows: [], next: null, loadingMore: false, error: "", moreError: "" };
export function createList({ fetcher, context, kind, get, set }: { fetcher: () => typeof fetch; context: Context; kind: "personal" | "admin"; get: () => ListState; set: (s: ListState) => void }) {
  let seq = 0;
  let alive = true;
  const parse = (body: unknown, after: string | null) => (kind === "personal" ? parsePersonalPage(body, after) : parseAdminPage(body, after, ADMIN_LIMIT));
  const url = (after: string | null) => (kind === "personal" ? personalUrl(after) : adminListUrl(after));
  const fail = (status: number) => (status === 401 ? COPY.session : status === 403 ? COPY.opForbidden : COPY.loadFailed);
  return {
    dispose() {
      alive = false;
      seq++;
    },
    async load() {
      const my = ++seq;
      const uid = context.userId(), gen = context.generation();
      // A refresh keeps the rows on screen (and an opened detail) until page 1 is confirmed again.
      if (get().phase !== "ready") set({ ...LIST_INITIAL });
      const r = await timed(fetcher(), url(null), { method: "GET" });
      if (!alive || my !== seq || context.userId() !== uid || context.generation() !== gen) return;
      if (r.status === 401 || r.status === 403) return set({ ...LIST_INITIAL, phase: "forbidden", error: fail(r.status) });
      const p = r.status === 200 ? parse(r.body, null) : null;
      if (!p) return set({ ...LIST_INITIAL, phase: "error", error: fail(r.status) });
      set({ ...LIST_INITIAL, phase: "ready", rows: p.rows, next: p.next_cursor });
    },
    async more() {
      const s = get();
      if (s.phase !== "ready" || s.loadingMore || !s.next) return;
      const my = seq;
      const uid = context.userId(), gen = context.generation();
      const after = s.next;
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await timed(fetcher(), url(after), { method: "GET" });
      if (!alive || my !== seq || context.userId() !== uid || context.generation() !== gen) return;
      if (r.status === 401 || r.status === 403) return set({ ...LIST_INITIAL, phase: "forbidden", error: fail(r.status) });
      const p = r.status === 200 ? parse(r.body, after) : null;
      if (!p) return set({ ...get(), loadingMore: false, moreError: COPY.moreFailed });
      const seen = new Set(get().rows.map((x) => x.id));
      set({ ...get(), rows: [...get().rows, ...p.rows.filter((x) => !seen.has(x.id))], next: p.next_cursor, loadingMore: false, moreError: "" });
    },
  };
}

// ---- Operator decision: identity-fenced command ------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-data-requests:";
export const pendingKey = (uid: string | null, gen: number, id: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${id.toLowerCase()}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), id: z.uuid(), command: commandSchema }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export type DetailView = { phase: "loading" | "ready" | "error" | "forbidden"; data: ErasureDetail | null; busy: boolean; error: string; notice: string; pending: DecisionCommand | null; waitS: number | null };
export const DETAIL_INITIAL: DetailView = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null, waitS: null };

export function createDetail({ id, fetcher, store, newId, context, get, set }: { id: string; fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; get: () => DetailView; set: (v: DetailView) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  let alive = true;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (w: { uid: string | null; gen: number }) => alive && context.userId() === w.uid && context.generation() === w.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const key = (w: { uid: string | null; gen: number }) => pendingKey(w.uid, w.gen, id);
  const clearStored = (w = identity()) => safe(() => store()?.remove(key(w)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...DETAIL_INITIAL, phase: "forbidden", error: COPY.opForbidden });
  };
  const load = async () => {
    const my = ++loadSeq;
    const w = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await timed(fetcher(), adminItemUrl(id), { method: "GET" });
    if (my !== loadSeq || !same(w)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const d = r.status === 200 ? parseDetail(r.body, id) : null;
    if (!d) return set({ ...get(), phase: get().data ? get().phase : "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", data: d, error: get().phase === "error" ? "" : get().error });
  };
  const persist = (cmd: DecisionCommand, w: { uid: string | null; gen: number }): boolean => {
    if (!w.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const value = JSON.stringify({ uid: w.uid, gen: w.gen, id: id.toLowerCase(), command: cmd });
    return safe(() => {
      s.set(key(w), value);
      return s.get(key(w)) === value;
    }) === true;
  };
  const send = async (cmd: DecisionCommand): Promise<boolean> => {
    if (inFlight) return false;
    const w = identity();
    if (!persist(cmd, w)) {
      set({ ...get(), error: COPY.opStorage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "", waitS: null });
    let r: Result;
    try {
      r = await timed(fetcher(), adminItemUrl(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    } finally {
      inFlight = false;
    }
    if (!same(w)) return false; // identity changed / unmounted: reply ignored, never replayed
    const ok = r.status === 200 ? parseDecision(r.body, id, cmd) : null;
    if (ok) {
      clearStored(w);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: ok.replayed ? COPY.opReplayed : COPY.opSaved });
      await load();
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400 || r.status === 404) {
      clearStored(w);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.opConflict : COPY.opInvalid });
      if (r.status === 409) await load();
      return false;
    }
    // Lost reply, 5xx, 429, timeout, unverifiable 200: the SAME command on retry.
    pendingFor = `${w.uid}|${w.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.opRetry, waitS: r.retryAfterS });
    return false;
  };
  return {
    load,
    dispose() {
      alive = false;
      loadSeq++;
    },
    restorePending() {
      const w = identity();
      if (!w.uid) return;
      const raw = safe(() => store()?.get(key(w)) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof stored> | null = null;
      try {
        const r = stored.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== w.uid || parsed.gen !== w.gen || parsed.id.toLowerCase() !== id.toLowerCase()) {
        safe(() => store()?.remove(key(w)));
        return;
      }
      pendingFor = `${w.uid}|${w.gen}`;
      set({ ...get(), pending: parsed.command, error: COPY.opRestored });
    },
    decide(state: DecisionCommand["state"], reason: string): Promise<boolean> {
      const d = get().data;
      if (!d || !d.can_decide || get().pending || inFlight) return Promise.resolve(false);
      if (d.request.state === "approved" || d.request.state === "rejected") return Promise.resolve(false);
      const text = reason.trim();
      if (!text || text.length > 1000) {
        set({ ...get(), error: COPY.opReasonRequired });
        return Promise.resolve(false);
      }
      const cid = safe(newId) ?? null;
      if (!cid) {
        set({ ...get(), error: COPY.opNoUuid });
        return Promise.resolve(false);
      }
      const cmd = commandSchema.safeParse({ command_id: cid, expected_version: d.request.version, state, reason: text });
      if (!cmd.success) {
        set({ ...get(), error: COPY.opInvalid });
        return Promise.resolve(false);
      }
      return send(cmd.data);
    },
    retry(): Promise<boolean> {
      const p = get().pending;
      if (!p) return Promise.resolve(false);
      const w = identity();
      if (pendingFor !== `${w.uid}|${w.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve(false);
      }
      return send(p);
    },
    /** Re-read the request (the unconfirmed command stays offered: nothing proves it was not applied). */
    reread: () => load(),
  };
}
