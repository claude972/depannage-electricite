"use client";
// « Sessions de connexion » (SYS-09 / Q-PDF-36): the signed-in holder closes their OTHER sessions
// after an explicit confirmation. One request at a time (synchronous ref); the uid / generation
// captured at the confirmation are re-checked after the await, and a reply for an older context
// or an unmounted panel is ignored. Demo: hidden, zero calls. Logic: ./model.
import { useEffect, useRef, useState } from "react";
import { COPY, revokeOthers, type Context } from "./model";
import styles from "../account-data/account-data.module.css";

export type AccountSessionsPanelProps = { demo: boolean; context: Context; fetcher?: typeof fetch };
type Phase = { kind: "idle" } | { kind: "confirming" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function AccountSessionsPanel({ demo, context, fetcher }: AccountSessionsPanelProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inFlight = useRef(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  if (demo) return null;

  const send = async () => {
    if (inFlight.current || phase.kind !== "confirming") return;
    inFlight.current = true;
    const uid = context.userId(), gen = context.generation();
    setPhase({ kind: "sending" });
    try {
      const out = uid ? await revokeOthers(fetcher ?? ((...a) => fetch(...a)), uid) : ({ kind: "error", message: COPY.noAccount } as const);
      // Another identity / generation, or the panel is gone: the reply is ignored.
      if (!alive.current || context.userId() !== uid || context.generation() !== gen) return;
      setPhase(out.kind === "ok" ? { kind: "done" } : { kind: "error", message: out.message });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section className={styles.panel} aria-labelledby="account-sessions-title" data-account-sessions={phase.kind}>
      <h2 id="account-sessions-title">{COPY.title}</h2>
      <p className={styles.hint}>{COPY.intro}</p>
      {(phase.kind === "idle" || phase.kind === "done") && (
        <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "confirming" })}>
          {COPY.action}
        </button>
      )}
      {(phase.kind === "confirming" || phase.kind === "sending") && (
        <div className={styles.confirm} role="group" aria-labelledby="account-sessions-confirm">
          <p id="account-sessions-confirm">{COPY.explain}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={() => void send()} disabled={phase.kind === "sending"} aria-busy={phase.kind === "sending" || undefined}>
              {phase.kind === "sending" ? COPY.sending : COPY.confirm}
            </button>
            <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "idle" })} disabled={phase.kind === "sending"}>
              {COPY.cancel}
            </button>
          </div>
        </div>
      )}
      {phase.kind === "sending" && <p className={styles.hint} role="status">{COPY.sending}</p>}
      {phase.kind === "done" && <p className={styles.ok} role="status" data-account-sessions-done="">{COPY.done}</p>}
      {phase.kind === "error" && (
        <div role="alert" data-account-sessions-error="">
          <p className={styles.error}>{phase.message}</p>
          {/* A retry goes through a new confirmation: never an automatic resend. */}
          <button type="button" className={styles.secondary} onClick={() => setPhase({ kind: "confirming" })}>
            {COPY.retry}
          </button>
        </div>
      )}
    </section>
  );
}
