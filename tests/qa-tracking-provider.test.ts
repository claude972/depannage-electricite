// WEB-TRACKING-QA-006 A3: the provider 429 is proven by INJECTION into the backend adapter
// (imported read-only from codex/gps-eta), never by a burst against IGN. No network is used:
// every call goes to a fake fetcher. The DB side (shared backoff) is proven by
// scripts/qa-tracking/sql-backoff-review.mjs on a local PGlite.
import test from "node:test";
import assert from "node:assert/strict";
import { providerJson, TrackingProviderError } from "../lib/features/tracking/provider";

const ROUTE = new URL("https://data.geopf.fr/navigation/itineraire?resource=bdtopo-valhalla");
function fakeFetch(status: number, headers: Record<string, string> = {}, body = "{}") {
  const calls: string[] = [];
  const fetcher = (async (url: URL | string) => {
    calls.push(String(url));
    return new Response(body, { status, headers });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
async function reasonOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof TrackingProviderError, "expected a TrackingProviderError");
    return { reason: error.reason, retryAfter: error.retryAfter };
  }
  throw new Error("expected a provider error");
}

test("injected IGN 429 becomes provider_quota with the server Retry-After, bounded 1–60 s", async () => {
  for (const [header, expected] of [["7", 7], ["999", 60], ["0", 1]] as const) {
    const { fetcher, calls } = fakeFetch(429, { "Retry-After": header });
    assert.deepEqual(await reasonOf(providerJson(ROUTE, fetcher)), { reason: "provider_quota", retryAfter: expected });
    assert.equal(calls.length, 1, "exactly one call, no automatic retry");
  }
});

test("injected 429 without (or with a non-numeric) Retry-After defaults to 30 s, still one call", async () => {
  const variants: Record<string, string>[] = [{}, { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" }];
  for (const headers of variants) {
    const { fetcher, calls } = fakeFetch(429, headers);
    assert.deepEqual(await reasonOf(providerJson(ROUTE, fetcher)), { reason: "provider_quota", retryAfter: 30 });
    assert.equal(calls.length, 1);
  }
});

test("other injected provider failures keep their documented reasons and no host other than data.geopf.fr is called", async () => {
  assert.equal((await reasonOf(providerJson(ROUTE, fakeFetch(404).fetcher))).reason, "route_unavailable");
  assert.equal((await reasonOf(providerJson(ROUTE, fakeFetch(502).fetcher))).reason, "provider_unavailable");
  assert.equal((await reasonOf(providerJson(ROUTE, fakeFetch(200, { "Content-Type": "text/html" }, "<html>").fetcher))).reason, "invalid_provider_response");
  const { fetcher, calls } = fakeFetch(200, { "Content-Type": "application/json" });
  assert.equal((await reasonOf(providerJson(new URL("https://example.org/navigation/itineraire"), fetcher))).reason, "provider_unavailable");
  assert.equal(calls.length, 0, "a foreign host must never be fetched");
});
