"use client";
// ADV-B2B-OPERATIONS-001 — single normalized entry point (contract WEB-SHARED-001, amendments
// A1/A2). Receives state, scope, client, unavailableMessage, demo?, onNavigate?; never fetches,
// never derives rights, never navigates by itself. A null result from the injected client means
// a stale identity chain: nothing is shown or updated. Any change of userId, organizationId or
// siteId remounts the content, clearing forms, drafts and loaded data.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SiteOperationsCommand, SiteOperationsViewProps } from "../../../lib/features/site-operations/types";
import { BudgetPanel } from "./budget-panel";
import { EquipmentPanel } from "./equipment-panel";
import { ErpPanel } from "./erp-panel";
import { GridsPanel } from "./grids-panel";
import { HistoryPanel } from "./history-panel";
import { MaintenancePanel } from "./maintenance-panel";
import { Loading, Notice, type InterventionSearchBinding, type PanelContext } from "./shared";
import { BUSY_MESSAGE, INITIAL_LOAD, applyLoadResult, messageOf, outcomeOf, resolveAuthority, scopeKey, type LoadState, type RunOutcome } from "../../../lib/features/site-operations/view-model";
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

type ViewProps = SiteOperationsViewProps & {
  /** ENT-07: paginated intervention choice for SLA cases (live only). */
  interventionSearch?: InterventionSearchBinding;
};
export function SiteOperationsView(props: ViewProps) {
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

function Content({ scope, client, demo, onNavigate, siteId, interventionSearch }: ViewProps & { siteId: string }) {
  const [tab, setTab] = useState<SiteOperationsTab>("equipment");
  const [data, setData] = useState<LoadState>(demo ? { report: demo, error: "", stale: false } : INITIAL_LOAD);
  const { report, error, stale } = data;
  const [loading, setLoading] = useState(!demo);
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
    try {
      const next = await client.load(siteId);
      if (!alive.current) return;
      // null = stale chain: no data update, previous report frozen (not actionable).
      setData((previous) => applyLoadResult(previous, next === null ? { kind: "stale" } : { kind: "ok", report: next }));
    } catch (e) {
      // Refusal (403/404) or failure (503): the displayed report and its write authority are invalidated.
      if (alive.current) setData((previous) => applyLoadResult(previous, { kind: "error", message: messageOf(e) || LOAD_FAILURE }));
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
        else if (outcome.status === "stale" && alive.current) setData((previous) => applyLoadResult(previous, { kind: "stale" }));
        return outcome;
      } catch (e) {
        return { status: "failed", message: messageOf(e) };
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [busy, client, load],
  );
  const authority = resolveAuthority(scope, report, stale);
  const context: PanelContext | null = report ? { report, ...authority, busy, run, onNavigate, interventionSearch: demo ? undefined : interventionSearch } : null;
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
              {report.completeness.truncated.length > 0 && ` · ${report.completeness.truncated.length} liste${report.completeness.truncated.length > 1 ? "s" : ""} tronquée${report.completeness.truncated.length > 1 ? "s" : ""} : les totaux affichés sont partiels`}
            </p>
          </div>
          {!demo && (
            <button type="button" className="button outline" onClick={() => void load()} disabled={loading || busy}>
              {loading ? "Actualisation…" : "Actualiser"}
            </button>
          )}
        </div>
      )}
      {error && !loading && (
        <div className="unavailable" role="alert" data-blocker="site-operations-load">
          <div>
            <strong>Données du site indisponibles</strong>
            <p>{error}</p>
            <button type="button" className="button outline" onClick={() => void load()}>
              Réessayer
            </button>
          </div>
        </div>
      )}
      {stale && !loading && (
        <Notice tone="warning">
          {authority.readOnlyReason}{" "}
          <button type="button" className={styles.link} onClick={() => void load()}>
            Actualiser
          </button>
        </Notice>
      )}
      {loading && !report && <Loading label="Chargement des opérations du site…" />}
      {context && (
        <>
          <div className={`tabs ${styles.tablist}`} role="tablist" aria-label="Sections des opérations du site">
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
