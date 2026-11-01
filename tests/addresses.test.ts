import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { addressResponse } from "../lib/features/addresses/server";
const feature = { type: "Feature", geometry: { type: "Point", coordinates: [-61.0694, 14.6037] }, properties: { id: "97209_qa", name: "Rue Victor Hugo", label: "Rue Victor Hugo 97200 Fort-de-France", postcode: "97200", city: "Fort-de-France", private_extra: "never" } };
const data = (features: unknown[] = [feature]) => ({ type: "FeatureCollection", features });
const req = (params: string) => new Request(`https://app.example.test/api/addresses/search?${params}`);
let tick = 2000000000000;
const budget = (t: TestContext) => t.mock.method(Date, "now", () => tick += 1000);
const check = (r: Response, status: number) => { assert.equal(r.status, status); assert.equal(r.headers.get("Cache-Control"), "private, no-store"); };

test("search/reverse project IGN address fields only, fix endpoint/index/limit and disable cache/redirect", async t => {
  budget(t);
  for (const mode of ["search", "reverse"] as const) {
    const r = await addressResponse(req(mode === "search" ? "q=Rue%20Victor%20Hugo" : "lat=14.6037&lon=-61.0694"), mode, async (input, init) => {
      const u = new URL(String(input)); assert.equal(u.origin, "https://data.geopf.fr"); assert.equal(u.pathname, `/geocodage/${mode}`);
      assert.equal(u.searchParams.get("index"), "address"); assert.equal(u.searchParams.get("limit"), "5");
      assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      return Response.json(data());
    });
    check(r, 200); const body = await r.json(); assert.equal(body.source, "IGN / BAN"); assert.ok(body.attribution.includes("BAN"));
    assert.deepEqual(body.candidates, [{ id: "97209_qa", label: feature.properties.label, address: feature.properties.name, postal_code: "97200", city: "Fort-de-France", latitude: 14.6037, longitude: -61.0694 }]);
    assert.ok(!JSON.stringify(body).includes("private_extra"));
  }
});

test("invalid/duplicate/unknown parameters are rejected before any provider request", async () => {
  const cases = [["search", "q=ab"], ["search", `q=${"a".repeat(201)}`], ["search", "q=abc%00"], ["search", "q=abc&q=def"], ["search", "q=abc&url=https://evil.example"], ["reverse", "lat=&lon=1"], ["reverse", "lat=91&lon=1"], ["reverse", "lat=1&lon=-181"], ["reverse", "lat=NaN&lon=0"], ["reverse", "lat=Infinity&lon=0"], ["reverse", "lat=0&lon=0&lon=1"]] as const;
  for (const [mode, params] of cases) {
    const r = await addressResponse(req(params), mode, async () => { assert.fail("must not fetch"); });
    check(r, 400); assert.equal((await r.json()).retryable, false);
  }
});

test("empty is successful; five candidates maximum; malformed provider data never becomes empty success", async t => {
  budget(t);
  check(await addressResponse(req("q=abc"), "search", async () => Response.json(data([]))), 200);
  const five = await addressResponse(req("q=abc"), "search", async () => Response.json(data(Array(5).fill(feature))));
  assert.equal((await five.json()).candidates.length, 5);
  for (const invalid of [null, {}, data(Array(6).fill(feature)), data([{ ...feature, geometry: { type: "Point", coordinates: [181, 1] } }]), data([{ ...feature, properties: { ...feature.properties, postcode: "972" } }]), data([{ ...feature, properties: { ...feature.properties, name: null } }])]) {
    const r = await addressResponse(req("q=abc"), "search", async () => Response.json(invalid)); check(r, 503); assert.equal((await r.json()).retryable, true);
  }
});

test("quota, failure, non-JSON, overlarge body and timeout are retryable without upstream content leakage", async t => {
  budget(t);
  for (const status of [429, 403, 500]) {
    const r = await addressResponse(req("q=abc"), "search", async () => new Response("private upstream", { status })); check(r, status === 429 ? 429 : 503);
    assert.equal(r.headers.get("Retry-After"), "2"); assert.ok(!(await r.text()).includes("private upstream"));
  }
  for (const body of ["not JSON", "a".repeat(128001)]) check(await addressResponse(req("q=abc"), "search", async () => new Response(body)), 503);
  const r = await addressResponse(req("q=abc"), "search", (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true })));
  check(r, 503); assert.equal((await r.json()).retryable, true);
});

test("warm-instance budget bounds traffic without claiming a distributed quota", async t => {
  t.mock.method(Date, "now", () => 3000000000000);
  let calls = 0;
  for (let i = 0; i < 11; i++) {
    const r = await addressResponse(req("q=abc"), "search", async () => { calls++; return Response.json(data([])); });
    check(r, i < 10 ? 200 : 429);
  }
  assert.equal(calls, 10);
});
