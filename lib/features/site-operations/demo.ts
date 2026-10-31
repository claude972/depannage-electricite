// Demonstration seeds for the site operations lot. Every value is fictitious and labelled as
// such; nothing here is a real site, rate, delay, calendar or regulatory statement. Only the
// lead decides to inject `demoClient`; the leaf component never imports this module.
import { buildReport } from "./report";
import { commandSchema } from "./schemas";
import type { SiteOperationsClient, SiteOperationsCommand, SiteOperationsCommandResult, SiteOperationsReport, SiteOperationsSnapshot } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const SITE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const at = "2026-10-01T08:00:00.000Z";
const audited = (id: string) => ({ id, version: 1, created_by: USER, created_at: at, updated_at: at });
export const DEMO_SITE_ID = SITE;
export const DEMO_ORGANIZATION_ID = ORG;

export function demoSnapshot(): SiteOperationsSnapshot {
  return {
    site: { id: SITE, organization_id: ORG, name: "Démonstration — établissement fictif", type: "erp", budget_cents: 0 },
    equipment: [
      { ...audited("e1000000-0000-4000-8000-000000000001"), site_id: SITE, name: "Démonstration — tableau général", category: "panel", criticality: "critical", location: "Local technique (fictif)", reference: "DEMO-TGBT", installed_on: null, status: "in_service", notes: "Donnée de démonstration." },
      { ...audited("e1000000-0000-4000-8000-000000000002"), site_id: SITE, name: "Démonstration — éclairage de sécurité", category: "emergency_lighting", criticality: "high", location: "Circulations (fictif)", reference: "", installed_on: "2024-03-12", status: "degraded", notes: "" },
    ],
    maintenance_plans: [
      { ...audited("a1000000-0000-4000-8000-000000000001"), site_id: SITE, equipment_id: "e1000000-0000-4000-8000-000000000002", title: "Démonstration — vérification périodique", frequency_kind: "months", frequency_value: 6, next_due_on: "2026-09-15", last_done_on: "2026-03-15", status: "active", notes: "", visits: [{ id: "b1000000-0000-4000-8000-000000000001", plan_id: "a1000000-0000-4000-8000-000000000001", site_id: SITE, done_on: "2026-03-15", intervention_id: null, summary: "Démonstration — visite fictive.", created_by: USER, created_at: at }], visits_total: 1 },
      { ...audited("a1000000-0000-4000-8000-000000000002"), site_id: SITE, equipment_id: null, title: "Démonstration — plan sans périodicité", frequency_kind: "none", frequency_value: null, next_due_on: null, last_done_on: null, status: "active", notes: "", visits: [], visits_total: 0 },
    ],
    fiscal_years: [{ ...audited("f1000000-0000-4000-8000-000000000001"), organization_id: ORG, label: "Démonstration — exercice 2026", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "open" }],
    budget_lines: [{ ...audited("c1000000-0000-4000-8000-000000000001"), site_id: SITE, fiscal_year_id: "f1000000-0000-4000-8000-000000000001", category: "maintenance", amount_cents: 480000, note: "Montant fictif de démonstration." }],
    budget_consumption: [{ fiscal_year_id: "f1000000-0000-4000-8000-000000000001", accepted_cents: 126000, paid_cents: 90000, interventions: 2 }],
    contract_grids: [{ ...audited("d1000000-0000-4000-8000-000000000001"), organization_id: ORG, lineage_id: "d1000000-0000-4000-8000-00000000000a", version_number: 1, label: "Démonstration — grille fictive", contract_id: null, effective_from: "2026-01-01", currency: "EUR", status: "published", published_at: at, lines: [{ label: "Déplacement (fictif)", unit: "visit", amount_cents: 4500, note: "" }, { label: "Main-d’œuvre (fictif)", unit: "hour", amount_cents: 6000, note: "" }] }],
    sla_calendars: [{ ...audited("91000000-0000-4000-8000-000000000001"), organization_id: ORG, name: "Démonstration — jours ouvrés fictifs", timezone: "America/Martinique", windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" })), closed_dates: [] }],
    sla_policies: [
      { ...audited("81000000-0000-4000-8000-000000000001"), site_id: SITE, name: "Démonstration — urgences", calendar_id: "91000000-0000-4000-8000-000000000001", urgency: "urgent", response_target_minutes: 240, resolution_target_minutes: 1440, status: "active" },
      { ...audited("81000000-0000-4000-8000-000000000002"), site_id: SITE, name: "Démonstration — sans calendrier", calendar_id: null, urgency: null, response_target_minutes: 60, resolution_target_minutes: null, status: "active" },
    ],
    sla_cases: [
      { ...audited("71000000-0000-4000-8000-000000000001"), site_id: SITE, policy_id: "81000000-0000-4000-8000-000000000001", intervention_id: null, reference: "DEMO-001", opened_at: "2026-09-28T13:00:00.000Z", responded_at: "2026-09-28T15:30:00.000Z", resolved_at: null, notes: "", pauses: [{ id: "61000000-0000-4000-8000-000000000001", case_id: "71000000-0000-4000-8000-000000000001", site_id: SITE, started_at: "2026-09-29T12:00:00.000Z", ended_at: null, reason: "Démonstration — attente de pièce.", created_by: USER, created_at: at }], pauses_total: 1 },
      { ...audited("71000000-0000-4000-8000-000000000002"), site_id: SITE, policy_id: "81000000-0000-4000-8000-000000000002", intervention_id: null, reference: "DEMO-002", opened_at: "2026-09-30T09:00:00.000Z", responded_at: null, resolved_at: null, notes: "", pauses: [], pauses_total: 0 },
    ],
    erp_checklists: [{ ...audited("51000000-0000-4000-8000-000000000001"), site_id: SITE, title: "Démonstration — contrôle déclaratif", nature: "declarative", description: "Liste fictive de démonstration.", performed_on: "2026-09-20", performed_by_label: "Responsable fictif", status: "completed", items: [{ key: "demo-1", label: "Élément vérifié (fictif)", state: "ok", note: "", reserve_resolved_on: null }, { key: "demo-2", label: "Réserve ouverte (fictive)", state: "reserve", note: "À traiter.", reserve_resolved_on: null }] }],
    events: [{ id: 1, site_id: SITE, actor_id: USER, entity: "equipment", entity_id: "e1000000-0000-4000-8000-000000000001", action: "created", version: 1, created_at: at }],
    limits: { equipment_limited: false, maintenance_plans_limited: false, fiscal_years_limited: false, budget_lines_limited: false, contract_grids_limited: false, contract_grids_readable: true, sla_calendars_limited: false, sla_policies_limited: false, sla_cases_limited: false, erp_checklists_limited: false, events_limited: false, can_write_site: true, can_write_organization: true },
  };
}
export function demoReport(now = "2026-10-01T10:00:00.000Z"): SiteOperationsReport {
  return buildReport(SITE, demoSnapshot(), now);
}
export const DEMO_COMMAND_MESSAGE = "Démonstration : action non disponible.";
/**
 * Strictly isolated demonstration client: no network, no persistence, no mix with real data.
 * Loads the seed report; validates commands like the server then refuses them honestly.
 */
export function demoClient(seed: SiteOperationsReport = demoReport()): SiteOperationsClient {
  return {
    async load(siteId: string) {
      return siteId === seed.site_id ? seed : null;
    },
    async command(command: SiteOperationsCommand): Promise<SiteOperationsCommandResult | null> {
      const parsed = commandSchema.safeParse(command);
      throw new Error(parsed.success ? DEMO_COMMAND_MESSAGE : parsed.error.issues[0]?.message ?? "Vérifiez les informations saisies.");
    },
  };
}
