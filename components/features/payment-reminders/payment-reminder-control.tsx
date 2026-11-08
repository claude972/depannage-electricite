"use client";
// SYS-04 / ENT-16 — « Me rappeler de régler ce devis le … »: a personal, in-app reminder next to the
// payment button. Nothing is read until the user opens the control (no call in demo). Every read and
// command is bound to identity (uid + generation) + quote; the server decides the right
// (can_schedule). Commands are stored + read back before the POST; an uncertain outcome keeps the
// command and offers to resend it with the SAME command_id; a 409 re-reads, never replays.
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  REMINDER_COPY as COPY,
  REMINDER_PATH,
  STATUS_LABEL,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  clearPending,
  commandOutcome,
  newCommandId,
  parseReminderRead,
  readPending,
  reminderInstant,
  request,
  tabStore,
  toLocalInput,
  writePending,
  type Context,
  type ReminderCommand,
  type ReminderRead,
  type Store,
} from "./model";

const when = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(iso));

export function PaymentReminderControl(props: { quoteId: string; context: Context; demo?: boolean; fetcher?: typeof fetch; store?: () => Store | null }) {
  if (props.demo) return null;
  const k = `${props.context.userId() ?? "-"}|${props.context.generation()}|${props.quoteId}`;
  return <Control key={k} {...props} />;
}

function Control({ quoteId, context, fetcher, store = tabStore }: { quoteId: string; context: Context; fetcher?: typeof fetch; store?: () => Store | null }) {
  const [me] = useState(() => ({ uid: context.userId() ?? "", gen: context.generation() }));
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<{ phase: "idle" | "loading" | "ready" | "error" | "refused"; data: ReminderRead | null }>({ phase: "idle", data: null });
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ReminderCommand | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const inFlight = useRef(false);
  const seq = useRef(0);
  const mounted = useRef(true);
  const latest = useRef({ context, fetcher });
  useEffect(() => {
    latest.current = { context, fetcher };
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      seq.current++;
    };
  }, []);
  const still = () => mounted.current && !!me.uid && latest.current.context.userId() === me.uid && latest.current.context.generation() === me.gen;
  const f = () => latest.current.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const load = async () => {
    if (!me.uid) return setRead({ phase: "refused", data: null });
    const my = ++seq.current;
    setRead((r) => ({ phase: "loading", data: r.data }));
    const r = await request(f(), `${REMINDER_PATH}?quote_id=${encodeURIComponent(quoteId)}`, { method: "GET" });
    if (my !== seq.current || !still()) return; // late: dropped
    if (r.status === 401 || r.status === 403 || r.status === 404) return setRead({ phase: "refused", data: null });
    const data = r.status === 200 ? parseReminderRead(r.body, quoteId) : null;
    setRead(data ? { phase: "ready", data } : { phase: "error", data: null });
  };
  const openControl = () => {
    setOpen(true);
    // A command left uncertain under THIS identity is restored exactly (never regenerated).
    if (me.uid) setPending(readPending(store(), me.uid, me.gen, quoteId));
    void load();
  };

  /** POST exactly `cmd` after a stored read-back; never a new id while the outcome is uncertain. */
  const send = async (cmd: ReminderCommand) => {
    if (inFlight.current || !still()) return;
    const stored = readPending(store(), me.uid, me.gen, quoteId);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(cmd)) return setMessage({ tone: "error", text: COPY.storage });
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const r = await request(f(), REMINDER_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    inFlight.current = false;
    if (!still()) return; // identity changed / closed: nothing applied, the command stays for its owner
    setBusy(false);
    const o = commandOutcome(r, cmd);
    if (o.kind === "uncertain") {
      setPending(cmd);
      setMessage({ tone: "error", text: COPY.uncertain });
      return;
    }
    clearPending(store(), me.uid, me.gen, quoteId);
    setPending(null);
    if (o.kind === "done") {
      setMessage({ tone: "ok", text: cmd.action === "schedule" ? COPY.scheduled : COPY.cancelled });
      setRead((x) => (x.data ? { phase: "ready", data: { ...x.data, reminder: o.reminder } } : x));
      setLocal("");
      void load();
      return;
    }
    if (o.kind === "conflict") {
      setMessage({ tone: "error", text: COPY.conflict });
      void load(); // never replayed
      return;
    }
    setMessage({ tone: "error", text: o.message });
  };
  const start = (cmd: Omit<ReminderCommand, "command_id">) => {
    if (inFlight.current || pending || !me.uid) return;
    const command_id = newCommandId();
    if (!command_id) return setMessage({ tone: "error", text: COPY.noId });
    const cmdFull = { ...cmd, command_id } as ReminderCommand;
    if (!writePending(store(), me.uid, me.gen, cmdFull)) {
      clearPending(store(), me.uid, me.gen, quoteId);
      return setMessage({ tone: "error", text: COPY.storage });
    }
    setPending(cmdFull);
    void send(cmdFull);
  };
  const schedule = (e: FormEvent) => {
    e.preventDefault();
    const at = reminderInstant(local);
    if (!at) return setMessage({ tone: "error", text: COPY.invalidDate });
    const current = read.data?.reminder;
    start({ quote_id: quoteId, expected_version: current ? current.version : null, action: "schedule", remind_at: at });
  };
  const cancel = () => {
    const current = read.data?.reminder;
    if (!current || current.status !== "scheduled") return;
    start({ quote_id: quoteId, expected_version: current.version, action: "cancel" });
  };

  if (!open)
    return (
      <button type="button" className="text-button" onClick={openControl} data-payment-reminder-open="">
        {COPY.open}
      </button>
    );
  const data = read.data;
  const reminder = data?.reminder ?? null;
  const now = Date.now();
  return (
    <section className="panel" aria-label="Rappel personnel de règlement" data-payment-reminder={read.phase} aria-busy={read.phase === "loading" || busy || undefined}>
      <p className="muted">{COPY.intro}</p>
      {read.phase === "loading" && <p className="muted" role="status">{COPY.loading}</p>}
      {read.phase === "refused" && <p className="muted" role="alert">{COPY.refused}</p>}
      {read.phase === "error" && (
        <div role="alert">
          <p className="muted">{COPY.failed}</p>
          <button type="button" className="button outline" onClick={() => void load()}>Réessayer</button>
        </div>
      )}
      {message && <p className={message.tone === "ok" ? "muted" : "field-error"} role={message.tone === "ok" ? "status" : "alert"} data-payment-reminder-message={message.tone}>{message.text}</p>}
      {pending && (
        <div role="alert" data-payment-reminder-pending={pending.command_id}>
          <button type="button" className="button outline" disabled={busy} onClick={() => void send(pending)}>
            {busy ? "Envoi…" : COPY.retry}
          </button>
        </div>
      )}
      {read.phase === "ready" && data && (
        <>
          {reminder && (
            <p data-payment-reminder-status={reminder.status}>
              <strong>{STATUS_LABEL[reminder.status]}</strong>
              {reminder.status === "scheduled" || reminder.status === "sent" ? ` — ${when(reminder.remind_at)}` : ""}
            </p>
          )}
          {!data.can_schedule ? (
            <p className="muted" data-payment-reminder-not-allowed="">{COPY.notAllowed}</p>
          ) : (
            <form onSubmit={schedule} noValidate>
              <fieldset disabled={busy || Boolean(pending)} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 8 }}>
                <label className="field">
                  <span>{COPY.label}</span>
                  <input type="datetime-local" value={local} min={toLocalInput(new Date(now + MIN_DELAY_MS))} max={toLocalInput(new Date(now + MAX_DELAY_MS))} onChange={(e) => setLocal(e.target.value)} />
                  <small>{COPY.hint}</small>
                </label>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="submit" className="button outline" disabled={!local} data-payment-reminder-schedule="">
                    {busy ? "Envoi…" : reminder?.status === "scheduled" ? COPY.reschedule : COPY.schedule}
                  </button>
                  {reminder?.status === "scheduled" && (
                    <button type="button" className="button outline" onClick={cancel} data-payment-reminder-cancel="">
                      {COPY.cancel}
                    </button>
                  )}
                </span>
              </fieldset>
            </form>
          )}
        </>
      )}
    </section>
  );
}
