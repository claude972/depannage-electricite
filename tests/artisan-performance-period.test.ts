// ART-10 — period report: revenue by source, punctuality rule and route validation.
import test from "node:test";
import assert from "node:assert/strict";
import { buildPeriodReport, firstArrivals, parsePeriod, punctualityReport, revenueReport } from "../lib/features/artisan-performance/period-report";
import { customBounds, parsePeriodReport, presetBounds, punctualityText } from "../components/features/artisan-performance/period-model";
import { GET } from "../app/api/artisan/performance/period/route";

const START = "2026-11-01T04:00:00.000Z", END = "2026-12-01T04:00:00.000Z";
const J1 = "d0000000-0000-4000-8000-000000000001", J2 = "d0000000-0000-4000-8000-000000000002", J3 = "d0000000-0000-4000-8000-000000000003", J4 = "d0000000-0000-4000-8000-000000000004";

test("period bounds: ISO instants with offset, ordered, capped at three years", () => {
  assert.deepEqual(parsePeriod(START, END), { ok: true, start: START, end: END });
  for (const [s, e] of [[null, END], [START, null], ["2026-11-01", END], ["2026-11-01T00:00:00", END], [END, START], [START, START], ["2020-01-01T00:00:00Z", END]] as const)
    assert.equal(parsePeriod(s, e).ok, false, `${s} ${e}`);
});

test("revenue: sum and split by payment source, exact cents", () => {
  const r = revenueReport([{ total_cents: 13020, method: "stripe" }, { total_cents: 4340, method: "stripe" }, { total_cents: 5000, method: "on_site_declared" }]);
  assert.deepEqual(r, { paid_cents: 22360, paid_count: 3, by_source: [{ source: "stripe", paid_cents: 17360, paid_count: 2 }, { source: "on_site_declared", paid_cents: 5000, paid_count: 1 }] });
  assert.deepEqual(revenueReport([]), { paid_cents: 0, paid_count: 0, by_source: [] });
  assert.throws(() => revenueReport([{ total_cents: 1.5, method: "stripe" }]));
});

test("punctuality: first presence vs end of the slot in force; no slot → not measured; no data → null", () => {
  const slot = (id: string, saved: string, ends: string) => ({ intervention_id: id, created_at: saved, starts_at: "2026-11-10T13:00:00Z", ends_at: ends });
  const arrivals = [
    { intervention_id: J1, action: "travel_on_site", created_at: "2026-11-10T13:30:00Z" }, // within the slot → on time
    { intervention_id: J1, action: "start", created_at: "2026-11-10T13:40:00Z" },
    { intervention_id: J2, action: "start", created_at: "2026-11-10T15:00:01Z" }, // start only, after the slot end → late
    { intervention_id: J3, action: "start", created_at: "2026-11-12T10:00:00Z" }, // no slot at all → excluded
    { intervention_id: J4, action: "travel_on_site", created_at: "2026-10-30T10:00:00Z" }, // first presence before the period → ignored
    { intervention_id: J4, action: "start", created_at: "2026-11-02T10:00:00Z" },
  ];
  const slots = [
    slot(J1, "2026-11-09T10:00:00Z", "2026-11-10T14:00:00Z"),
    slot(J1, "2026-11-10T18:00:00Z", "2026-11-10T12:00:00Z"), // changed AFTER the arrival: ignored
    slot(J2, "2026-11-09T10:00:00Z", "2026-11-10T15:00:00Z"),
    slot(J4, "2026-10-29T10:00:00Z", "2026-10-30T12:00:00Z"),
  ];
  assert.deepEqual(punctualityReport(arrivals, slots, START, END), { rate_percent: 50, measured_count: 2, on_time_count: 1, late_count: 1, without_slot_count: 1, from_start_count: 1 });
  assert.deepEqual(punctualityReport([], [], START, END), { rate_percent: null, measured_count: 0, on_time_count: 0, late_count: 0, without_slot_count: 0, from_start_count: 0 });
  assert.equal(punctualityReport([arrivals[3]], [], START, END).rate_percent, null);
  // A « sur place » declared after the start of work is not the first presence.
  assert.deepEqual(firstArrivals([{ intervention_id: J1, action: "start", created_at: "2026-11-10T10:00:00Z" }, { intervention_id: J1, action: "travel_on_site", created_at: "2026-11-10T11:00:00Z" }]).get(J1), { at: Date.parse("2026-11-10T10:00:00Z"), from: "start" });
});

test("client parser accepts only a coherent reply for the asked bounds; texts never show a rate without its sample", () => {
  const report = buildPeriodReport({ start: START, end: END, paid: [{ total_cents: 13020, method: "stripe" }], completed: 2, arrivals: [], slots: [] });
  const asked = { start: START, end: END };
  assert.deepEqual(parsePeriodReport(JSON.parse(JSON.stringify(report)), asked), report);
  assert.equal(parsePeriodReport(report, { start: START, end: "2026-12-02T04:00:00.000Z" }), null, "other period");
  assert.equal(parsePeriodReport({ ...report, revenue: { ...report.revenue, paid_cents: 1 } }, asked), null, "sources do not add up");
  assert.equal(parsePeriodReport({ ...report, punctuality: { ...report.punctuality, rate_percent: 90 } }, asked), null, "rate without sample");
  assert.equal(parsePeriodReport({ ...report, artisan_id: "x" }, asked), null, "extra key");
  assert.deepEqual(punctualityText(report.punctuality).value, "Non calculable");
  const measured = punctualityText({ rate_percent: 50, measured_count: 2, on_time_count: 1, late_count: 1, without_slot_count: 1, from_start_count: 0 });
  assert.equal(measured.value, "50 %");
  assert.match(measured.note, /1 sur 2 interventions mesurées à l’heure, 1 en retard\. 1 intervention non mesurée/);
});

test("presets and custom bounds follow the device calendar; « au » is inclusive", () => {
  const now = new Date(2026, 10, 22, 15);
  assert.deepEqual(presetBounds("month", now), { start: new Date(2026, 10, 1).toISOString(), end: new Date(2026, 11, 1).toISOString() });
  assert.deepEqual(presetBounds("previous_month", now), { start: new Date(2026, 9, 1).toISOString(), end: new Date(2026, 10, 1).toISOString() });
  assert.deepEqual(presetBounds("quarter", now), { start: new Date(2026, 9, 1).toISOString(), end: new Date(2027, 0, 1).toISOString() });
  assert.deepEqual(presetBounds("year", now), { start: new Date(2026, 0, 1).toISOString(), end: new Date(2027, 0, 1).toISOString() });
  assert.deepEqual(customBounds("2026-11-10", "2026-11-12"), { ok: true, bounds: { start: new Date(2026, 10, 10).toISOString(), end: new Date(2026, 10, 13).toISOString() } });
  for (const [a, b] of [["", "2026-11-12"], ["2026-11-12", "2026-11-10"], ["2026-02-30", "2026-03-01"], ["2020-01-01", "2026-11-12"]]) assert.equal(customBounds(a, b).ok, false, `${a} ${b}`);
});

test("route refuses malformed queries (422) before any account or service access", async () => {
  const call = (q: string) => GET(new Request(`https://courant.example/api/artisan/performance/period${q}`));
  for (const q of ["", "?start=" + START, `?start=${START}&end=${END}&artisan_id=${J1}`, `?start=${START}&start=${START}&end=${END}`, `?start=${END}&end=${START}`, `?start=2026-11-01&end=2026-12-01`]) {
    const response = await call(q);
    assert.equal(response.status, 422, q);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
