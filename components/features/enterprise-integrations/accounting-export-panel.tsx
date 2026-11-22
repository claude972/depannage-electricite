"use client";
// ENT-16 — « Export comptable et intégrations » of the enterprise space. The only data exchange that
// exists is a manual CSV download (GET /api/enterprise/accounting-export, server-authorised). The
// panel says plainly that no third-party connector, API or automatic synchronisation is offered.
import { useEffect, useRef, useState } from "react";
import styles from "./accounting-export.module.css";

type Context = { generation(): number; userId(): string | null };
type Summary = { captured_at: string; invoices: number; credit_notes: number; settlements: number; settlements_paid: number; visible_sites: number };
type View = { phase: "loading" } | { phase: "error"; text: string } | { phase: "denied" } | { phase: "ready"; summary: Summary };

const isSummary = (b: unknown): b is Summary => {
  const s = b as Summary | null;
  return !!s && typeof s === "object" && [s.invoices, s.credit_notes, s.settlements, s.settlements_paid, s.visible_sites].every((n) => Number.isSafeInteger(n) && n >= 0) && typeof s.captured_at === "string";
};
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const dateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function AccountingExportPanel({ organizationId, context }: { organizationId: string; context: Context }) {
  return <Panel key={`${context.userId() ?? "-"}|${context.generation()}|${organizationId}`} organizationId={organizationId} context={context} />;
}
function Panel({ organizationId, context }: { organizationId: string; context: Context }) {
  const [view, setView] = useState<View>({ phase: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const seq = useRef(0);
  const lock = useRef(false);
  const ctx = useRef(context);
  ctx.current = context;
  const base = `/api/enterprise/accounting-export?organization_id=${encodeURIComponent(organizationId)}`;
  const load = async () => {
    const my = ++seq.current;
    setView({ phase: "loading" });
    let status = 0;
    let body: unknown = null;
    try {
      const response = await fetch(base, { credentials: "same-origin", cache: "no-store" });
      status = response.status;
      body = await response.json().catch(() => null);
    } catch {
      status = 0;
    }
    if (my !== seq.current) return;
    if (status === 200 && isSummary(body)) setView({ phase: "ready", summary: body });
    else if ([401, 403, 404].includes(status)) setView({ phase: "denied" });
    else setView({ phase: "error", text: (status === 422 && (body as { error?: string } | null)?.error) || "L’export comptable n’a pas pu être vérifié. Réessayez." });
  };
  useEffect(() => {
    void load();
    return () => {
      seq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const download = async () => {
    if (lock.current) return; // double-submit protection
    lock.current = true;
    setBusy(true);
    setMessage(null);
    const gen = ctx.current.generation(), uid = ctx.current.userId();
    try {
      const response = await fetch(`${base}&format=csv`, { credentials: "same-origin", cache: "no-store" });
      if (ctx.current.generation() !== gen || ctx.current.userId() !== uid) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setMessage({ tone: "error", text: [401, 403, 404].includes(response.status) ? "Vous n’avez pas accès à l’export de cette organisation." : body?.error || "Le fichier n’a pas pu être produit. Réessayez." });
        return;
      }
      const blob = await response.blob();
      const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "export-comptable.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ tone: "ok", text: `Fichier « ${name} » téléchargé.` });
    } catch {
      setMessage({ tone: "error", text: "Le fichier n’a pas pu être téléchargé. Vérifiez votre connexion puis réessayez." });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="accounting-export" data-accounting-export={view.phase} aria-busy={view.phase === "loading" || busy || undefined}>
      <h2 id="accounting-export">Export comptable et intégrations</h2>
      <p className={styles.muted}>
        Un fichier CSV regroupe les factures et avoirs de prestation émis à votre organisation et les règlements de ses dossiers, tels qu’ils sont enregistrés. Il se télécharge puis s’importe manuellement dans votre outil.
      </p>
      {view.phase === "loading" && <p className={styles.muted} role="status">Vérification des données à exporter…</p>}
      {view.phase === "denied" && <p role="alert" data-accounting-export-denied="">Vous n’avez pas accès à l’export de cette organisation.</p>}
      {view.phase === "error" && (
        <div role="alert">
          <p>{view.text}</p>
          <button type="button" className="button outline" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      )}
      {view.phase === "ready" && (
        <>
          <p className={styles.counts} data-accounting-export-counts="">
            {plural(view.summary.invoices, "facture", "factures")} · {plural(view.summary.credit_notes, "avoir", "avoirs")} · {plural(view.summary.settlements, "règlement", "règlements")} (dont {view.summary.settlements_paid} confirmé{view.summary.settlements_paid > 1 ? "s" : ""})
          </p>
          <p className={styles.muted}>
            Périmètre : {view.summary.visible_sites > 1 ? `les ${view.summary.visible_sites} sites visibles` : view.summary.visible_sites === 1 ? "le seul site visible" : "aucun site visible"} avec vos droits. Données au {dateTime(view.summary.captured_at)}.
          </p>
          <div className={styles.actions}>
            <button type="button" className="button primary" onClick={() => void download()} disabled={busy} data-accounting-export-download="">
              {busy ? "Préparation du fichier…" : "Télécharger l’export comptable (CSV)"}
            </button>
          </div>
          {message && (
            <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? styles.error : styles.ok} data-accounting-export-message={message.tone}>
              {message.text}
            </p>
          )}
          <p className={styles.note}>Format : UTF-8, séparateur « ; », une ligne par facture, avoir ou règlement, montants en euros. Un document émis n’indique pas l’état d’un paiement ; un règlement n’est pas une facture.</p>
        </>
      )}
      <h3 className={styles.sub}>Ce qui n’est pas connecté</h3>
      <ul className={styles.list} data-accounting-export-not-connected="">
        <li>Aucun connecteur vers un logiciel de comptabilité, un ERP, un CRM ou un outil de pilotage n’est raccordé.</li>
        <li>Aucune synchronisation automatique, aucune API ni aucun webhook n’est proposé aux organisations.</li>
        <li>Les relances de paiement ne sont pas envoyées par l’application.</li>
      </ul>
      <p className={styles.note}>L’export CSV ci-dessus et le rapport CSV de la page « Rapports » sont les seuls échanges de données disponibles.</p>
    </section>
  );
}
