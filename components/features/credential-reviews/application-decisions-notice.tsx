"use client";
// ADM-02 — the artisan sees WHY: decisions taken by the administration on his application, with the
// reason given (GET /api/artisan/application-decisions, own account only). The latest negative
// decision is shown as a banner; the full list follows. Read-only; a failed read says so and can be
// retried, it never pretends that no decision exists.
import { useCallback, useEffect, useState } from "react";
import styles from "./credential-reviews.module.css";

type Kind = "approve" | "request_changes" | "reject" | "reopen" | "suspend" | "reinstate";
type Decision = { id: string; decided_at: string; kind: Kind; reason: string; application_version: number };
const LABELS: Record<Kind, string> = {
  approve: "Candidature approuvée",
  request_changes: "Corrections demandées",
  reject: "Candidature refusée",
  reopen: "Candidature rouverte",
  suspend: "Accès suspendu",
  reinstate: "Accès réactivé",
};
const NEGATIVE: readonly Kind[] = ["request_changes", "reject", "suspend"];
const when = (value: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));

export function ApplicationDecisionsNotice({ refreshKey, demo = false }: { refreshKey?: string | number; demo?: boolean }) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; decisions: Decision[] }>({ status: "loading", decisions: [] });
  const load = useCallback(async (signal?: AbortSignal) => {
    if (demo) return setState({ status: "ready", decisions: [] });
    try {
      const response = await fetch("/api/artisan/application-decisions", { cache: "no-store", credentials: "same-origin", signal });
      const body = (await response.json().catch(() => null)) as { decisions?: unknown } | null;
      if (!response.ok || !body || !Array.isArray(body.decisions)) throw new Error("unavailable");
      const decisions = (body.decisions as Decision[]).filter((d) => d && typeof d.id === "string" && typeof d.reason === "string" && typeof d.decided_at === "string" && Object.hasOwn(LABELS, d.kind));
      setState({ status: "ready", decisions });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setState((previous) => ({ status: "error", decisions: previous.decisions }));
    }
  }, [demo]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, refreshKey]);

  if (state.status === "loading") return null;
  if (state.status === "error" && !state.decisions.length)
    return (
      <section className={styles.panel} data-application-decisions="error" role="alert">
        <p className={styles.meta}>Les décisions de l’exploitant sur votre candidature n’ont pas pu être lues.</p>
        <div>
          <button type="button" className="button outline" onClick={() => void load()}>Réessayer</button>
        </div>
      </section>
    );
  if (!state.decisions.length) return null;
  const [latest, ...older] = state.decisions;
  const negative = NEGATIVE.includes(latest.kind);
  return (
    <section className={styles.panel} data-application-decisions="ready" aria-label="Décisions de l’exploitant sur votre candidature">
      <div className={styles.head}>
        <h3 className={styles.title}>{negative ? `Décision de l’exploitant : ${LABELS[latest.kind].toLowerCase()}` : `Dernière décision de l’exploitant : ${LABELS[latest.kind].toLowerCase()}`}</h3>
        <span className={styles.meta}>{when(latest.decided_at)}</span>
      </div>
      <p style={{ margin: 0 }} data-application-decision-reason={latest.kind}>
        <strong>Motif communiqué :</strong> {latest.reason}
      </p>
      {latest.kind === "reject" && <p className={styles.meta}>Cette candidature ne peut pas être soumise à nouveau tant que l’exploitant ne l’a pas rouverte. Vous pouvez écrire à l’assistance depuis la rubrique Assistance.</p>}
      {latest.kind === "request_changes" && <p className={styles.meta}>Corrigez votre dossier et vos justificatifs, puis soumettez à nouveau votre candidature.</p>}
      {older.length > 0 && (
        <details>
          <summary>Décisions précédentes ({older.length})</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
            {older.map((item) => (
              <li key={item.id} data-application-decision-record={item.kind}>
                <strong>{LABELS[item.kind]}</strong> · {when(item.decided_at)}
                <br />
                Motif : {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
