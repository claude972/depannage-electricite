"use client";
// Operator refund-execution panel for ONE approved refund request (platform finance, refunds tab).
// Reads the local execution state (never the bank), and emits only after an explicit confirmation,
// single-flight, with a persisted stable command id. 202 / submitted / pending is never a refund.
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_RX_CONTEXT,
  REASON_COPY,
  RX_COPY,
  RX_INITIAL,
  canExecute,
  createRxApi,
  createRxController,
  executionLabel,
  isStale,
  tabStore,
  type RefundRequestView,
  type RxApi,
  type RxContext,
  type RxState,
  type RxStore,
} from "./refund-execution-model";
import { PlatformMfaPanel } from "../platform-operations/platform-mfa-panel";
import styles from "./refund-execution.module.css";

export type RefundExecutionPanelProps = {
  /** The request row of the finance list: id, payment_id, approved amount, status, version. */
  request: RefundRequestView;
  /** GET /api/platform-operations/me → capabilities.refund_execution (strict, server-side). */
  capability: boolean;
  api?: RxApi;
  context?: RxContext;
  demo?: boolean;
  /** Tests / injection only. */
  store?: RxStore;
  newId?: () => string | null;
  initial?: RxState;
};

const money = (cents: number) => `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.trunc(cents) / 100)} €`.replace(/ | /g, " ");
const short = (id: string) => id.slice(0, 8);

/** Keyed by operator + generation + request + version: any change starts from a fresh read. */
export function RefundExecutionPanel(props: RefundExecutionPanelProps) {
  const ctx = props.context ?? DEFAULT_RX_CONTEXT;
  return <Inner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.request.id}|${props.request.version}`} {...props} />;
}

function Inner({ request, capability, api, context = DEFAULT_RX_CONTEXT, demo = false, store, newId, initial }: RefundExecutionPanelProps) {
  const [state, setRaw] = useState<RxState>(initial ?? (demo ? { ...RX_INITIAL, phase: "demo" } : RX_INITIAL));
  const ref = useRef(state);
  const set = (next: RxState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store, capability });
  latest.current = { api, store, capability };
  // One controller PER EFFECT RUN (StrictMode mounts twice): the discarded run's controller is
  // detached, so its GET never applies; the live run's GET does.
  const controller = useRef<ReturnType<typeof createRxController> | null>(null);
  useEffect(() => {
    let client: RxApi | null = null;
    let tab: RxStore | null = null;
    const c = createRxController({
      api: () => (client ??= latest.current.api ?? createRxApi()),
      store: () => (tab ??= latest.current.store ?? tabStore()),
      request,
      capability: () => latest.current.capability,
      context,
      newId,
      demo,
      get: () => ref.current,
      set,
    });
    controller.current = c;
    if (!initial) void c.load(); // GET only: never a POST on mount
    return () => {
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Capability revoked (same identity): close any confirmation; actions re-check it themselves.
  useEffect(() => {
    if (!capability && ref.current.confirming) set({ ...ref.current, confirming: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capability]);
  const c = {
    load: () => void controller.current?.load(),
    confirm: () => controller.current?.confirm(),
    cancel: () => controller.current?.cancel(),
    execute: () => void controller.current?.execute(),
    retry: () => void controller.current?.retry(),
  };

  if (state.phase === "demo") return <p className={styles.note} role="note" data-rx="demo">{RX_COPY.demo}</p>;
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-rx="loading">{RX_COPY.loading}</p>;
  if (state.phase === "unavailable") return <p className={styles.muted} role="status" data-rx="unavailable">{state.error}</p>;
  if (state.phase === "error" || !state.read)
    return (
      <div data-rx="error">
        <p className={styles.error} role="alert">{state.error || RX_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={c.load} data-rx-reload="">Réessayer la lecture</button>
      </div>
    );

  const read = state.read;
  const label = executionLabel(read);
  const stale = isStale(request, read);
  const actionable = canExecute(capability, demo, request, state);
  const resume = read.execution_status !== null;
  return (
    <section className={styles.panel} aria-label="Exécution du remboursement" data-rx="ready">
      <dl className={styles.kv}>
        <dt>Montant approuvé</dt>
        <dd data-rx-amount="">{money(request.amount_cents)}</dd>
        <dt>Exécution</dt>
        <dd data-rx-status={read.execution_status ?? "none"} data-rx-confirmed={label.confirmed ? "" : undefined}>{label.text}</dd>
      </dl>
      <p className={styles.muted}>{RX_COPY.localRead}</p>
      {stale && <p className={styles.warning} role="alert" data-rx-stale="">{RX_COPY.stale}</p>}
      {!capability && <p className={styles.muted} data-rx-capability="">{RX_COPY.noCapability}</p>}
      {capability && !stale && !read.available && <p className={styles.muted} data-rx-reason={read.reason}>{REASON_COPY[read.reason]}</p>}
      {state.notice && <p className={styles.note} role="status" data-rx-notice="">{state.notice}</p>}
      {state.conflict && (
        <div role="alert" data-rx-conflict="">
          <p className={styles.error}>{state.conflict}</p>
          <button type="button" className={styles.button} onClick={c.load} data-rx-reload="">Actualiser</button>
        </div>
      )}
      {state.mfaRequired && capability && (
        <PlatformMfaPanel userId={context.userId() ?? ""} onVerified={() => controller.current?.finishMfa()} />
      )}
      {state.writeError && !state.mfaRequired && (
        <div role="alert" data-rx-write-error="">
          <p className={styles.error}>{state.writeError}</p>
          {state.pending && capability ? (
            <button type="button" className={styles.button} disabled={state.writing} onClick={c.retry} data-rx-retry="">
              {state.writing ? "Envoi…" : "Réessayer (même commande)"}
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={c.load} data-rx-reload="">Actualiser</button>
          )}
        </div>
      )}
      {actionable && !state.confirming && !state.pending && (
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={state.writing} onClick={() => c.confirm()} data-rx-open="">
          {resume ? "Vérifier / reprendre" : "Émettre le remboursement…"}
        </button>
      )}
      {state.confirming && actionable && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`rx-${request.id}`} data-rx-confirm="">
          <strong id={`rx-${request.id}`}>{RX_COPY.confirmTitle}</strong>
          <p>Montant approuvé : <strong>{money(request.amount_cents)}</strong></p>
          <p>{RX_COPY.recipient(short(request.payment_id))}</p>
          <p>{resume ? RX_COPY.resumeNote : RX_COPY.irreversible}</p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={state.writing} onClick={c.execute} data-rx-execute="">
              {state.writing ? "Envoi…" : resume ? "Confirmer la vérification / reprise" : "Confirmer l’émission"}
            </button>
            <button type="button" className={styles.button} disabled={state.writing} onClick={() => c.cancel()}>Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}
