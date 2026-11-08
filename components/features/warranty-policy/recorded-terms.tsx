"use client";
// PUB-06 — terms version recorded with a warranty case, read ON DEMAND (exact ?version=N, checked).
// The host keys this component on identity + dossier + case + version: a scope change clears it.
// A case without a recorded version makes no request.
import { useEffect, useId, useRef, useState } from "react";
import { RECORDED_COPY as COPY, PUBLIC_COPY, loadRecordedTerms, validRecordedVersion, type RecordedTermsState } from "./model";
import styles from "./warranty-policy.module.css";

export function RecordedTerms({ version, fetcher }: { version: number | null | undefined; fetcher?: typeof fetch }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<RecordedTermsState | "loading" | null>(null);
  const seq = useRef(0);
  const alive = useRef(true);
  const bodyId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      seq.current++;
    };
  }, []);
  if (!validRecordedVersion(version)) {
    return (
      <p className={styles.muted} data-recorded-terms="none">
        {COPY.none}
      </p>
    );
  }
  const read = () => {
    const my = ++seq.current;
    setState("loading");
    void loadRecordedTerms(version, fetcher).then((r) => {
      if (!alive.current || my !== seq.current) return; // late reply: dropped
      setState(r);
    });
  };
  const phase = state === null ? "idle" : state === "loading" ? "loading" : state.phase;
  return (
    <div data-recorded-terms={phase} data-recorded-version={version}>
      <p className={styles.muted}>{COPY.label(version)}</p>
      <button
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          if (state === null || (state !== "loading" && state.phase !== "ready")) read();
        }}
      >
        {open ? COPY.hide : COPY.open(version)}
      </button>
      {open && (
        <div id={bodyId} className={styles.preview} aria-busy={state === "loading" || undefined}>
          {state === "loading" && <p className={styles.muted} role="status">{COPY.loading}</p>}
          {state !== null && state !== "loading" && state.phase === "error" && (
            <div role="alert">
              <p className={styles.error}>{COPY.error}</p>
              <button type="button" className={styles.button} onClick={read} data-recorded-retry="">
                Réessayer
              </button>
            </div>
          )}
          {state !== null && state !== "loading" && state.phase === "missing" && (
            <p className={styles.note} role="status">{COPY.missing}</p>
          )}
          {state !== null && state !== "loading" && state.phase === "ready" && (
            <>
              <h4 className={styles.subtitle}>{state.published.title}</h4>
              <p className={styles.plain} data-recorded-body="">{state.published.body}</p>
              <p className={styles.muted}>{PUBLIC_COPY.stamp(state.published)}</p>
            </>
          )}
          <p className={styles.muted}>{COPY.meaning}</p>
        </div>
      )}
    </div>
  );
}
