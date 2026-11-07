"use client";
// « Être rappelé » (PUB-04, public). Shown ONLY when GET /api/public/callback says available. Phone,
// reason and the explicit consent text before sending; the request_id is created at submit and reused
// only to retry exactly the same content (lost reply / 5xx); any edit ⇒ a new UUID. Everything stays
// in component memory: never in the URL, storage or logs. 429 ⇒ honest countdown, no auto-retry.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CONSENT_TEXT, COPY, PUBLIC_PATH, REASONS, REASON_LABEL, attemptFor, isReceipt, parseAvailable, phoneLooksValid, timed, type Attempt, type Reason } from "./model";
import styles from "./public-callback.module.css";

export type PublicCallbackFormProps = { fetcher?: typeof fetch; newId?: () => string | null };
const uuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

export function PublicCallbackForm({ fetcher, newId = uuid }: PublicCallbackFormProps) {
  const id = useId();
  const doFetch = (): typeof fetch => fetcher ?? ((...a) => fetch(...a));
  // null = reading; "failed" = the availability could not be verified.
  const [available, setAvailable] = useState<boolean | "failed" | null>(null);
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState<Reason | "">("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [wait, setWait] = useState(0);
  const attempt = useRef<Attempt | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void timed(doFetch(), PUBLIC_PATH, { method: "GET" }).then((r) => {
      if (!alive.current) return;
      const v = r.status === 200 ? parseAvailable(r.body) : null;
      setAvailable(v === null ? "failed" : v);
    });
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  if (available === null) return null; // reading: nothing claimed yet
  if (available !== true)
    // Closed or unverifiable: an honest state, no form and no POST.
    return (
      <section className={styles.panel} aria-labelledby={`${id}-title`} data-public-callback={available === false ? "closed" : "failed"}>
        <h2 id={`${id}-title`}>{COPY.title}</h2>
        <p className={styles.hint}>{available === false ? COPY.closedState : COPY.failedState}</p>
      </section>
    );

  // Any edit of the content drops the current attempt (next submit ⇒ new UUID).
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    attempt.current = null;
    setError("");
    setter(v);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || wait > 0) return;
    if (!phoneLooksValid(phone)) return setError(COPY.phoneInvalid);
    if (!reason) return setError(COPY.reasonRequired);
    if (!consent) return setError(COPY.consentRequired);
    const a = attemptFor(attempt.current, phone, reason, newId);
    if (!a) return setError(COPY.noUuid);
    attempt.current = a;
    setBusy(true);
    setError("");
    const r = await timed(doFetch(), PUBLIC_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request_id: a.request_id, phone: a.phone, reason: a.reason, consent: true }) });
    if (!alive.current) return;
    setBusy(false);
    if (r.status === 200 && isReceipt(r.body)) {
      attempt.current = null;
      setPhone("");
      setReason("");
      setConsent(false);
      return setDone(true);
    }
    if (r.status === 429) {
      setWait(r.retryAfterS ?? 60);
      return setError("");
    }
    if (r.status === 422 || r.status === 400) return setError(COPY.invalid);
    if (r.status === 503 && r.body && (r.body as { error?: string }).error === COPY.closed) return setError(COPY.closed);
    setError(COPY.retry); // lost reply / 5xx / unconfirmed: the SAME attempt is reused on retry
  };

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`} data-public-callback={done ? "done" : "form"}>
      <h2 id={`${id}-title`}>{COPY.title}</h2>
      {done ? (
        <p className={styles.ok} role="status" data-public-callback-receipt="">{COPY.received}</p>
      ) : (
        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate autoComplete="off">
          <p className={styles.hint}>{COPY.intro}</p>
          <label className={styles.field}>
            {COPY.phone}
            <input type="tel" inputMode="tel" autoComplete="off" maxLength={40} value={phone} onChange={(e) => edit(setPhone)(e.target.value)} disabled={busy} />
          </label>
          <label className={styles.field}>
            {COPY.reason}
            <select value={reason} onChange={(e) => edit(setReason)(e.target.value as Reason | "")} disabled={busy}>
              <option value="">Choisir…</option>
              {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={busy} />
            <span>{CONSENT_TEXT}</span>
          </label>
          {error && <p className={styles.error} role="alert" data-public-callback-error="">{error}</p>}
          {wait > 0 && <p className={styles.error} role="status" data-public-callback-wait={wait}>{COPY.limited(wait)}</p>}
          <button type="submit" className={styles.primary} disabled={busy || wait > 0}>{busy ? COPY.sending : COPY.submit}</button>
        </form>
      )}
    </section>
  );
}
