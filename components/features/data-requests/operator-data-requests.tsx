"use client";
// SYS-07 operator review of data erasure requests (support queue). Independent of SupportCenter: no
// ticket title or messages. Paged list; detail with the request, its history and can_decide (server);
// decision form ONLY when can_decide and the state is not terminal: state + required reason (1–1000),
// nothing pre-filled. Command fenced under courant-private-data-requests:<uid>:<gen>:<id>; lost reply
// / 5xx ⇒ same command; 409 ⇒ honest + re-read, no replay; 401/403 ⇒ cleared + scope refusal;
// identity change ⇒ reset (remount by key). Nothing is erased: execution is never started here.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DATA_REQUESTS_COPY as COPY, DECISIONS, EXECUTION_LABEL, STATE_LABEL, TERMINAL, type DecisionCommand } from "./contract";
import { DETAIL_INITIAL, LIST_INITIAL, createDetail, createList, tabStore, type Context, type DetailView, type ListState, type Store } from "./model";
import styles from "./data-requests.module.css";
import { ErasureExecutionPanel } from "./erasure-execution-panel";

export type OperatorDataRequestsProps = { context: Context; fetcher?: typeof fetch; store?: () => Store | null; newId?: () => string | null };
const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Martinique" });
};

export function OperatorDataRequests(props: OperatorDataRequestsProps) {
  // Identity change ⇒ full reset (list, selection, form).
  return <Live key={`${props.context.userId() ?? "-"}|${props.context.generation()}`} {...props} />;
}

function Live({ context, fetcher, store = tabStore, newId = uuid }: OperatorDataRequestsProps) {
  const [list, setRaw] = useState<ListState>(LIST_INITIAL);
  const ref = useRef(list);
  const set = (s: ListState) => {
    ref.current = s;
    setRaw(s);
  };
  const latest = useRef({ fetcher, context, store, newId });
  latest.current = { fetcher, context, store, newId };
  const ctrl = useRef<ReturnType<typeof createList> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const c = createList({
      fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      kind: "admin",
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    void c.load();
    return () => c.dispose();
  }, []);
  const c = ctrl.current;
  return (
    <section className={styles.panel} aria-labelledby="op-erasure-title" data-op-erasure={list.phase}>
      <h2 id="op-erasure-title">{COPY.opTitle}</h2>
      <p className={styles.hint}>{COPY.opNote}</p>
      {list.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {list.phase === "forbidden" && <p className={styles.note} role="alert" data-op-erasure-forbidden="">{list.error}</p>}
      {list.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{list.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c?.load()}>Réessayer</button>
        </div>
      )}
      {list.phase === "ready" && list.rows.length === 0 && <p className={styles.hint}>{COPY.opEmpty}</p>}
      {list.phase === "ready" && list.rows.length > 0 && (
        <ul className={styles.list}>
          {list.rows.map((r) => (
            <li key={r.id} className={styles.item} data-op-erasure-row={r.id}>
              <span className={styles.labels}>
                <span className={styles.badge}>{STATE_LABEL[r.state]}</span>
                {/* SYS-09: the execution is read from the platform journal (request rows only know « not_started »). */}
                <span className={styles.badge} data-op-erasure-execution={list.executions ? (list.executions[r.id] ? "executed" : "not_started") : "unknown"}>
                  {list.executions ? (list.executions[r.id] ? `${COPY.opExecuted} le ${when(list.executions[r.id])}` : EXECUTION_LABEL[r.execution_state]) : COPY.opExecutionUnknown}
                </span>
              </span>
              <span className={styles.meta}>Demande {r.id.slice(0, 8)} · version {r.version} · déposée le {when(r.created_at)}</span>
              <button type="button" className={styles.secondary} aria-expanded={selected === r.id} onClick={() => setSelected(selected === r.id ? null : r.id)}>
                {selected === r.id ? "Fermer" : "Examiner"}
              </button>
              {selected === r.id && <Detail id={r.id} fetcher={() => latest.current.fetcher ?? ((...a) => fetch(...a))} store={() => latest.current.store()} newId={() => latest.current.newId()} context={context} onDecided={() => void c?.load()} />}
            </li>
          ))}
        </ul>
      )}
      {list.moreError && <p className={styles.error} role="alert">{list.moreError}</p>}
      {list.phase === "ready" && list.next && (
        <button type="button" className={styles.secondary} disabled={list.loadingMore} onClick={() => void c?.more()} data-op-erasure-more="">
          {list.loadingMore ? "Chargement…" : COPY.more}
        </button>
      )}
    </section>
  );
}

function Detail({ id, fetcher, store, newId, context, onDecided }: { id: string; fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; onDecided: () => void }) {
  const [view, setRaw] = useState<DetailView>(DETAIL_INITIAL);
  const ref = useRef(view);
  const set = (v: DetailView) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ fetcher, store, newId, context });
  latest.current = { fetcher, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createDetail> | null>(null);
  useEffect(() => {
    const c = createDetail({
      id,
      fetcher: () => latest.current.fetcher(),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
    ctrl.current = c;
    c.restorePending();
    void c.load();
    return () => c.dispose();
  }, [id]);
  const c = ctrl.current;
  const [state, setState] = useState<DecisionCommand["state"] | "">("");
  const [reason, setReason] = useState("");
  const d = view.data;
  const canForm = Boolean(d && d.can_decide && !TERMINAL.has(d.request.state));
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!state) return set({ ...ref.current, error: "Choisissez l’état de la décision." });
    if (await c?.decide(state, reason)) {
      setState("");
      setReason("");
      onDecided();
    }
  };
  return (
    <div className={styles.detail} data-op-erasure-detail={view.phase} aria-busy={view.busy || undefined}>
      {view.phase === "loading" && <p className={styles.hint} role="status">Lecture de la demande…</p>}
      {view.phase === "forbidden" && <p className={styles.note} role="alert" data-op-erasure-forbidden="">{view.error}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c?.load()}>Réessayer</button>
        </div>
      )}
      {d && view.phase === "ready" && (
        <>
          <dl className={styles.kv}>
            <div><dt>État de la demande</dt><dd data-op-erasure-state={d.request.state}>{STATE_LABEL[d.request.state]} (version {d.request.version})</dd></div>
            <div><dt>Déposée / mise à jour</dt><dd>{when(d.request.created_at)} · {when(d.request.updated_at)}</dd></div>
          </dl>
          <ErasureExecutionPanel id={id} requestState={d.request.state} fetcher={() => latest.current.fetcher()} onExecuted={onDecided} />
          <h4 className={styles.title}>Historique ({d.history.length})</h4>
          {d.history.length === 0 ? (
            <p className={styles.hint}>Aucune décision enregistrée.</p>
          ) : (
            <ol className={styles.history}>
              {d.history.map((h) => (
                <li key={h.id}>
                  <span className={styles.meta}>v{h.version} · {when(h.created_at)} · {h.actor_id.slice(0, 8)}</span>
                  <span>{h.from_state ? `${STATE_LABEL[h.from_state]} → ` : ""}{STATE_LABEL[h.to_state]}</span>
                  {h.reason && <span className={styles.reason}>{h.reason}</span>}
                </li>
              ))}
            </ol>
          )}
          {canForm && !view.pending ? (
            <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate data-op-erasure-form="">
              <label className={styles.field}>
                Nouvel état
                <select value={state} onChange={(e) => setState(e.target.value as DecisionCommand["state"] | "")} disabled={view.busy}>
                  <option value="">Choisir…</option>
                  {DECISIONS.filter((s) => s !== d.request.state).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                Motif (obligatoire, 1000 caractères au plus)
                <textarea value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} disabled={view.busy} />
              </label>
              <button type="submit" className={styles.primary} disabled={view.busy}>Enregistrer la décision</button>
            </form>
          ) : !canForm ? (
            <p className={styles.hint} data-op-erasure-noform="">{COPY.opDecideNo}</p>
          ) : null}
        </>
      )}
      {view.busy && <p className={styles.hint} role="status">Enregistrement…</p>}
      {view.notice && <p className={styles.ok} role="status" data-op-erasure-notice="">{view.notice}</p>}
      {view.phase === "ready" && view.error && (
        <div className={styles.note} role="alert" data-op-erasure-error="">
          <p className={styles.error}>{view.error}</p>
          {view.pending && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} onClick={() => void c?.retry()} disabled={view.busy}>Réessayer</button>
              <button type="button" className={styles.secondary} onClick={() => void c?.reread()} disabled={view.busy}>Relire la demande</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
