"use client";
// ENT-12 UI: SitePolicyPanel (explicit, versioned site approval policy; edit only with can_manage)
// and QuoteApprovalPanel (ordered chain of the EXACT quote as the server returns it; actions only from
// the server permissions; later steps locked; never an acceptance). StrictMode-safe, fenced writes.
import { readRefused } from "../../app/refusal";
import { useEffect, useId, useRef, useState } from "react";
import { money } from "../../app/format";
import {
  ACTION_DONE,
  ACTION_LABEL,
  COPY,
  STEP_STATUS,
  WRITER_INITIAL,
  buildAction,
  buildPolicy,
  chain,
  createApApi,
  createWriter,
  parsePolicyReceipt,
  parsePolicyStatus,
  parseWorkflowReceipt,
  parseWorkflowStatus,
  schemas,
  tabStore,
  type Action,
  type ApApi,
  type Context,
  type PolicyCommand,
  type PolicyStatus,
  type Step,
  type Store,
  type WorkflowCommand,
  type WorkflowStatus,
  type WriterState,
} from "./model";
import styles from "./approvals.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
export type Member = { id: string; label: string };
const stepLabel = (s: Step, members: Member[] | null) => ("role" in s ? (s.role === "owner" ? "Propriétaire de l’organisation" : "Gestionnaire du site") : members?.find((m) => m.id.toLowerCase() === s.user_id.toLowerCase())?.label ?? `Membre ${s.user_id.slice(0, 8)}`);
type Deps = { context: Context; api?: ApApi; store?: () => Store | null; newId?: () => string | null; demo?: boolean; loadMembers?: () => Promise<Member[] | null> };

function useMembers(loader?: () => Promise<Member[] | null>) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const ref = useRef(loader);
  useEffect(() => {
    let active = true;
    void ref.current?.().then((m) => active && setMembers(m), () => active && setMembers(null));
    return () => {
      active = false;
    };
  }, []);
  return members;
}
function useWriter<C extends { command_id: string; expected_version: number | null }>(make: (get: () => WriterState, set: (s: WriterState) => void) => ReturnType<typeof createWriter<C>>) {
  const [state, setRaw] = useState<WriterState>(WRITER_INITIAL);
  const ref = useRef(state);
  const set = (s: WriterState) => {
    ref.current = s;
    setRaw(s);
  };
  const w = useRef<ReturnType<typeof createWriter<C>> | null>(null);
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    const writer = makeRef.current(() => ref.current, set);
    w.current = writer;
    writer.restore();
    return () => {
      writer.stop();
      if (w.current === writer) w.current = null;
    };
  }, []);
  return { state, run: (c: C) => w.current?.run(c) ?? Promise.resolve(false), retry: () => void w.current?.retry() };
}
function Feedback({ state, onRetry }: { state: WriterState; onRetry: () => void }) {
  return (
    <>
      {state.notice && <p className={styles.text} role="status" data-ap-notice="">{state.notice}</p>}
      {state.error && (
        <div role="alert" data-ap-error="">
          <p className={styles.error}>{state.error}</p>
          {state.pending !== null && (
            <button type="button" className={styles.button} disabled={state.busy} onClick={onRetry} data-ap-retry="">
              {state.busy ? "Envoi…" : "Réessayer la même commande"}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---- Site policy ----------------------------------------------------------------------------------
export function SitePolicyPanel(props: Deps & { siteId: string; initial?: PolicyStatus | null }) {
  if (props.demo)
    return (
      <div className={styles.block} data-ap-policy="demo">
        <p className={styles.muted}>{COPY.demo}</p>
      </div>
    );
  return <Policy key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.siteId}`} {...props} />;
}
function Policy({ siteId, context, api, store = tabStore, newId = uuid, loadMembers, initial }: Deps & { siteId: string; initial?: PolicyStatus | null }) {
  const uid = useId();
  const [status, setStatus] = useState<PolicyStatus | null | "error" | "forbidden" | undefined>(initial === undefined ? undefined : initial);
  const client = useRef<ApApi | null>(null);
  const getApi = () => (client.current ??= api ?? createApApi());
  const members = useMembers(loadMembers);
  const load = async () => {
    const gen = context.generation(), who = context.userId();
    const r = await getApi().policy(siteId);
    if (context.generation() !== gen || context.userId() !== who) return;
    if (r.status === 401 || r.status === 403) return setStatus("forbidden");
    setStatus(r.status === 200 ? parsePolicyStatus(r.body, siteId) ?? "error" : "error");
  };
  useEffect(() => {
    if (initial === undefined) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writer = useWriter<PolicyCommand>((get, set) =>
    createWriter({ scope: `site:${siteId.toLowerCase()}`, schema: schemas.policyCommand, post: (c) => getApi().setPolicy(siteId, c), receipt: (b, c) => parsePolicyReceipt(b, siteId, c), store: () => store(), context, get, set, after: load, onForbidden: () => setStatus("forbidden"), notice: () => COPY.saved }),
  );
  const [form, setForm] = useState<{ enabled: boolean; threshold: string; steps: Step[] } | null>(null);
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState(false);
  if (status === undefined) return <p className={styles.muted} role="status">{COPY.loading}</p>;
  if (status === "forbidden") return null;
  if (status === "error" || status === null)
    return (
      <div role="alert">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void load()}>Réessayer</button>
      </div>
    );
  const p = status.policy;
  const locked = writer.state.busy || writer.state.pending !== null;
  const f = form ?? { enabled: p?.enabled ?? true, threshold: p ? String(p.threshold_cents / 100).replace(".", ",") : "", steps: p?.steps ?? [{ role: "owner" }] };
  const setStep = (i: number, value: string) => setForm({ ...f, steps: f.steps.map((s, j) => (j === i ? (value === "owner" || value === "manager" ? { role: value } : { user_id: value }) : s)) });
  return (
    <section className={styles.block} aria-labelledby={`${uid}-t`} data-ap-policy="ready">
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.policyTitle}</h3>
      {p ? (
        <>
          <p className={styles.text} data-ap-policy-version={p.version}>
            {p.enabled ? `Actif · au-delà de ${money(p.threshold_cents)} TTC · version ${p.version}` : COPY.policyDisabled}
          </p>
          <ol className={styles.steps}>
            {p.steps.map((s, i) => (
              <li key={i}>Étape {i + 1} : {stepLabel(s, members)}</li>
            ))}
          </ol>
        </>
      ) : (
        <p className={styles.muted}>{COPY.policyNone}</p>
      )}
      <p className={styles.muted}>{COPY.policyNote}</p>
      <Feedback state={writer.state} onRetry={writer.retry} />
      {status.can_manage && (
        <form
          className={styles.form}
          noValidate
          data-ap-policy-form=""
          onSubmit={(e) => {
            e.preventDefault();
            const cid = newId();
            if (!cid) return setFormError(COPY.noUuid);
            if (!buildPolicy(f, cid, p?.version ?? null)) return setFormError("Seuil en euros (0 à 1 000 000) et 1 à 10 étapes requis.");
            setFormError("");
            setConfirm(true);
          }}
        >
          <label className={styles.check}>
            <input type="checkbox" checked={f.enabled} onChange={(e) => setForm({ ...f, enabled: e.target.checked })} disabled={locked} />
            Circuit actif
          </label>
          <label className={styles.label} htmlFor={`${uid}-th`}>Seuil TTC (€), explicite</label>
          <input id={`${uid}-th`} className={styles.input} inputMode="decimal" value={f.threshold} onChange={(e) => setForm({ ...f, threshold: e.target.value })} disabled={locked} />
          {f.steps.map((s, i) => (
            <div key={i} className={styles.row} data-ap-step-edit={i}>
              <label className={styles.muted} htmlFor={`${uid}-s${i}`}>Étape {i + 1}</label>
              <select id={`${uid}-s${i}`} className={styles.input} value={"role" in s ? s.role : s.user_id} onChange={(e) => setStep(i, e.target.value)} disabled={locked}>
                <option value="owner">Propriétaire de l’organisation</option>
                <option value="manager">Gestionnaire du site</option>
                {(members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>Membre nommé : {m.label}</option>
                ))}
                {!("role" in s) && !(members ?? []).some((m) => m.id === s.user_id) && <option value={s.user_id}>Membre {s.user_id.slice(0, 8)}</option>}
              </select>
              <button type="button" className={styles.button} disabled={locked || f.steps.length <= 1} onClick={() => setForm({ ...f, steps: f.steps.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
          <button type="button" className={styles.button} disabled={locked || f.steps.length >= 10} onClick={() => setForm({ ...f, steps: [...f.steps, { role: "manager" }] })}>Ajouter une étape</button>
          {formError && <small className={styles.error}>{formError}</small>}
          <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={locked} data-ap-policy-save="">Enregistrer le circuit…</button>
          {confirm && (
            <div className={styles.confirm} role="alertdialog" aria-label="Confirmer le circuit" data-ap-policy-confirm="">
              <p>Enregistrer ce circuit ({f.steps.length} étape{f.steps.length > 1 ? "s" : ""}, seuil {f.threshold} € TTC) ? Il remplace la règle simple du site ; les devis déjà acceptés ne sont pas concernés.</p>
              <div className={styles.row}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={locked}
                  onClick={() => {
                    const cid = newId();
                    const cmd = cid ? buildPolicy(f, cid, p?.version ?? null) : null;
                    if (!cmd) return setConfirm(false);
                    void writer.run(cmd).then((ok) => {
                      setConfirm(false);
                      if (ok) setForm(null);
                    });
                  }}
                  data-ap-policy-execute=""
                >
                  Confirmer
                </button>
                <button type="button" className={styles.button} disabled={writer.state.busy} onClick={() => setConfirm(false)}>Annuler</button>
              </div>
            </div>
          )}
        </form>
      )}
    </section>
  );
}

// ---- Quote approval chain ---------------------------------------------------------------------------
export function QuoteApprovalPanel(props: Deps & { quoteId: string; onStatus?: (s: WorkflowStatus | null) => void; initial?: WorkflowStatus | null }) {
  if (props.demo)
    return (
      <div className={styles.block} data-ap-quote="demo">
        <p className={styles.muted}>{COPY.demo}</p>
      </div>
    );
  return <Quote key={`${props.context.userId() ?? "-"}|${props.context.generation()}|${props.quoteId}`} {...props} />;
}
function Quote({ quoteId, context, api, store = tabStore, newId = uuid, loadMembers, onStatus, initial }: Deps & { quoteId: string; onStatus?: (s: WorkflowStatus | null) => void; initial?: WorkflowStatus | null }) {
  const uid = useId();
  const [status, setStatus] = useState<WorkflowStatus | null | "error" | "forbidden" | undefined>(initial === undefined ? undefined : initial);
  const [events, setEvents] = useState<WorkflowStatus["events"]>(initial ? initial.events : []);
  const client = useRef<ApApi | null>(null);
  const getApi = () => (client.current ??= api ?? createApApi());
  const members = useMembers(loadMembers);
  const cb = useRef(onStatus);
  cb.current = onStatus;
  // Callbacks only while THIS mount is alive (A→B→A, or a late reply of an unmounted A, never
  // reaches the parent); only the latest load of this mount applies (causal order kept).
  const alive = useRef(true);
  const loadSeq = useRef(0);
  const report = (st: WorkflowStatus | null) => {
    if (alive.current) cb.current?.(st);
  };
  const load = async () => {
    const my = ++loadSeq.current;
    const gen = context.generation(), who = context.userId();
    const r = await getApi().workflow(quoteId, null);
    if (!alive.current || my !== loadSeq.current || context.generation() !== gen || context.userId() !== who) return;
    if (readRefused(r.status)) {
      // P1 (E20): 401/403/404 purge the history and the decision actions.
      setStatus("forbidden");
      setEvents([]);
      report(null);
      return;
    }
    const s = r.status === 200 ? parseWorkflowStatus(r.body, quoteId, 0) : null;
    setStatus(s ?? "error");
    if (s) setEvents(s.events);
    report(s);
  };
  const more = async (after: number) => {
    const r = await getApi().workflow(quoteId, after);
    if (readRefused(r.status)) {
      setStatus("forbidden");
      setEvents([]);
      report(null);
      return;
    }
    const s = r.status === 200 ? parseWorkflowStatus(r.body, quoteId, after) : null;
    if (s) {
      setEvents((e) => [...e, ...s.events]);
      setStatus((cur) => (cur && typeof cur === "object" ? { ...cur, next_after: s.next_after } : cur));
    }
  };
  useEffect(() => {
    alive.current = true;
    if (initial === undefined) void load();
    else report(initial);
    return () => {
      alive.current = false;
      loadSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const writer = useWriter<WorkflowCommand>((get, set) =>
    createWriter({ scope: `quote:${quoteId.toLowerCase()}`, schema: schemas.workflowCommand, post: (c) => getApi().act(quoteId, c), receipt: (b, c) => parseWorkflowReceipt(b, quoteId, c), store: () => store(), context, get, set, after: load, onForbidden: () => {
      loadSeq.current++;
      setStatus("forbidden");
      report(null); // a 401/403 on a write makes the state undetermined for the parent too
    }, notice: (c) => ACTION_DONE[c.action] }),
  );
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [noteError, setNoteError] = useState("");
  if (status === undefined) return <p className={styles.muted} role="status" data-ap-quote="loading">{COPY.loading}</p>;
  if (status === "forbidden") return <p className={styles.muted} data-ap-quote="forbidden">{COPY.forbidden}</p>;
  if (status === "error" || status === null)
    return (
      <div role="alert" data-ap-quote="error">
        <p className={styles.error}>{COPY.loadFailed}</p>
        <button type="button" className={styles.button} onClick={() => void load()}>Réessayer</button>
      </div>
    );
  const s = status, w = s.workflow;
  const locked = writer.state.busy || writer.state.pending !== null;
  const actions: Action[] = [
    ...(s.permissions.can_submit ? (["submit"] as Action[]) : []),
    ...(s.permissions.can_decide && w && (w.state === "pending") ? (["approve", "reject", "request_information"] as Action[]) : []),
    ...(s.permissions.can_respond && w && w.state === "changes_requested" ? (["respond"] as Action[]) : []),
  ];
  const readOnly = actions.length === 0;
  const execute = (a: Action) => {
    const cid = newId();
    const cmd = cid ? buildAction(a, note, cid, w?.version ?? null) : null;
    if (!cmd) return setNoteError(cid ? COPY.noteRequired : COPY.noUuid);
    setNoteError("");
    void writer.run(cmd).then((ok) => {
      setConfirm(null);
      if (ok) setNote("");
    });
  };
  return (
    <section className={styles.block} aria-labelledby={`${uid}-t`} data-ap-quote="ready" data-ap-required={s.required ? "yes" : "no"}>
      <h3 id={`${uid}-t`} className={styles.title}>{COPY.quoteTitle}</h3>
      {!s.required && !w && <p className={styles.muted} data-ap-not-required="">{COPY.notRequired}</p>}
      {s.required && !w && <p className={styles.text} data-ap-not-submitted="">{COPY.notSubmitted}</p>}
      {s.approved_current && <p className={styles.text} data-ap-approved="">{COPY.approved}</p>}
      {w && !w.snapshot_matches && <p className={styles.warning} role="note" data-ap-snapshot="">{COPY.snapshotChanged}</p>}
      {w && (
        <ol className={styles.chain} aria-label="Étapes d’approbation" data-ap-chain="">
          {chain(w).map((v) => (
            <li key={v.index} className={styles[v.status]} data-ap-step={v.index} data-ap-step-status={v.status} aria-current={v.status === "current" ? "step" : undefined}>
              <strong>Étape {v.index} · {stepLabel(v.step, members)}</strong>
              <span>{STEP_STATUS[v.status]}</span>
            </li>
          ))}
        </ol>
      )}
      <Feedback state={writer.state} onRetry={writer.retry} />
      {readOnly ? (
        (w || s.required) && <p className={styles.muted} data-ap-readonly="">{COPY.readOnly}</p>
      ) : (
        <div className={styles.form} data-ap-actions="">
          <label className={styles.label} htmlFor={`${uid}-n`}>Commentaire {actions.some((a) => a === "reject" || a === "request_information" || a === "respond") ? "(obligatoire pour rejeter, demander un complément ou répondre)" : "(facultatif)"}</label>
          <textarea id={`${uid}-n`} className={styles.input} rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} />
          {noteError && <small className={styles.error}>{noteError}</small>}
          <div className={styles.row}>
            {actions.map((a) => (
              <button key={a} type="button" className={`${styles.button} ${a === "approve" || a === "submit" ? styles.primary : ""}`} disabled={locked} onClick={() => setConfirm(a)} data-ap-action={a}>
                {a === "submit" ? (w ? "Soumettre à nouveau…" : "Soumettre au circuit…") : a === "approve" ? "Approuver l’étape…" : a === "reject" ? "Rejeter…" : a === "request_information" ? "Demander un complément…" : "Répondre…"}
              </button>
            ))}
          </div>
          {confirm && (
            <div className={styles.confirm} role="alertdialog" aria-label="Confirmer l’action" data-ap-confirm={confirm}>
              <p>
                {ACTION_LABEL[confirm]} pour cette version exacte du devis{w ? ` (circuit version ${w.version})` : ""}.{confirm === "submit" && w ? ` ${COPY.resubmitNote}` : ""} {confirm === "approve" ? "Une approbation interne n’accepte pas le devis." : ""}
              </p>
              <div className={styles.row}>
                <button type="button" className={`${styles.button} ${styles.primary}`} disabled={locked} onClick={() => execute(confirm)} data-ap-execute="">Confirmer</button>
                <button type="button" className={styles.button} disabled={writer.state.busy} onClick={() => setConfirm(null)}>Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}
      <details className={styles.events}>
        <summary>Historique ({events.length} affiché{events.length > 1 ? "s" : ""})</summary>
        {events.length === 0 && <p className={styles.muted}>{COPY.noEvents}</p>}
        <ul className={styles.list}>
          {events.map((e) => (
            <li key={e.version} data-ap-event={e.version}>
              {ACTION_LABEL[e.action]} · {members?.find((m) => m.id.toLowerCase() === e.actor_id.toLowerCase())?.label ?? `Membre ${e.actor_id.slice(0, 8)}`} · {when(e.created_at)}
              {e.note && <span className={styles.note}> — {e.note}</span>}
            </li>
          ))}
        </ul>
        {s.next_after !== null && <button type="button" className={styles.button} onClick={() => void more(s.next_after!)}>Afficher la suite</button>}
      </details>
    </section>
  );
}
