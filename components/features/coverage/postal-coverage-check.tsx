"use client";
// Public postal-code check (PUB-03) under « Tarifs ». One GET on explicit submit, 5-digit validation
// first (no call otherwise); the code lives in component memory only (no storage, no URL, autocomplete
// off). Informative wording per status — never promises an artisan or a delay, never blocks a request.
import { useRef, useState, type FormEvent } from "react";
import { PUBLIC_COPY, isPostalCode, parsePublic, publicError, publicMessage, publicUrl, timed, type PublicCoverage } from "./model";
import styles from "./coverage.module.css";

type State = { phase: "idle" | "checking" | "result" | "error"; code: string; result: PublicCoverage | null; error: string };
const IDLE: State = { phase: "idle", code: "", result: null, error: "" };

export function PostalCoverageCheck({ fetcher }: { fetcher?: typeof fetch }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<State>(IDLE);
  const seq = useRef(0);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = value.trim();
    if (!isPostalCode(code)) return setState({ ...IDLE, phase: "error", error: PUBLIC_COPY.invalid });
    const my = ++seq.current;
    setState({ phase: "checking", code, result: null, error: "" });
    const r = await timed(fetcher ?? ((...a) => fetch(...a)), publicUrl(code), { method: "GET", referrerPolicy: "no-referrer" });
    if (my !== seq.current) return; // the input changed or another check started: stale reply dropped
    const parsed = r.status === 200 ? parsePublic(r.body) : null;
    setState(parsed ? { phase: "result", code, result: parsed, error: "" } : { phase: "error", code, result: null, error: r.status === 200 ? PUBLIC_COPY.failed : publicError(r.status, r.retryAfterS) });
  };
  return (
    <section className={styles.panel} aria-labelledby="coverage-check-title" data-coverage-check={state.phase}>
      <h2 id="coverage-check-title">{PUBLIC_COPY.title}</h2>
      <p className={styles.hint}>{PUBLIC_COPY.intro}</p>
      <form className={styles.row} onSubmit={(e) => void submit(e)} noValidate>
        <label className={styles.field}>
          {PUBLIC_COPY.label}
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            autoComplete="off"
            value={value}
            aria-invalid={state.phase === "error" && state.error === PUBLIC_COPY.invalid ? true : undefined}
            aria-describedby="coverage-check-out"
            onChange={(e) => {
              seq.current++;
              setValue(e.target.value.replace(/\D/g, "").slice(0, 5));
              setState(IDLE);
            }}
          />
        </label>
        <button type="submit" className={styles.primary} disabled={state.phase === "checking"}>
          {state.phase === "checking" ? PUBLIC_COPY.checking : PUBLIC_COPY.check}
        </button>
      </form>
      <div id="coverage-check-out" aria-live="polite">
        {state.phase === "result" && state.result && (
          <div className={styles.result} data-coverage-status={state.result.status}>
            <p><strong>{publicMessage(state.code, state.result)}</strong></p>
            <p className={styles.hint}>{PUBLIC_COPY.informative}</p>
          </div>
        )}
        {state.phase === "error" && <p className={styles.error} role="alert">{state.error}</p>}
      </div>
    </section>
  );
}
