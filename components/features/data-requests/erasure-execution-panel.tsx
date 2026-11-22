"use client";
// SYS-09 — execution of an approved erasure request (administrator only), with an explicit,
// irreversible confirmation. Reads and writes /api/admin/data-requests/<id>/execution.
// The panel states what is erased and what the law requires to keep, shows what blocks the execution,
// and after it lists every step with its real outcome (done, nothing to do, kept, not done + reason).
import { useCallback, useEffect, useId, useRef, useState } from "react";
import styles from "./data-requests.module.css";

type Step = { key: string; label: string; status: "done" | "kept" | "failed" | "none"; count: number; detail?: string };
type Execution = { request_id: string; executed_at: string; executed_by: string | null; steps: Step[] };
type Plan = { account_role: string; eligible: boolean; blockers: string[]; counts: { addresses: number; interventions_open: number; interventions_kept: number; interventions_erasable: number } };
type View = { request_state: string; execution: Execution | null; can_execute: boolean; administrator: boolean; plan: Plan | null; confirmation_word: string };
const STATUS: Record<Step["status"], string> = { done: "Effacé", none: "Rien à effacer", kept: "Conservé", failed: "Non effectué" };
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Martinique" });
};
export const ERASED_SCOPE = "Seront effacés ou rendus anonymes : l’identité et le téléphone du profil, les adresses enregistrées, les textes écrits par le compte (descriptions et adresses des dossiers sans paiement, messages, échanges avec l’assistance, avis, demandes de garantie), les brouillons de réservation, les notifications, les photos des dossiers sans paiement. L’adresse e-mail de connexion est remplacée, le compte est désactivé et ses sessions sont fermées.";
export const KEPT_SCOPE = "Sont conservés, parce que les règles comptables et fiscales l’imposent : les paiements, les factures et avoirs, les devis acceptés et les dossiers qui ont donné lieu à un paiement, avec leurs documents. Les journaux d’audit sont conservés (identifiants et codes d’action, sans texte libre).";

export function ErasureExecutionPanel({ id, requestState, fetcher, onExecuted }: { id: string; requestState: string; fetcher: () => typeof fetch; onExecuted?: () => void }) {
  const [view, setView] = useState<View | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const command = useRef<string | null>(null);
  const inputId = useId();
  const url = `/api/admin/data-requests/${encodeURIComponent(id)}/execution`;
  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const response = await fetcher()(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
      const body = (await response.json().catch(() => null)) as View | { error?: string } | null;
      if (!response.ok || !body || !("request_state" in body)) throw new Error((body as { error?: string } | null)?.error || "L’état de l’effacement n’a pas pu être lu. Réessayez.");
      setView(body);
      setPhase("ready");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => {
    void load();
  }, [load, requestState]);

  async function execute() {
    if (!view || sending.current) return;
    if (word.trim() !== view.confirmation_word) return setError(`Saisissez ${view.confirmation_word} en majuscules pour confirmer : l’effacement est irréversible.`);
    if (!command.current) command.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null;
    if (!command.current) return setError("Ce navigateur ne permet pas de créer un identifiant sécurisé : exécution impossible ici.");
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetcher()(url, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command_id: command.current, confirmation: word.trim() }) });
      const body = (await response.json().catch(() => null)) as { execution?: Execution; error?: string; blockers?: string[] } | null;
      if (!response.ok || !body?.execution) {
        setError(body?.error || "L’effacement n’a pas été confirmé par le serveur. Relisez la demande avant de réessayer.");
        if (response.status === 409 || response.status >= 500) void load();
        return;
      }
      command.current = null;
      setConfirming(false);
      setWord("");
      setView({ ...view, execution: body.execution, can_execute: false, plan: null });
      onExecuted?.();
    } catch {
      setError("La réponse du serveur n’est pas parvenue. Relisez la demande : si l’effacement a eu lieu, il apparaît ci-dessous.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  if (phase === "loading" && !view) return <p className={styles.hint} role="status">Lecture de l’état de l’effacement…</p>;
  if (phase === "error" && !view)
    return (
      <div className={styles.note} role="alert">
        <p className={styles.error}>{error}</p>
        <button type="button" className={styles.secondary} onClick={() => void load()}>Réessayer</button>
      </div>
    );
  if (!view) return null;
  const execution = view.execution;
  return (
    <div className={styles.block} data-erasure-execution={execution ? "executed" : view.can_execute ? "ready" : "not_started"}>
      <h4 className={styles.title}>Exécution de l’effacement</h4>
      {execution ? (
        <>
          <p className={styles.ok} role="status" data-erasure-executed="">
            Effacement exécuté le {when(execution.executed_at)}{execution.executed_by ? ` par le compte administrateur ${execution.executed_by.slice(0, 8)}` : ""}. Le compte ne peut plus se connecter.
          </p>
          <ul className={styles.list}>
            {execution.steps.map((step) => (
              <li key={step.key} className={styles.item} data-erasure-step={step.key} data-erasure-step-status={step.status}>
                <span>{step.label}</span>
                <span className={styles.meta}>
                  {STATUS[step.status]}{step.count > 0 ? ` · ${step.count}` : ""}{step.detail ? ` · ${step.detail}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {execution.steps.some((step) => step.status === "failed") && <p className={styles.error} role="alert">Certaines étapes n’ont pas pu être effectuées : elles sont listées « Non effectué » avec leur motif et restent à traiter manuellement.</p>}
          <p className={styles.hint}>{KEPT_SCOPE}</p>
        </>
      ) : view.request_state !== "approved" ? (
        <p className={styles.hint} data-erasure-not-approved="">Effacement non commencé. Il ne peut être exécuté qu’après l’approbation de la demande.</p>
      ) : !view.administrator ? (
        <p className={styles.hint} data-erasure-admin-only="">Demande approuvée, effacement non commencé. Son exécution est réservée aux administrateurs de la plateforme.</p>
      ) : (
        <>
          <p className={styles.hint}>{ERASED_SCOPE}</p>
          <p className={styles.hint}>{KEPT_SCOPE}</p>
          {view.plan && (
            <p className={styles.meta} data-erasure-plan="">
              Compte visé : {view.plan.counts.addresses} adresse(s) enregistrée(s), {view.plan.counts.interventions_erasable} dossier(s) sans paiement à rendre anonyme(s), {view.plan.counts.interventions_kept} dossier(s) conservé(s) pour obligation comptable.
            </p>
          )}
          {view.plan && !view.plan.eligible ? (
            <div className={styles.note} role="alert" data-erasure-blocked="">
              <p className={styles.error}>L’effacement ne peut pas être exécuté pour l’instant :</p>
              <ul>{view.plan.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
              <button type="button" className={styles.secondary} onClick={() => void load()}>Vérifier à nouveau</button>
            </div>
          ) : !confirming ? (
            <button type="button" className={styles.secondary} onClick={() => { setConfirming(true); setError(""); }} data-erasure-prepare="">Exécuter l’effacement…</button>
          ) : (
            <div className={styles.note} data-erasure-confirm="">
              <p><strong>Action irréversible.</strong> Les données effacées ne pourront pas être rétablies et le titulaire ne pourra plus se connecter.</p>
              <label className={styles.field} htmlFor={inputId}>
                Pour confirmer, saisissez {view.confirmation_word}
                <input id={inputId} type="text" autoComplete="off" value={word} onChange={(e) => { setWord(e.target.value); if (error) setError(""); }} disabled={busy} />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.primary} onClick={() => void execute()} disabled={busy} data-erasure-execute="">{busy ? "Effacement en cours…" : "Effacer définitivement"}</button>
                <button type="button" className={styles.secondary} onClick={() => { setConfirming(false); setWord(""); setError(""); }} disabled={busy}>Annuler</button>
              </div>
            </div>
          )}
        </>
      )}
      {error && view && <p className={styles.error} role="alert" data-erasure-error="">{error}</p>}
    </div>
  );
}
