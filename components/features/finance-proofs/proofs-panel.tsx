"use client";
// FIN-06 finance proofs: read-only display of the recorded Charge / Fee / Payout proofs with their
// exact scope, and an explicit, confirmed qualification (provider reads) for finance writers.
// Mounted as the « Preuves » tab of the platform finance screen (charge + fee by payment id) and in the
// provider observation detail (payout proof of a payout event). Logic and fence in ./model.
import { useEffect, useId, useRef, useState } from "react";
import { COPY, EVT, PROOF_INITIAL, createProofApi, createProofController, identityOf, tabStore, targetId, validTarget, viewKey, viewOf, type Context, type Data, type ProofApi, type ProofState, type Store, type Target } from "./model";
import styles from "./finance-proofs.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const eur = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ")} €`;
const signed = (cents: number) => (cents < 0 ? `−${eur(-cents)}` : eur(cents));
const at = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "America/Martinique", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const unix = (s: number) => at(new Date(s * 1000).toISOString());

type Deps = { api?: ProofApi; store?: () => Store | null; newId?: () => string | null };

function useProof(target: Target | null, context: Context, deps: Deps) {
  const [state, setState] = useState<ProofState>(PROOF_INITIAL);
  const identity = identityOf(context);
  const proofId = target && validTarget(target) ? targetId(target) : "";
  const key = viewKey(context, target);
  const ctrl = useRef<ReturnType<typeof createProofController> | null>(null);
  const latest = useRef({ deps, context, target });
  latest.current = { deps, context, target };
  useEffect(() => {
    if (!proofId) return;
    let client: ProofApi | null = null;
    const c = createProofController({ target: latest.current.target!, api: () => (client ??= latest.current.deps.api ?? createProofApi()), store: () => (latest.current.deps.store ?? tabStore)(), newId: () => (latest.current.deps.newId ?? uuid)(), context: latest.current.context, set: setState });
    ctrl.current = c;
    c.restorePending();
    void c.load();
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
      setState(PROOF_INITIAL);
    };
  }, [identity, proofId]);
  const after = target?.kind === "charge" ? target.after : null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    void ctrl.current?.page(after);
  }, [after]);
  // Bound AT RENDER: a state of another identity / target / cursor is never shown.
  return { state: viewOf(state, key), key, ctrl };
}

function Scope({ text }: { text: string }) {
  return <p className={styles.scope} data-proof-scope="">{text}</p>;
}

function ChargeView({ data, onPage }: { data: Extract<Data, { kind: "charge" }>; onPage: (after: string | null) => void }) {
  const p = data.page.proof;
  if (!p) return <p className={styles.note} data-proof-none="">{COPY.chargeNone}</p>;
  return (
    <>
      <Scope text={COPY.chargeScope} />
      <dl className={styles.kv}>
        <div><dt>Montant capturé (Charge)</dt><dd>{eur(p.source.amount_cents)} · commission figée {eur(p.source.fee_cents)}</dd></div>
        <div><dt>Mode</dt><dd>{p.live ? "Production" : "Test"}</dd></div>
        <div><dt>Charge / PaymentIntent</dt><dd className={styles.mono}>{p.charge_id} · {p.payment_intent_id}</dd></div>
        <div><dt>Session Checkout</dt><dd className={styles.mono}>{p.source.session_id}</dd></div>
        <div><dt>Compte destinataire</dt><dd className={styles.mono}>{p.source.destination_account}</dd></div>
        <div><dt>Payé (local) / Charge créée</dt><dd>{at(p.source.paid_at)} · {unix(p.charge_created)}</dd></div>
        <div><dt>Attestation serveur</dt><dd>{at(p.verified_at)}</dd></div>
      </dl>
      <h5 className={styles.sub}>Observations de litige liées</h5>
      <p className={styles.hint}>{COPY.disputesNote}</p>
      {data.page.dispute_observations.length === 0 ? (
        <p className={styles.hint} data-proof-disputes-empty="">Aucune observation de litige liée dans cette page.</p>
      ) : (
        <ul className={styles.list}>
          {data.page.dispute_observations.map((o) => (
            <li key={o.event_id} data-proof-dispute={o.event_id}>
              <span className={styles.mono}>{o.dispute_id}</span> · contesté {eur(o.disputed_amount_cents)} · statut observé {o.observed_status ?? "non indiqué"} · {at(o.observed_at)} (v{o.observation_version})
            </li>
          ))}
        </ul>
      )}
      {data.page.next_after && (
        <button type="button" className={styles.secondary} onClick={() => onPage(data.page.next_after)} data-proof-next="">Observations suivantes</button>
      )}
    </>
  );
}

function FeeView({ data }: { data: Extract<Data, { kind: "fee" }> }) {
  const q = data.reply.qualification;
  if (!q) return <p className={styles.note} data-proof-none="">{COPY.feeNone}</p>;
  return (
    <>
      <Scope text={COPY.feeScope} />
      <dl className={styles.kv}>
        <div><dt>Commission</dt><dd><span className={styles.mono}>{q.source.fee_id}</span> · {eur(q.source.amount_cents)}</dd></div>
        <div><dt>Remboursé (lu à la qualification)</dt><dd>{q.provider_amount_refunded_cents === null ? "inconnu" : eur(q.provider_amount_refunded_cents)}{q.provider_refunded ? " · intégralement" : ""}</dd></div>
        <div><dt>Charge plateforme / Charge connectée</dt><dd className={styles.mono}>{q.source.charge_id} · {q.source.connected_charge_id}</dd></div>
        <div><dt>Compte</dt><dd className={styles.mono}>{q.source.destination_account}</dd></div>
        <div><dt>Observation / lecture Stripe / qualification</dt><dd>{at(q.source.observation_created)} · {at(q.provider_observed_at)} · {at(q.qualified_at)}</dd></div>
      </dl>
    </>
  );
}

function PayoutView({ data }: { data: Extract<Data, { kind: "payout" }> }) {
  const q = data.reply.qualification;
  if (!q) return <p className={styles.note} data-proof-none="">{COPY.payoutNone}</p>;
  const p = q.proof;
  return (
    <>
      <Scope text={COPY.payoutScope} />
      <dl className={styles.kv}>
        <div><dt>Versement automatique</dt><dd><span className={styles.mono}>{p.payout_id}</span> · {eur(p.amount_cents)} · {p.live ? "Production" : "Test"}</dd></div>
        <div><dt>Statut Stripe relu</dt><dd>« paid » le {at(p.provider_observed_at)} — réception bancaire non confirmée</dd></div>
        <div><dt>Compte Connect source</dt><dd className={styles.mono}>{q.source.account_id}</dd></div>
        <div><dt>Débit propre</dt><dd><span className={styles.mono}>{p.debit.id}</span> · {signed(p.debit.net_cents)}</dd></div>
        <div><dt>Composants</dt><dd>{p.components.length} ligne{p.components.length > 1 ? "s" : ""} non attribuée{p.components.length > 1 ? "s" : ""} · net {signed(p.net_components_cents)} · {p.page_count} page{p.page_count > 1 ? "s" : ""} lue{p.page_count > 1 ? "s" : ""}</dd></div>
        <div><dt>Observation signée / qualification</dt><dd>{at(q.source.observation_created)} · {at(q.qualified_at)}</dd></div>
      </dl>
      <details className={styles.details}>
        <summary>Lignes du versement ({p.components.length})</summary>
        <ul className={styles.list}>
          {p.components.map((l) => (
            <li key={l.id} className={styles.mono}>{l.id} · {l.type} · montant {signed(l.amount_cents)} · frais {signed(l.fee_cents)} · net {signed(l.net_cents)} · non attribuée</li>
          ))}
        </ul>
      </details>
    </>
  );
}

export function ProofSection({ target, title, canWrite, context, ...deps }: { target: Target | null; title: string; canWrite: boolean; context: Context } & Deps) {
  const uid = useId();
  const [after, setAfter] = useState<string | null>(null);
  const effective: Target | null = target && target.kind === "charge" ? { ...target, after } : target;
  const { state, key, ctrl } = useProof(effective, context, deps);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    setAfter(null);
    setConfirming(false);
  }, [target ? targetId(target) : ""]);
  if (!target || !validTarget(target)) return null;
  const d = state.data;
  return (
    <section className={styles.proof} aria-labelledby={`${uid}-t`} aria-busy={state.busy || state.phase === "loading" || undefined} data-proof={target.kind} data-proof-phase={state.phase}>
      <h4 id={`${uid}-t`}>{title}</h4>
      <p className={styles.hint}>{COPY.readNote}</p>
      {state.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.note} role="alert" data-proof-forbidden="">{state.error}</p>}
      {state.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{state.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void ctrl.current?.load()} data-proof-reload="">Réessayer</button>
        </div>
      )}
      {state.phase === "ready" && d && (
        <>
          {d.kind === "charge" && <ChargeView data={d} onPage={setAfter} />}
          {d.kind === "fee" && <FeeView data={d} />}
          {d.kind === "payout" && <PayoutView data={d} />}
        </>
      )}
      {state.notice && <p className={styles.ok} role="status" data-proof-notice="">{state.notice}</p>}
      {state.phase === "ready" && state.error && (
        <div className={styles.note} role="alert" data-proof-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && canWrite && (
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.current?.retry(key)} data-proof-retry="">
              {state.busy ? "Envoi…" : COPY.retrySame}
            </button>
          )}
        </div>
      )}
      {canWrite && state.phase === "ready" && !state.pending && (
        <div className={styles.qualify} data-proof-qualify="">
          {!confirming ? (
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => setConfirming(true)} data-proof-qualify-open="">{COPY.qualify}</button>
          ) : (
            <div className={styles.confirm} role="group" aria-labelledby={`${uid}-c`}>
              <p id={`${uid}-c`}>{COPY.qualifyExplain}</p>
              <div className={styles.actions}>
                <button type="button" className={styles.primary} disabled={state.busy} onClick={() => { setConfirming(false); void ctrl.current?.qualify(canWrite, key); }} data-proof-qualify-confirm="">{COPY.confirm}</button>
                <button type="button" className={styles.secondary} onClick={() => setConfirming(false)}>{COPY.cancel}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {state.busy && <p className={styles.hint} role="status">Qualification en cours…</p>}
    </section>
  );
}

/** Payout proof of ONE provider observation (payout family), inside the observation detail. */
export function PayoutProofSection({ eventId, canWrite, context, ...deps }: { eventId: string; canWrite: boolean; context: Context } & Deps) {
  return <ProofSection target={{ kind: "payout", eventId }} title="Preuve de rapprochement du versement" canWrite={canWrite} context={context} {...deps} />;
}

/** « Preuves » tab: charge proof (+ linked dispute observations) and fee proof by payment id. */
export function FinanceProofsTab({ demo, canRead, canWrite, context, ...deps }: { demo: boolean; canRead: boolean; canWrite: boolean; context: Context } & Deps) {
  const [payment, setPayment] = useState("");
  const [event, setEvent] = useState("");
  const [shown, setShown] = useState<{ paymentId: string; eventId: string } | null>(null);
  const [errors, setErrors] = useState<{ payment?: string; event?: string }>({});
  if (!canRead && !demo) return null;
  return (
    <section className={styles.panel} aria-labelledby="finance-proofs-title" data-finance-proofs={demo ? "demo" : ""}>
      <h3 id="finance-proofs-title">Preuves de paiement</h3>
      <p className={styles.hint}>Preuves enregistrées de capture (Charge), de commission (Fee) et, depuis le détail d’une observation de versement, de rapprochement d’un versement. Une preuve n’est jamais un solde, un net restant ni une réception bancaire.</p>
      {demo ? (
        <p className={styles.note}>En démonstration, aucune preuve n’est lue ni qualifiée et aucun appel n’est fait.</p>
      ) : (
        <>
          <form
            className={styles.form}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const next: { payment?: string; event?: string } = {};
              if (!UUID.test(payment.trim())) next.payment = "Identifiant de paiement (UUID) invalide.";
              if (event.trim() && !EVT.test(event.trim())) next.event = "Identifiant d’événement attendu (evt_…).";
              setErrors(next);
              if (Object.keys(next).length) return;
              setShown({ paymentId: payment.trim().toLowerCase(), eventId: event.trim() });
            }}
          >
            <label className={styles.field}>
              Identifiant du paiement
              <input value={payment} onChange={(e) => setPayment(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!!errors.payment} data-proofs-payment="" />
              {errors.payment && <span className={styles.error}>{errors.payment}</span>}
            </label>
            <label className={styles.field}>
              Événement de commission (facultatif)
              <input value={event} onChange={(e) => setEvent(e.target.value)} spellCheck={false} autoComplete="off" placeholder="evt_…" aria-invalid={!!errors.event} data-proofs-event="" />
              {errors.event && <span className={styles.error}>{errors.event}</span>}
            </label>
            <button type="submit" className={styles.primary} data-proofs-open="">Afficher les preuves</button>
          </form>
          {shown && <ProofSection target={{ kind: "charge", paymentId: shown.paymentId, after: null }} title="Preuve de capture (Charge Checkout)" canWrite={canWrite} context={context} {...deps} />}
          {shown?.eventId && <ProofSection target={{ kind: "fee", paymentId: shown.paymentId, eventId: shown.eventId }} title="Preuve de commission (Fee)" canWrite={canWrite} context={context} {...deps} />}
        </>
      )}
    </section>
  );
}
