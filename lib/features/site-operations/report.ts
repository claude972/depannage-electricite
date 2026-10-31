// Builds the GET report from the raw snapshot: SLA evaluation per case (server computed) and
// completeness flags so the UI never claims "no alert" on partial or truncated data.
import { evaluateSlaCase } from "./sla";
import type { Completeness, SiteOperationsReport, SiteOperationsSnapshot, SlaEvaluation, SlaSummary } from "./types";

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function evaluateCases(snapshot: SiteOperationsSnapshot, now: string): SlaEvaluation[] {
  const policies = new Map(snapshot.sla_policies.map((p) => [p.id, p]));
  const calendars = new Map(snapshot.sla_calendars.map((c) => [c.id, c]));
  return snapshot.sla_cases.map((c) => {
    const policy = policies.get(c.policy_id);
    const calendar = policy?.calendar_id ? calendars.get(policy.calendar_id) ?? null : null;
    return evaluateSlaCase(
      { case_id: c.id, policy_id: c.policy_id },
      calendar ? { timezone: calendar.timezone, windows: calendar.windows, closed_dates: calendar.closed_dates } : null,
      { response_target_minutes: policy?.response_target_minutes ?? null, resolution_target_minutes: policy?.resolution_target_minutes ?? null },
      { opened_at: c.opened_at, responded_at: c.responded_at, resolved_at: c.resolved_at, pauses: c.pauses, pauses_total: c.pauses_total },
      now,
    );
  });
}
export function summarize(cases: SlaEvaluation[]): SlaSummary {
  const summary: SlaSummary = { cases: cases.length, measurable: 0, not_measurable: 0, breached: 0, pending: 0, met: 0 };
  for (const c of cases) {
    if (!c.measurable) {
      summary.not_measurable++;
      continue;
    }
    summary.measurable++;
    const statuses = [c.response.status, c.resolution.status];
    if (statuses.includes("breached")) summary.breached++;
    else if (statuses.includes("pending")) summary.pending++;
    else summary.met++;
  }
  return summary;
}
export function completeness(snapshot: SiteOperationsSnapshot, cases: SlaEvaluation[], now: string): Completeness {
  const today = isoDate(Date.parse(now));
  const current = snapshot.fiscal_years.find((f) => f.starts_on <= today && f.ends_on >= today) ?? null;
  const scheduled = snapshot.maintenance_plans.filter((p) => p.status !== "archived" && p.next_due_on !== null);
  const openReserves = snapshot.erp_checklists
    .filter((c) => c.status !== "archived")
    .reduce((n, c) => n + c.items.filter((i) => i.state === "reserve" && i.reserve_resolved_on === null).length, 0);
  const l = snapshot.limits;
  const truncated = (
    [
      ["equipment", l.equipment_limited],
      ["maintenance_plans", l.maintenance_plans_limited],
      ["fiscal_years", l.fiscal_years_limited],
      ["budget_lines", l.budget_lines_limited],
      ["contract_grids", l.contract_grids_limited],
      ["sla_calendars", l.sla_calendars_limited],
      ["sla_policies", l.sla_policies_limited],
      ["sla_cases", l.sla_cases_limited],
      ["erp_checklists", l.erp_checklists_limited],
      ["events", l.events_limited],
    ] as const
  )
    .filter(([, limited]) => limited)
    .map(([name]) => name);
  return {
    budget: {
      fiscal_years: snapshot.fiscal_years.length,
      current_fiscal_year_id: current?.id ?? null,
      lines: snapshot.budget_lines.length,
      configured: current !== null && snapshot.budget_lines.some((b) => b.fiscal_year_id === current.id),
    },
    sla: {
      calendars: snapshot.sla_calendars.length,
      policies: snapshot.sla_policies.filter((p) => p.status === "active").length,
      cases: cases.length,
      measurable: cases.filter((c) => c.measurable).length,
      not_measurable: cases.filter((c) => !c.measurable).length,
    },
    maintenance: {
      plans: snapshot.maintenance_plans.filter((p) => p.status !== "archived").length,
      without_schedule: snapshot.maintenance_plans.filter((p) => p.status !== "archived" && p.next_due_on === null).length,
      overdue: scheduled.length ? scheduled.filter((p) => p.next_due_on! < today).length : null,
    },
    erp: { checklists: snapshot.erp_checklists.filter((c) => c.status !== "archived").length, open_reserves: openReserves },
    contract_grids: {
      readable: snapshot.contract_grids !== null,
      published: snapshot.contract_grids ? snapshot.contract_grids.filter((g) => g.status === "published").length : null,
    },
    truncated,
  };
}
export function buildReport(siteId: string, snapshot: SiteOperationsSnapshot, now = new Date().toISOString()): SiteOperationsReport {
  const cases = evaluateCases(snapshot, now);
  return { site_id: siteId, snapshot, sla: { cases, summary: summarize(cases) }, completeness: completeness(snapshot, cases, now), computed_at: now };
}
