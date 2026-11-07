"use client";
// FIN-07 (slice 1): optional subscription in « Mon profil » (client and artisan). Shows the attested
// subscription read by the server (status, period, scheduled end), or the server's offers with their
// terms taken ONLY from server fields. Subscribing needs an explicit consent that states the automatic
// renewal and that stopping is not available here yet (assistance), then an explicit click on the
// validated Stripe URL. « Gérer mon abonnement » (Stripe Billing portal) only when the server says
// portal_available; no wording promises a cancellation. A Stripe return only re-reads.
// Logic and identity fence in ./model.
import { useEffect, useId, useRef, useState } from "react";
import { COPY, SUB_INITIAL, STATUS_LABEL, canOffer, canResume, createSubscriptionsApi, createSubscriptionsController, formatDay, formatMoment, isTerminal, offerTerms, returnMarker, tabStore, visibleOffers, type Context, type RawOffer, type ReadyOverview, type Store, type SubApi, type SubState } from "./model";
import styles from "./subscriptions.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

export type SubscriptionsPanelProps = {
  role: "client" | "artisan";
  context: Context;
  demo?: boolean;
  api?: SubApi;
  store?: () => Store | null;
  newId?: () => string | null;
  /** Opens the validated Stripe URL; called only from the user's click. */
  navigate?: (url: string) => void;
  /** Page query string (tests); defaults to window.location.search. */
  search?: string;
  /** Tests only. */
  initial?: SubState;
};

export function SubscriptionsPanel(props: SubscriptionsPanelProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby={`subscriptions-demo-${props.role}`} data-subscriptions="demo">
        <h2 id={`subscriptions-demo-${props.role}`} className={styles.title}>{COPY.title}</h2>
        <p className={styles.note}>{COPY.demo}</p>
        <p className={styles.muted}>{COPY.optional}</p>
      </section>
    );
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Terms({ offer }: { offer: RawOffer }) {
  const t = offerTerms(offer);
  if (!t) return <span className={styles.muted}>{COPY.termsUnknown}</span>;
  return (
    <span data-subscription-terms="">
      {t.amount} {t.every} · {t.tax}
    </span>
  );
}

function Current({ s, portal }: { s: NonNullable<ReadyOverview["subscription"]>; portal: boolean }) {
  return (
    <div className={styles.current} data-subscription-status={s.status}>
      <p className={styles.row}>
        <strong>{s.offer.label}</strong>
        <span className={`${styles.badge} ${isTerminal(s.status) ? "" : styles.badgeOn}`}>{STATUS_LABEL[s.status]}</span>
      </p>
      <p className={styles.note}>
        <Terms offer={s.offer} />
      </p>
      {!isTerminal(s.status) && <p className={styles.note}>{COPY.period(formatDay(s.current_period_start), formatDay(s.current_period_end))}</p>}
      {s.cancel_at_period_end && !isTerminal(s.status) && <p className={styles.note} data-subscription-ends="">{COPY.endsAt(formatDay(s.current_period_end))}</p>}
      <p className={styles.muted}>{COPY.observed(formatMoment(s.observed_at))}</p>
      {portal ? <p className={styles.note} data-subscription-manage-note="">{COPY.manageNote}</p> : !isTerminal(s.status) && <p className={styles.note} data-subscription-stop="">{COPY.stop}</p>}
    </div>
  );
}

function Live({ role, context, api, store = tabStore, newId = uuid, navigate, search, initial }: SubscriptionsPanelProps) {
  const uid = useId();
  const [state, setRaw] = useState<SubState>(initial ?? SUB_INITIAL);
  const ref = useRef(state);
  const set = (s: SubState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ api, store, newId, navigate, role });
  latest.current = { api, store, newId, navigate, role };
  const ctrl = useRef<ReturnType<typeof createSubscriptionsController> | null>(null);
  useEffect(() => {
    let client: SubApi | null = null;
    const c = createSubscriptionsController({ api: () => (client ??= latest.current.api ?? createSubscriptionsApi()), store: () => latest.current.store(), newId: () => latest.current.newId(), context, role: () => latest.current.role, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      c.restorePending();
      // A Stripe return is only a reason to re-read: it proves nothing.
      const marker = returnMarker(search ?? (typeof window !== "undefined" ? window.location.search : ""));
      void c.load(marker === "returned" ? COPY.returned : marker === "cancelled" ? COPY.cancelled : marker === "managed" ? COPY.managed : undefined);
    }
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const offers = visibleOffers(state.overview, role);
  const hiddenCount = state.overview?.state === "ready" && state.overview.available ? state.overview.offers.filter((x) => x.role === role).length - offers.length : 0;
  const [picked, setPicked] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const selected = offers.find((x) => x.id === picked) ?? (offers.length === 1 ? offers[0] : null);
  const terms = selected ? offerTerms(selected) : null;
  const locked = state.busy || !!state.pending;
  const o = state.overview;
  const openResume = () => {
    const url = ctrl.current?.takeResumeUrl();
    if (!url) return;
    if (latest.current.navigate) latest.current.navigate(url);
    else window.location.assign(url);
  };
  const openPortal = () => {
    const url = ctrl.current?.takePortalUrl();
    if (!url) return;
    if (latest.current.navigate) latest.current.navigate(url);
    else window.location.assign(url);
  };
  const open = () => {
    const url = ctrl.current?.takeCheckoutUrl();
    if (!url) return;
    if (latest.current.navigate) latest.current.navigate(url);
    else window.location.assign(url);
  };
  return (
    <section className={styles.panel} aria-labelledby={`${uid}-t`} aria-busy={state.busy || undefined} data-subscriptions={state.phase}>
      <h2 id={`${uid}-t`} className={styles.title}>{COPY.title}</h2>
      <p className={styles.muted}>{COPY.optional}</p>
      {state.phase === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.note} data-subscriptions-forbidden="">{COPY.forbidden}</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div role="alert">
          <p className={styles.error}>{state.error || COPY.loadFailed}</p>
          <button type="button" className={styles.button} onClick={() => void ctrl.current?.load()} data-subscriptions-reload="">Réessayer</button>
        </div>
      )}
      {state.notice && <p className={styles.note} role="status" data-subscriptions-notice="">{state.notice}</p>}
      {state.phase === "ready" && state.error && (
        <div role="alert" data-subscriptions-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={() => void ctrl.current?.retry()} data-subscriptions-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même demande"}
            </button>
          )}
        </div>
      )}
      {state.phase === "ready" && o?.state === "unavailable" && <p className={styles.note} data-subscriptions-not-read="">{COPY.notRead}</p>}
      {state.phase === "ready" && o?.state === "ready" && (
        <>
          {o.subscription && <Current s={o.subscription} portal={o.portal_available} />}
          {(o.portal_available || state.portalUrl) && (
            <div className={styles.add} data-subscriptions-manage="">
              {state.portalUrl ? (
                <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openPortal} data-subscriptions-portal-open="">{COPY.openPortal}</button>
              ) : (
                <button type="button" className={styles.button} disabled={locked} onClick={() => void ctrl.current?.manage()} data-subscriptions-portal="">
                  {state.busy ? "Préparation…" : COPY.manage}
                </button>
              )}
            </div>
          )}
          {o.checkout_pending && !state.checkoutUrl && <p className={styles.note} data-subscriptions-pending="">{canResume(o) ? COPY.resumeNote : COPY.pending}</p>}
          {(canResume(o) || state.resumeUrl) && (
            <div className={styles.add} data-subscriptions-resume-box="">
              {state.resumeUrl ? (
                <button type="button" className={`${styles.button} ${styles.primary}`} onClick={openResume} data-subscriptions-resume-open="">{COPY.open}</button>
              ) : (
                <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => void ctrl.current?.resume()} data-subscriptions-resume="">
                  {state.busy ? "Préparation…" : state.resumeRetry ? "Réessayer" : COPY.resume}
                </button>
              )}
            </div>
          )}
          {o.subscription && !isTerminal(o.subscription.status) && <p className={styles.muted} data-subscriptions-running="">{COPY.running}</p>}
          {canOffer(o) && offers.length === 0 && <p className={styles.note} data-subscriptions-none="">{COPY.none}</p>}
          {!o.available && !o.subscription && <p className={styles.note} data-subscriptions-none="">{COPY.none}</p>}
          {canOffer(o) && hiddenCount > 0 && <p className={styles.muted} data-subscriptions-hidden="">{COPY.hidden}</p>}
          {(canOffer(o) || state.checkoutUrl) && offers.length > 0 && (
            <>
              <ul className={styles.list}>
                {offers.map((x) => (
                  <li key={x.id} className={`${styles.item} ${selected?.id === x.id ? styles.itemOn : ""}`} data-subscription-offer={x.id}>
                    <span className={styles.offerText}>
                      <strong>{x.label}</strong>
                      <Terms offer={x} />
                    </span>
                    {offers.length > 1 && (
                      <button type="button" className={styles.button} aria-pressed={selected?.id === x.id} disabled={locked || !!state.checkoutUrl} onClick={() => (setPicked(x.id), setConsent(false))} data-subscription-pick={x.id}>
                        {COPY.choose}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {selected && terms && (
                <div className={styles.add} data-subscriptions-subscribe="">
                  <label className={styles.check}>
                    <input type="checkbox" checked={consent} disabled={locked || !!state.checkoutUrl} onChange={(e) => setConsent(e.target.checked)} data-subscriptions-consent="" />
                    <span data-subscriptions-consent-text="">{COPY.consent(selected.label, terms)}</span>
                  </label>
                  {state.checkoutUrl ? (
                    <button type="button" className={`${styles.button} ${styles.primary}`} onClick={open} data-subscriptions-open="">{COPY.open}</button>
                  ) : (
                    <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked || !consent} onClick={() => void ctrl.current?.checkout(selected.id, consent)} data-subscriptions-checkout="">
                      {state.busy ? "Préparation…" : COPY.subscribe}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
