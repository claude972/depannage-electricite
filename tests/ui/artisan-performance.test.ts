// ART-10 — strict parser of the server performance report and wiring of the three live mounts
// (Overview summary, Profile block, Performance page) to session.loadArtisanPerformance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  growthLabel,
  identityKey,
  isEmptyReport,
  parseArtisanPerformance,
} from "../../components/features/artisan-performance/model";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

// Shape returned by the artisan_performance RPC (Postgres timestamptz JSON, +00:00 offsets).
const rpc = () => ({
  period: {
    current_start: "2026-11-01T04:00:00+00:00",
    current_end: "2026-12-01T04:00:00+00:00",
    previous_start: "2026-10-01T04:00:00+00:00",
    previous_end: "2026-11-01T04:00:00+00:00",
    boundary: "inclusive_start_exclusive_end",
  },
  current: { paid_service_cents: 1234500, paid_count: 131, completed_missions_count: 118 },
  previous: { paid_service_cents: 1000000, paid_count: 97, completed_missions_count: 90 },
  rating: { average: 4.6, count: 212, period: "all_time" },
  growth_percent: 23.5,
  punctuality_rate: null,
  currency: "eur",
  scope: "all_current_artisan_records",
  limited: false,
  basis: { revenue: "r", completed: "c", rating: "a", growth: "g", punctuality: "p" },
});

test("parser : the RPC payload is accepted as is (fresh copy)", () => {
  const raw = rpc();
  const r = parseArtisanPerformance(raw);
  assert.ok(r);
  assert.deepEqual(r, raw);
  assert.notEqual(r.current, raw.current);
  assert.equal(isEmptyReport(r), false);
});

test("parser : off-contract payloads are rejected, never repaired", () => {
  const bad: Array<[string, (r: ReturnType<typeof rpc>) => unknown]> = [
    ["not an object", () => "x"],
    ["array", () => []],
    ["missing period", (r) => ({ ...r, period: undefined })],
    ["bad instant", (r) => ({ ...r, period: { ...r.period, current_start: "nope" } })],
    ["non-contiguous", (r) => ({ ...r, period: { ...r.period, previous_end: "2026-10-31T04:00:00+00:00" } })],
    ["reversed", (r) => ({ ...r, period: { ...r.period, current_end: "2026-10-15T04:00:00+00:00" } })],
    ["no boundary", (r) => ({ ...r, period: { ...r.period, boundary: "" } })],
    ["negative cents", (r) => ({ ...r, current: { ...r.current, paid_service_cents: -1 } })],
    ["fractional count", (r) => ({ ...r, current: { ...r.current, paid_count: 1.5 } })],
    ["string cents", (r) => ({ ...r, previous: { ...r.previous, paid_service_cents: "10" } })],
    ["unsafe integer", (r) => ({ ...r, current: { ...r.current, paid_service_cents: 2 ** 53 } })],
    ["amount without payment", (r) => ({ ...r, current: { ...r.current, paid_count: 0 } })],
    ["average without review", (r) => ({ ...r, rating: { ...r.rating, count: 0 } })],
    ["no average with reviews", (r) => ({ ...r, rating: { ...r.rating, average: null } })],
    ["average out of range", (r) => ({ ...r, rating: { ...r.rating, average: 6 } })],
    ["growth when previous is zero", (r) => ({ ...r, previous: { paid_service_cents: 0, paid_count: 0, completed_missions_count: 0 } })],
    ["no growth when previous > 0", (r) => ({ ...r, growth_percent: null })],
    ["NaN growth", (r) => ({ ...r, growth_percent: Number.NaN })],
    ["punctuality invented", (r) => ({ ...r, punctuality_rate: 0.9 })],
    ["other currency", (r) => ({ ...r, currency: "usd" })],
    ["limited not boolean", (r) => ({ ...r, limited: "false" })],
    ["no scope", (r) => ({ ...r, scope: "" })],
    ["basis not text", (r) => ({ ...r, basis: { revenue: 1 } })],
  ];
  for (const [name, mutate] of bad) assert.equal(parseArtisanPerformance(mutate(rpc())), null, name);
});

test("empty report, growth label and identity key", () => {
  const zero = { paid_service_cents: 0, paid_count: 0, completed_missions_count: 0 };
  const empty = parseArtisanPerformance({ ...rpc(), current: zero, previous: zero, growth_percent: null, rating: { average: null, count: 0, period: "all_time" } });
  assert.ok(empty);
  assert.equal(isEmptyReport(empty), true);
  assert.equal(growthLabel(23.5), "+23,5 %");
  assert.equal(growthLabel(-3), "−3 %");
  assert.equal(growthLabel(0), "0 %");
  assert.equal(identityKey({ userId: () => null, generation: () => 4 }), null);
  assert.equal(identityKey({ userId: () => "u1", generation: () => 4 }), "u1|4");
});

test("wiring : Overview, Profile and Performance read the server report in live; demo keeps its computation", () => {
  const src = read("components/role/artisan-space.tsx");
  assert.equal((src.match(/useArtisanPerformance\(session\)/g) || []).length, 3, "three mounts");
  const block = (start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)));
  const overview = block("function Overview(", "\nfunction ");
  assert.match(overview, /livePerf\.phase === "demo" \? \(\s*<PerformanceSummary perf=\{perf\}/);
  assert.match(overview, /<LivePerformanceSummary perf=\{livePerf\}/);
  const profile = block("function Profile(", "\nfunction ");
  assert.match(profile, /livePerf\.phase === "demo" \? \(\s*<PerfGrid perf=\{perf\}/);
  assert.match(profile, /<LivePerformanceGrid perf=\{livePerf\}/);
  assert.match(profile, /<LiveRatingLine perf=\{livePerf\}/);
  const view = block("function PerformanceView(", "\nfunction ");
  assert.match(view, /livePerformanceSubtitle\(livePerf\)/);
  assert.match(view, /livePerf\.phase !== "demo" \? \(\s*<LivePerformanceGrid/);
  const leaf = ["model.ts", "use-artisan-performance.ts", "artisan-performance-views.tsx"]
    .map((f) => read(`components/features/artisan-performance/${f}`))
    .join("\n");
  assert.ok(!/dossiers chargés/.test(leaf), "never in live");
  assert.ok(!/artisanPerformance\(|data\.payments|monthPeriods/.test(leaf), "no cache figure, no period recomputed");
  assert.ok(!/fetch\(|sessionStorage|localStorage/.test(leaf), "only the session loader");
});
