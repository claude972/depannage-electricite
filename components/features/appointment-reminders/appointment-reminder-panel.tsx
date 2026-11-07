"use client";
// Personal in-app appointment reminder (client or artisan). The person picks an explicit LOCAL date
// and time before the appointment (timezone shown); the panel shows the REAL server state
// (scheduled — only promised when it targets the current slot —, sent, muted, invalidated,
// expired, cancelled) and lets them cancel / reschedule. No external channel, no exact-minute
// promise. Writes are identity-fenced commands (see ./model). Demo: no call. StrictMode-safe.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { COPY, STALE_SCHEDULED, STATUS_TEXT, VIEW_INITIAL, createReminderApi, createReminderController, localTimeZone, localToInstant, remindAtAllowed, tabStore, type ReminderApi, type ReminderContext, type Store, type View } from "./model";
import styles from "./appointment-reminder.module.css";

const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export type AppointmentReminderProps = {
  interventionId: string;
  role: "client" | "artisan";
  context: ReminderContext;
  demo?: boolean;
  api?: ReminderApi;
  store?: () => Store | null;
  newId?: () => string | null;
  now?: () => number;
  /** Tests only. */
  initial?: View;
};

export function AppointmentReminderPanel(props: AppointmentReminderProps) {
  if (props.demo)
    return (
      <section className={styles.panel} aria-labelledby={`reminder-${props.interventionId}`} data-appointment-reminder="demo">
        <h3 id={`reminder-${props.interventionId}`}>Rappel de rendez-vous</h3>
        <p className={styles.note}>{COPY.demo}</p>
        <p className={styles.hint}>{COPY.channel}</p>
      </section>
    );
  return <Live {...props} />;
}

function Live({ interventionId, role, context, api, store = tabStore, newId = uuid, now = Date.now, initial }: AppointmentReminderProps) {
  const [view, setRaw] = useState<View>(initial ?? VIEW_INITIAL);
  const ref = useRef(view);
  const set = (v: View) => {
    ref.current = v;
    setRaw(v);
  };
  const latest = useRef({ api, store, newId, context });
  latest.current = { api, store, newId, context };
  const ctrl = useRef<ReturnType<typeof createReminderController> | null>(null);
  if (!ctrl.current) {
    let client: ReminderApi | null = null;
    ctrl.current = createReminderController({
      interventionId,
      api: () => (client ??= latest.current.api ?? createReminderApi(interventionId)),
      store: () => latest.current.store(),
      newId: () => latest.current.newId(),
      context: { generation: () => latest.current.context.generation(), userId: () => latest.current.context.userId() },
      get: () => ref.current,
      set,
    });
  }
  const c = ctrl.current;
  // StrictMode runs effects twice: the first read happens once per mount.
  const started = useRef(false);
  useEffect(() => {
    if (initial || started.current) return;
    started.current = true;
    c.restorePending();
    void c.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [formError, setFormError] = useState("");
  const tz = localTimeZone();
  const d = view.data;
  const record = d?.record ?? null;
  const editable = Boolean(d?.can_schedule && d.appointment);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!d?.appointment) return;
    const instant = localToInstant(date, time);
    if (!instant || !remindAtAllowed(instant, d.appointment.starts_at, now())) return setFormError(COPY.pickBefore);
    setFormError("");
    void c.schedule(instant);
  };

  return (
    <section className={styles.panel} aria-labelledby={`reminder-${interventionId}`} data-appointment-reminder={view.phase} data-role={role} aria-busy={view.busy || view.phase === "loading" || undefined}>
      <h3 id={`reminder-${interventionId}`}>Rappel de rendez-vous</h3>
      <p className={styles.hint}>{COPY.channel}</p>
      {view.phase === "loading" && <p className={styles.hint} role="status">Vérification du rappel…</p>}
      {view.phase === "forbidden" && <p className={styles.note} data-reminder-forbidden="">{COPY.forbidden}</p>}
      {view.phase === "error" && (
        <p className={styles.error} role="alert">
          {view.error}{" "}
          <button type="button" className={styles.secondary} onClick={() => void c.load()}>Réessayer</button>
        </p>
      )}
      {view.notice && <p className={styles.ok} role="status">{view.notice}</p>}
      {view.phase === "ready" && view.error && (
        <div className={styles.error} role="alert" data-reminder-error="">
          {view.error}{" "}
          {view.pending ? (
            <button type="button" className={styles.secondary} disabled={view.busy} onClick={() => void c.retry()} data-reminder-retry="">Réessayer</button>
          ) : (
            <button type="button" className={styles.secondary} disabled={view.busy} onClick={() => void c.load()} data-reminder-reload="">Recharger</button>
          )}
        </div>
      )}

      {view.phase === "ready" && d && (
        <>
          {d.appointment ? (
            <p data-reminder-appointment="">Rendez-vous : {dayTime(d.appointment.starts_at)}.</p>
          ) : null}
          {d.eligibility === "no_appointment" && <p className={styles.note} data-reminder-eligibility="no_appointment">{COPY.noAppointment}</p>}
          {d.eligibility === "closed" && <p className={styles.note} data-reminder-eligibility="closed">{COPY.closed}</p>}
          {d.eligibility === "elapsed" && <p className={styles.note} data-reminder-eligibility="elapsed">{COPY.elapsed}</p>}

          {record && (
            <div className={styles.status} data-reminder-status={record.status} data-reminder-current={d.scheduled_for_current_slot ? "true" : "false"}>
              {record.status === "scheduled" ? (
                d.scheduled_for_current_slot ? (
                  <p>
                    {STATUS_TEXT.scheduled} {COPY.minute(hhmm(record.remind_at))}
                  </p>
                ) : (
                  <p>{STALE_SCHEDULED}</p>
                )
              ) : (
                <p>{STATUS_TEXT[record.status]}{record.processed_at ? ` (${dayTime(record.processed_at)})` : ""}</p>
              )}
              {record.status === "scheduled" && (
                <button type="button" className={styles.secondary} disabled={view.busy || Boolean(view.pending)} onClick={() => void c.cancel()} data-reminder-cancel="">
                  Annuler le rappel
                </button>
              )}
            </div>
          )}

          {editable && d.appointment && (
            <form className={styles.form} onSubmit={submit} noValidate data-reminder-form={record ? "reschedule" : "create"}>
              <p className={styles.hint}>
                {record ? (record.status === "scheduled" ? "Modifier l’horaire du rappel" : "Programmer un nouveau rappel") : "Programmer un rappel"} — heure locale ({tz}), avant le début du rendez-vous.
              </p>
              <div className={styles.fields}>
                <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={d.appointment.starts_at.slice(0, 10)} required /></label>
                <label>Heure<input type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></label>
              </div>
              {formError && <p className={styles.error} role="alert" data-reminder-form-error="">{formError}</p>}
              <button type="submit" className={styles.primary} disabled={view.busy || Boolean(view.pending)} data-reminder-submit="">
                {view.busy ? "Enregistrement…" : "Enregistrer le rappel"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
