// Command schemas: strict keys, version rule, business refinements, RPC mapping.
import test from "node:test";
import assert from "node:assert/strict";
import { commandSchema, isValidTimeZone, slaCalendarPayload, toRpc } from "../../lib/features/site-operations/schemas";

const site = "22222222-2222-4222-8222-222222222222";
const org = "11111111-1111-4111-8111-111111111111";
const id = "e1000000-0000-4000-8000-000000000001";
const equipment = { name: "QA tableau", category: "panel", criticality: "high", location: "", reference: "", installed_on: null, status: "in_service", notes: "" };
const ok = (c: unknown) => {
  const r = commandSchema.safeParse(c);
  assert.ok(r.success, JSON.stringify(r.success ? null : r.error.issues[0]));
  return r.data;
};
const ko = (c: unknown, pattern?: RegExp) => {
  const r = commandSchema.safeParse(c);
  assert.equal(r.success, false, "expected rejection");
  if (pattern && !r.success) assert.match(r.error.issues[0]?.message ?? "", pattern);
};

test("strict keys and the id/expected_version pairing", () => {
  ok({ action: "save_equipment", site_id: site, payload: equipment });
  ok({ action: "save_equipment", site_id: site, payload: equipment, id, expected_version: 3 });
  ko({ action: "save_equipment", site_id: site, payload: equipment, id }, /version attendue/);
  ko({ action: "save_equipment", site_id: site, payload: equipment, expected_version: 1 }, /version attendue/);
  ko({ action: "save_equipment", site_id: site, payload: { ...equipment, extra: true } });
  ko({ action: "save_equipment", site_id: site, payload: equipment, extra: true });
  ko({ action: "delete_equipment", site_id: site });
  ko({ action: "save_equipment", site_id: "site", payload: equipment });
  ko({ action: "save_equipment", site_id: site, payload: { ...equipment, name: "   " } });
  ko({ action: "save_equipment", site_id: site, payload: { ...equipment, installed_on: "12/03/2024" } }, /AAAA-MM-JJ/);
});
test("maintenance frequency, fiscal year order, budget bounds", () => {
  const plan = { equipment_id: null, title: "QA", frequency_kind: "months", frequency_value: 6, next_due_on: null, last_done_on: null, status: "active", notes: "" };
  ok({ action: "save_maintenance_plan", site_id: site, payload: plan });
  ok({ action: "save_maintenance_plan", site_id: site, payload: { ...plan, frequency_kind: "none", frequency_value: null } });
  ko({ action: "save_maintenance_plan", site_id: site, payload: { ...plan, frequency_value: null } }, /périodicité/);
  ko({ action: "save_maintenance_plan", site_id: site, payload: { ...plan, frequency_kind: "none" } }, /périodicité/);
  ok({ action: "record_maintenance_visit", plan_id: id, done_on: "2026-10-10", summary: "", intervention_id: null });
  ko({ action: "record_maintenance_visit", plan_id: id, done_on: "2026-10-10", summary: "" });
  ok({ action: "save_fiscal_year", organization_id: org, payload: { label: "QA 2026", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "open" } });
  ko({ action: "save_fiscal_year", organization_id: org, payload: { label: "QA", starts_on: "2026-12-31", ends_on: "2026-01-01", status: "open" } }, /précède/);
  ok({ action: "save_budget_line", site_id: site, fiscal_year_id: id, category: "repairs", amount_cents: 0, note: "" });
  ko({ action: "save_budget_line", site_id: site, fiscal_year_id: id, category: "repairs", amount_cents: 10.5, note: "" });
  ko({ action: "save_budget_line", site_id: site, fiscal_year_id: id, category: "repairs", amount_cents: 100000001, note: "" });
});
test("contract grids carry only entered amounts; publish needs a version", () => {
  const grid = { label: "QA", contract_id: null, effective_from: null, lines: [{ label: "Déplacement", unit: "visit", amount_cents: 4500, note: "" }] };
  ok({ action: "save_contract_grid", organization_id: org, payload: grid });
  ok({ action: "save_contract_grid", organization_id: org, payload: { ...grid, from_grid_id: id } });
  ko({ action: "save_contract_grid", organization_id: org, payload: { ...grid, lines: [{ label: "x", unit: "day", amount_cents: 1, note: "" }] } });
  ko({ action: "save_contract_grid", organization_id: org, payload: { ...grid, lines: [{ label: "x", unit: "hour", amount_cents: -1, note: "" }] } });
  ok({ action: "publish_contract_grid", id, expected_version: 2 });
  ko({ action: "publish_contract_grid", id });
});
test("SLA calendar needs a real IANA zone and coherent windows; cases keep chronology", () => {
  assert.equal(isValidTimeZone("Europe/Paris"), true);
  assert.equal(isValidTimeZone("America/Martinique"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone("Europe/Paris; drop"), false);
  const calendar = { name: "QA", timezone: "Europe/Paris", windows: [{ weekday: 1, start: "08:00", end: "12:00" }], closed_dates: ["2026-12-25"] };
  ok({ action: "save_sla_calendar", organization_id: org, payload: calendar });
  assert.equal(slaCalendarPayload.safeParse({ ...calendar, timezone: "Nowhere/City" }).success, false);
  ko({ action: "save_sla_calendar", organization_id: org, payload: { ...calendar, windows: [{ weekday: 1, start: "12:00", end: "08:00" }] } }, /suivre son début/);
  ko({ action: "save_sla_calendar", organization_id: org, payload: { ...calendar, windows: [{ weekday: 0, start: "08:00", end: "12:00" }] } });
  ko({ action: "save_sla_calendar", organization_id: org, payload: { ...calendar, windows: [{ weekday: 1, start: "8:00", end: "12:00" }] } }, /HH:MM/);
  const policy = { name: "QA", calendar_id: null, urgency: null, response_target_minutes: null, resolution_target_minutes: null, status: "active" };
  ok({ action: "save_sla_policy", site_id: site, payload: policy });
  ko({ action: "save_sla_policy", site_id: site, payload: { ...policy, response_target_minutes: 0 } });
  const kase = { policy_id: id, intervention_id: null, reference: "", opened_at: "2026-10-05T07:00:00Z", responded_at: null, resolved_at: null, notes: "" };
  ok({ action: "save_sla_case", site_id: site, payload: kase });
  ko({ action: "save_sla_case", site_id: site, payload: { ...kase, responded_at: "2026-10-05T06:00:00Z" } }, /précéder l’ouverture/);
  ko({ action: "save_sla_case", site_id: site, payload: { ...kase, responded_at: "2026-10-05T08:00:00Z", resolved_at: "2026-10-05T07:30:00Z" } }, /résolution/);
  ko({ action: "save_sla_case", site_id: site, payload: { ...kase, opened_at: "2026-10-05 07:00" } }, /ISO/);
  ko({ action: "save_sla_case", site_id: site, payload: { ...kase, opened_at: "2026-13-45T07:00:00Z" } }, /invalide/);
  ok({ action: "pause_sla_case", id, started_at: "2026-10-05T07:00:00Z", reason: "QA", expected_version: 1 });
  ok({ action: "resume_sla_case", id, ended_at: "2026-10-05T07:00:00Z", expected_version: 1 });
});
test("ERP checklist items are declarative, bounded and unique by key", () => {
  const checklist = { title: "QA", description: "", performed_on: null, performed_by_label: "", status: "draft", items: [{ key: "a", label: "QA", state: "ok", note: "", reserve_resolved_on: null }] };
  ok({ action: "save_erp_checklist", site_id: site, payload: checklist });
  ko({ action: "save_erp_checklist", site_id: site, payload: { ...checklist, nature: "declarative" } }, undefined);
  ko({ action: "save_erp_checklist", site_id: site, payload: { ...checklist, items: [checklist.items[0], checklist.items[0]] } }, /clé unique/);
  ko({ action: "save_erp_checklist", site_id: site, payload: { ...checklist, items: [{ ...checklist.items[0], state: "certified" }] } });
  ko({ action: "save_erp_checklist", site_id: site, payload: { ...checklist, items: [{ ...checklist.items[0], key: "bad key" }] } }, /Clé/);
});
test("every command maps to its SQL entry point with null defaults", () => {
  const equipmentRpc = toRpc(ok({ action: "save_equipment", site_id: site, payload: equipment }));
  assert.equal(equipmentRpc.fn, "save_site_equipment");
  assert.deepEqual(equipmentRpc.args, { p_site_id: site, p_payload: equipment, p_id: null, p_expected_version: null });
  const budget = toRpc(ok({ action: "save_budget_line", site_id: site, fiscal_year_id: id, category: "other", amount_cents: 5, note: "QA" }));
  assert.deepEqual(budget, { fn: "save_budget_line", args: { p_site_id: site, p_fiscal_year_id: id, p_category: "other", p_amount_cents: 5, p_note: "QA", p_expected_version: null } });
  const pause = toRpc(ok({ action: "pause_sla_case", id, started_at: "2026-10-05T07:00:00Z", reason: "QA", expected_version: 4 }));
  assert.deepEqual(pause, { fn: "pause_sla_case", args: { p_case_id: id, p_started_at: "2026-10-05T07:00:00Z", p_reason: "QA", p_expected_version: 4 } });
  const visit = toRpc(ok({ action: "record_maintenance_visit", plan_id: id, done_on: "2026-10-10", summary: "QA", intervention_id: null }));
  assert.equal(visit.fn, "record_maintenance_visit");
  const names = new Set<string>();
  for (const c of [
    { action: "save_maintenance_plan", site_id: site, payload: { equipment_id: null, title: "QA", frequency_kind: "none", frequency_value: null, next_due_on: null, last_done_on: null, status: "active", notes: "" } },
    { action: "save_fiscal_year", organization_id: org, payload: { label: "QA", starts_on: "2026-01-01", ends_on: "2026-12-31", status: "open" } },
    { action: "save_contract_grid", organization_id: org, payload: { label: "QA", contract_id: null, effective_from: null, lines: [] } },
    { action: "publish_contract_grid", id, expected_version: 1 },
    { action: "save_sla_calendar", organization_id: org, payload: { name: "QA", timezone: "UTC", windows: [], closed_dates: [] } },
    { action: "save_sla_policy", site_id: site, payload: { name: "QA", calendar_id: null, urgency: null, response_target_minutes: null, resolution_target_minutes: null, status: "active" } },
    { action: "save_sla_case", site_id: site, payload: { policy_id: id, intervention_id: null, reference: "", opened_at: "2026-10-05T07:00:00Z", responded_at: null, resolved_at: null, notes: "" } },
    { action: "resume_sla_case", id, ended_at: "2026-10-05T07:00:00Z", expected_version: 1 },
    { action: "save_erp_checklist", site_id: site, payload: { title: "QA", description: "", performed_on: null, performed_by_label: "", status: "draft", items: [] } },
  ])
    names.add(toRpc(ok(c)).fn);
  assert.equal(names.size, 9);
});
