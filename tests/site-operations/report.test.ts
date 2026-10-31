// Report assembly and completeness flags on synthetic QA snapshots.
import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, summarize } from "../../lib/features/site-operations/report";
import { demoSnapshot, demoReport, demoClient, DEMO_COMMAND_MESSAGE, DEMO_SITE_ID } from "../../lib/features/site-operations/demo";
import type { SiteOperationsSnapshot } from "../../lib/features/site-operations/types";

const NOW = "2026-10-01T10:00:00.000Z";
function emptySnapshot(): SiteOperationsSnapshot {
  const seed = demoSnapshot();
  return {
    ...seed,
    equipment: [], maintenance_plans: [], fiscal_years: [], budget_lines: [], budget_consumption: [], contract_grids: null,
    sla_calendars: [], sla_policies: [], sla_cases: [], erp_checklists: [], events: [],
    limits: { ...seed.limits, contract_grids_readable: false, can_write_site: false, can_write_organization: false },
  };
}

test("an empty site reports nothing as configured and no overdue figure (null, not zero)", () => {
  const report = buildReport("site", emptySnapshot(), NOW);
  assert.equal(report.completeness.budget.configured, false);
  assert.equal(report.completeness.budget.current_fiscal_year_id, null);
  assert.equal(report.completeness.maintenance.overdue, null, "no scheduled plan: overdue is unknown, not zero");
  assert.equal(report.completeness.contract_grids.readable, false);
  assert.equal(report.completeness.contract_grids.published, null);
  assert.deepEqual(report.sla.summary, { cases: 0, measurable: 0, not_measurable: 0, breached: 0, pending: 0, met: 0 });
  assert.deepEqual(report.completeness.truncated, []);
  assert.equal(report.computed_at, NOW);
});
test("the demo snapshot yields measurable and not-measurable cases, overdue plans, open reserves", () => {
  const report = demoReport(NOW);
  assert.equal(report.site_id, DEMO_SITE_ID);
  assert.equal(report.completeness.budget.configured, true);
  assert.equal(report.completeness.budget.current_fiscal_year_id, "f1000000-0000-4000-8000-000000000001");
  assert.equal(report.completeness.maintenance.plans, 2);
  assert.equal(report.completeness.maintenance.without_schedule, 1);
  assert.equal(report.completeness.maintenance.overdue, 1, "next_due_on 2026-09-15 is before 2026-10-01");
  assert.equal(report.completeness.erp.open_reserves, 1);
  assert.equal(report.completeness.contract_grids.published, 1);
  assert.equal(report.sla.summary.cases, 2);
  assert.equal(report.sla.summary.not_measurable, 1, "policy without calendar");
  assert.equal(report.sla.summary.measurable, 1);
  const paused = report.sla.cases.find((c) => c.case_id === "71000000-0000-4000-8000-000000000001")!;
  assert.equal(paused.paused_now, true);
  assert.equal(paused.response.status, "met");
  assert.equal(paused.resolution.status, "pending");
  const unmeasurable = report.sla.cases.find((c) => c.case_id === "71000000-0000-4000-8000-000000000002")!;
  assert.deepEqual(unmeasurable.reasons, ["no_calendar"]);
  for (const text of JSON.stringify(report.snapshot).match(/"name":"[^"]+"|"title":"[^"]+"|"label":"[^"]+"/g) ?? [])
    assert.match(text, /Démonstration|ficti/, `demo label ${text}`);
});
test("truncation flags surface in completeness and summary counts breached before pending", () => {
  const seed = demoSnapshot();
  seed.limits.sla_cases_limited = true;
  seed.limits.events_limited = true;
  const report = buildReport("site", seed, NOW);
  assert.deepEqual(report.completeness.truncated, ["sla_cases", "events"]);
  const summary = summarize([
    { case_id: "a", policy_id: "p", measurable: true, reasons: [], paused_now: false, response: { ...track("met") }, resolution: { ...track("breached") } },
    { case_id: "b", policy_id: "p", measurable: true, reasons: [], paused_now: false, response: { ...track("met") }, resolution: { ...track("pending") } },
    { case_id: "c", policy_id: "p", measurable: true, reasons: [], paused_now: false, response: { ...track("met") }, resolution: { ...track("not_measurable") } },
    { case_id: "d", policy_id: "p", measurable: false, reasons: ["no_calendar"], paused_now: false, response: { ...track("not_measurable") }, resolution: { ...track("not_measurable") } },
  ]);
  assert.deepEqual(summary, { cases: 4, measurable: 3, not_measurable: 1, breached: 1, pending: 1, met: 1 });
});
test("the demo client never reaches the network: it serves the seed and refuses commands honestly", async () => {
  const client = demoClient();
  assert.equal((await client.load(DEMO_SITE_ID))?.site_id, DEMO_SITE_ID);
  assert.equal(await client.load("other"), null);
  await assert.rejects(
    client.command({ action: "publish_contract_grid", id: "d1000000-0000-4000-8000-000000000001", expected_version: 1 }),
    (e: unknown) => e instanceof Error && e.message === DEMO_COMMAND_MESSAGE,
  );
  await assert.rejects(
    client.command({ action: "publish_contract_grid", id: "not-a-uuid", expected_version: 1 }),
    (e: unknown) => e instanceof Error && e.message !== DEMO_COMMAND_MESSAGE,
    "invalid input is reported as validation, like the server",
  );
});
const track = (status: "met" | "breached" | "pending" | "not_measurable") => ({
  target_minutes: status === "not_measurable" ? null : 60,
  deadline_at: null,
  elapsed_minutes: null,
  remaining_minutes: null,
  status,
  reason: status === "not_measurable" ? ("no_target" as const) : null,
});
