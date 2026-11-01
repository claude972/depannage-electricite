"use client";
// Card-hold settlement (docs/GUEST_SETTLEMENT_CONTRACT.md): shows the server's settlement status
// for one intervention and lets the client confirm the capture of the amount the SERVER states.
// Only GET /api/bookings/settlement/status and POST /api/bookings/settlement/capture
// {intervention_id}; never an amount, account, rate or Stripe id sent or rendered, never a
// Checkout link, never « payé » inferred from a URL. Unknown ⇒ error + Réessayer (never
// « not_started »). The lead passes the guard generation + uid: a reply is applied only if
// both are unchanged since the request started.
import { useEffect, useRef, useState } from "react";
import { money } from "../app/format";
import styles from "./booking-settlement.module.css";

export const SETTLEMENT_STATUSES = ["not_started", "processing", "captured_transfer_pending", "paid", "needs_review"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export type SettlementDTO = { method: "card_hold"; status: SettlementStatus; amount_cents: number | null; currency: "eur"; available: boolean; reason?: string };
export type SettlementResult = { status: number; body: unknown; retryAfter: number | null };
export type SettlementApi = {
  status(interventionId: string): Promise<SettlementResult>;
  capture(interventionId: string): Promise<SettlementResult>;
};
export type SettlementContext = { generation(): number; userId(): string | null };
export const DEFAULT_CONTEXT: SettlementContext = { generation: () => 0, userId: () => null };
export const SETTLEMENT_TIMEOUT_MS = 15_000;
export const SETTLEMENT_TIMEOUT = -1;

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<SettlementResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: SettlementResult = { status: SETTLEMENT_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<SettlementResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<SettlementResult> => {
    try {
      const response = await fetcher(path, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
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
/** Same-origin, credentials same-origin, no-store, 15 s deadline. The body carries only the id. */
export function createSettlementApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = SETTLEMENT_TIMEOUT_MS } = {}): SettlementApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  return {
    status: (id) => timed(fetcher, `/api/bookings/settlement/status?intervention_id=${encodeURIComponent(id)}`, { ...base, method: "GET" }, timeoutMs),
    capture: (id) => timed(fetcher, "/api/bookings/settlement/capture", { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervention_id: id }) }, timeoutMs),
  };
}

// ---- Pure parse + presentation ------------------------------------------------------------------
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/** Strict DTO parse: anything else ⇒ null (rendered as an error, never as « not_started »). */
export function parseSettlement(body: unknown): SettlementDTO | null {
  if (!isObj(body) || body.method !== "card_hold" || body.currency !== "eur" || typeof body.available !== "boolean") return null;
  if (!SETTLEMENT_STATUSES.includes(body.status as SettlementStatus)) return null;
  const amount = body.amount_cents;
  if (!(amount === null || (typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0))) return null;
  if (body.reason !== undefined && typeof body.reason !== "string") return null;
  return { method: "card_hold", status: body.status as SettlementStatus, amount_cents: amount as number | null, currency: "eur", available: body.available, ...(typeof body.reason === "string" ? { reason: body.reason } : {}) };
}
export const SETTLEMENT_COPY = {
  notAvailable: "Le règlement par carte n’est pas encore disponible.",
  amountPending: "Montant en cours de vérification.",
  processing: "Prélèvement en cours de vérification.",
  transferPending: (m: string) => `Montant prélevé (${m}). Finalisation du versement à l’artisan en cours.`,
  paid: (m: string) => `Réglé (${m}).`,
  needsReview: "Votre règlement est en cours de vérification par notre équipe.",
  pay: (m: string) => `Régler ${m}`,
  explain: (m: string) => `Régler ${m} : ce montant sera prélevé sur votre empreinte bancaire.`,
  confirm: (m: string) => `Je confirme le prélèvement de ${m}`,
  loadFailed: "Le statut du règlement n’a pas pu être vérifié. Réessayez.",
  captureFailed: "Statut non confirmé. Vérifiez à nouveau ou reprenez la même demande.",
  timeout: "Délai dépassé. Le prélèvement n’est pas confirmé ; réessayez.",
  conflict: "La situation du règlement a changé. Actualisez pour voir son état.",
  unavailable: "Ce règlement n’est pas disponible pour ce dossier.",
  session: "Votre session a expiré. Reconnectez-vous pour régler.",
  resume: "Reprendre la finalisation",
  resumeNote: "Cela poursuit la même opération, sans nouveau prélèvement.",
} as const;
/** « resume »: the GET never settles on its own; the same POST continues the same operation
 *  (the server skips an already captured payment and resumes the transfer with the same key). */
export type SettlementPresentation = { text: string; action: "pay" | "refresh" | "resume" | null };
export function present(dto: SettlementDTO): SettlementPresentation {
  const m = dto.amount_cents === null ? null : money(dto.amount_cents);
  if (!dto.available && dto.status === "not_started") return { text: SETTLEMENT_COPY.notAvailable, action: null };
  switch (dto.status) {
    case "not_started":
      return m ? { text: SETTLEMENT_COPY.pay(m), action: "pay" } : { text: SETTLEMENT_COPY.amountPending, action: null };
    case "processing":
      return { text: SETTLEMENT_COPY.processing, action: dto.available ? "resume" : "refresh" };
    case "captured_transfer_pending":
      return { text: m ? SETTLEMENT_COPY.transferPending(m) : SETTLEMENT_COPY.amountPending, action: dto.available ? "resume" : m ? null : "refresh" };
    case "paid":
      return { text: m ? SETTLEMENT_COPY.paid(m) : SETTLEMENT_COPY.amountPending, action: m ? null : "refresh" };
    case "needs_review":
      return { text: SETTLEMENT_COPY.needsReview, action: null };
  }
}

// ---- State machine + controller -----------------------------------------------------------------
export type SettlementState = {
  phase: "loading" | "ready" | "error" | "unavailable";
  dto: SettlementDTO | null;
  confirming: boolean;
  busy: boolean;
  /** Message of the last failed action, with the action that recovers. */
  error: string;
  retry: "load" | "capture" | "refresh" | null;
};
export const SETTLEMENT_INITIAL: SettlementState = { phase: "loading", dto: null, confirming: false, busy: false, error: "", retry: null };

export function applyStatus(s: SettlementState, r: SettlementResult): SettlementState {
  const base = { ...s, busy: false, confirming: false, error: "", retry: null };
  if (r.status === 200) {
    const dto = parseSettlement(r.body);
    return dto ? { ...base, phase: "ready", dto } : { ...base, phase: s.dto ? s.phase : "error", error: SETTLEMENT_COPY.loadFailed, retry: "load" };
  }
  if (r.status === 404) return { ...base, phase: "unavailable", dto: null, error: SETTLEMENT_COPY.unavailable };
  if (r.status === 401 || r.status === 403) return { ...base, phase: s.dto ? s.phase : "error", error: SETTLEMENT_COPY.session, retry: "load" };
  return { ...base, phase: s.dto ? s.phase : "error", error: r.status === SETTLEMENT_TIMEOUT ? SETTLEMENT_COPY.timeout : SETTLEMENT_COPY.loadFailed, retry: "load" };
}
export function applyCapture(s: SettlementState, r: SettlementResult): SettlementState {
  const base = { ...s, busy: false, error: "", retry: null };
  if (r.status === 200) {
    const dto = parseSettlement(r.body);
    return dto ? { ...base, phase: "ready", dto, confirming: false } : { ...base, error: SETTLEMENT_COPY.conflict, retry: "refresh", confirming: false };
  }
  if (r.status === 409 || r.status === 422) return { ...base, confirming: false, error: SETTLEMENT_COPY.conflict, retry: "refresh" };
  if (r.status === 404) return { ...base, phase: "unavailable", dto: null, confirming: false, error: SETTLEMENT_COPY.unavailable };
  if (r.status === 401 || r.status === 403) return { ...base, confirming: false, error: SETTLEMENT_COPY.session, retry: "refresh" };
  // 503 / timeout / network: same intervention, same request on retry (confirmation already given).
  return { ...base, error: r.status === SETTLEMENT_TIMEOUT ? SETTLEMENT_COPY.timeout : SETTLEMENT_COPY.captureFailed, retry: "capture" };
}

/** Requests outside React: one at a time (ref), each bound to the generation + uid current at its
 *  start; replies of an older generation/uid, or after unmount, are ignored. */
export function createSettlementController({ api, interventionId, context = DEFAULT_CONTEXT, get, set, onSettled }: { api: () => SettlementApi; interventionId: string; context?: SettlementContext; get: () => SettlementState; set: (s: SettlementState) => void; onSettled?: () => void }) {
  let inFlight = false;
  let attached = true;
  let settled = false;
  const run = async (call: () => Promise<SettlementResult>, apply: (s: SettlementState, r: SettlementResult) => SettlementState) => {
    if (inFlight) return false;
    inFlight = true;
    const gen = context.generation();
    const uid = context.userId();
    set({ ...get(), busy: true, error: "" });
    let r: SettlementResult;
    try {
      r = await call();
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      inFlight = false;
    }
    if (!attached || context.generation() !== gen || context.userId() !== uid) return false;
    const before = get().dto?.status;
    const next = apply(get(), r);
    set(next);
    // Once, on a verified « paid » under the current identity (first load, POST or refresh):
    // the parent re-reads the dossier (it may be stale). Never repeated while already paid.
    if (next.dto?.status === "paid" && before !== "paid" && !settled) {
      settled = true;
      onSettled?.();
    }
    return true;
  };
  return {
    get busy() {
      return inFlight;
    },
    load: () => run(() => api().status(interventionId), applyStatus),
    /** POST: a first capture only after the explicit confirmation step; a resume (processing /
     *  captured_transfer_pending, available) continues the same operation without a new amount. */
    capture() {
      const s = get();
      const d = s.dto;
      const payable = d?.status === "not_started" && d.available && d.amount_cents !== null;
      const resumable = (d?.status === "processing" || d?.status === "captured_transfer_pending") && d.available;
      if (!(payable && (s.confirming || s.retry === "capture")) && !resumable) return Promise.resolve(false);
      return run(() => api().capture(interventionId), applyCapture);
    },
    confirm(open: boolean) {
      set({ ...get(), confirming: open, error: "", retry: null });
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
    },
  };
}

// ---- View ---------------------------------------------------------------------------------------
export function BookingSettlement({ interventionId, api, context = DEFAULT_CONTEXT, onSettled, initial }: { interventionId: string; api?: SettlementApi; context?: SettlementContext; /** Called once when the server reports « paid » after a POST or a refresh. */ onSettled?: () => void; /** Tests only. */ initial?: SettlementState }) {
  const [state, setStateRaw] = useState<SettlementState>(initial ?? SETTLEMENT_INITIAL);
  const ref = useRef(state);
  const set = (next: SettlementState) => {
    ref.current = next;
    setStateRaw(next);
  };
  const latest = useRef({ api, context, onSettled });
  latest.current = { api, context, onSettled };
  const controller = useRef<ReturnType<typeof createSettlementController> | null>(null);
  if (!controller.current) {
    let client: SettlementApi | null = null;
    controller.current = createSettlementController({
      api: () => (client ??= latest.current.api ?? createSettlementApi()),
      interventionId,
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
      onSettled: () => latest.current.onSettled?.(),
    });
  }
  const ctrl = controller.current;
  useEffect(() => {
    ctrl.attach();
    if (!initial) void ctrl.load();
    return () => ctrl.detach();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctrl]);

  const dto = state.dto;
  const view = dto ? present(dto) : null;
  const amount = dto?.amount_cents != null ? money(dto.amount_cents) : "";
  return (
    <section className={styles.card} aria-labelledby={`settlement-${interventionId}`} aria-busy={state.busy || undefined} data-settlement={state.phase} data-settlement-status={dto?.status}>
      <h3 id={`settlement-${interventionId}`} className={styles.title}>Règlement par carte</h3>
      {state.phase === "loading" && <p className={styles.text} role="status">Vérification du règlement…</p>}
      {state.phase === "unavailable" && <p className={styles.text}>{SETTLEMENT_COPY.unavailable}</p>}
      {view && state.phase === "ready" && view.action !== "pay" && <p className={styles.text} role="status">{view.text}</p>}
      {view?.action === "resume" && state.phase === "ready" && (
        <div className={styles.row}>
          <p className={styles.note}>{SETTLEMENT_COPY.resumeNote}</p>
          <button type="button" className={styles.primary} disabled={state.busy} onClick={() => void ctrl.capture()} data-settlement-resume="">
            {state.busy ? "Finalisation…" : state.retry === "capture" ? "Réessayer" : SETTLEMENT_COPY.resume}
          </button>
        </div>
      )}
      {view && state.phase === "ready" && view.action === "pay" && !state.confirming && state.retry !== "capture" && (
        <button type="button" className={styles.primary} disabled={state.busy} onClick={() => ctrl.confirm(true)} data-settlement-pay="">
          {view.text}
        </button>
      )}
      {view?.action === "pay" && (state.confirming || state.retry === "capture") && (
        <div className={styles.confirm} data-settlement-confirm="">
          <p className={styles.text}>{SETTLEMENT_COPY.explain(amount)}</p>
          <div className={styles.row}>
            <button type="button" className={styles.primary} disabled={state.busy} onClick={() => void ctrl.capture()} data-settlement-capture="">
              {state.busy ? "Prélèvement…" : state.retry === "capture" ? "Réessayer" : SETTLEMENT_COPY.confirm(amount)}
            </button>
            {!state.busy && state.retry !== "capture" && (
              <button type="button" className={styles.secondary} onClick={() => ctrl.confirm(false)}>
                Annuler
              </button>
            )}
          </div>
        </div>
      )}
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      {(state.retry === "load" || state.retry === "refresh" || state.retry === "capture" || view?.action === "resume" || (view?.action === "refresh" && !state.error)) && (
        <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.load()} data-settlement-refresh="">
          {state.retry === "load" ? "Réessayer" : "Actualiser"}
        </button>
      )}
    </section>
  );
}
