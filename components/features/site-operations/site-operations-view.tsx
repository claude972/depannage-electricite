"use client";
// ADV-B2B-OPERATIONS-001 — single normalized entry point (contract WEB-SHARED-001, amendments
// A1/A2). Receives state, scope, client, unavailableMessage, demo?, onNavigate?; never fetches,
// never derives rights, never navigates by itself. A null result from the injected client means
// a stale identity chain: nothing is shown or updated. Any change of userId, organizationId or
// siteId remounts the content, clearing forms, drafts and loaded data.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SiteOperationsCommand, SiteOperationsReport, SiteOperationsViewProps } from "../../../lib/features/site-operations/types";
import { BudgetPanel } from "./budget-panel";
import { EquipmentPanel } from "./equipment-panel";
import { ErpPanel } from "./erp-panel";
import { GridsPanel } from "./grids-panel";
import { HistoryPanel } from "./history-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { Loading, Notice, type PanelContext } from "./shared";
import { BUSY_MESSAGE, messageOf, outcomeOf, resolveAuthority, scopeKey, type RunOutcome } from "../../../lib/features/site-operations/view-model";
import { SlaPanel } from "./sla-panel";
import styles from "./site-operations.module.css";

export type SiteOperationsTab = "equipment" | "maintenance" | "budget" | "grids" | "sla" | "erp" | "history";
const TABS: { id: SiteOperationsTab; label: string }[] = [
  { id: "equipment", label: "Équipements" },
  { id: "maintenance", label: "Maintenance" },
  { id: "budget", label: "Budget" },
  { id: "grids", label: "Grilles" },
  { id: "sla", label: "Délais" },
  { id: "erp", label: "Contrôles ERP" },
  { id: "history", label: "Historique" },
];
const LOAD_FAILURE = "Les données du site n’ont pas pu être chargées.";

export function SiteOperationsView(props: SiteOperationsViewProps) {
  const { state, scope, unavailableMessage } = props;
  if (state !== "available")
    return (
      <div className="unavailable" role="note" data-blocker="site-operations">
        <div>
          <strong>Opérations du site</strong>
          <p>{state === "unknown" ? "Vérification de la disponibilité du service…" : unavailableMessage}</p>
        </div>
      </div>
    );
  if (!scope.siteId)
    return (
      <div className="empty-state">
        <h3>Choisissez un site</h3>
        <p>Les équipements, plans, budgets, délais et contrôles sont rattachés à un site de votre organisation.</p>
      </div>
    );
  // Remount on any scope change: forms, drafts and loaded data are discarded, then reloaded.
  return <Content key={scopeKey(scope)} {...props} siteId={scope.siteId} />;
}

function Content({ scope, client, demo, onNavigate, siteId }: SiteOperationsViewProps & { siteId: string }) {
  const [tab, setTab] = useState<SiteOperationsTab>("equipment");
  const [report, setReport] = useState<SiteOperationsReport | null>(demo ?? null);
  const [loading, setLoading] = useState(!demo);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    if (demo) return;
    setLoading(true);
    setError("");
    try {
      const next = await client.load(siteId);
      if (!alive.current || next === null) return; // stale chain: keep nothing
      setReport(next);
    } catch (e) {
      if (alive.current) setError(messageOf(e) || LOAD_FAILURE);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [client, demo, siteId]);
  useEffect(() => {
    void load();
  }, [load]);
  const run = useCallback(
    async (command: SiteOperationsCommand): Promise<RunOutcome> => {
      if (busy) return { status: "failed", message: BUSY_MESSAGE };
      setBusy(true);
      try {
        const outcome = outcomeOf(await client.command(command), alive.current);
        if (outcome.status === "done") await load();
        return outcome;
      } catch (e) {
        return { status: "failed", message: messageOf(e) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [busy, client, load],
  );
  const authority = resolveAuthority(scope, report);
  const context: PanelContext | null = report ? { report, ...authority, busy, run, onNavigate } : null;
  return (
    <div className={styles.root} data-demo={demo ? "true" : undefined}>
      {demo && (
        <p className={styles.demoBanner} role="note">
          Démonstration — données fictives. Rien n’est enregistré.
        </p>
      )}
      {report && (
        <div className={styles.header}>
          <div>
            <h2>{report.snapshot.site.name}</h2>
            <p className={styles.muted}>
              Calculé le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.computed_at))}
              {report.completeness.truncated.length > 0 && " · certaines listes sont tronquées"}
            </p>
          </div>
          {!demo && (
            <button type="button" className="button outline" onClick={() => void load()} disabled={loading || busy}>
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          )}
        </div>
      )}
      {error && (
        <Notice tone="error" onClose={() => setError("")}>
          {error}{" "}
          <button type="button" className={styles.link} onClick={() => void load()} disabled={loading}>
            Réessayer
          </button>
        </Notice>
      )}
      {loading && !report && <Loading label="Chargement des opérations du site…" />}
      {context && (
        <>
          <div className="tabs" role="tablist" aria-label="Sections des opérations du site">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" id={`so-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`so-panel-${t.id}`} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`so-panel-${tab}`} aria-labelledby={`so-tab-${tab}`} className={styles.panel} aria-busy={busy || loading}>
            {tab === "equipment" && <EquipmentPanel context={context} />}
            {tab === "maintenance" && <MaintenancePanel context={context} />}
            {tab === "budget" && <BudgetPanel context={context} />}
            {tab === "grids" && <GridsPanel context={context} />}
            {tab === "sla" && <SlaPanel context={context} />}
            {tab === "erp" && <ErpPanel context={context} />}
            {tab === "history" && <HistoryPanel context={context} />}
          </div>
        </>
      )}
    </div>
  );
}
