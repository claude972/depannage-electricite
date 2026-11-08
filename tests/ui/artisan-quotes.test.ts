// ART-07 — artisan quotes list model: strict parser (contract 76151e2 / 42708ad), URL, Retry-After,
// controller (pagination + dedup, 422 cursor ⇒ page 1, 401/403 ⇒ cleared, late replies dropped).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createQuotes, parseQuotes, quotesInitial, quotesUrl, retryAfterSeconds, type QuotesState } from "../../components/features/artisan-quotes/model";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const Q = (n: number) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const I = (n: number) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const item = (n: number, status = "sent") => ({ id: Q(n), intervention_id: I(n), status, total_cents: 10000 + n, created_at: "2026-11-07T10:00:00.123456+00:00", accepted_at: status === "accepted" ? "2026-11-07T11:00:00Z" : null, intervention: { id: I(n), category: "panel", status: "quoted" } });
const page = (items: unknown[], next: string | null, limit = 50) => ({ items, page: { limit, has_more: next !== null, next_cursor: next }, order: "newest_first" });

test("parser : exact contract accepted; off-contract rejected", () => {
  assert.ok(parseQuotes(page([item(1), item(2, "accepted")], "eyJ2IjoxfQ"), "all"));
  assert.ok(parseQuotes(page([], null), "rejected"), "empty = 200 + []");
  const bad: Array<[string, unknown, string?]> = [
    ["extra key", { ...page([item(1)], null), extra: 1 }],
    ["item extra key", page([{ ...item(1), client: "x" }], null)],
    ["draft status", page([item(1, "draft")], null)],
    ["status ≠ filter", page([item(1, "accepted")], null), "sent"],
    ["dossier id mismatch", page([{ ...item(1), intervention: { ...item(1).intervention, id: I(9) } }], null)],
    ["duplicate id", page([item(1), item(1)], null)],
    ["has_more without cursor", { ...page([item(1)], null), page: { limit: 50, has_more: true, next_cursor: null } }],
    ["cursor not opaque-safe", page([item(1)], "a b")],
    ["zero total", page([{ ...item(1), total_cents: 0 }], null)],
    ["bad timestamp", page([{ ...item(1), created_at: "2026-11-07" }], null)],
    ["wrong order", { ...page([item(1)], null), order: "oldest_first" }],
    ["more items than limit", page([item(1), item(2)], null, 1)],
  ];
  for (const [name, body, f] of bad) assert.equal(parseQuotes(body, (f ?? "all") as "all"), null, name);
});

test("url, Retry-After", () => {
  assert.equal(quotesUrl("all", null), "/api/artisan/quotes?status=all");
  assert.equal(quotesUrl("sent", "ab_-C"), "/api/artisan/quotes?status=sent&cursor=ab_-C");
  assert.equal(retryAfterSeconds("2"), 2);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds("Wed, 21 Oct 2026 07:28:00 GMT"), null);
});

function harness(replies: Array<{ status: number; body?: unknown; retryAfter?: string }>, ctx = { uid: "u1", gen: 1 }) {
  const calls: string[] = [];
  let state: QuotesState = quotesInitial("");
  const gates: Array<() => void> = [];
  let hold = false;
  const fetcher = (async (url: string) => {
    calls.push(url);
    const r = replies.shift() ?? { status: 503 };
    if (hold) await new Promise<void>((res) => gates.push(res));
    return new Response(JSON.stringify(r.body ?? { error: "x" }), { status: r.status, headers: r.retryAfter ? { "Retry-After": r.retryAfter } : {} });
  }) as unknown as typeof fetch;
  const context = { userId: () => ctx.uid, generation: () => ctx.gen };
  const make = (filter: "all" | "sent" = "all", now = () => 1000) => createQuotes({ fetcher: () => fetcher, filter, context, get: () => state, set: (s) => (state = s), now });
  return { calls, get: () => state, make, ctx, gates, setHold: (v: boolean) => (hold = v) };
}

test("controller : 123 quotes over 3 pages, dedup by id, 422 cursor ⇒ page 1 with a notice", async () => {
  const p1 = Array.from({ length: 50 }, (_, i) => item(i + 1));
  const p2 = Array.from({ length: 50 }, (_, i) => item(i + 50)); // 50 is a duplicate
  const p3 = Array.from({ length: 24 }, (_, i) => item(i + 100));
  const h = harness([{ status: 200, body: page(p1, "C1") }, { status: 200, body: page(p2, "C2") }, { status: 200, body: page(p3, null) }, { status: 200, body: page(p1, "C1") }, { status: 422 }, { status: 200, body: page(p1, "C1") }]);
  const c = h.make();
  await c.load();
  await c.more();
  await c.more();
  assert.equal(h.get().items.length, 123);
  assert.equal(new Set(h.get().items.map((i) => i.id)).size, 123);
  assert.equal(h.get().next, null);
  assert.deepEqual(h.calls, ["/api/artisan/quotes?status=all", "/api/artisan/quotes?status=all&cursor=C1", "/api/artisan/quotes?status=all&cursor=C2"]);
  await c.load();
  await c.more();
  assert.equal(h.get().phase, "ready");
  assert.equal(h.get().items.length, 50, "restarted at page 1");
  assert.match(h.get().notice, /repart de la première page/);
  assert.equal(h.calls.at(-1), "/api/artisan/quotes?status=all");
});

test("controller : 401/403 clear the list; 503 keeps Retry-After; late reply after identity change dropped", async () => {
  const h = harness([{ status: 200, body: page([item(1)], "C1") }, { status: 403 }]);
  const c = h.make();
  await c.load();
  await c.more();
  assert.equal(h.get().phase, "forbidden");
  assert.deepEqual(h.get().items, [], "cleared");
  const h2 = harness([{ status: 503, retryAfter: "2" }]);
  await h2.make("all", () => 5000).load();
  assert.equal(h2.get().phase, "error");
  assert.equal(h2.get().retryAt, 7000);
  const h3 = harness([{ status: 200, body: page([item(1)], null) }]);
  h3.setHold(true);
  const c3 = h3.make();
  const pending = c3.load();
  await new Promise((r) => setTimeout(r, 0));
  h3.ctx.gen = 2; // identity generation changed while the read was in flight
  h3.gates.shift()!();
  await pending;
  assert.equal(h3.get().phase, "loading", "late reply dropped");
  assert.deepEqual(h3.get().items, []);
});

test("wiring : Quotes mounts the live panel only outside demo; demo branch unchanged", () => {
  const src = readFileSync(path.join(ROOT, "components/role/artisan-space.tsx"), "utf8");
  const q = src.slice(src.indexOf("function Quotes("), src.indexOf("\nfunction QuoteRow("));
  assert.match(q, /const live = session\.mode !== "demo";/);
  assert.match(q, /if \(!live && !myQuotes\.length && !toWrite\.length\)/);
  assert.match(q, /\{live && \(\s*<>[\s\S]*<ArtisanQuotesPanel/);
  assert.match(q, /onOpenDossier=\{\(id\) => session\.openIntervention\(id\)\}/);
  assert.match(q, /\{!live && groups\.map/);
  const leaf = readFileSync(path.join(ROOT, "components/features/artisan-quotes/artisan-quotes-panel.tsx"), "utf8") + readFileSync(path.join(ROOT, "components/features/artisan-quotes/model.ts"), "utf8");
  assert.ok(!/dossiers chargés|session\.data|sessionStorage|localStorage/.test(leaf), "no cache, no storage");
});
