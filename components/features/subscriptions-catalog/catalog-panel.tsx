"use client";
// FIN-07 operator catalog of optional subscription offers (platform finance « Abonnements » tab).
// Mode test|live selector with the server's configured mode always shown; list with read-only amounts
// (as read back from the server); create / edit (label, role, active, price_id) only when the server
// says can_write AND the shown mode is the configured one. No amount input, no activation button, no
// default offer, price or role. Logic and identity fence in ./model.
import { useEffect, useId, useRef, useState } from "react";
import { CATALOG_INITIAL, COPY, EMPTY_DRAFT, MODE_LABEL, ROLE_LABEL, amountText, createCatalogApi, createCatalogController, draftOf, tabStore, validateDraft, writable, type CatalogApi, type CatalogOffer, type CatalogState, type Context, type Draft, type Mode, type Store } from "./model";
import styles from "./catalog.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

export type SubscriptionsCatalogProps = {
  demo: boolean;
  /** finance_read or super admin (visibility of the tab). */
  canRead: boolean;
  /** Local session can write at all (read-only sessions never mutate, whatever the server says). */
  sessionWritable: boolean;
  context: Context;
  api?: CatalogApi;
  store?: () => Store | null;
  newId?: () => string | null;
  /** Tests only. */
  initial?: CatalogState;
};

export function SubscriptionsCatalogPanel(props: SubscriptionsCatalogProps) {
  if (!props.canRead && !props.demo) return null;
  return (
    <section className={styles.panel} aria-labelledby="subscriptions-catalog-title" data-subscriptions-catalog={props.demo ? "demo" : ""}>
      <h3 id="subscriptions-catalog-title">{COPY.title}</h3>
      <p className={styles.hint}>{COPY.intro}</p>
      {props.demo ? <p className={styles.note}>{COPY.demo}</p> : <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />}
    </section>
  );
}

function OfferForm({ initial, busy, onSubmit, onCancel, submitLabel }: { initial: Draft; busy: boolean; onSubmit: (d: Draft) => void; onCancel: () => void; submitLabel: string }) {
  const id = useId();
  const [d, setD] = useState<Draft>(initial);
  const [tried, setTried] = useState(false);
  const errors = validateDraft(d);
  const show = (k: keyof Draft) => (tried ? errors[k] : undefined);
  return (
    <form
      className={styles.form}
      noValidate
      data-catalog-form=""
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (Object.keys(errors).length === 0) onSubmit(d);
      }}
    >
      <label className={styles.field}>
        Libellé
        <input value={d.label} maxLength={160} onChange={(e) => setD({ ...d, label: e.target.value })} aria-invalid={!!show("label")} aria-describedby={show("label") ? `${id}-label` : undefined} data-catalog-label="" />
        {show("label") && <span id={`${id}-label`} className={styles.error}>{show("label")}</span>}
      </label>
      <label className={styles.field}>
        Profil concerné
        <select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as Draft["role"] })} aria-invalid={!!show("role")} data-catalog-role="">
          <option value="">Choisir…</option>
          <option value="client">{ROLE_LABEL.client}</option>
          <option value="artisan">{ROLE_LABEL.artisan}</option>
        </select>
        {show("role") && <span className={styles.error}>{show("role")}</span>}
      </label>
      <label className={styles.field}>
        Price Stripe
        <input value={d.price_id} maxLength={206} spellCheck={false} autoComplete="off" onChange={(e) => setD({ ...d, price_id: e.target.value })} aria-invalid={!!show("price_id")} data-catalog-price="" />
        {show("price_id") && <span className={styles.error}>{show("price_id")}</span>}
      </label>
      <label className={styles.check}>
        <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} data-catalog-active="" />
        <span>Offre active</span>
      </label>
      <p className={styles.hint}>Le montant, la devise, la périodicité et la fiscalité seront relus par le serveur depuis ce Price.</p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy} data-catalog-submit="">{busy ? "Enregistrement…" : submitLabel}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

function Live({ context, sessionWritable, api, store = tabStore, newId = uuid, initial }: SubscriptionsCatalogProps) {
  const [state, setRaw] = useState<CatalogState>(initial ?? CATALOG_INITIAL);
  const ref = useRef(state);
  const set = (s: CatalogState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ api, store, newId, sessionWritable });
  latest.current = { api, store, newId, sessionWritable };
  const ctrl = useRef<ReturnType<typeof createCatalogController> | null>(null);
  useEffect(() => {
    let client: CatalogApi | null = null;
    const c = createCatalogController({ api: () => (client ??= latest.current.api ?? createCatalogApi()), store: () => latest.current.store(), newId: () => latest.current.newId(), context, sessionWritable: () => latest.current.sessionWritable, get: () => ref.current, set });
    ctrl.current = c;
    if (!initial) {
      const m = c.restorePending();
      void c.load(m ?? ref.current.mode);
    }
    return () => {
      c.stop();
      if (ctrl.current === c) ctrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const cat = state.catalog;
  const canMutate = writable(cat, sessionWritable);
  const locked = state.busy || !!state.pending;
  const submit = (target: CatalogOffer | null) => (d: Draft) => void ctrl.current?.save(target, d).then((ok) => ok && setEditing(null));
  return (
    <div className={styles.live} data-catalog-phase={state.phase} aria-busy={state.busy || undefined}>
      <div className={styles.modes} role="group" aria-label="Mode Stripe affiché">
        {(["test", "live"] as Mode[]).map((m) => (
          <button key={m} type="button" className={styles.secondary} aria-pressed={state.mode === m} disabled={locked} onClick={() => (setEditing(null), void ctrl.current?.selectMode(m))} data-catalog-mode={m}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <dl className={styles.kv}>
        <div><dt>Mode affiché</dt><dd data-catalog-shown="">{MODE_LABEL[state.mode]}</dd></div>
        {cat && <div><dt>Mode configuré sur le serveur</dt><dd data-catalog-configured="">{cat.configured_mode ? MODE_LABEL[cat.configured_mode] : "Aucun"}</dd></div>}
      </dl>
      {state.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {state.phase === "forbidden" && <p className={styles.note} data-catalog-forbidden="">{COPY.forbidden}</p>}
      {(state.phase === "error" || state.phase === "unavailable") && (
        <div role="alert">
          <p className={styles.error}>{state.error || COPY.loadFailed}</p>
          <button type="button" className={styles.secondary} onClick={() => void ctrl.current?.load()} data-catalog-reload="">Réessayer</button>
        </div>
      )}
      {state.notice && <p className={styles.ok} role="status" data-catalog-notice="">{state.notice}</p>}
      {state.error && state.phase === "ready" && (
        <div role="alert" data-catalog-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending && (
            <button type="button" className={styles.secondary} disabled={state.busy} onClick={() => void ctrl.current?.retry()} data-catalog-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même demande"}
            </button>
          )}
        </div>
      )}
      {state.phase === "ready" && cat && (
        <>
          {cat.configured_mode === null && <p className={styles.note} data-catalog-mismatch="">{COPY.noConfigured}</p>}
          {cat.configured_mode !== null && cat.configured_mode !== cat.mode && <p className={styles.note} data-catalog-mismatch="">{COPY.mismatch(cat.mode, cat.configured_mode)}</p>}
          {!cat.can_write && <p className={styles.note} data-catalog-readonly="">{COPY.readOnly}</p>}
          {!cat.catalog_enabled && <p className={styles.note} data-catalog-disabled="">{COPY.disabled}</p>}
          {cat.offers.length === 0 && <p className={styles.hint} data-catalog-empty="">{COPY.empty}</p>}
          <ul className={styles.list}>
            {cat.offers.map((o) => (
              <li key={o.id} className={styles.item} data-catalog-offer={o.id}>
                <p className={styles.headline}><strong>{o.label}</strong></p>
                <dl className={styles.kv}>
                  <div><dt>Profil</dt><dd>{ROLE_LABEL[o.role]}</dd></div>
                  <div><dt>État</dt><dd data-catalog-offer-active="">{o.active ? "Active" : "Inactive"}</dd></div>
                  <div><dt>Price Stripe</dt><dd className={styles.mono}>{o.price_id}</dd></div>
                  <div><dt>Montant (relu)</dt><dd data-catalog-amount="">{amountText(o)}</dd></div>
                  <div><dt>Version</dt><dd>{o.version}</dd></div>
                </dl>
                {canMutate && editing !== o.id && (
                  <button type="button" className={styles.secondary} disabled={locked || editing !== null} onClick={() => setEditing(o.id)} data-catalog-edit={o.id}>Modifier</button>
                )}
                {canMutate && editing === o.id && <OfferForm initial={draftOf(o)} busy={state.busy} onSubmit={submit(o)} onCancel={() => setEditing(null)} submitLabel="Enregistrer l’offre" />}
              </li>
            ))}
          </ul>
          {canMutate && editing !== "new" && (
            <button type="button" className={styles.primary} disabled={locked || editing !== null} onClick={() => setEditing("new")} data-catalog-create="">Nouvelle offre</button>
          )}
          {canMutate && editing === "new" && <OfferForm initial={EMPTY_DRAFT} busy={state.busy} onSubmit={submit(null)} onCancel={() => setEditing(null)} submitLabel="Créer l’offre" />}
        </>
      )}
    </div>
  );
}
