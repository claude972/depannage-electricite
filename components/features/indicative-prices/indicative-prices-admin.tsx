"use client";
// ADM-08 « Barème public » (Super Admin): the active version and its five indicative ranges, the latest
// prepared version, « publication fermée » while the server says so, and « Préparer une version »
// (explicit form, reason required; staging never changes the active version). Command fenced under
// courant-private-indicative-prices:<uid>:<gen>; same-UUID retry; re-read after success / uncertain /
// 409. « Publier » ONLY when the server says publication_available, with the active and latest
// versions shown and an explicit confirmation step (never automatic). Demo: honest note, zero calls.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CATEGORIES } from "../../../lib/domain";
import { COPY, PRICE_CATEGORIES, rangeText, type PriceCategory } from "./model";
import { ADMIN_COPY, ADMIN_INITIAL, EMPTY_INPUTS, PUBLISH_COPY, PUBLISH_INITIAL, createPublication, createStaging, tabStore, type AdminView, type Context, type PublishView, type RangeInputs, type Store } from "./admin-model";
import styles from "./indicative-prices.module.css";

export type IndicativePricesAdminProps = { demo?: boolean; context?: Context; fetcher?: typeof fetch; store?: () => Store | null; newId?: () => string | null };
const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const label = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
const eurosInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");

export function IndicativePricesAdmin({ demo = false, context, ...rest }: IndicativePricesAdminProps) {
  if (demo || !context)
    return (
      <section className={styles.panel} aria-labelledby="indicative-prices-admin" data-indicative-admin="demo">
        <h2 id="indicative-prices-admin">{COPY.adminTitle}</h2>
        <p className={styles.note}>En démonstration, le barème n’est pas lu : aucun appel n’est fait. {COPY.closed}</p>
      </section>
    );
  return <Live key={`${context.userId() ?? "-"}|${context.generation()}`} context={context} {...rest} />;
}

function Live({ context, fetcher, store = tabStore, newId = uuid }: IndicativePricesAdminProps & { context: Context }) {
  const [view, setRaw] = useState<AdminView>(ADMIN_INITIAL);
  const ref = useRef(view);
  const set = (v: AdminView) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ fetcher, store, newId, context });
  latest.current = { fetcher, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createStaging> | null>(null);
  const [pub, setPubRaw] = useState<PublishView>(PUBLISH_INITIAL);
  const pubRef = useRef(pub);
  const setPub = (v: PublishView) => {
    pubRef.current = v;
    setPubRaw(v);
  };
  const pubCtrl = useRef<ReturnType<typeof createPublication> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pubReason, setPubReason] = useState("");
  useEffect(() => {
    const c = createStaging({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    c.restorePending();
    void c.load();
    const p = createPublication({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => pubRef.current,
      set: setPub,
      reload: () => c.load(),
    });
    pubCtrl.current = p;
    p.restorePending();
    return () => {
      c.dispose();
      p.dispose();
    };
  }, []);
  const c = ctrl.current;
  const [inputs, setInputs] = useState<RangeInputs>(EMPTY_INPUTS);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const d = view.data;
  const setField = (cat: PriceCategory, k: "min" | "max", v: string) => setInputs((x) => ({ ...x, [cat]: { ...x[cat], [k]: v } }));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await c?.stage(inputs, reason)) {
      setInputs(EMPTY_INPUTS);
      setReason("");
      setOpen(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby="indicative-prices-admin" data-indicative-admin={view.phase} aria-busy={view.busy || undefined}>
      <h2 id="indicative-prices-admin">{COPY.adminTitle}</h2>
      {view.phase === "loading" && <p className={styles.hint} role="status">Lecture du barème…</p>}
      {view.phase === "forbidden" && <p className={styles.note} role="alert">{view.error}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p>{view.error}</p>
          <button type="button" className={styles.button} onClick={() => void c?.load()}>Réessayer</button>
        </div>
      )}
      {d && view.phase === "ready" && (
        <>
          <p className={styles.hint} data-indicative-admin-version={d.active.version}>
            Version active {d.active.version} · fourchettes indicatives (EUR), jamais des prix garantis.
            {d.staged ? ` Dernière version préparée : ${d.staged.version} (non active).` : ""}
          </p>
          <dl className={styles.kv}>
            {PRICE_CATEGORIES.map((cat) => (
              <div key={cat} data-indicative-admin-row={cat}>
                <dt>{label(cat)}</dt>
                <dd>{rangeText(d.active.ranges[cat])}</dd>
              </div>
            ))}
          </dl>
          {!d.publication_available && <p className={styles.note} data-indicative-admin-closed="">{COPY.closed}</p>}
          {d.publication_available && d.staged && !pub.pending && (
            !confirming ? (
              <button type="button" className={styles.button} onClick={() => setConfirming(true)} data-indicative-publish-open="">{PUBLISH_COPY.title}</button>
            ) : (
              <div className={styles.form} role="group" aria-labelledby="indicative-publish-title" data-indicative-publish-confirm="">
                <h3 id="indicative-publish-title">{PUBLISH_COPY.title}</h3>
                <p className={styles.hint}>{PUBLISH_COPY.note(d.active.version, d.latest_version)}</p>
                <dl className={styles.kv}>
                  {PRICE_CATEGORIES.map((cat) => (
                    <div key={cat}><dt>{label(cat)}</dt><dd>{rangeText(d.active.ranges[cat])} → {rangeText(d.staged!.ranges[cat])}</dd></div>
                  ))}
                </dl>
                <label className={styles.field}>
                  Motif de publication (obligatoire, 10 à 1000 caractères)
                  <textarea value={pubReason} maxLength={1000} onChange={(e) => setPubReason(e.target.value)} disabled={pub.busy} />
                </label>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={pub.busy} onClick={async () => { if (await pubCtrl.current?.publish(d, pubReason)) { setConfirming(false); setPubReason(""); } }}>
                    {PUBLISH_COPY.confirm(d.latest_version)}
                  </button>
                  <button type="button" className={styles.button} onClick={() => setConfirming(false)}>Annuler</button>
                </div>
              </div>
            )
          )}
          {!open && !view.pending && (
            <button type="button" className={styles.button} onClick={() => setOpen(true)} data-indicative-stage-open="">{ADMIN_COPY.stageTitle}</button>
          )}
          {open && !view.pending && (
            <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-indicative-stage-form="">
              <h3>{ADMIN_COPY.stageTitle} (version {d.latest_version + 1})</h3>
              <p className={styles.hint}>{ADMIN_COPY.stageNote}</p>
              <button type="button" className={styles.button} onClick={() => setInputs(Object.fromEntries(PRICE_CATEGORIES.map((cat) => [cat, { min: eurosInput(d.active.ranges[cat].min_cents), max: eurosInput(d.active.ranges[cat].max_cents) }])) as RangeInputs)}>
                Partir de la version active
              </button>
              {PRICE_CATEGORIES.map((cat) => (
                <fieldset key={cat} className={styles.rangeRow}>
                  <legend>{label(cat)} (€)</legend>
                  <label className={styles.field}>Minimum<input inputMode="decimal" value={inputs[cat].min} onChange={(e) => setField(cat, "min", e.target.value)} disabled={view.busy} /></label>
                  <label className={styles.field}>Maximum<input inputMode="decimal" value={inputs[cat].max} onChange={(e) => setField(cat, "max", e.target.value)} disabled={view.busy} /></label>
                </fieldset>
              ))}
              <label className={styles.field}>
                Motif (obligatoire, 10 à 1000 caractères)
                <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} disabled={view.busy} />
              </label>
              <div className={styles.actions}>
                <button type="submit" className={styles.primary} disabled={view.busy}>{ADMIN_COPY.stageTitle}</button>
                <button type="button" className={styles.button} onClick={() => setOpen(false)}>Annuler</button>
              </div>
            </form>
          )}
        </>
      )}
      {(view.busy || pub.busy) && <p className={styles.hint} role="status">Envoi…</p>}
      {pub.notice && <p className={styles.ok} role="status" data-indicative-publish-notice="">{pub.notice}</p>}
      {pub.error && (
        <div className={styles.note} role="alert" data-indicative-publish-error="">
          <p className={styles.error}>{pub.error}</p>
          {pub.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={() => void pubCtrl.current?.retry()} disabled={pub.busy}>Renvoyer la même publication</button>
              <button type="button" className={styles.button} onClick={() => pubCtrl.current?.discard()} disabled={pub.busy}>Abandonner</button>
            </div>
          )}
        </div>
      )}
      {view.notice && <p className={styles.ok} role="status" data-indicative-stage-notice="">{view.notice}</p>}
      {view.phase === "ready" && view.error && (
        <div className={styles.note} role="alert" data-indicative-stage-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={() => void c?.retry()} disabled={view.busy}>Réessayer</button>
              <button type="button" className={styles.button} onClick={() => c?.discard()} disabled={view.busy}>Abandonner</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
