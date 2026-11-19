"use client";
// ADM-07 — operator-only triage of a support ticket (assignment, internal motivated escalation) and
// the « Mes attributions » / « Escaladées » queues. Mounted only in the operator queue (« all »);
// never in a requester view. Writes only when the server says can_manage and the ticket is not
// resolved. Every read and write is fenced by the session identity (uid + generation) captured at
// its start and a per-request sequence: a late reply is dropped. Demo: nothing, zero calls.
import { useEffect, useRef, useState } from "react";
import { Field, Tag } from "../../app/ui";
import { dateTime, shortId } from "../../app/format";
import {
  REASON_MAX,
  TRIAGE_COPY,
  buildCommand,
  clearCommand,
  fetchOperators,
  fetchQueue,
  fetchTicket,
  newCommandId,
  parseOperators,
  parseQueue,
  parseReceipt,
  parseTicketTriage,
  pendingKey,
  persistCommand,
  postCommand,
  readCommand,
  readMessage,
  tabStore,
  type Context,
  type Operator,
  type Page,
  type QueueRow,
  type Store,
  type TicketTriage,
  type TriageCommand,
} from "./model";
import styles from "./support-triage.module.css";

type Fetcher = typeof fetch;
const defaultFetch: Fetcher = (...a) => fetch(...a);

/** Identity fence + mounted flag: `fresh()` is true only for the context captured at the start. */
function useFence(context: Context) {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return () => {
    const uid = context.userId(), gen = context.generation();
    return () => alive.current && context.userId() === uid && context.generation() === gen;
  };
}

type Load = { phase: "loading" | "ready" | "error" | "refused"; data: TicketTriage | null; message: string; more: "idle" | "loading" | "error" };

export function SupportTriagePanel({ ticketId, resolved, demo, context, fetcher = defaultFetch, store = tabStore }: { ticketId: string; resolved: boolean; demo: boolean; context: Context; fetcher?: Fetcher; store?: () => Store | null }) {
  const fence = useFence(context);
  const [load, setLoad] = useState<Load>({ phase: "loading", data: null, message: "", more: "idle" });
  const seq = useRef(0);
  const read = async () => {
    const my = ++seq.current;
    const fresh = fence();
    setLoad((s) => ({ ...s, phase: s.data ? s.phase : "loading", message: "", more: "idle" }));
    const r = await fetchTicket(fetcher, ticketId, null);
    if (!fresh() || my !== seq.current) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return setLoad({ phase: "refused", data: null, message: readMessage(r.status), more: "idle" });
    const p = r.status === 200 ? parseTicketTriage(r.body, ticketId, null) : null;
    setLoad(p ? { phase: "ready", data: p, message: "", more: "idle" } : { phase: "error", data: null, message: TRIAGE_COPY.loadFailed, more: "idle" });
  };
  const more = async () => {
    const cur = load.data;
    if (!cur || cur.next_after_version === null || load.more === "loading") return;
    const my = seq.current, after = cur.next_after_version;
    const fresh = fence();
    setLoad((s) => ({ ...s, more: "loading" }));
    const r = await fetchTicket(fetcher, ticketId, after);
    if (!fresh() || my !== seq.current) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return setLoad({ phase: "refused", data: null, message: readMessage(r.status), more: "idle" });
    const p = r.status === 200 ? parseTicketTriage(r.body, ticketId, after) : null;
    if (!p) return setLoad((s) => ({ ...s, more: "error" }));
    setLoad((s) => (s.data ? { ...s, more: "idle", data: { ...p, events: [...s.data.events, ...p.events.filter((e) => !s.data!.events.some((x) => x.id === e.id))] } } : s));
  };
  useEffect(() => {
    if (!demo) void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, ticketId]);
  if (demo) return null;

  const data = load.data;
  return (
    <section className="panel" aria-labelledby="support-triage-title" data-support-triage={load.phase}>
      <h2 id="support-triage-title" className={styles.title}>{TRIAGE_COPY.title}</h2>
      <p className={styles.hint}>{TRIAGE_COPY.internal}</p>
      {load.phase === "loading" && <p className={styles.hint} role="status">{TRIAGE_COPY.loading}</p>}
      {load.phase === "refused" && <p className={styles.hint} role="note" data-support-triage-refused="">{load.message}</p>}
      {load.phase === "error" && (
        <div role="alert" className={styles.row}>
          <p className="field-error">{load.message}</p>
          <button type="button" className="button outline" onClick={() => void read()}>{TRIAGE_COPY.retry}</button>
        </div>
      )}
      {load.phase === "ready" && data && (
        <>
          <dl className={styles.state}>
            <div>
              <dt>Attribution</dt>
              <dd data-support-triage-assignee="">
                {data.triage.assigned_to ? (
                  <>
                    {data.triage.assignee_name || "Opérateur"} · réf. {data.triage.assigned_to.slice(-8)}{data.triage.assigned_to === context.userId() ? " (vous)" : ""}
                    {!data.triage.assignee_active && <> {" "}<Tag tone="amber">{TRIAGE_COPY.inactive}</Tag></>}
                  </>
                ) : (
                  TRIAGE_COPY.unassigned
                )}
              </dd>
            </div>
            <div>
              <dt>Escalade</dt>
              <dd>{data.triage.escalated ? <Tag tone="red">{TRIAGE_COPY.escalated}</Tag> : TRIAGE_COPY.notEscalated}</dd>
            </div>
          </dl>
          <h3 className={styles.subtitle}>Historique du triage</h3>
          {data.events.length === 0 ? (
            <p className={styles.hint}>{TRIAGE_COPY.noEvents}</p>
          ) : (
            <ol className={styles.events} aria-label="Historique du triage">
              {data.events.map((e) => (
                <li key={e.id} data-support-triage-event={e.version}>
                  <strong>
                    {e.action === "assign" ? (e.assigned_to ? "Attribution" : "Attribution retirée") : e.escalated ? "Escalade" : "Escalade levée"}
                  </strong>
                  <span className={styles.hint}>
                    {dateTime(e.created_at)} · par l’opérateur {shortId(e.actor_id)} · version {e.version}
                  </span>
                  <span>Motif : {e.reason}</span>
                </li>
              ))}
            </ol>
          )}
          {data.next_after_version !== null && (
            <button type="button" className="button outline" disabled={load.more === "loading"} onClick={() => void more()}>
              {load.more === "loading" ? "Chargement…" : TRIAGE_COPY.more}
            </button>
          )}
          {load.more === "error" && <p className="field-error" role="alert">{TRIAGE_COPY.moreFailed}</p>}
          {resolved ? (
            <p className={styles.hint} data-support-triage-readonly="">{TRIAGE_COPY.readOnly}</p>
          ) : !data.can_manage ? (
            <p className={styles.hint} data-support-triage-readonly="">{TRIAGE_COPY.noManage}</p>
          ) : (
            <TriageCommands key={`${context.userId() ?? "-"}|${context.generation()}`} ticketId={ticketId} data={data} context={context} fetcher={fetcher} store={store} onChanged={() => void read()} />
          )}
        </>
      )}
    </section>
  );
}

type Send = { phase: "idle" | "sending" | "pending" | "done" | "error"; message: string };

function TriageCommands({ ticketId, data, context, fetcher, store, onChanged }: { ticketId: string; data: TicketTriage; context: Context; fetcher: Fetcher; store: () => Store | null; onChanged: () => void }) {
  const fence = useFence(context);
  const key = () => pendingKey(context.userId() ?? "-", context.generation(), ticketId);
  // A command left by this identity / generation for this ticket is offered again (same command).
  const [pending, setPending] = useState<TriageCommand | null>(() => readCommand(store(), key(), ticketId));
  const [send, setSend] = useState<Send>(pending ? { phase: "pending", message: TRIAGE_COPY.pending } : { phase: "idle", message: "" });
  const [action, setAction] = useState<"assign" | "unassign" | "escalation">("assign");
  const [operator, setOperator] = useState<Operator | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const inFlight = useRef(false);
  const t = data.triage;

  const post = async (cmd: TriageCommand) => {
    if (inFlight.current) return;
    inFlight.current = true;
    const fresh = fence();
    const k = key();
    try {
      if (!persistCommand(store(), k, cmd)) return setSend({ phase: "error", message: TRIAGE_COPY.storage });
      setPending(cmd);
      setSend({ phase: "sending", message: "" });
      const r = await postCommand(fetcher, cmd);
      if (!fresh()) return; // another identity / generation, or gone: never applied, never replayed
      if (r.status === 200 || r.status === 201) {
        const receipt = parseReceipt(r.body, cmd);
        if (receipt) {
          clearCommand(store(), k);
          setPending(null);
          setSend({ phase: "done", message: TRIAGE_COPY.done });
          setReason("");
          setOperator(null);
          return onChanged();
        }
      }
      if (r.status === 409) {
        clearCommand(store(), k);
        setPending(null);
        setSend({ phase: "error", message: TRIAGE_COPY.conflict });
        return onChanged(); // re-read only, never a replay
      }
      if (r.status === 400 || r.status === 401 || r.status === 403 || r.status === 404 || r.status === 422 || r.status === 429) {
        clearCommand(store(), k);
        setPending(null);
        setSend({ phase: "error", message: r.status === 401 ? TRIAGE_COPY.session : r.status === 403 || r.status === 404 ? TRIAGE_COPY.refused : r.status === 429 ? TRIAGE_COPY.limited : TRIAGE_COPY.invalid });
        if (r.status === 403 || r.status === 404) onChanged(); // rights re-read: the panel may become read-only
        return;
      }
      // Lost reply, timeout, 5xx, unverifiable receipt: the SAME command on an explicit retry.
      setSend({ phase: "pending", message: TRIAGE_COPY.pending });
    } finally {
      inFlight.current = false;
    }
  };
  const submit = () => {
    if (pending || inFlight.current) return;
    const text = reason.trim();
    if (!text || text.length > REASON_MAX) return setReasonError(TRIAGE_COPY.reasonError);
    if (action === "assign" && !operator) return setReasonError("Choisissez un opérateur.");
    setReasonError("");
    const commandId = newCommandId();
    if (!commandId) return setSend({ phase: "error", message: TRIAGE_COPY.noUuid });
    const cmd =
      action === "escalation"
        ? buildCommand({ ticketId, commandId, expectedVersion: t.version, reason: text, action: "set_escalated", escalated: !t.escalated })
        : buildCommand({ ticketId, commandId, expectedVersion: t.version, reason: text, action: "assign", assignedTo: action === "assign" ? operator!.id : null });
    if (!cmd) return setReasonError(TRIAGE_COPY.reasonError);
    void post(cmd);
  };
  const locked = send.phase === "sending" || Boolean(pending);
  return (
    <div className={styles.commands} data-support-triage-send={send.phase}>
      <fieldset className={styles.fieldset} disabled={locked}>
        <legend>Modifier le triage</legend>
        <div className={styles.row} role="radiogroup" aria-label="Action">
          <label className={styles.choice}><input type="radio" name={`triage-${ticketId}`} checked={action === "assign"} onChange={() => setAction("assign")} /> {TRIAGE_COPY.assign}</label>
          {t.assigned_to && <label className={styles.choice}><input type="radio" name={`triage-${ticketId}`} checked={action === "unassign"} onChange={() => setAction("unassign")} /> {TRIAGE_COPY.unassign}</label>}
          <label className={styles.choice}><input type="radio" name={`triage-${ticketId}`} checked={action === "escalation"} onChange={() => setAction("escalation")} /> {t.escalated ? TRIAGE_COPY.restore : TRIAGE_COPY.escalate}</label>
        </div>
        {action === "assign" && <OperatorPicker context={context} fetcher={fetcher} selected={operator} onSelect={setOperator} current={t.assigned_to} />}
        <Field label={TRIAGE_COPY.reason} error={reasonError || undefined}>
          <textarea rows={2} maxLength={REASON_MAX} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <button type="button" className="button primary" onClick={submit}>
          {send.phase === "sending" ? TRIAGE_COPY.sending : action === "assign" ? TRIAGE_COPY.assign : action === "unassign" ? TRIAGE_COPY.unassign : t.escalated ? TRIAGE_COPY.restore : TRIAGE_COPY.escalate}
        </button>
      </fieldset>
      {send.phase === "sending" && <p className={styles.hint} role="status">{TRIAGE_COPY.sending}</p>}
      {send.phase === "done" && <p className={styles.ok} role="status">{send.message}</p>}
      {(send.phase === "error" || send.phase === "pending") && (
        <div role="alert" className={styles.row}>
          <p className="field-error">{send.message}</p>
          {send.phase === "pending" && pending && (
            <button type="button" className="button outline" onClick={() => void post(pending)}>{TRIAGE_COPY.retry}</button>
          )}
        </div>
      )}
    </div>
  );
}

function OperatorPicker({ context, fetcher, selected, onSelect, current }: { context: Context; fetcher: Fetcher; selected: Operator | null; onSelect: (o: Operator) => void; current: string | null }) {
  const fence = useFence(context);
  const [state, setState] = useState<{ phase: "loading" | "ready" | "error" | "refused"; rows: Operator[]; next: string | null; more: boolean; message: string }>({ phase: "loading", rows: [], next: null, more: false, message: "" });
  const seq = useRef(0);
  const load = async (after: string | null) => {
    const my = after ? seq.current : ++seq.current;
    const fresh = fence();
    setState((s) => (after ? { ...s, more: true, message: "" } : { phase: "loading", rows: [], next: null, more: false, message: "" }));
    const r = await fetchOperators(fetcher, after);
    if (!fresh() || my !== seq.current) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return setState({ phase: "refused", rows: [], next: null, more: false, message: readMessage(r.status) });
    const p: Page<Operator> | null = r.status === 200 ? parseOperators(r.body, after) : null;
    if (!p) return setState((s) => ({ ...s, phase: after ? s.phase : "error", more: false, message: TRIAGE_COPY.operatorsFailed }));
    setState((s) => ({ phase: "ready", rows: after ? [...s.rows, ...p.rows.filter((x) => !s.rows.some((y) => y.id === x.id))] : p.rows, next: p.next_cursor, more: false, message: "" }));
  };
  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={styles.picker} data-support-triage-operators={state.phase}>
      <p className={styles.label}>{TRIAGE_COPY.pickOperator}</p>
      {state.phase === "loading" && <p className={styles.hint} role="status">{TRIAGE_COPY.operatorsLoading}</p>}
      {state.phase === "refused" && <p className={styles.hint}>{state.message}</p>}
      {state.phase === "ready" && state.rows.length === 0 && <p className={styles.hint}>{TRIAGE_COPY.operatorsEmpty}</p>}
      <div className={styles.options}>
        {state.rows.map((o) => (
          <label key={o.id} className={styles.choice}>
            <input type="radio" name="triage-operator" aria-label={`${o.name || "Opérateur"} · référence ${o.id}${o.id === context.userId() ? " (vous)" : ""}${o.id === current ? " (déjà attribuée)" : ""}`} checked={selected?.id === o.id} disabled={o.id === current} onChange={() => onSelect(o)} />
            {o.name || "Opérateur"} · réf. {o.id.slice(-8)}{o.id === context.userId() ? " (vous)" : ""}{o.id === current ? " (déjà attribuée)" : ""}
          </label>
        ))}
      </div>
      {state.message && state.phase !== "refused" && (
        <div role="alert" className={styles.row}>
          <p className="field-error">{state.message}</p>
          <button type="button" className="button outline" onClick={() => void load(state.phase === "ready" ? state.next : null)}>{TRIAGE_COPY.retry}</button>
        </div>
      )}
      {state.phase === "ready" && state.next && !state.message && (
        <button type="button" className="button outline" disabled={state.more} onClick={() => void load(state.next)}>
          {state.more ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </div>
  );
}

/** « Mes attributions » / « Escaladées »: active tickets, UUID order, 50 per page; a row opens it. */
export function SupportTriageQueues({ demo, context, onOpen, fetcher = defaultFetch }: { demo: boolean; context: Context; onOpen: (ticketId: string) => void; fetcher?: Fetcher }) {
  const fence = useFence(context);
  const [queue, setQueue] = useState<"mine" | "escalated">("mine");
  const [state, setState] = useState<{ phase: "loading" | "ready" | "error" | "refused"; rows: QueueRow[]; next: string | null; more: boolean; message: string }>({ phase: "loading", rows: [], next: null, more: false, message: "" });
  const seq = useRef(0);
  const load = async (which: "mine" | "escalated", after: string | null) => {
    const my = after ? seq.current : ++seq.current;
    const fresh = fence();
    setState((s) => (after ? { ...s, more: true, message: "" } : { phase: "loading", rows: [], next: null, more: false, message: "" }));
    const r = await fetchQueue(fetcher, which, after);
    if (!fresh() || my !== seq.current) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return setState({ phase: "refused", rows: [], next: null, more: false, message: readMessage(r.status) });
    const p = r.status === 200 ? parseQueue(r.body, after) : null;
    if (!p) return setState((s) => ({ ...s, phase: after ? s.phase : "error", more: false, message: TRIAGE_COPY.queueFailed }));
    setState((s) => ({ phase: "ready", rows: after ? [...s.rows, ...p.rows.filter((x) => !s.rows.some((y) => y.id === x.id))] : p.rows, next: p.next_cursor, more: false, message: "" }));
  };
  useEffect(() => {
    if (!demo) void load(queue, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo, queue]);
  if (demo) return null;
  return (
    <section className="panel" aria-labelledby="support-triage-queues-title" data-support-triage-queue={queue}>
      <h2 id="support-triage-queues-title" className={styles.title}>{TRIAGE_COPY.queuesTitle}</h2>
      <div className={styles.row} role="tablist" aria-label="Files de triage">
        {(["mine", "escalated"] as const).map((q) => (
          <button key={q} type="button" role="tab" aria-selected={queue === q} className={`button ${queue === q ? "primary" : "outline"}`} onClick={() => setQueue(q)}>
            {q === "mine" ? TRIAGE_COPY.mine : TRIAGE_COPY.escalatedQueue}
          </button>
        ))}
      </div>
      {state.phase === "loading" && <p className={styles.hint} role="status">Lecture de la file…</p>}
      {state.phase === "refused" && <p className={styles.hint}>{state.message}</p>}
      {state.phase === "ready" && state.rows.length === 0 && <p className={styles.hint}>{TRIAGE_COPY.queueEmpty[queue]}</p>}
      {state.rows.length > 0 && (
        <ul className={styles.queue}>
          {state.rows.map((row) => (
            <li key={row.id}>
              <button type="button" className="text-button" onClick={() => onOpen(row.id)} data-support-triage-row={row.id}>
                {row.subject}
              </button>
              {row.escalated && <Tag tone="red">{TRIAGE_COPY.escalated}</Tag>}
            </li>
          ))}
        </ul>
      )}
      {state.message && state.phase !== "refused" && (
        <div role="alert" className={styles.row}>
          <p className="field-error">{state.message}</p>
          <button type="button" className="button outline" onClick={() => void load(queue, state.phase === "ready" ? state.next : null)}>{TRIAGE_COPY.retry}</button>
        </div>
      )}
      {state.phase === "ready" && state.next && !state.message && (
        <button type="button" className="button outline" disabled={state.more} onClick={() => void load(queue, state.next)}>
          {state.more ? "Chargement…" : "Afficher plus"}
        </button>
      )}
    </section>
  );
}
