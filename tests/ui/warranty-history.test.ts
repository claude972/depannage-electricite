// ADM-10 / PUB-06 — warranty history model: strict parser (Astra b8301be), URL, claim proof,
// controller (pages beyond 100 + dedup, 422 cursor ⇒ page 1, 401/403/404 clear, late reply dropped).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claimAllowed, createHistory, historyInitial, historyUrl, parseHistory, type HistoryState } from "../../components/features/warranty-corrective/warranty-history";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const D = "d0000000-0000-4000-8000-000000000001";
const W = (n: number) => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const kase = (n: number, status = "resolved", dossier = D) => ({ id: W(n), intervention_id: dossier, client_id: "c0000000-0000-4000-8000-000000000001", description: "Disjoncteur qui saute encore " + n, status, resolution: "", created_at: "2026-11-07T10:00:00.123456+00:00", updated_at: "2026-11-07T10:00:00.123456+00:00", terms_version: 2 });
const page = (cases: unknown[], next: string | null, has_active: boolean | null = false, enabled = true) => ({ cases, enabled, next_cursor: next, has_active });

test("parser : filtered page needs a boolean proof consistent with the page; global needs null", () => {
  assert.ok(parseHistory(page([kase(1)], "cur"), D));
  assert.ok(parseHistory(page([kase(1, "reviewing")], null, true), D));
  assert.ok(parseHistory(page([kase(1, "reviewing", "d0000000-0000-4000-8000-000000000009")], null, null), null), "global");
  const bad: Array<[string, unknown, string | null]> = [
    ["has_active null on a dossier read", page([kase(1)], null, null), D],
    ["has_active boolean on a global read", page([kase(1)], null, false), null],
    ["active case listed but has_active false", page([kase(1, "submitted")], null, false), D],
    ["other dossier row", page([kase(1, "resolved", "d0000000-0000-4000-8000-000000000002")], null), D],
    ["missing enabled", { cases: [], next_cursor: null, has_active: false }, D],
    ["extra key", { ...page([], null), total: 0 }, D],
    ["case extra key", page([{ ...kase(1), price: 1 }], null), D],
    ["duplicate case", page([kase(1), kase(1)], null), D],
    ["more than 100", page(Array.from({ length: 101 }, (_, k) => kase(k)), null), D],
    ["bad terms_version", page([{ ...kase(1), terms_version: "2" }], null), D],
    ["timestamp beyond microseconds (handler shape)", page([{ ...kase(1), created_at: "2026-11-07T10:00:00.1234567+00:00" }], null), D],
    ["cursor not base64url (handler shape)", page([kase(1)], "a b"), D],
    ["cursor longer than 600", page([kase(1)], "a".repeat(601)), D],
  ];
  for (const [name, body, id] of bad) assert.equal(parseHistory(body, id), null, name);
  assert.equal(historyUrl(D, null), `/api/warranty?intervention_id=${D}`);
  assert.equal(historyUrl(D, "a_b"), `/api/warranty?intervention_id=${D}&cursor=a_b`);
  assert.equal(historyUrl(null, null), "/api/warranty");
});

test("claim proof : only ready + enabled + has_active === false for a dossier", () => {
  const ready = (o: Partial<HistoryState>): HistoryState => ({ ...historyInitial("k"), phase: "ready", ...o });
  assert.equal(claimAllowed(ready({ enabled: true, hasActive: false }), D), true);
  assert.equal(claimAllowed(ready({ enabled: true, hasActive: true }), D), false, "active case");
  assert.equal(claimAllowed(ready({ enabled: true, hasActive: null }), D), false, "no proof (global)");
  assert.equal(claimAllowed(ready({ enabled: false, hasActive: false }), D), false, "disabled");
  assert.equal(claimAllowed({ ...historyInitial("k"), enabled: true, hasActive: false }, D), false, "loading");
  assert.equal(claimAllowed(ready({ phase: "error", enabled: true, hasActive: false }), D), false, "error");
  assert.equal(claimAllowed(ready({ enabled: true, hasActive: false }), undefined), false, "no dossier");
});

function harness(replies: Array<{ status: number; body?: unknown }>, ctx = { uid: "u1", gen: 1 }) {
  const calls: string[] = [];
  let state = historyInitial("k");
  const gates: Array<() => void> = [];
  let hold = false;
  const fetcher = (async (url: string) => {
    calls.push(url);
    const r = replies.shift() ?? { status: 503 };
    if (hold) await new Promise<void>((res) => gates.push(res));
    return new Response(JSON.stringify(r.body ?? { error: "x" }), { status: r.status });
  }) as unknown as typeof fetch;
  const make = () => createHistory({ fetcher: () => fetcher, interventionId: D, key: "k", context: { userId: () => ctx.uid, generation: () => ctx.gen }, get: () => state, set: (s) => (state = s) });
  return { calls, get: () => state, make, ctx, gates, setHold: (v: boolean) => (hold = v) };
}

test("controller : 150 cases over 2 pages + dedup, proof kept; 422 cursor ⇒ page 1 with notice", async () => {
  const p1 = Array.from({ length: 100 }, (_, k) => kase(k + 1));
  const p2 = Array.from({ length: 51 }, (_, k) => kase(k + 100));
  const h = harness([{ status: 200, body: page(p1, "C1") }, { status: 200, body: page(p2, null) }, { status: 200, body: page(p1, "C1") }, { status: 422 }, { status: 200, body: page(p1, "C1") }]);
  const c = h.make();
  await c.load();
  await c.more();
  assert.equal(h.get().cases.length, 150);
  assert.equal(h.get().hasActive, false);
  assert.equal(h.get().enabled, true);
  assert.deepEqual(h.calls, [historyUrl(D, null), historyUrl(D, "C1")]);
  await c.load();
  await c.more();
  assert.equal(h.get().cases.length, 100);
  assert.match(h.get().notice, /première page/);
});

test("controller : 401/403/404 clear everything; late reply dropped", async () => {
  for (const status of [401, 403, 404]) {
    const h = harness([{ status: 200, body: page([kase(1)], "C1") }, { status }]);
    const c = h.make();
    await c.load();
    await c.more();
    assert.equal(h.get().phase, "refused");
    assert.deepEqual(h.get().cases, []);
    assert.equal(h.get().enabled, null);
  }
  const h = harness([{ status: 200, body: page([kase(1)], null) }]);
  h.setHold(true);
  const pending = h.make().load();
  await new Promise((r) => setTimeout(r, 0));
  h.ctx.gen = 2;
  h.gates.shift()!();
  await pending;
  assert.equal(h.get().phase, "loading", "late reply dropped");
});

test("wiring : identity fence passed by every caller; out-of-cache paid dossier gets the panel", () => {
  const client = readFileSync(path.join(ROOT, "components/role/client-space.tsx"), "utf8");
  const ent = readFileSync(path.join(ROOT, "components/role/enterprise-space.tsx"), "utf8");
  const admin = readFileSync(path.join(ROOT, "components/role/admin-space.tsx"), "utf8");
  for (const src of [client, ent, admin]) assert.ok(!/<WarrantyPanel(?![^>]*context=\{session\.mutationContext\})[^>]*\/>/.test(src), "every WarrantyPanel carries the fence");
  assert.match(client, /presence\.decision === "detail" && presence\.detail\?\.intervention\.status === "paid" && \(\s*<WarrantyPanel\s+key=\{presence\.detail\.intervention\.id\}\s+interventionId=\{presence\.detail\.intervention\.id\}/);
  assert.match(ent, /presence\.detail\.intervention\.status === "paid" && !outside\(presence\.detail\) && \(\s*<WarrantyPanel/);
  // Owner proof: the requester id goes to every client / enterprise panel (normal and point-read detail).
  assert.match(client, /ownerId=\{i\.client_id\}/);
  assert.match(client, /ownerId=\{presence\.detail\.intervention\.client_id\}/);
  assert.match(ent, /ownerId=\{intervention\.client_id\}/);
  assert.match(ent, /ownerId=\{presence\.detail\.intervention\.client_id\}/);
  const forms = readFileSync(path.join(ROOT, "components/app/forms.tsx"), "utf8");
  assert.match(forms, /: claimRole && isOwner && claimAllowed\(hs, interventionId\);/);
  assert.match(forms, /<WarrantyPanelBody key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.interventionId \?\? "\*"\}`\}/, "state isolated by identity + generation + dossier");
});

test("corrective panel : global history cursor read and followed as is", async () => {
  const m = await import("../../components/features/warranty-corrective/model");
  assert.equal(m.parseNextCursor({ cases: [], enabled: true, next_cursor: "p100", has_active: null }), "p100");
  assert.equal(m.parseNextCursor({ cases: [], enabled: true, next_cursor: null, has_active: null }), null);
  assert.equal(m.parseNextCursor({ cases: [], next_cursor: 3 }), undefined, "malformed");
  assert.equal(m.parseNextCursor({ cases: [], next_cursor: "a b" }), undefined, "not base64url");
  const urls: string[] = [];
  const api = m.createCorrectiveApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch);
  await api.cases();
  await api.cases("p_100");
  assert.deepEqual(urls, ["/api/warranty", "/api/warranty?cursor=p_100"]);
});
