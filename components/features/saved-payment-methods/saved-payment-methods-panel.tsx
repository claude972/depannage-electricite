"use client";
// FIN-08: saved payment methods of the signed-in client (« Mon profil »). Lists brand, •••• last4 and
// expiry (expired flagged locally), adds a card through Stripe only after explicit consent AND an
// explicit click on the validated URL, removes a card behind an inline confirmation. No payment and
// no card choice here. A return from Stripe only re-reads the list. Logic and fence in ./model.
import { useEffect, useId, useRef, useState } from "react";
import { COPY, PM_INITIAL, brandLabel, createPmApi, createPmController, isExpired, returnMarker, tabStore, type Context, type PmApi, type PmState, type SavedMethod, type Store } from "./model";
import styles from "./saved-payment-methods.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const expiry = (m: SavedMethod) => `${String(m.exp_month).padStart(2, "0")}/${m.exp_year}`;
const label = (m: SavedMethod) => `${brandLabel(m.brand)} •••• ${m.last4}`;

export type SavedPaymentMethodsProps = {
  context: Context;
  demo?: boolean;
  api?: PmApi;
  store?: () => Store | null;
  newId?: () => string | null;
  /** Opens the validated Stripe URL; called only from the user's click. */
  navigate?: (url: string) => void;
  /** Page query string (tests); defaults to window.location.search. */
  search?: string;
  now?: () => Date;
  /** Tests only. */
  initial?: PmState;
};

export function SavedPaymentMethodsPanel(props: SavedPaymentMethodsProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby="saved-methods-demo" data-saved-methods="demo">
        <h2 id="saved-methods-demo" className={styles.title}>{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Live({ context, api, store = tabStore, newId = uuid, navigate, search, now = () => new Date(), initial }: SavedPaymentMethodsProps) {
  const uid = useId();
  const [state, setRaw] = useState<PmState>(initial ?? PM_INITIAL);
  const ref = useRef(state);
  const set = (s: PmState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ api, store, newId, navigate });
  latest.current = { api, store, newId, navigate };
  const ctrl = useRef<ReturnType<typeof createPmController> | null>(null);
  useEffect(() => {
    let client: PmApi | null = null;
    const c = createPmController({ api: () => (client ??= latest.current.api ?? createPmApi()), store: () => latest.current.store(), newId: () => latest.current.newId(), context, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      // A Stripe return is only a reason to re-read: it proves nothing.
      const marker = returnMarker(search ?? (typeof window !== "undefined" ? window.location.search : ""));
      void c.load(marker === "returned" ? COPY.returned : marker === "cancelled" ? COPY.cancelled : undefined);
    }
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [consent, setConsent] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const c = ctrl.current;
  const locked = state.busy || !!state.pending;
  const open = () => {
    const url = ctrl.current?.takeSetupUrl();
    if (!url) return;
    if (latest.current.navigate) latest.current.navigate(url);
    else window.location.assign(url);
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-t`} aria-busy={state.busy || undefined} data-saved-methods={state.phase}>
      <h2 id={`${uid}-t`} className={styles.title}>{COPY.title}</h2>
      <p className={styles.muted}>{COPY.note}</p>
      {state.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.note} data-saved-methods-forbidden="">{COPY.forbidden}</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div role="alert">
          <p className={styles.error}>{state.error || COPY.loadFailed}</p>
          <button type="button" className={styles.button} onClick={() => void c?.load()} data-saved-methods-reload="">Réessayer</button>
        </div>
      )}
      {state.notice && <p className={styles.note} role="status" data-saved-methods-notice="">{state.notice}</p>}
      {state.phase === "ready" && state.error && (
        <div role="alert" data-saved-methods-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void ctrl.current?.retry()} data-saved-methods-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même demande"}
            </button>
          )}
        </div>
      )}
      {state.phase === "ready" && (
        <>
          {state.methods.length === 0 && <p className={styles.muted} data-saved-methods-empty="">{COPY.empty}</p>}
          <ul className={styles.list}>
            {state.methods.map((m) => (
              <li key={m.id} className={styles.item} data-saved-method={m.id}>
                <span>
                  <strong>{label(m)}</strong> · expire {expiry(m)}
                  {isExpired(m, now()) && <span className={styles.expired} data-saved-method-expired=""> · {COPY.expired}</span>}
                </span>
                <button type="button" className={styles.button} disabled={locked || removing === m.id} onClick={() => setRemoving(m.id)} data-saved-method-remove={m.id}>Supprimer…</button>
                {removing === m.id && (
                  <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-rm-${m.id}`} data-saved-method-confirm={m.id}>
                    <p id={`${uid}-rm-${m.id}`}>{COPY.removeConfirm(label(m))}</p>
                    <span className={styles.row}>
                      <button type="button" className={`${styles.button} ${styles.danger}`} disabled={locked} onClick={() => void ctrl.current?.remove(m.id).then(() => setRemoving(null))} data-saved-method-execute={m.id}>Confirmer la suppression</button>
                      <button type="button" className={styles.button} disabled={state.busy} onClick={() => setRemoving(null)}>Annuler</button>
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {state.hasMore && (
            <button type="button" className={styles.button} disabled={state.loadingMore} onClick={() => void ctrl.current?.more()} data-saved-methods-more="">
              {state.loadingMore ? "Chargement…" : COPY.more}
            </button>
          )}
          <div className={styles.add} data-saved-methods-add="">
            <label className={styles.check}>
              <input type="checkbox" checked={consent} disabled={locked} onChange={(e) => setConsent(e.target.checked)} data-saved-methods-consent="" />
              <span>{COPY.consent}</span>
            </label>
            {state.setupUrl ? (
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={open} data-saved-methods-open="">{COPY.open}</button>
            ) : (
              <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !consent} onClick={() => void ctrl.current?.setup(consent)} data-saved-methods-setup="">
                {state.busy ? "Préparation…" : COPY.add}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
