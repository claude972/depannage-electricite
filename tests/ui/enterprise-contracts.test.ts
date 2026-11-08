// ENT-13 — contracts model: strict parsers (ROOT 201057a), URLs, controller (pagination beyond 50 +
// dedup, 422 cursor ⇒ page 1, 401/403/404 refusal incl. sites-only scope, 503 Retry-After, late reply).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createContracts, detailUrl, listInitial, listUrl, parseContract, parseContracts, type ListState } from "../../components/features/enterprise-contracts/model";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ORG = "0a000000-0000-4000-8000-000000000001";
const C = (n: number) => "c0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const item = (n: number, org = ORG) => ({ id: C(n), organization_id: org, title: "Contrat " + n, reference: "REF-" + n, starts_on: "2026-01-01", ends_on: n % 2 ? null : "2026-12-31", status: "active", created_at: "2026-11-07T10:00:00.123456+00:00" });
const page = (items: unknown[], next: string | null) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next } });

test("parsers : exact contract; off-contract refused", () => {
  assert.ok(parseContracts(page([item(1), item(2)], "eyJ2"), ORG));
  assert.ok(parseContracts(page([], null), ORG));
  const bad: Array<[string, unknown]> = [
    ["other org row", page([item(1, "0a000000-0000-4000-8000-000000000002")], null)],
    ["extra key", { ...page([item(1)], null), total: 1 }],
    ["item extra key (terms in list)", page([{ ...item(1), terms: "x" }], null)],
    ["limit ≠ 50", { items: [], page: { limit: 25, has_more: false, next_cursor: null } }],
    ["has_more without cursor", { items: [], page: { limit: 50, has_more: true, next_cursor: null } }],
    ["duplicate", page([item(1), item(1)], null)],
    ["bad status", page([{ ...item(1), status: "signed" }], null)],
    ["bad date", page([{ ...item(1), starts_on: "01/01/2026" }], null)],
  ];
  for (const [name, body] of bad) assert.equal(parseContracts(body, ORG), null, name);
  const d = { contract: { ...item(7), terms: "Périmètre et conditions" } };
  assert.equal(parseContract(d, ORG, C(7).toUpperCase())?.terms, "Périmètre et conditions");
  assert.equal(parseContract(d, ORG, C(8)), null, "another contract");
  assert.equal(parseContract({ contract: { ...item(7) } }, ORG, C(7)), null, "terms required");
  assert.equal(parseContract({ contract: { ...item(7, "0a000000-0000-4000-8000-000000000002"), terms: "x" } }, ORG, C(7)), null, "other org");
  assert.equal(listUrl(ORG, null), `/api/enterprise/contracts?organization_id=${ORG}`);
  assert.equal(listUrl(ORG, "ab_C"), `/api/enterprise/contracts?organization_id=${ORG}&cursor=ab_C`);
  assert.equal(detailUrl(ORG, C(7)), `/api/enterprise/contracts/${C(7)}?organization_id=${ORG}`);
});

function harness(replies: Array<{ status: number; body?: unknown; retryAfter?: string }>, ctx = { uid: "u1", gen: 1 }) {
  const calls: string[] = [];
  let state: ListState = listInitial("k");
  const gates: Array<() => void> = [];
  let hold = false;
  const fetcher = (async (url: string) => {
    calls.push(url);
    const r = replies.shift() ?? { status: 503 };
    if (hold) await new Promise<void>((res) => gates.push(res));
    return new Response(JSON.stringify(r.body ?? { error: "x" }), { status: r.status, headers: r.retryAfter ? { "Retry-After": r.retryAfter } : {} });
  }) as unknown as typeof fetch;
  const context = { userId: () => ctx.uid, generation: () => ctx.gen };
  const make = (now = () => 1000) => createContracts({ fetcher: () => fetcher, organizationId: ORG, key: "k", context, get: () => state, set: (s) => (state = s), now });
  return { calls, get: () => state, make, ctx, gates, setHold: (v: boolean) => (hold = v) };
}

test("controller : 120 contracts over 3 pages + dedup; 422 cursor ⇒ page 1 with notice", async () => {
  const p1 = Array.from({ length: 50 }, (_, i) => item(i + 1));
  const p2 = Array.from({ length: 50 }, (_, i) => item(i + 50));
  const p3 = Array.from({ length: 21 }, (_, i) => item(i + 100));
  const h = harness([{ status: 200, body: page(p1, "C1") }, { status: 200, body: page(p2, "C2") }, { status: 200, body: page(p3, null) }, { status: 200, body: page(p1, "C1") }, { status: 422 }, { status: 200, body: page(p1, "C1") }]);
  const c = h.make();
  await c.load();
  await c.more();
  await c.more();
  assert.equal(h.get().items.length, 120);
  assert.equal(h.get().next, null);
  assert.deepEqual(h.calls, [listUrl(ORG, null), listUrl(ORG, "C1"), listUrl(ORG, "C2")]);
  await c.load();
  await c.more();
  assert.equal(h.get().items.length, 50);
  assert.match(h.get().notice, /première page/);
  assert.equal(h.calls.at(-1), listUrl(ORG, null));
});

test("controller : 401 / 403 / 404 (sites-only scope) refusals clear; 503 keeps Retry-After; late reply dropped", async () => {
  for (const [status, re] of [[401, /session a expiré/], [403, /comptes entreprise/], [404, /accès à toute l’organisation.*limité à certains sites/]] as const) {
    const h = harness([{ status: 200, body: page([item(1)], "C1") }, { status }]);
    const c = h.make();
    await c.load();
    await c.more();
    assert.equal(h.get().phase, "refused", String(status));
    assert.deepEqual(h.get().items, []);
    assert.match(h.get().error, re);
  }
  const h2 = harness([{ status: 503, retryAfter: "2" }]);
  await h2.make(() => 5000).load();
  assert.equal(h2.get().phase, "error");
  assert.equal(h2.get().retryAt, 7000);
  const h3 = harness([{ status: 200, body: page([item(1)], null) }]);
  h3.setHold(true);
  const pending = h3.make().load();
  await new Promise((r) => setTimeout(r, 0));
  h3.ctx.gen = 2;
  h3.gates.shift()!();
  await pending;
  assert.equal(h3.get().phase, "loading", "late reply dropped");
});

test("wiring : only the contracts section of ProfessionalOperations; typed context prop; save_contract unchanged", () => {
  const src = readFileSync(path.join(ROOT, "components/app/forms.tsx"), "utf8");
  assert.match(src, /contracts\?: EnterpriseContractsContext;/);
  assert.match(src, /\{liveContracts \? \(\s*<EnterpriseContractsPanel/);
  assert.match(src, /\) : data\.contracts\.length \? \(/, "demo listing kept");
  assert.match(src, /const contractOrganizationId = liveContracts \? contracts\?\.organizationId \|\| undefined : organizations\[0\]\?\.id;/, "live: no fallback to organizations[0]");
  const panel = readFileSync(path.join(ROOT, "components/features/enterprise-contracts/enterprise-contracts-panel.tsx"), "utf8");
  assert.match(panel, /action: "save_contract",\s+id: ct\.id,\s+organization_id: ct\.organization_id,\s+title: ct\.title,\s+reference: ct\.reference,\s+starts_on: ct\.starts_on,\s+ends_on: ct\.ends_on \|\| undefined,\s+terms: ct\.terms,\s+status: ct\.status === "archived" \? "active" : "archived",/);
  assert.ok(!/discount|remise|sessionStorage|localStorage/i.test(panel));
});
