"use client";
// ENT-16: delegated B2B payer of ONE dossier. DelegatedPayerManager = owner grant / revoke (shown only
// when the server says can_manage). DelegatedPayerCheckout = the EXISTING platform Checkout CTA
// (rendered by the caller, unchanged) for a delegated member, only while the server says the mandate
// is current and checkout is allowed; otherwise an honest state. No amount, no other right.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { COPY, VIEW_INITIAL, createPayerApi, createPayerController, delegatedCheckout, tabStore, type Context, type PayerApi, type Store, type View } from "./model";
import styles from "./delegated-payer.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
export type PayerMember = { id: string; label: string };
type Common = { interventionId: string; context: Context; demo?: boolean; api?: PayerApi; store?: () => Store | null; newId?: () => string | null; /** Tests only. */ initial?: View };

function usePayer({ interventionId, context, api, store = tabStore, newId = uuid, initial }: Common, restore: boolean) {
  const [view, setRaw] = useState<View>(initial ?? VIEW_INITIAL);
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ api, store, newId });
  latest.current = { api, store, newId };
  const ctrl = useRef<ReturnType<typeof createPayerController> | null>(null);
  useEffect(() => {
    let client: PayerApi | null = null;
    const c = createPayerController({
      api: () => (client ??= latest.current.api ?? createPayerApi()),
      interventionId,
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context,
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    if (!initial) {
      if (restore) c.restorePending();
      void c.load();
    }
    return () => {
      c.detach();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { view, ctrl };
}

export function DelegatedPayerManager(props: Common & { loadMembers?: () => Promise<PayerMember[] | null> }) {
  if (props.demo)
    return (
      <div className={styles.block} data-payer-manager="demo">
        <p className={styles.muted}>{COPY.demo}</p>
      </div>
    );
  return <Manager key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}

function Manager(props: Common & { loadMembers?: () => Promise<PayerMember[] | null> }) {
  const uid = useId();
  const { view, ctrl } = usePayer(props, true);
  const [members, setMembers] = useState<PayerMember[] | null>(null);
  const [choice, setChoice] = useState("");
  const [confirm, setConfirm] = useState<"grant" | "revoke" | null>(null);
  const loadMembers = useRef(props.loadMembers);
  useEffect(() => {
    let active = true;
    void loadMembers.current?.().then((m) => active && setMembers(m), () => active && setMembers(null));
    return () => {
      active = false;
    };
  }, []);
  const s = view.status;
  // Management exists only for the owner the server recognises; nothing is shown otherwise.
  if (view.phase === "forbidden" || (view.phase === "ready" && !s?.can_manage)) return null;
  if (view.phase === "loading") return <p className={styles.muted} role="status" data-payer-manager="loading">{COPY.loading}</p>;
  if (view.phase === "error" || !s)
    return (
      <div role="alert" data-payer-manager="error">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
      </div>
    );
  const nameOf = (id: string) => members?.find((m) => m.id.toLowerCase() === id.toLowerCase())?.label ?? `Membre ${id.slice(0, 8)}`;
  const choices = (members ?? []).filter((m) => m.id.toLowerCase() !== s.payer_id?.toLowerCase());
  const locked = view.busy || !!view.pending;
  return (
    <section className={styles.block} aria-labelledby={`${uid}-t`} data-payer-manager="ready">
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.title}</h3>
      <p className={styles.text} data-payer-current={s.payer_id ?? "none"}>
        {s.payer_id ? `${COPY.current} ${nameOf(s.payer_id)}` : COPY.none}
      </p>
      <p className={styles.muted}>{COPY.scope}</p>
      {s.external_session_pending && <p className={styles.warning} role="note" data-payer-pending-session="">{COPY.pendingSession}</p>}
      {view.notice && <p className={styles.text} role="status" data-payer-notice="">{view.notice}</p>}
      {view.error && (
        <div role="alert" data-payer-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <button type="button" className={styles.button} disabled={view.busy} onClick={() => void ctrl.current?.retry()} data-payer-retry="">
              {view.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
      <div className={styles.row}>
        <label className={styles.muted} htmlFor={`${uid}-m`}>Désigner un membre ayant accès au site</label>
        <select id={`${uid}-m`} className={styles.input} value={choice} onChange={(e) => setChoice(e.target.value)} disabled={locked || choices.length === 0}>
          <option value="">{members === null ? "Membres non chargés" : "Choisir…"}</option>
          {choices.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !choice} onClick={() => setConfirm("grant")} data-payer-grant="">Désigner…</button>
        {s.payer_id && (
          <button type="button" className={styles.button} disabled={locked} onClick={() => setConfirm("revoke")} data-payer-revoke="">Retirer la délégation…</button>
        )}
      </div>
      {confirm && (
        <div className={styles.confirm} role="alertdialog" aria-labelledby={`${uid}-c`} data-payer-confirm={confirm}>
          <p id={`${uid}-c`}>{confirm === "grant" ? COPY.confirmGrant(nameOf(choice)) : COPY.confirmRevoke}</p>
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={locked}
              onClick={() => void (confirm === "grant" ? ctrl.current?.grant(choice) : ctrl.current?.revoke())?.then((ok) => {
                setConfirm(null);
                if (ok) setChoice("");
              })}
              data-payer-execute=""
            >
              Confirmer
            </button>
            <button type="button" className={styles.button} disabled={view.busy} onClick={() => setConfirm(null)}>Annuler</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The caller renders the EXISTING Checkout CTA; it appears only on the server's word. */
export function DelegatedPayerCheckout(props: Common & { renderCheckout: () => ReactNode }) {
  if (props.demo) return <p className={styles.muted} data-payer-checkout="demo">{COPY.notDelegated}</p>;
  return <Checkout key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.interventionId}`} {...props} />;
}
function Checkout(props: Common & { renderCheckout: () => ReactNode }) {
  const { view, ctrl } = usePayer(props, false);
  if (view.phase === "loading") return <p className={styles.muted} role="status" data-payer-checkout="loading">{COPY.loading}</p>;
  if (view.phase === "error")
    return (
      <div role="alert" data-payer-checkout="error">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()}>Réessayer</button>
      </div>
    );
  if (delegatedCheckout(view.status))
    return (
      <div className={styles.block} data-payer-checkout="delegated">
        <p className={styles.text}>{COPY.delegatedYes}</p>
        {props.renderCheckout()}
      </div>
    );
  if (view.status?.delegate_current) return <p className={styles.muted} data-payer-checkout="not-open">{COPY.checkoutNotYet}</p>;
  return <p className={styles.muted} data-payer-checkout="none">{COPY.notDelegated}</p>;
}
