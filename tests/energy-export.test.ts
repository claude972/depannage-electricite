import test from "node:test";
import assert from "node:assert/strict";
import { loadModule, fakeServerHelpers } from "./documents/harness";
const org = "10000000-0000-4000-8000-000000000001",
  site = "10000000-0000-4000-8000-000000000002",
  other = "10000000-0000-4000-8000-000000000003";
const period = (value: string | null = "0") => ({
  record_count: value === null ? 0 : 1,
  crossing_count: 0,
  missing_cost_count: 0,
  consumption_wh: value,
  cost_cents: value === null ? null : "0",
  coverage_complete: value !== null,
});
const meter = (label = "compteur QA") => ({
  site_id: site,
  meter_label: label,
  current: period(),
  previous: period("25"),
});
const data = (meters: unknown[] = [meter()], sites = [site]) => ({
  organization_id: org,
  site_ids: sites,
  meters,
});
function harness(
  result: unknown = data(),
  error: string | null = null,
  auth = true,
) {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { data: result, error: error ? { code: error } : null };
    },
  };
  return {
    ...(loadModule("app/api/organizations/[id]/energy/route.ts", {
      "@/lib/supabase/server": fakeServerHelpers({ db, authenticated: auth }),
    }) as any),
    calls,
  };
}
const q = `site_ids=${site}&from=2026-01-01&to=2026-01-31&previous_from=2025-12-01&previous_to=2025-12-31`;
const request = (format: string | null = "csv", query = q) =>
  new Request(
    `https://app.example/api/organizations/${org}/energy?${query}${format === null ? "" : "&format=" + format}`,
  );
const context = { params: Promise.resolve({ id: org }) };
// Parse quoted cells, including embedded semicolons/newlines and doubled quotes.
function parse(input: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  input = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ";" && !quoted) {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && input[i + 1] === "\n" && !quoted) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  assert.equal(quoted, false);
  return rows;
}
test("real handler exports exact same report, scope and RPC as default JSON with private attachment headers", async () => {
  const json = harness(),
    csv = harness();
  const j = await (await json.GET(request(null), context)).json();
  const response = await csv.GET(request(), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="rapport-energie.csv"',
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(
    JSON.parse(JSON.stringify(csv.calls)),
    JSON.parse(JSON.stringify(json.calls)),
  );
  assert.equal(csv.calls.length, 1);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [239, 187, 191]);
  const rows = parse(new TextDecoder().decode(bytes));
  assert.ok(rows.every((r) => r.length === 23));
  const total = rows.find(
    (r) => r[0] === "ensemble_des_releves" && r[5] === "current",
  )!;
  assert.equal(total[13], j.current.recorded_consumption_wh);
  assert.equal(total[14], j.current.recorded_cost_cents);
  assert.equal(total[15], "oui");
  assert.equal(total[17], "non");
  assert.equal(total[22], j.basis);
  const comparison = rows.find((r) => r[0] === "comparaison_des_releves")!;
  assert.equal(comparison[20], "'" + j.comparison.consumption_delta_wh);
  assert.equal(comparison[19], j.comparison.reason);
  assert.deepEqual(
    await (await harness().GET(request("json"), context)).json(),
    j,
  );
});
test("empty selected sites and missing costs remain unavailable, never numeric zero or complete physical total", async () => {
  const m = {
    ...meter(),
    current: { ...period("0"), cost_cents: null, missing_cost_count: 1 },
  };
  const rows = parse(
    await (
      await harness(data([m], [site, other])).GET(
        request("csv", q.replace(site, site + "," + other)),
        context,
      )
    ).text(),
  );
  const empty = rows.find(
    (r) => r[0] === "site" && r[3] === other && r[5] === "current",
  )!;
  assert.equal(empty[13], "non disponible");
  assert.equal(empty[15], "non");
  const measured = rows.find((r) => r[0] === "compteur" && r[5] === "current")!;
  assert.equal(measured[13], "0");
  assert.equal(measured[14], "non disponible");
  assert.equal(measured[12], "1");
  assert.ok(rows.slice(1).every((r) => r[17] === "non"));
  assert.equal(
    rows.find((r) => r[0] === "comparaison_des_releves")![20],
    "non disponible",
  );
});
test("formula payloads, leading whitespace and quoted multiline labels stay a single protected cell", async () => {
  const labels = [
    "=SUM(1;2)",
    " \t+cmd",
    "@evil",
    "-2+3",
    '\n=HYPERLINK("bad")',
    'normal;"quote"\r\nnext',
  ];
  const meters = labels.map(meter);
  const rows = parse(
    await (await harness(data(meters)).GET(request(), context)).text(),
  ).filter((r) => r[0] === "compteur" && r[5] === "current");
  assert.equal(rows.length, labels.length);
  labels.forEach((label, i) =>
    assert.equal(rows[i][4], i < 5 ? "'" + label : label),
  );
});
test("all reported meters export beyond 100 and large decimal strings retain exact precision", async () => {
  const meters = Array.from({ length: 201 }, (_, i) => ({
    ...meter("QA " + i),
    current: period(i === 0 ? "9007199254740993" : "1"),
  }));
  const h = harness(data(meters));
  const rows = parse(await (await h.GET(request(), context)).text());
  assert.equal(rows.filter((r) => r[0] === "compteur").length, 402);
  assert.equal(
    rows.find(
      (r) => r[0] === "ensemble_des_releves" && r[5] === "current",
    )![13],
    "9007199254741193",
  );
  assert.equal(h.calls.length, 1);
});
test("CSV preserves auth, foreign scope and malformed response refusals as private JSON errors", async () => {
  for (const [h, status] of [
    [harness(null, null, false), 401],
    [harness(null, "P0002"), 404],
    [harness(null, "42501"), 403],
    [harness(null, "XX"), 503],
    [harness(data([{ ...meter(), site_id: other }])), 503],
    [harness(null), 503],
  ] as const) {
    const r = await h.GET(request(), context);
    assert.equal(r.status, status);
    assert.match(r.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(r.headers.get("content-disposition"), null);
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  }
});
test("unsupported or repeated format and modified scope are rejected before RPC", async () => {
  for (const req of [
    request("xlsx"),
    request(""),
    request("csv", q + "&format=csv"),
    request("csv", q + "&site_ids=" + other),
    request("csv", q + "&extra=1"),
  ]) {
    const h = harness();
    assert.equal((await h.GET(req, context)).status, 422);
    assert.equal(h.calls.length, 0);
  }
});
