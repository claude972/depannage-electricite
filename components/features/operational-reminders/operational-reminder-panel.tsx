"use client";
// Personal deadline reminder (SYS-04 / ART-03 / ENT-14): one panel, two entry points —
// CredentialReminderPanel (artisan « Mes documents ») and ComplianceReminderPanel (enterprise site
// compliance). State, eligibility and permissions are shown exactly as the server returns them;
// schedule needs an explicit Martinique date + time (nothing proposed); cancel needs a confirmation.
// Commands fenced under courant-private-op-reminders:. Demo: honest note, zero calls. Logic: ./model.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { COPY, ELIGIBILITY, STATUS, VIEW_INITIAL, createReminder, formatDay, tabStore, type Context, type Kind, type Store, type View } from "./model";
import styles from "./operational-reminders.module.css";

type Common = { context: Context; demo: boolean; fetcher?: typeof fetch; store?: () => Store | null; newId?: () => string | null; now?: () => number };
export type CredentialReminderPanelProps = Common & { credentialId: string };
export type ComplianceReminderPanelProps = Common & { complianceId: string };

export function CredentialReminderPanel({ credentialId, ...rest }: CredentialReminderPanelProps) {
  return <ReminderPanel kind="credential" id={credentialId} {...rest} />;
}
export function ComplianceReminderPanel({ complianceId, ...rest }: ComplianceReminderPanelProps) {
  return <ReminderPanel kind="compliance" id={complianceId} {...rest} />;
}

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

function ReminderPanel(props: Common & { kind: Kind; id: string }) {
  const { context, demo, kind, id } = props;
  if (demo)
    return (
      <div className={styles.panel} data-op-reminder="demo" data-kind={kind}>
        <strong className={styles.title}>{COPY.title}</strong>
        <p className={styles.hint}>{COPY.demo}</p>
      </div>
    );
  return <Live key={`${kind}|${id}|${context.userId() ?? "-"}|${context.generation()}`} {...props} />;
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

function Live({ kind, id, context, fetcher, store = tabStore, newId = uuid, now }: Common & { kind: Kind; id: string }) {
  const [view, setRaw] = useState<View>(VIEW_INITIAL);
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ fetcher, store, newId, context, now });
  latest.current = { fetcher, store, newId, context, now };
  const ctrl = useRef<ReturnType<typeof createReminder> | null>(null);
  ctrl.current ??= createReminder({
    kind,
    id,
    fetcher: () => latest.current.fetcher ?? ((...a) => fetch(...a)),
    store: () => latest.current.store(),
    newId: () => latest.current.newId(),
    context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
    now: () => (latest.current.now ?? Date.now)(),
    get: () => ref.current,
    set,
  });
  const c = ctrl.current;
  useEffect(() => {
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const wait = useWait(view.pending ? view.waitS : null, view.error);
  const d = view.data;
  const rec = d?.record ?? null;
  const fid = `op-rem-${kind}-${id}`;
  const blocked = view.busy || Boolean(view.pending);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const ok = await c.schedule(date, time);
    if (ok) {
      setDate("");
      setTime("");
    }
  };

  return (
    <div className={styles.panel} data-op-reminder={view.phase} data-kind={kind} aria-busy={view.busy || undefined}>
      <strong className={styles.title}>{COPY.title}</strong>
      <p className={styles.hint}>{COPY.intro}</p>
      {view.phase === "loading" && <p className={styles.hint} role="status">{COPY.loading}</p>}
      {view.phase === "forbidden" && <p className={styles.note} role="alert" data-op-reminder-forbidden="">{view.error}</p>}
      {view.phase === "error" && (
        <div className={styles.note} role="alert">
          <p className={styles.error}>{view.error}</p>
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </div>
      )}
      {d && view.phase === "ready" && (
        <>
          <p className={styles.line} data-op-eligibility={d.eligibility}>{ELIGIBILITY[d.eligibility](d.source.due_on)}</p>
          {rec && (
            <p className={styles.line} data-op-status={rec.status}>
              <span className={styles.label}>Dernier rappel :</span> {STATUS[rec.status](rec)}
              {rec.status === "scheduled" && !d.scheduled_for_current_source && " Il ne correspond plus à l’échéance actuelle."}
            </p>
          )}
          {rec?.status === "scheduled" && (
            confirmCancel ? (
              <div className={styles.confirm} role="group" aria-labelledby={`${fid}-cancel`}>
                <p id={`${fid}-cancel`}>Annuler ce rappel ? Une notification déjà émise n’est pas effacée.</p>
                <div className={styles.actions}>
                  <button type="button" className={styles.danger} disabled={blocked} onClick={async () => { setConfirmCancel(false); await c.cancel(); }}>Confirmer l’annulation</button>
                  <button type="button" className={styles.secondary} onClick={() => setConfirmCancel(false)}>Garder le rappel</button>
                </div>
              </div>
            ) : (
              <button type="button" className={styles.secondary} disabled={blocked} onClick={() => setConfirmCancel(true)}>Annuler le rappel</button>
            )
          )}
          {d.can_schedule && d.source.due_on && (
            <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate aria-labelledby={`${fid}-form`}>
              <p id={`${fid}-form`} className={styles.label}>
                {rec?.status === "scheduled" ? "Reprogrammer" : "Programmer"} un rappel avant le {formatDay(d.source.due_on)} (heure de Martinique)
              </p>
              <div className={styles.row}>
                <label className={styles.field}>Date<input type="date" value={date} max={d.source.due_on} onChange={(e) => setDate(e.target.value)} disabled={blocked} /></label>
                <label className={styles.field}>Heure<input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={blocked} /></label>
              </div>
              <button type="submit" className={styles.primary} disabled={blocked}>Enregistrer le rappel</button>
            </form>
          )}
        </>
      )}
      {view.busy && <p className={styles.hint} role="status">Envoi…</p>}
      {view.notice && <p className={styles.ok} role="status" data-op-notice="">{view.notice}</p>}
      {view.phase === "ready" && view.error && (
        <div className={styles.note} role="alert" data-op-error="">
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
