"use client";
// FIN-06 — private finance OBSERVER of provider transfer observations (platform finance screen).
// List (≤ 50 per page, cursor `after`, optional state filter), detail with the review history, and the
// operator review (note + automatic re-association by OUR server, per contract). Every observation is
// labelled « Observation du fournisseur (lecture) »; status and result are shown exactly as returned.
// No provider call from the browser. Review command fenced under courant-private-reconciliation:.
// Demo: honest note, zero calls. Logic in ./model.
import { useEffect, useRef, useState } from "react";
import { COPY, DETAIL_INITIAL, FAMILY_LABEL, OBSERVATION_LABEL, REASON_LABEL, STATE_LABEL, TYPE_LABEL, amountText, createDetail, listUrl, parsePage, statusError, tabStore, timed, type Context, type DetailView, type Observation, type StateFilter, type Store } from "./model";
import styles from "./reconciliation.module.css";

export type ReconciliationPanelProps = {
  demo: boolean;
  /** finance_read (or super admin) from the server's /me; the server re-checks every call. */
  canRead: boolean;
  /** finance_read AND finance_write (or super admin); the server re-checks. */
  canWrite: boolean;
  context: Context;
  onOpenDossier?: (interventionId: string) => void;
  fetcher?: typeof fetch;
  store?: () => Store | null;
  newId?: () => string | null;
};
const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
};

export function ReconciliationPanel(props: ReconciliationPanelProps) {
  if (!props.canRead && !props.demo) return null;
  return (
    <section className={styles.panel} aria-labelledby="reconciliation-title" data-reconciliation={props.demo ? "demo" : ""}>
      <h3 id="reconciliation-title">{COPY.title}</h3>
      <p className={styles.hint}>{COPY.intro}</p>
      {props.demo ? <p className={styles.note}>{COPY.demo}</p> : <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />}
    </section>
  );
}

type ListState = { phase: "loading" | "ready" | "error" | "forbidden"; records: Observation[]; next: string | null; error: string };

function Live({ canWrite, context, onOpenDossier, fetcher, store = tabStore, newId = uuid }: ReconciliationPanelProps) {
  const [filter, setFilter] = useState<StateFilter>("");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [list, setList] = useState<ListState>({ phase: "loading", records: [], next: null, error: "" });
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const after = cursors[cursors.length - 1];
  const doFetch = (): typeof fetch => fetcher ?? ((...a) => fetch(...a));
  useEffect(() => {
    let live = true;
    const uid = context.userId(), gen = context.generation();
    setList((l) => ({ ...l, phase: "loading", error: "" }));
    void timed(doFetch(), listUrl(after, filter), { method: "GET" }).then((r) => {
      if (!live || context.userId() !== uid || context.generation() !== gen) return;
      if (r.status === 401 || r.status === 403) return setList({ phase: "forbidden", records: [], next: null, error: statusError(r.status, null) });
      const p = r.status === 200 ? parsePage(r.body, after, filter) : null;
      if (!p) return setList({ phase: "error", records: [], next: null, error: statusError(r.status === 200 ? 0 : r.status, r.retryAfterS) });
      setList({ phase: "ready", records: p.records, next: p.next_after, error: "" });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [after, filter, reload]);

  if (list.phase === "forbidden") return <p className={styles.note} role="alert" data-reconciliation-forbidden="">{list.error}</p>;
  return (
    <div className={styles.live}>
      <p className={styles.hint}>{COPY.paging}</p>
      {!canWrite && <p className={styles.hint}>{COPY.readOnly}</p>}
      <div className={styles.row}>
        <label className={styles.field}>
          Résultat du rapprochement
          <select value={filter} onChange={(e) => { setFilter(e.target.value as StateFilter); setCursors([null]); setSelected(null); }}>
            <option value="">Tous</option>
            <option value="needs_review">À examiner</option>
            <option value="matched">Associées au transfert enregistré</option>
          </select>
        </label>
        <button type="button" className={styles.secondary} onClick={() => setReload((n) => n + 1)} disabled={list.phase === "loading"}>{COPY.reread}</button>
      </div>
      {list.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {list.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{list.error}</p>
          <button type="button" className={styles.secondary} onClick={() => setReload((n) => n + 1)}>Réessayer</button>
        </div>
      )}
      {list.phase === "ready" && (list.records.length === 0 ? <p className={styles.hint} data-reconciliation-empty="">{COPY.empty}</p> : (
        <ul className={styles.list} aria-label="Observations du fournisseur">
          {list.records.map((r) => (
            <li key={r.event.id} className={styles.item} data-reconciliation-event={r.event.id} data-state={r.result.state}>
              <Summary record={r} />
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} aria-expanded={selected === r.event.id} onClick={() => setSelected(selected === r.event.id ? null : r.event.id)}>
                  {selected === r.event.id ? "Fermer le détail" : "Examiner"}
                </button>
              </div>
              {selected === r.event.id && (
                <DetailPanel key={`${r.event.id}|${context.userId() ?? "-"}|${context.generation()}`} id={r.event.id} canWrite={canWrite} context={context} fetcher={doFetch} store={store} newId={newId} onOpenDossier={onOpenDossier} />
              )}
            </li>
          ))}
        </ul>
      ))}
      <div className={styles.actions}>
        {cursors.length > 1 && <button type="button" className={styles.secondary} onClick={() => { setCursors(cursors.slice(0, -1)); setSelected(null); }} disabled={list.phase === "loading"}>Page précédente</button>}
        {list.phase === "ready" && list.next && <button type="button" className={styles.secondary} onClick={() => { setCursors([...cursors, list.next]); setSelected(null); }}>Page suivante</button>}
      </div>
      {list.phase === "ready" && !list.next && list.records.length > 0 && <p className={styles.hint}>{COPY.lastPage}</p>}
    </div>
  );
}

function Summary({ record }: { record: Observation }) {
  const e = record.event, o = e.object, res = record.result;
  return (
    <div className={styles.summary}>
      <p className={styles.kicker}>{OBSERVATION_LABEL}</p>
      <p className={styles.headline}>
        <strong>{FAMILY_LABEL[e.family]}</strong> — {TYPE_LABEL[e.type] ?? e.type}
      </p>
      <dl className={styles.kv}>
        <div><dt>Événement</dt><dd className={styles.mono}>{e.id} · {e.type}{e.livemode ? " · réel" : " · test"}</dd></div>
        <div><dt>Objet observé</dt><dd className={styles.mono}>{o.id}</dd></div>
        <div><dt>Montant observé</dt><dd>{amountText(o.amount, o.currency)}{o.amount_reversed !== null ? ` · repris : ${amountText(o.amount_reversed, o.currency)}` : ""}</dd></div>
        <div><dt>État indiqué par le fournisseur</dt><dd>{o.status ?? "non indiqué"}{o.reversed !== null ? ` · repris : ${o.reversed ? "oui" : "non"}` : ""}</dd></div>
        <div><dt>Émis / reçu</dt><dd>{when(e.created)} · reçu {when(record.received_at)}</dd></div>
        <div>
          <dt>Rapprochement</dt>
          <dd data-reconciliation-result={res.state}>
            <strong>{STATE_LABEL[res.state]}</strong> <span className={styles.mono}>({res.state} / {res.reason})</span>
            <br />
            {REASON_LABEL[res.reason]}
          </dd>
        </div>
        <div><dt>Version</dt><dd>{record.version}</dd></div>
      </dl>
    </div>
  );
}

function useWait(seconds: number | null, key: unknown) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (!seconds) return setWaiting(false);
    setWaiting(true);
    const t = setTimeout(() => setWaiting(false), seconds * 1000);
    return () => clearTimeout(t);
  }, [seconds, key]);
  return waiting;
}

function DetailPanel({ id, canWrite, context, fetcher, store, newId, onOpenDossier }: { id: string; canWrite: boolean; context: Context; fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; onOpenDossier?: (id: string) => void }) {
  const [view, setRaw] = useState<DetailView>(DETAIL_INITIAL);
  const ref = useRef(view);
  const set = (v: DetailView) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ fetcher, store, newId, context });
  latest.current = { fetcher, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createDetail> | null>(null);
  ctrl.current ??= createDetail({
    id,
    fetcher: () => latest.current.fetcher(),
    store: () => latest.current.store(),
    newId: () => latest.current.newId(),
    context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
    get: () => ref.current,
    set,
  });
  const c = ctrl.current;
  useEffect(() => {
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const wait = useWait(view.pending ? view.waitS : null, view.error);
  if (view.phase === "forbidden") return <p className={styles.note} role="alert">{COPY.forbidden}</p>;
  const d = view.data;
  const res = d?.record.result;
  return (
    <div className={styles.detail} data-reconciliation-detail={view.phase} aria-busy={view.busy || undefined}>
      {view.phase === "loading" && <p className={styles.hint} role="status">Lecture du détail…</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </div>
      )}
      {d && res && (
        <>
          <dl className={styles.kv}>
            <div><dt>Résultat actuel</dt><dd><strong>{STATE_LABEL[res.state]}</strong> <span className={styles.mono}>({res.state} / {res.reason})</span> — version {d.record.version}</dd></div>
            <div>
              <dt>Rattachement prouvé</dt>
              <dd>
                {res.intervention_id ? (
                  <>
                    {onOpenDossier ? <button type="button" className="text-button" onClick={() => onOpenDossier(res.intervention_id!)} data-reconciliation-dossier={res.intervention_id}>Ouvrir le dossier</button> : <span className={styles.mono}>{res.intervention_id}</span>}
                    <span className={styles.mono}> · règlement {res.settlement_id} · devis {res.quote_id}</span>
                  </>
                ) : (
                  "Aucun (preuve insuffisante)"
                )}
              </dd>
            </div>
            <div><dt>Compte source</dt><dd className={styles.mono}>{d.record.event.source_account ?? "compte plateforme"}</dd></div>
            <div><dt>Charge source / destinataire</dt><dd className={styles.mono}>{d.record.event.object.source_charge ?? "—"} → {d.record.event.object.destination ?? "—"}</dd></div>
          </dl>
          <button type="button" className={styles.secondary} onClick={() => void c.load()} disabled={view.busy}>{COPY.reread}</button>
          <h4>Revues ({d.history.length}{d.history_limited ? ", historique limité aux 50 dernières" : ""})</h4>
          {d.history.length === 0 ? (
            <p className={styles.hint}>Aucune revue enregistrée.</p>
          ) : (
            <ol className={styles.history}>
              {d.history.map((h) => (
                <li key={h.version}>
                  <span className={styles.mono}>v{h.version} · {when(h.created_at)} · {h.actor_id.slice(0, 8)}</span>
                  <span>{STATE_LABEL[h.outcome.state]} ({h.outcome.reason})</span>
                  <span className={styles.noteText}>{h.note}</span>
                </li>
              ))}
            </ol>
          )}
          {view.notice && (
            <p className={styles.ok} role="status" data-reconciliation-notice="">
              {view.notice}
              {view.receipt && ` Résultat : ${STATE_LABEL[view.receipt.result.state]} (${view.receipt.result.state} / ${view.receipt.result.reason}), version ${view.receipt.version}.`}
            </p>
          )}
          {canWrite && !view.pending && (
            <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); if (!note.trim() || note.trim().length > 2000) return set({ ...ref.current, error: COPY.noteRequired }); setConfirming(true); }}>
              <label className={styles.field}>
                Note de revue (obligatoire)
                <textarea value={note} maxLength={2000} onChange={(e) => { setNote(e.target.value); setConfirming(false); }} disabled={view.busy} />
              </label>
              {!confirming ? (
                <button type="submit" className={styles.secondary} disabled={view.busy}>Enregistrer une revue…</button>
              ) : (
                <div className={styles.confirm} role="group" aria-labelledby={`review-confirm-${id}`}>
                  <p id={`review-confirm-${id}`}>{COPY.reviewExplain}</p>
                  <div className={styles.actions}>
                    <button type="button" className={styles.primary} disabled={view.busy} onClick={async () => { setConfirming(false); const ok = await c.review(note); if (ok) setNote(""); }}>Confirmer la revue (version {d.record.version})</button>
                    <button type="button" className={styles.secondary} onClick={() => setConfirming(false)}>Annuler</button>
                  </div>
                </div>
              )}
            </form>
          )}
        </>
      )}
      {view.busy && <p className={styles.hint} role="status">{COPY.sending}</p>}
      {view.phase !== "error" && view.error && (
        <div className={styles.note} role="alert" data-reconciliation-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void c.retry()} disabled={view.busy || wait}>Réessayer</button>
              <button type="button" className={styles.secondary} onClick={() => c.discard()} disabled={view.busy}>Abandonner</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
