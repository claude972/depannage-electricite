"use client";
// Phone access (docs/GUEST_CHECKOUT_CONTRACT.md): verified phone identity without a password, for
// a booking (purpose "booking") or to find one's requests again (purpose "lookup"). Talks ONLY to
// POST /api/auth/phone/start and /api/auth/phone/verify (Supabase SSR cookies are set by the
// server; no JWT, token or code is ever read, logged or stored here). Pure state machine + thin
// React view; the fetcher is injected (tests use a fake, never a real SMS).
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { normalizePhone } from "../app/booking-draft";
import { STATUS, category as categoryOf, date as formatDate, money } from "../app/format";
import type { Status } from "../app/types";
import { Field } from "../app/ui";
import { createClient } from "../../lib/supabase/client";
import { PublicChrome } from "./public-chrome";
import { serviceChromeHandlers } from "./public-service-page";
import styles from "./phone-access.module.css";

export type PhonePurpose = "booking" | "lookup";
export type PhoneKind = "sms" | "phone_change";
export type ApiResult = { status: number; body: unknown; retryAfter: number | null };
export type PhoneApi = {
  start(body: { phone: string; first_name: string; last_name: string; purpose: PhonePurpose }): Promise<ApiResult>;
  verify(body: { phone: string; token: string; kind: PhoneKind }): Promise<ApiResult>;
};

/** Deadline of every phone/history request: a hung network never leaves « Envoi… » forever. */
export const PHONE_TIMEOUT_MS = 15_000;
/** Synthetic status of a request aborted by the deadline (never a server answer). */
export const TIMEOUT_STATUS = -1;
const systemClock = () => Date.now();

/** fetch + JSON with a deadline: the request is aborted (AbortController) and the call settles as
 *  TIMEOUT_STATUS when the deadline passes first; the timer is always cleared. */
async function timedJson(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<ApiResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: ApiResult = { status: TIMEOUT_STATUS, body: null, retryAfter: null };
  const deadline = new Promise<ApiResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<ApiResult> => {
    try {
      const response = await fetcher(path, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      const body = await response.json().catch(() => null);
      return { status: response.status, body, retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch (error) {
      if (controller?.signal.aborted) return timedOut;
      throw error;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
/** Same-origin JSON POST, credentials same-origin, no-store; Retry-After parsed (seconds). */
export function createPhoneApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = PHONE_TIMEOUT_MS } = {}): PhoneApi {
  const post = (path: string, body: unknown) =>
    timedJson(fetcher, path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  return { start: (body) => post("/api/auth/phone/start", body), verify: (body) => post("/api/auth/phone/verify", body) };
}

// ---- Pure state machine -------------------------------------------------------------------------
export type PhoneStage = "form" | "sending" | "code" | "verifying" | "verified";
export type PhoneState = {
  stage: PhoneStage;
  phone: string;
  first_name: string;
  last_name: string;
  code: string;
  kind: PhoneKind | null;
  suffix: string;
  /** Epoch ms before which « Renvoyer le code » stays disabled. */
  resendAt: number;
  /** Epoch ms before which a new attempt is refused (429 Retry-After). */
  blockedUntil: number;
  message: string;
  error: string;
  fieldErrors: Partial<Record<"phone" | "first_name" | "last_name" | "code", string>>;
};
export function initialPhoneState(prefill: { phone?: string; first_name?: string; last_name?: string } = {}): PhoneState {
  return { stage: "form", phone: prefill.phone ?? "", first_name: prefill.first_name ?? "", last_name: prefill.last_name ?? "", code: "", kind: null, suffix: "", resendAt: 0, blockedUntil: 0, message: "", error: "", fieldErrors: {} };
}
export const PHONE_COPY = {
  sentBooking: (suffix: string) => `Code envoyé au •••• ${suffix}.`,
  sentLookup: "Si ce numéro est connu, un code vous a été envoyé.",
  unavailable: {
    booking: "Service SMS indisponible, réessayez dans un instant ; ou revenez plus tard : votre demande reste conservée dans ce navigateur.",
    lookup: "Service SMS indisponible, réessayez dans un instant ; ou connectez-vous avec votre email si vous avez un compte.",
  },
  wrongCode: "Code incorrect ou expiré. Vérifiez les 6 chiffres reçus.",
  tooMany: (s: number) => `Trop de tentatives. Réessayez dans ${s} s.`,
  refused: "Ce numéro ne peut pas être utilisé ici. Connectez-vous avec votre compte habituel.",
  invalid: "Vérifiez le numéro de téléphone, votre nom et votre prénom.",
  failed: "La vérification n’a pas abouti. Rien n’a été confirmé ; réessayez.",
  timeout: "Délai dépassé, réessayez. Rien n’a été confirmé.",
} as const;

export function phoneFormErrors(s: PhoneState): PhoneState["fieldErrors"] {
  const e: PhoneState["fieldErrors"] = {};
  if (!normalizePhone(s.phone)) e.phone = "Indiquez un numéro de mobile valide (ex. 0696 12 34 56).";
  if (!s.first_name.trim()) e.first_name = "Indiquez votre prénom.";
  if (!s.last_name.trim()) e.last_name = "Indiquez votre nom.";
  return e;
}
export const codeError = (code: string) => (/^\d{6}$/.test(code.trim()) ? "" : "Saisissez le code à 6 chiffres.");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const seconds = (r: ApiResult, fallback = 60) => r.retryAfter ?? fallback;

/** Result of POST /start applied to the state. Never a success that the server did not give. */
export function applyStart(s: PhoneState, r: ApiResult, purpose: PhonePurpose, now: number): PhoneState {
  const base = { ...s, error: "", message: "", fieldErrors: {} };
  const body = isObj(r.body) ? r.body : {};
  if (r.status === 200 && body.status === "verified") return { ...base, stage: "verified" };
  if (r.status === 200 && body.status === "code_requested" && (body.kind === "sms" || body.kind === "phone_change")) {
    const suffix = typeof body.phone_suffix === "string" ? body.phone_suffix.slice(-4) : "";
    const retry = typeof body.retry_after === "number" && body.retry_after > 0 ? body.retry_after : 60;
    return { ...base, stage: "code", kind: body.kind, suffix, code: "", resendAt: now + retry * 1000, message: purpose === "lookup" ? PHONE_COPY.sentLookup : PHONE_COPY.sentBooking(suffix) };
  }
  const stage: PhoneStage = s.kind ? "code" : "form";
  if (r.status === TIMEOUT_STATUS) return { ...base, stage, error: PHONE_COPY.timeout };
  if (r.status === 429) return { ...base, stage, blockedUntil: now + seconds(r) * 1000, error: PHONE_COPY.tooMany(seconds(r)) };
  if (r.status === 503) return { ...base, stage, error: PHONE_COPY.unavailable[purpose] };
  if (r.status === 409) return { ...base, stage, error: PHONE_COPY.refused };
  if (r.status === 400 || r.status === 422) return { ...base, stage, error: PHONE_COPY.invalid };
  return { ...base, stage, error: PHONE_COPY.failed };
}
/** Result of POST /verify. 422 keeps the typed code so it can be corrected. */
export function applyVerify(s: PhoneState, r: ApiResult, purpose: PhonePurpose, now: number): PhoneState {
  const base = { ...s, stage: "code" as PhoneStage, error: "", fieldErrors: {} };
  if (r.status === 200 && isObj(r.body) && r.body.verified === true) return { ...base, stage: "verified", message: "" };
  if (r.status === TIMEOUT_STATUS) return { ...base, error: PHONE_COPY.timeout };
  if (r.status === 422) return { ...base, error: PHONE_COPY.wrongCode };
  if (r.status === 429) return { ...base, blockedUntil: now + seconds(r) * 1000, error: PHONE_COPY.tooMany(seconds(r)) };
  if (r.status === 503) return { ...base, error: PHONE_COPY.unavailable[purpose] };
  return { ...base, error: PHONE_COPY.failed };
}
export function phoneActionLabel(s: PhoneState): string {
  if (s.stage === "sending") return "Envoi…";
  if (s.stage === "verifying") return "Vérification…";
  if (s.stage === "code") return "Valider le code";
  if (s.stage === "verified") return "Téléphone vérifié";
  return "Recevoir un code";
}

// ---- Controller: single flight, request sequence, late replies ignored --------------------------
/** Drives start/verify outside React: ONE request at a time (a ref, not state), each reply applied
 *  only if it belongs to the latest request of a still-attached view; onVerified at most once. */
export function createPhoneController({ api, purpose, clock = systemClock, get, set, onVerified }: { api: () => PhoneApi; purpose: PhonePurpose; clock?: () => number; get: () => PhoneState; set: (s: PhoneState) => void; onVerified: () => void }) {
  let inFlight = false;
  let seq = 0;
  let attached = true;
  let verified = false;
  const settle = (my: number, next: PhoneState) => {
    if (!attached || my !== seq) return; // unmounted or superseded: ignored
    set(next);
    if (next.stage === "verified" && !verified) {
      verified = true;
      onVerified();
    }
  };
  const send = async (call: () => Promise<ApiResult>, apply: (s: PhoneState, r: ApiResult) => PhoneState, busy: PhoneStage) => {
    if (inFlight) return false;
    inFlight = true;
    const my = ++seq;
    set({ ...get(), stage: busy, error: "" });
    let result: ApiResult;
    try {
      result = await call();
    } catch {
      result = { status: 0, body: null, retryAfter: null };
    } finally {
      inFlight = false;
    }
    settle(my, apply(get(), result));
    return true;
  };
  return {
    get busy() {
      return inFlight;
    },
    start(): Promise<boolean> | false {
      const s = get();
      const fieldErrors = phoneFormErrors(s);
      if (Object.keys(fieldErrors).length) return set({ ...s, fieldErrors, error: "" }), false;
      if (s.blockedUntil > clock() || inFlight) return false;
      const phone = normalizePhone(s.phone)!;
      return send(() => api().start({ phone, first_name: s.first_name.trim(), last_name: s.last_name.trim(), purpose }), (cur, r) => applyStart(cur, r, purpose, clock()), "sending");
    },
    verify(): Promise<boolean> | false {
      const s = get();
      const error = codeError(s.code);
      if (error) return set({ ...s, fieldErrors: { code: error }, error: "" }), false;
      if (s.blockedUntil > clock() || !s.kind || inFlight) return false;
      const kind = s.kind;
      return send(() => api().verify({ phone: normalizePhone(s.phone)!, token: s.code.trim(), kind }), (cur, r) => applyVerify(cur, r, purpose, clock()), "verifying");
    },
    /** « Modifier le numéro »: any reply still on its way is superseded. */
    reset() {
      seq++;
      inFlight = false;
      set({ ...get(), stage: "form", code: "", kind: null, message: "", error: "" });
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      seq++;
    },
  };
}

// ---- View ---------------------------------------------------------------------------------------
export function PhoneAccess({
  purpose,
  prefill,
  api,
  onVerified,
  formId: givenFormId,
  onStateChange,
  initial,
  clock = systemClock,
}: {
  purpose: PhonePurpose;
  prefill?: { phone?: string; first_name?: string; last_name?: string };
  api?: PhoneApi;
  onVerified: () => void;
  formId?: string;
  onStateChange?: (s: PhoneState) => void;
  /** Tests only: render a given stage. */
  initial?: PhoneState;
  /** Stable by default (module-level), so the countdown effect never re-subscribes per render. */
  clock?: () => number;
}) {
  const uid = useId();
  const formId = givenFormId ?? `${uid}-phone`;
  const [state, setStateRaw] = useState<PhoneState>(initial ?? initialPhoneState(prefill));
  const stateRef = useRef(state);
  const setState = useCallback((next: PhoneState | ((s: PhoneState) => PhoneState)) => {
    stateRef.current = typeof next === "function" ? next(stateRef.current) : next;
    setStateRaw(stateRef.current);
  }, []);
  const latest = useRef({ api, onVerified, clock });
  latest.current = { api, onVerified, clock };
  const controller = useRef<ReturnType<typeof createPhoneController> | null>(null);
  if (!controller.current) {
    let client: PhoneApi | null = null;
    controller.current = createPhoneController({
      api: () => (client ??= latest.current.api ?? createPhoneApi()),
      purpose,
      clock: () => latest.current.clock(),
      get: () => stateRef.current,
      set: setState,
      onVerified: () => latest.current.onVerified(),
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach(); // StrictMode re-mount re-attaches
    return () => ctrl.detach();
  }, [ctrl]);
  const [now, setNow] = useState(() => clock());
  const namesPrefilled = !!(prefill?.first_name?.trim() && prefill?.last_name?.trim());

  useEffect(() => onStateChange?.(state), [state, onStateChange]);
  // One-second tick only while a countdown is pending; deps are primitives + a stable clock.
  const until = Math.max(state.resendAt, state.blockedUntil);
  useEffect(() => {
    if (!until) return;
    setNow(clock());
    const timer = setInterval(() => {
      const t = clock();
      setNow(t);
      if (t >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until, clock]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (stateRef.current.stage === "form") void ctrl.start();
    else if (stateRef.current.stage === "code") void ctrl.verify();
  };
  const busy = state.stage === "sending" || state.stage === "verifying";
  const resendIn = Math.max(0, Math.ceil((state.resendAt - now) / 1000));
  const blockedIn = Math.max(0, Math.ceil((state.blockedUntil - now) / 1000));
  const set = (patch: Partial<PhoneState>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className={styles.root} data-phone-access={purpose} data-phone-stage={state.stage}>
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        {(state.stage === "form" || state.stage === "sending") && (
          <>
            {!namesPrefilled && (
              <div className={styles.grid}>
                <Field label="Prénom" error={state.fieldErrors.first_name}>
                  <input autoComplete="given-name" maxLength={60} value={state.first_name} disabled={busy} onChange={(e) => set({ first_name: e.target.value })} />
                </Field>
                <Field label="Nom" error={state.fieldErrors.last_name}>
                  <input autoComplete="family-name" maxLength={60} value={state.last_name} disabled={busy} onChange={(e) => set({ last_name: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label="Téléphone mobile" hint="Un code à 6 chiffres sera demandé pour vérifier ce numéro." error={state.fieldErrors.phone}>
              <input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={state.phone} disabled={busy} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
          </>
        )}
        {(state.stage === "code" || state.stage === "verifying") && (
          <>
            {state.message && <p className={styles.message} role="status">{state.message}</p>}
            <Field label="Code reçu par SMS" hint="6 chiffres" error={state.fieldErrors.code}>
              <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={state.code} disabled={busy} onChange={(e) => set({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
            </Field>
            <div className={styles.row}>
              <button type="button" className={styles.link} disabled={busy || resendIn > 0 || blockedIn > 0} onClick={() => { set({ code: "" }); void ctrl.start(); }}>
                {resendIn > 0 ? `Renvoyer le code dans ${resendIn} s` : "Renvoyer le code"}
              </button>
              <button type="button" className={styles.link} disabled={busy} onClick={() => ctrl.reset()}>
                Modifier le numéro
              </button>
            </div>
          </>
        )}
        {state.stage === "verified" && <p className={styles.message} role="status">Téléphone vérifié.</p>}
        {state.error && <p className={styles.error} role="alert">{blockedIn > 0 ? PHONE_COPY.tooMany(blockedIn) : state.error}</p>}
        {state.stage !== "verified" && (
          <button type="submit" className={styles.submit} disabled={busy || blockedIn > 0} data-phone-submit={state.stage}>
            {phoneActionLabel(state)}
          </button>
        )}
      </form>
    </div>
  );
}

// ---- Verified history (GET /api/auth/phone/history), cursor pagination ---------------------------
export type HistoryItem = { id: string; category: string; status: string; city: string; created_at: string; estimate_min_cents: number | null; estimate_max_cents: number | null };
export type HistoryApi = (params: { cursor?: string; limit: number }) => Promise<ApiResult>;
export const HISTORY_LIMIT = 20;
export function createHistoryApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = PHONE_TIMEOUT_MS } = {}): HistoryApi {
  return ({ cursor, limit }) => {
    // The opaque cursor is sent back unchanged (only URL-encoded).
    const query = `limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    return timedJson(fetcher, `/api/auth/phone/history?${query}`, { method: "GET", credentials: "same-origin", cache: "no-store" }, timeoutMs);
  };
}
export type HistoryState = {
  status: "loading" | "ready" | "error" | "expired" | "unavailable";
  items: HistoryItem[];
  hasMore: boolean;
  nextCursor: string | null;
  loadingMore: boolean;
  error: string;
};
export const HISTORY_INITIAL: HistoryState = { status: "loading", items: [], hasMore: false, nextCursor: null, loadingMore: false, error: "" };
export const HISTORY_COPY = {
  expired: "Votre vérification a expiré, recommencez.",
  unavailable: "Le suivi est momentanément indisponible, réessayez dans un instant.",
  failed: "Vos demandes n’ont pas pu être chargées. Réessayez.",
  empty: "Aucune demande n’est associée à ce numéro.",
} as const;
const UUIDISH = /^[0-9a-f-]{8,64}$/i;
function parseHistory(body: unknown): { items: HistoryItem[]; hasMore: boolean; nextCursor: string | null } | null {
  if (!isObj(body) || !Array.isArray(body.interventions) || !isObj(body.page)) return null;
  const items: HistoryItem[] = [];
  for (const r of body.interventions) {
    if (!isObj(r) || typeof r.id !== "string" || !UUIDISH.test(r.id) || typeof r.category !== "string" || typeof r.status !== "string" || typeof r.created_at !== "string") return null;
    const cents = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
    items.push({ id: r.id, category: r.category, status: r.status, city: typeof r.city === "string" ? r.city : "", created_at: r.created_at, estimate_min_cents: cents(r.estimate_min_cents), estimate_max_cents: cents(r.estimate_max_cents) });
  }
  const hasMore = body.page.has_more === true;
  const nextCursor = hasMore && typeof body.page.next_cursor === "string" && body.page.next_cursor ? body.page.next_cursor : null;
  return { items, hasMore: hasMore && nextCursor !== null, nextCursor };
}
/** One history reply applied to the state; `append` = « Afficher plus » (dedupe by id). */
export function applyHistory(s: HistoryState, r: ApiResult, append: boolean): HistoryState {
  const base = { ...s, loadingMore: false, error: "" };
  if (r.status === 200) {
    const page = parseHistory(r.body);
    if (!page) return { ...base, status: append ? s.status : "error", error: HISTORY_COPY.failed };
    const seen = new Set(append ? s.items.map((i) => i.id) : []);
    const merged = [...(append ? s.items : []), ...page.items.filter((i) => !seen.has(i.id) && (seen.add(i.id), true))];
    return { ...base, status: "ready", items: merged, hasMore: page.hasMore, nextCursor: page.nextCursor };
  }
  if (r.status === 401) return { ...HISTORY_INITIAL, status: "expired", error: HISTORY_COPY.expired };
  if (r.status === TIMEOUT_STATUS) return { ...base, status: append ? s.status : "error", error: PHONE_COPY.timeout };
  if (r.status === 503) return { ...base, status: append ? s.status : "unavailable", error: HISTORY_COPY.unavailable };
  return { ...base, status: append ? s.status : "error", error: HISTORY_COPY.failed };
}

/** Identity source: (uid | null) on every auth change, incl. the initial session. */
export type IdentityWatch = (cb: (uid: string | null) => void) => () => void;
export const supabaseIdentity: IdentityWatch = (cb) => {
  try {
    const { data } = createClient().auth.onAuthStateChange((_event, session) => cb(session?.user?.id ?? null));
    return () => data.subscription.unsubscribe();
  } catch {
    return () => {}; // auth client not configured: the server 401 still ends the list
  }
};

/** History outside React: a generation counter (identity change, reload) makes every older reply
 *  void; « Afficher plus » is single-flight; an identity change clears the list at once. */
export function createHistoryController({ api, get, set, onExpired }: { api: () => HistoryApi; get: () => HistoryState; set: (s: HistoryState) => void; onExpired: () => void }) {
  let gen = 0;
  let moreInFlight = false;
  let attached = true;
  let uid: string | undefined; // undefined = not known yet
  const expire = () => {
    gen++;
    moreInFlight = false;
    set({ ...HISTORY_INITIAL, status: "expired", error: HISTORY_COPY.expired });
    onExpired();
  };
  const fetchPage = async (append: boolean) => {
    const my = append ? gen : ++gen;
    const cursor = append ? get().nextCursor ?? undefined : undefined;
    let result: ApiResult;
    try {
      result = await api()({ cursor, limit: HISTORY_LIMIT });
    } catch {
      result = { status: 0, body: null, retryAfter: null };
    }
    if (append) moreInFlight = false;
    if (!attached || my !== gen) return false; // old identity / superseded reload
    const next = applyHistory(get(), result, append);
    if (next.status === "expired") return expire(), true;
    set(next);
    return true;
  };
  return {
    /** First load or retry: shows « loading » (no stale list). */
    load() {
      set(HISTORY_INITIAL);
      return fetchPage(false);
    },
    /** Window focus: revalidate in place (the current list stays until the fresh reply). */
    revalidate() {
      if (get().status === "expired") return Promise.resolve(false);
      return fetchPage(false);
    },
    more() {
      const s = get();
      if (moreInFlight || !s.hasMore || !s.nextCursor) return Promise.resolve(false);
      moreInFlight = true;
      set({ ...s, loadingMore: true });
      return fetchPage(true);
    },
    /** Auth change: SIGNED_OUT (null) or another uid ⇒ cleared immediately, back to the phone step. */
    identity(next: string | null) {
      // Before a uid is known (e.g. the browser client cannot read the session), nothing is
      // inferred: the server's 401 still ends the list. Once known, any change clears it.
      if (uid === undefined) {
        if (next !== null) uid = next;
        return;
      }
      if (next !== uid) {
        uid = next ?? undefined;
        expire();
      }
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      gen++;
    },
  };
}

export function PhoneHistory({ api, onExpired, initial, watchIdentity = supabaseIdentity }: { api?: HistoryApi; onExpired: () => void; initial?: HistoryState; watchIdentity?: IdentityWatch }) {
  const [state, setStateRaw] = useState<HistoryState>(initial ?? HISTORY_INITIAL);
  const stateRef = useRef(state);
  const setState = useCallback((next: HistoryState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);
  const latest = useRef({ api, onExpired });
  latest.current = { api, onExpired };
  const controller = useRef<ReturnType<typeof createHistoryController> | null>(null);
  if (!controller.current) {
    let client: HistoryApi | null = null;
    controller.current = createHistoryController({ api: () => (client ??= latest.current.api ?? createHistoryApi()), get: () => stateRef.current, set: setState, onExpired: () => latest.current.onExpired() });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load();
    const stop = watchIdentity((uid) => ctrl.identity(uid));
    const onFocus = () => void ctrl.revalidate();
    window.addEventListener("focus", onFocus);
    return () => {
      ctrl.detach();
      stop();
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl, watchIdentity]);

  if (state.status === "loading") return <p className={styles.lead} role="status" data-history="loading">Chargement de vos demandes…</p>;
  if (state.status === "expired") return <p className={styles.error} role="alert" data-history="expired">{HISTORY_COPY.expired}</p>;
  if (state.status === "error" || state.status === "unavailable")
    return (
      <div className={styles.card} data-history={state.status}>
        <p className={styles.error} role="alert">{state.error}</p>
        <button type="button" className={styles.link} onClick={() => void ctrl.load()}>Réessayer</button>
      </div>
    );
  if (!state.items.length) return <p className={styles.lead} data-history="empty">{HISTORY_COPY.empty}</p>;
  return (
    <div className={styles.history} data-history="ready">
      <ul className={styles.historyList}>
        {state.items.map((item) => {
          const c = categoryOf(item.category);
          const range = item.estimate_min_cents !== null && item.estimate_max_cents !== null ? `${money(item.estimate_min_cents)} – ${money(item.estimate_max_cents)}` : null;
          return (
            <li key={item.id}>
              <a className={styles.historyRow} href={`/#detail/${encodeURIComponent(item.id)}`} data-history-id={item.id}>
                <strong>{c.label}</strong>
                <span className={styles.historyStatus}>{STATUS[item.status as Status] ?? "Statut à vérifier"}</span>
                <span>{[item.city, formatDate(item.created_at)].filter(Boolean).join(" · ")}</span>
                {range && <span>Estimation indicative : {range}</span>}
              </a>
            </li>
          );
        })}
      </ul>
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {state.hasMore && (
        <button type="button" className={styles.submit} disabled={state.loadingMore} onClick={() => void ctrl.more()} data-history-more="">
          {state.loadingMore ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}

// ---- /suivi: find one's requests with a verified phone (no public lookup, no listing before) ----
// While phone auth is off (server options), no phone form at all: honest message + account login.
export function PhoneLookupPage({ api, optionsApi, historyApi, watchIdentity, initialOptions, initialVerified = false, go = (href: string) => window.location.assign(href) }: { api?: PhoneApi; optionsApi?: OptionsApi; historyApi?: HistoryApi; watchIdentity?: IdentityWatch; initialOptions?: OptionsState; initialVerified?: boolean; go?: (href: string) => void }) {
  const { options } = useBookingOptions(optionsApi, initialOptions);
  const [verified, setVerified] = useState(initialVerified);
  const [expired, setExpired] = useState(false);
  return (
    <PublicChrome current="suivi" handlers={serviceChromeHandlers(go)} onHome={() => go("/")}>
      <div className={styles.page}>
        <h1>Suivre ma demande</h1>
        {options.status === "loading" ? (
          <p className={styles.lead} role="status">Chargement…</p>
        ) : !phoneAuthOn(options) ? (
          <div className={styles.card} data-suivi-off="">
            <p className={styles.lead}>{SUIVI_OFF}</p>
            <a className={styles.submit} href="/#auth">Me connecter à mon compte</a>
          </div>
        ) : verified ? (
          <PhoneHistory api={historyApi} watchIdentity={watchIdentity} onExpired={() => { setExpired(true); setVerified(false); }} />
        ) : (
          <>
            {expired && <p className={styles.error} role="alert">{HISTORY_COPY.expired}</p>}
            <p className={styles.lead}>Indiquez le téléphone utilisé pour votre demande, avec votre nom et votre prénom. Après vérification du code, vos demandes s’affichent ici.</p>
            <div className={styles.card}>
              <PhoneAccess purpose="lookup" api={api} onVerified={() => { setExpired(false); setVerified(true); }} />
            </div>
          </>
        )}
      </div>
    </PublicChrome>
  );
}

// ---- Booking options (GET /api/bookings/options): availability decided by the server only -------
export type PaymentMethodOption = { id: "on_site" | "card_hold"; available: boolean; label?: string; description?: string; reason?: string };
export type BookingOptions = { payment_methods: PaymentMethodOption[]; phone_auth: { available: boolean | null; reason?: string }; currency: string };
export type OptionsState = { status: "loading" } | { status: "error" } | { status: "ready"; options: BookingOptions };
export type OptionsApi = () => Promise<BookingOptions | null>;

/** Strict parse: anything unexpected ⇒ null (treated as « options unavailable », never as available). */
export function parseBookingOptions(body: unknown): BookingOptions | null {
  if (!isObj(body) || !Array.isArray(body.payment_methods) || !isObj(body.phone_auth)) return null;
  const methods: PaymentMethodOption[] = [];
  for (const m of body.payment_methods) {
    if (!isObj(m) || (m.id !== "on_site" && m.id !== "card_hold") || typeof m.available !== "boolean") return null;
    methods.push({ id: m.id, available: m.available, ...(typeof m.label === "string" ? { label: m.label } : {}), ...(typeof m.description === "string" ? { description: m.description } : {}), ...(typeof m.reason === "string" ? { reason: m.reason.slice(0, 300) } : {}) });
  }
  const p = body.phone_auth;
  const available = p.available === true ? true : p.available === false ? false : null;
  return { payment_methods: methods, phone_auth: { available, ...(typeof p.reason === "string" ? { reason: p.reason.slice(0, 300) } : {}) }, currency: typeof body.currency === "string" ? body.currency : "eur" };
}
export function createOptionsApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = PHONE_TIMEOUT_MS } = {}): OptionsApi {
  return async () => {
    try {
      const r = await timedJson(fetcher, "/api/bookings/options", { method: "GET", credentials: "same-origin", cache: "no-store" }, timeoutMs);
      return r.status === 200 ? parseBookingOptions(r.body) : null;
    } catch {
      return null;
    }
  };
}
/** Loads the options once (and on retry). Tests pass `initial` to render a given state. */
export function useBookingOptions(api?: OptionsApi, initial?: OptionsState): { options: OptionsState; retry: () => void } {
  const [options, setOptions] = useState<OptionsState>(initial ?? { status: "loading" });
  const [attempt, setAttempt] = useState(initial ? -1 : 0);
  useEffect(() => {
    if (attempt < 0) return;
    let alive = true;
    setOptions({ status: "loading" });
    void (api ?? createOptionsApi())().then((o) => {
      if (alive) setOptions(o ? { status: "ready", options: o } : { status: "error" });
    });
    return () => {
      alive = false;
    };
  }, [api, attempt]);
  return { options, retry: () => setAttempt((n) => Math.max(0, n) + 1) };
}
export const phoneAuthOn = (o: OptionsState) => o.status === "ready" && o.options.phone_auth.available === true;
export const SUIVI_OFF = "Le suivi par SMS sera disponible prochainement.";
