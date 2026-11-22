"use client";
// SYS-09 — « Exploitation » panel of the administration settings. Shows what the server has just
// checked (database, storage, sign-in service), what is configured (payments, outbound messages), the
// last recorded incidents, and — stated as such — what the application cannot observe (backups,
// restore tests, alerting). Read-only; an explicit refresh re-runs the checks.
import { useCallback, useEffect, useState } from "react";
import styles from "./platform-operations.module.css";

type Check = { key: string; label: string; state: "ok" | "error" | "not_configured" | "unknown"; detail: string; duration_ms?: number };
type Status = {
  checked_at: string;
  environment: string;
  checks: Check[];
  failing: string[];
  incidents: { key: string; label: string; at: string | null; detail: string }[];
  not_observable: { key: string; label: string; detail: string }[];
};
const STATE: Record<Check["state"], string> = { ok: "Opérationnel", error: "En erreur", not_configured: "Non configuré", unknown: "Inconnu" };
const ENVIRONMENTS: Record<string, string> = { production: "production", preview: "recette", development: "développement", local: "poste local" };
const when = (iso: string) => new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));

export function OperationsStatusPanel({ demo = false }: { demo?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/operations-status", { cache: "no-store", credentials: "same-origin" });
      const body = (await response.json().catch(() => null)) as Status | { error?: string } | null;
      if (!response.ok || !body || !("checks" in body)) throw new Error((body as { error?: string } | null)?.error || "L’état d’exploitation n’a pas pu être vérifié. Réessayez.");
      setStatus(body);
    } catch (e) {
      // The previous result is dated and no longer current: it is not kept as if it were.
      setStatus(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [demo]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className={styles.panel} aria-labelledby="operations-status-title" data-operations-status={demo ? "demo" : loading ? "loading" : error ? "error" : status?.failing.length ? "failing" : "ok"}>
      <div className={styles.panelHead}>
        <h2 id="operations-status-title">Exploitation</h2>
        {!demo && (
          <button type="button" className={styles.button} onClick={() => void load()} disabled={loading}>
            {loading ? "Vérification…" : "Vérifier à nouveau"}
          </button>
        )}
      </div>
      {demo ? (
        <p className={styles.hint}>La démonstration ne vérifie aucun service.</p>
      ) : error ? (
        <div className={`${styles.alert} ${styles.error}`} role="alert" data-operations-status-error="">
          <strong>Vérification impossible.</strong> {error} Si l’erreur persiste, suivez la procédure de reprise (docs/EXPLOITATION_REPRISE.md).
        </div>
      ) : !status ? (
        <p className={styles.hint} role="status">Vérification des services…</p>
      ) : (
        <>
          <p className={styles.hint} role="status">
            Vérifié le {when(status.checked_at)} · environnement : {ENVIRONMENTS[status.environment] ?? status.environment}.{" "}
            {status.failing.length ? `${status.failing.length} service(s) en erreur : suivez la procédure de reprise.` : "Aucun service vérifié n’est en erreur."}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>État des services vérifiés</caption>
              <thead><tr><th>Service</th><th>État</th><th>Constat</th></tr></thead>
              <tbody>
                {status.checks.map((check) => (
                  <tr key={check.key} data-operations-check={check.key} data-operations-state={check.state}>
                    <td>{check.label}</td>
                    <td><strong>{STATE[check.state]}</strong></td>
                    <td>{check.detail}{typeof check.duration_ms === "number" ? ` (${check.duration_ms} ms)` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Derniers incidents enregistrés</h3>
          <ul className={styles.list}>
            {status.incidents.map((incident) => (
              <li key={incident.key} data-operations-incident={incident.key}>
                {incident.label} : {incident.at ? `${when(incident.at)} · ` : ""}{incident.detail}
              </li>
            ))}
          </ul>
          <h3>Non observable depuis l’application</h3>
          <ul className={styles.list}>
            {status.not_observable.map((item) => (
              <li key={item.key} data-operations-unknown={item.key}>
                <strong>{item.label} : non vérifié.</strong> {item.detail}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
