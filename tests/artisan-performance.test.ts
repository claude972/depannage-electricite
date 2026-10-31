import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/artisan/performance/route";

const valid = {
  current_start: "2026-10-01T00:00:00Z",
  current_end: "2026-11-01T00:00:00Z",
  previous_start: "2026-09-01T00:00:00Z",
  previous_end: "2026-10-01T00:00:00Z",
};
const request = (query: URLSearchParams) => new Request(`https://courant.example/api/artisan/performance?${query}`);

test("performance route strictly validates query before any service access", async () => {
  const cases: URLSearchParams[] = [];
  const missing = new URLSearchParams(valid); missing.delete("previous_start"); cases.push(missing);
  const duplicate = new URLSearchParams(valid); duplicate.append("current_start", valid.current_start); cases.push(duplicate);
  const target = new URLSearchParams(valid); target.set("user_id", "10000000-0000-4000-8000-000000000002"); cases.push(target);
  for (const change of [
    { current_start: "2026-10-01T00:00:00" },
    { current_start: "not-a-date" },
    { current_start: valid.current_end, current_end: valid.current_start },
    { current_end: "2026-12-01T00:00:00Z" },
    { previous_start: "2026-07-01T00:00:00Z" },
    { previous_end: "2026-09-30T00:00:00Z" },
  ]) cases.push(new URLSearchParams({ ...valid, ...change }));
  for (const query of cases) {
    const response = await GET(request(query));
    assert.equal(response.status, 422, query.toString());
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("valid performance periods remain explicitly unavailable without configured backend, never simulated", async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
  try {
    // Same instant with another timezone offset remains valid, without inventing one product timezone.
    for (const query of [
      new URLSearchParams(valid),
      new URLSearchParams({ ...valid, previous_end: "2026-09-30T20:00:00-04:00" }),
      new URLSearchParams({ current_start: "2026-03-01T00:00:00Z", current_end: "2026-04-01T00:00:00Z", previous_start: "2026-02-01T00:00:00Z", previous_end: "2026-03-01T00:00:00Z" }),
    ]) {
      const response = await GET(request(query));
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.match(body.error, /configuration/);
      assert.equal(body.current, undefined);
      assert.equal(body.rating, undefined);
    }
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});
