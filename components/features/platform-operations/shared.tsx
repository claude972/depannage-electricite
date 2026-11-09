"use client";
// Local primitives for the platform leaf views. No import from components/app/** (shared contract §2).
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ContractState, Page, PlatformViewScope } from "../../../lib/features/platform-operations/types";
import styles from "./platform-operations.module.css";
import { ApiRequestError } from "../../app/api";
import { classifyRefusal, readRefused } from "../../app/refusal";

export const money = (cents: number, currency = "eur") => new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2 }).format(cents / 100);
export const dateTime = (value: string | null | undefined) => (value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—");
export const shortId = (id: string | null | undefined) => (id ? id.slice(0, 8).toUpperCase() : "—");
export const newRequestId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`);
export const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : "L’action n’a pas pu être réalisée. Réessayez.");
/** Mount key: any change of user, role, organization or site resets forms, drafts and loaded data. */
export const scopeKey = (scope: PlatformViewScope) => `${scope.userId}|${scope.role}|${scope.organizationId ?? ""}|${scope.siteId ?? ""}`;

export function Unavailable({ title, message, blocker }: { title: string; message: string; blocker?: string }) {
  return (
    <div className="unavailable" role="note" data-blocker={blocker}>
      <div><strong>{title}</strong><p>{message}</p></div>
    </div>
  );
}
export function Loading({ label = "Chargement…" }: { label?: string }) {
  return <div className="page-loader" role="status"><span className="spinner" />{label}</div>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty-state"><h3>{title}</h3>{children && <p>{children}</p>}</div>;
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={styles.danger} role="alert">
      <span>{message}</span>
      {onRetry && <div><button type="button" className={styles.button} onClick={onRetry}>Réessayer</button></div>}
    </div>
  );
}
export function ReadOnly({ reason }: { reason?: string }) {
  return <p className={styles.alert} role="note">Lecture seule : {reason || "vous n’avez pas de droit d’écriture sur cet espace."}</p>;
}
export function Panel({ title, intro, action, children }: { title: string; intro?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}><div><h3>{title}</h3>{intro && <p>{intro}</p>}</div>{action}</div>
      {children}
    </section>
  );
}
export function Field({ label, hint, error, children, full }: { label: string; hint?: string; error?: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={full ? styles.full : undefined}>
      <span>{label}</span>
      {children}
      {hint && <span className={styles.hint}>{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}
export function Pager({ page, onPrev, onNext, canPrev }: { page: Page; onPrev: () => void; onNext: () => void; canPrev: boolean }) {
  return (
    <div className={styles.pager}>
      <span>{page.total} au total · {page.limit} par page</span>
      <span className={styles.actions}>
        <button type="button" className={styles.button} onClick={onPrev} disabled={!canPrev}>Précédent</button>
        <button type="button" className={styles.button} onClick={onNext} disabled={!page.has_more}>Suivant</button>
      </span>
    </div>
  );
}
/** Contract gate shared by the three views. */
export function Gate({ state, unavailableMessage, title, children }: { state: ContractState; unavailableMessage: string; title: string; children: ReactNode }) {
  if (state === "unknown") return <Loading label="Vérification de la disponibilité…" />;
  if (state !== "available") return <Unavailable title={title} message={unavailableMessage} blocker={state} />;
  return <>{children}</>;
}
/** Loads data through an injected loader. A null result means a stale chain: nothing changes. */
export function useLoad<T>(loader: () => Promise<T | null>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    loader().then((result) => { if (!active) return; if (result !== null) setData(result); setLoading(false); })
      .catch((e) => {
        if (!active) return;
        // P1 shared rule: a refused read (401/403/404) purges the data already shown.
        if (e instanceof ApiRequestError && readRefused(e.status)) setData(undefined);
        setError(errorText(e)); setLoading(false);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}
/** Runs a command with double-submit protection. null = stale: no success, no update. */
export function useCommand<A extends unknown[], R>(command: (...args: A) => Promise<R | null>, onDone: (result: R) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const run = useCallback(async (...args: A) => {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try { const result = await command(...args); if (result !== null) { onDone(result); setSuccess("Enregistré."); } }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }, [busy, command, onDone]);
  return { run, busy, error, success, reset: () => { setError(""); setSuccess(""); } };
}
export function preventDefault(event: FormEvent) { event.preventDefault(); }
/** P1 shared rule for a refused command: 409 ⇒ the current version must be re-read in place. */
export function commandConflict(e: unknown): boolean {
  return e instanceof ApiRequestError && classifyRefusal(e.status) === "conflict";
}
export const CONFLICT_REREAD = "Cet élément a été modifié entre-temps : sa version actuelle est relue. Votre saisie est conservée ; vérifiez-la avant de confirmer à nouveau.";
/** P1 shared rule for a refused command: true when rights + resource must be re-read first. */
export function commandRefused(e: unknown): boolean {
  if (!(e instanceof ApiRequestError)) return false;
  const k = classifyRefusal(e.status);
  return k === "session" || k === "access";
}
export const UUID_HINT = "Identifiant au format UUID (36 caractères).";
