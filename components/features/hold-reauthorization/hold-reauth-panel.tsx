"use client";
// CLI-07 / FIN-01: replacement of an expired or insufficient card hold. The CTA exists only when the
// server says available AND the client consents explicitly; a return from the bank page proves
// nothing — only the server state read afterwards does. No debit is ever announced here.
import { useEffect, useId, useRef, useState } from "react";
import { money } from "../../app/format";
import {
  DEFAULT_HR_CONTEXT,
  HR_COPY,
  HR_INITIAL,
  REASON_COPY,
  STATUS_COPY,
  actionsFor,
  createHrApi,
  createHrController,
  providerReturn,
  tabStore,
  type HrApi,
  type HrContext,
  type HrState,
  type HrStore,
} from "./hold-reauth-model";
import styles from "./hold-reauth.module.css";

export type HoldReauthorizationPanelProps = {
  interventionId: string;
  api?: HrApi;
  context?: HrContext;
  demo?: boolean;
  /** Tests / injection only. */
  store?: HrStore;
  newId?: () => string | null;
  navigate?: (url: string) => void;
  search?: string;
  initial?: HrState;
};

/** Keyed by identity + generation + mode + dossier: any change starts from a fresh read. */
export function HoldReauthorizationPanel(props: HoldReauthorizationPanelProps) {
  const ctx = props.context ?? DEFAULT_HR_CONTEXT;
  return <Inner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.interventionId}`} {...props} />;
}

function Inner({ interventionId, api, context = DEFAULT_HR_CONTEXT, demo = false, store, newId, navigate, search, initial }: HoldReauthorizationPanelProps) {
  const uid = useId();
  const [state, setRaw] = useState<HrState>(initial ?? (demo ? { ...HR_INITIAL, phase: "demo" } : HR_INITIAL));
  const ref = useRef(state);
  const set = (next: HrState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store, navigate });
  latest.current = { api, store, navigate };
  const controller = useRef<ReturnType<typeof createHrController> | null>(null);
  // One controller per effect run (StrictMode-safe). Mount = GET only, never a POST.
  useEffect(() => {
    let client: HrApi | null = null;
    let tab: HrStore | null = null;
    const c = createHrController({
      api: () => (client ??= latest.current.api ?? createHrApi()),
      store: () => (tab ??= latest.current.store ?? tabStore()),
      interventionId,
      context,
      newId,
      demo,
      navigate: (url) => (latest.current.navigate ? latest.current.navigate(url) : window.location.assign(url)),
      get: () => ref.current,
      set,
    });
    controller.current = c;
    if (!initial) void c.load();
    return () => {
      c.detach();
      if (controller.current === c) controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [returned] = useState(() => providerReturn(search ?? (typeof window !== "undefined" ? window.location.search : "")));

  if (state.phase === "demo")
    return (
      <section className={styles.panel} data-hr="demo">
        <h4 className={styles.title}>{HR_COPY.title}</h4>
        <p className={styles.note} role="note">{HR_COPY.demo}</p>
      </section>
    );
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-hr="loading">{HR_COPY.loading}</p>;
  if (state.phase === "unavailable") return <p className={styles.muted} role="status" data-hr="unavailable">{state.error}</p>;
  if (state.phase === "error" || !state.read)
    return (
      <div data-hr="error">
        <p className={styles.error} role="alert">{state.error || HR_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void controller.current?.load()} data-hr-reload="">Réessayer</button>
      </div>
    );

  const read = state.read;
  const can = actionsFor(read, demo);
  const busy = state.busy || state.redirecting;
  const consented = state.consentedSnapshot === read.snapshot_id;
  const fromBank = returned && returned.attempt_id === read.attempt_id?.toLowerCase();
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} aria-busy={busy || undefined} data-hr="ready" data-hr-status={read.status}>
      <h4 id={`${uid}-title`} className={styles.title}>{HR_COPY.title}</h4>
      {fromBank && <p className={styles.note} role="note" data-hr-return={returned.outcome}>{HR_COPY.providerReturn}</p>}
      <p className={styles.text} role="status" data-hr-state="">{STATUS_COPY[read.status]}</p>
      <dl className={styles.kv}>
        <dt>Empreinte actuelle</dt>
        <dd>{money(read.original_authorized_cents)}</dd>
        <dt>Total du devis accepté</dt>
        <dd>{money(read.accepted_total_cents)}</dd>
      </dl>
      {!read.available && read.reason && <p className={styles.muted} data-hr-reason={read.reason}>{REASON_COPY[read.reason]}</p>}
      {state.stale && <p className={styles.warning} role="alert" data-hr-stale="">{HR_COPY.stale}</p>}
      {state.conflict && <p className={styles.error} role="alert" data-hr-conflict="">{state.conflict}</p>}
      {state.writeError && (
        <div role="alert" data-hr-write-error="">
          <p className={styles.error}>{state.writeError}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={busy} onClick={() => void controller.current?.retry()} data-hr-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même demande"}
            </button>
          )}
        </div>
      )}
      {state.redirecting && <p className={styles.muted} role="status">{HR_COPY.redirect}</p>}
      {can.begin && !state.pending && (
        <div className={styles.consent}>
          <label className={styles.check}>
            <input type="checkbox" checked={consented} disabled={busy} onChange={(e) => controller.current?.consent(e.target.checked ? read.snapshot_id : null)} data-hr-consent="" />
            <span>{HR_COPY.consent(money(read.accepted_total_cents))}</span>
          </label>
          {consented && (
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void controller.current?.begin()} data-hr-begin="">
              {state.busy ? "Vérification…" : HR_COPY.begin}
            </button>
          )}
        </div>
      )}
      {(can.resume || can.abort) && !state.pending && (
        <div className={styles.actions}>
          {can.resume && (
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={busy} onClick={() => void controller.current?.resume()} data-hr-resume="">
              {HR_COPY.resume}
            </button>
          )}
          {can.abort && (
            <button type="button" className={styles.button} disabled={busy} onClick={() => void controller.current?.abort()} data-hr-abort="">
              {HR_COPY.abort}
            </button>
          )}
        </div>
      )}
      <button type="button" className={styles.button} disabled={busy} onClick={() => void controller.current?.load()} data-hr-refresh="">Actualiser</button>
    </section>
  );
}
