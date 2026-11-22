"use client";
// ART-03 / ADM-02: decisions on ONE credential (justificatif). Admin: decision form only when the
// server says can_review. Artisan: read-only (current decision, reason, history). A decision never
// approves the whole application; a reviewed document is never edited (a new document is needed).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  CR_COPY,
  CR_INITIAL,
  DECISIONS,
  DECISION_LABEL,
  DEFAULT_CR_CONTEXT,
  KIND_LABEL,
  REASON_MAX,
  canDecide,
  createCrApi,
  createCrController,
  tabStore,
  type CrApi,
  type CrContext,
  type CrState,
  type CrStore,
  type Decision,
} from "./credential-reviews-model";
import styles from "./credential-reviews.module.css";

export type CredentialReviewPanelProps = {
  credentialId: string;
  mode: "admin" | "artisan";
  api?: CrApi;
  context?: CrContext;
  demo?: boolean;
  /** O1 : signale la décision courante lue (null = aucune décision ou lecture non aboutie). */
  onCurrentDecision?: (credentialId: string, decision: Decision | null) => void;
  /** Tests / injection only. */
  store?: CrStore;
  newId?: () => string | null;
  initial?: CrState;
};

const day = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const when = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

/** Keyed by identity + generation + mode + credential: any change starts from a fresh read. */
export function CredentialReviewPanel(props: CredentialReviewPanelProps) {
  const ctx = props.context ?? DEFAULT_CR_CONTEXT;
  return <Inner key={`${ctx.userId() ?? "-"}|${ctx.generation()}|${props.demo ? "demo" : "live"}|${props.mode}|${props.credentialId}`} {...props} />;
}

function Inner({ credentialId, mode, api, context = DEFAULT_CR_CONTEXT, demo = false, store, newId, initial, onCurrentDecision }: CredentialReviewPanelProps) {
  const uid = useId();
  const [state, setRaw] = useState<CrState>(initial ?? (demo ? { ...CR_INITIAL, phase: "demo" } : CR_INITIAL));
  const ref = useRef(state);
  const set = (next: CrState) => {
    ref.current = next;
    setRaw(next);
  };
  const latest = useRef({ api, store });
  latest.current = { api, store };
  const controller = useRef<ReturnType<typeof createCrController> | null>(null);
  // One controller per effect run (StrictMode-safe): the discarded run's GET never applies.
  useEffect(() => {
    let client: CrApi | null = null;
    let tab: CrStore | null = null;
    const c = createCrController({
      api: () => (client ??= latest.current.api ?? createCrApi()),
      store: () => (tab ??= latest.current.store ?? tabStore()),
      credentialId,
      mode,
      context,
      newId,
      demo,
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
  const [decision, setDecision] = useState<Decision | "">("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<{ decision?: string; reason?: string }>({});
  // O1 : la carte hôte affiche la décision courante à la place de « Transmis ». Rien n'est déduit
  // sans lecture aboutie : tant que la page n'est pas lue, la décision signalée est null.
  const currentDecision: Decision | null = state.page && state.page.current_version > 0
    ? state.reviews.find((r) => r.version === state.page!.current_version)?.decision ?? null
    : null;
  const report = useRef(onCurrentDecision);
  report.current = onCurrentDecision;
  useEffect(() => {
    report.current?.(credentialId, currentDecision);
  }, [credentialId, currentDecision]);

  if (state.phase === "demo") return <p className={styles.note} role="note" data-cr="demo">{CR_COPY.demo}</p>;
  if (state.phase === "loading") return <p className={styles.muted} role="status" data-cr="loading">{CR_COPY.loading}</p>;
  if (state.phase === "unavailable") return <p className={styles.muted} role="status" data-cr="unavailable">{state.error}</p>;
  if (state.phase === "error" || !state.page)
    return (
      <div data-cr="error">
        <p className={styles.error} role="alert">{state.error || CR_COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void controller.current?.load()} data-cr-reload="">Réessayer</button>
      </div>
    );

  const page = state.page;
  const current = page.current_version > 0 ? state.reviews.find((r) => r.version === page.current_version) : undefined;
  const decide = canDecide(mode, demo, state);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await controller.current?.decide(decision, reason);
    if (out && typeof out === "object" && out.errors) return setErrors(out.errors);
    setErrors({});
    if (out === true) {
      setDecision("");
      setReason("");
    }
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-title`} data-cr="ready" data-cr-mode={mode}>
      <div className={styles.head}>
        <h4 id={`${uid}-title`} className={styles.title}>Décisions sur cette pièce</h4>
        <span className={styles.meta}>
          {KIND_LABEL[page.kind]} · {page.expires_on ? `validité jusqu’au ${day(page.expires_on)}` : "sans date de validité"}
        </span>
      </div>
      <p className={styles.current} data-cr-current={current?.decision ?? "none"}>
        {current ? (
          <>
            <strong>{DECISION_LABEL[current.decision]}</strong> le {when(current.reviewed_at)} — {current.reason}
          </>
        ) : (
          CR_COPY.empty
        )}
      </p>
      <p className={styles.muted}>{CR_COPY.scope}</p>
      <p className={styles.muted}>{CR_COPY.newDocument}</p>
      {state.stale && (
        <p className={styles.warning} role="alert" data-cr-stale="">{CR_COPY.stale}</p>
      )}
      {state.notice && <p className={styles.note} role="status" data-cr-notice="">{state.notice}</p>}
      {state.conflict && (
        <div role="alert" data-cr-conflict="">
          <p className={styles.error}>{state.conflict}</p>
        </div>
      )}
      {state.writeError && (
        <div role="alert" data-cr-write-error="">
          <p className={styles.error}>{state.writeError}</p>
          {state.pending && mode === "admin" && (
            <button type="button" className={styles.button} disabled={state.writing} onClick={() => void controller.current?.retry()} data-cr-retry="">
              {state.writing ? "Envoi…" : "Réessayer (même décision)"}
            </button>
          )}
        </div>
      )}
      {(state.conflict || state.stale) && (
        <button type="button" className={styles.button} onClick={() => void controller.current?.refresh()} data-cr-refresh="">Actualiser</button>
      )}
      {decide && (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-cr-form="">
          <fieldset className={styles.fieldset}>
            <legend>Nouvelle décision (version {page.current_version + 1})</legend>
            {DECISIONS.map((d) => (
              <label key={d} className={styles.choice}>
                <input type="radio" name={`${uid}-decision`} value={d} checked={decision === d} onChange={() => setDecision(d)} />
                {DECISION_LABEL[d]}
              </label>
            ))}
            {errors.decision && <small className={styles.fieldError}>{errors.decision}</small>}
          </fieldset>
          <label className={styles.label} htmlFor={`${uid}-reason`}>
            {decision === "accepted" ? "Commentaire" : "Motif"} (obligatoire, {REASON_MAX} caractères maximum)
          </label>
          <textarea id={`${uid}-reason`} className={styles.textarea} rows={3} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={errors.reason ? true : undefined} aria-describedby={`${uid}-reason-hint`} />
          <small id={`${uid}-reason-hint`} className={errors.reason ? styles.fieldError : styles.muted}>{errors.reason ?? CR_COPY.reasonVisible}</small>
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={state.writing} data-cr-submit="">
            {state.writing ? "Envoi…" : "Enregistrer la décision"}
          </button>
        </form>
      )}
      {state.reviews.length > 0 && (
        <div className={styles.history}>
          <h5 className={styles.subtitle}>Historique</h5>
          <ol className={styles.list}>
            {state.reviews.map((r) => (
              <li key={r.version} className={styles.item} data-cr-version={r.version}>
                <strong>v{r.version} · {DECISION_LABEL[r.decision]}</strong>
                <span className={styles.meta}>{when(r.reviewed_at)}</span>
                <p className={styles.reason}>{r.reason}</p>
              </li>
            ))}
          </ol>
          {state.reviews.length < page.current_version && <p className={styles.muted} data-cr-partial="">{CR_COPY.partial(state.reviews.length, page.current_version)}</p>}
          {state.nextBefore !== null && !state.stale && (
            <button type="button" className={styles.button} disabled={state.loadingMore} onClick={() => void controller.current?.more()} data-cr-more="">
              {state.loadingMore ? "Chargement…" : "Afficher les décisions précédentes"}
            </button>
          )}
          {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        </div>
      )}
    </section>
  );
}
