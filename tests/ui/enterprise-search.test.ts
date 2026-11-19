import { fileURLToPath as localSourcePath } from "node:url";
// Enterprise intervention list + server CSV. Real model/controller (fake api + timers), a Chromium mount
// of the REAL enterprise RequestsView (live ctx stub + fake fetch) at 390 and 1280 px, and the real app
// demo (local list unchanged, zero /api).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import { withApp, skip as appSkip } from "./real-app-harness";
import type * as Model from "../../components/features/enterprise-search/model";
import type * as Counts from "../../components/features/enterprise-search/overview-counts";
import type * as Pro from "../../components/features/enterprise-search/professional-overview";

const m = loadModule("components/features/enterprise-search/model.ts") as unknown as typeof Model;
const oc = loadModule("components/features/enterprise-search/overview-counts.ts") as unknown as typeof Counts;
const ORG_B = "20000000-0000-4000-8000-000000000002";
const po = loadModule("components/features/enterprise-search/professional-overview.ts") as unknown as typeof Pro;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const S1 = "30000000-0000-4000-8000-000000000001";
const S2 = "30000000-0000-4000-8000-000000000002";
const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), category: "outage", address: `${n} rue Victor Hugo`, postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 12000, created_at: "2025-01-02T10:00:00.000Z", site_id: S1, site_name: "Siège", artisan_assigned: false, ...over });
const pageOf = (items: unknown[], number: number, total: number) => ({ items, total, page: { number, limit: 10, pages: Math.max(1, Math.ceil(total / 10)) } });
const F = (over: Partial<Model.Filters> = {}): Model.Filters => ({ organization_id: ORG, site_id: null, category: null, status: null, search: "", sort: "recent", ...over });
const res = (status: number, body: unknown = null) => ({ status, body });

test("corps exacts par action (schéma de la route) ; rien d’invalide n’est envoyé", () => {
  same(m.listBody(F({ search: "  tableau " }), 2), { action: "list", organization_id: ORG, site_id: null, category: null, status: null, search: "tableau", sort: "recent", page: 2 });
  same(m.exportBody(F({ site_id: S1, category: "panel", status: "paid", sort: "oldest" })), { action: "export", organization_id: ORG, site_id: S1, category: "panel", status: "paid", search: "", sort: "oldest" });
  assert.ok(!("page" in m.exportBody(F())!), "export has no page");
  for (const [f, p] of [[F({ organization_id: "x" }), 1], [F({ site_id: "s" }), 1], [F({ search: "a".repeat(121) }), 1], [F({ search: "a\u0007" }), 1], [F(), 0], [F({ category: "plumbing" as never }), 1]] as [Model.Filters, number][])
    assert.equal(m.listBody(f, p), null, JSON.stringify(f).slice(0, 80));
});

test("lecture stricte : contrat + invariants de la route (numéro, pages, nombre, ids, périmètre)", () => {
  const req = m.listBody(F(), 1)!;
  assert.ok(m.parseListPage(pageOf(Array.from({ length: 10 }, (_, i) => row(i + 1)), 1, 23), req));
  assert.ok(m.parseListPage(pageOf([], 1, 0), req));
  const p3 = m.listBody(F(), 3)!;
  assert.ok(m.parseListPage(pageOf([row(21), row(22), row(23)], 3, 23), p3));
  for (const [bad, r] of [
    [{ ...pageOf([row(1)], 1, 1), extra: 1 }, req],
    [pageOf([row(1)], 2, 1), req],
    [{ items: [row(1)], total: 1, page: { number: 1, limit: 10, pages: 2 } }, req],
    [{ items: [row(1)], total: 1, page: { number: 1, limit: 25, pages: 1 } }, req],
    [pageOf([row(1)], 1, 5), req],
    [pageOf([row(1), row(1)], 1, 2), req],
    [pageOf([row(1, { artisan_id: USER })], 1, 1), req],
    [pageOf([(({ site_name: _s, ...x }) => x)(row(1))], 1, 1), req],
    [pageOf([row(1, { postal_code: "972" })], 1, 1), req],
    [pageOf([row(1, { estimate_max_cents: 100 })], 1, 1), req],
    [pageOf([row(1, { site_id: S2 })], 1, 1), m.listBody(F({ site_id: S1 }), 1)!],
    [pageOf([row(1, { status: "paid" })], 1, 1), m.listBody(F({ status: "requested" }), 1)!],
    [pageOf([row(1, { category: "panel" })], 1, 1), m.listBody(F({ category: "outage" }), 1)!],
    [pageOf(Array.from({ length: 11 }, (_, i) => row(i + 1)), 1, 11), req],
  ] as [unknown, Model.ListBody][])
    assert.equal(m.parseListPage(bad, r), null, JSON.stringify(bad).slice(0, 100));
  same([m.attachmentName('attachment; filename="interventions.csv"'), m.attachmentName('attachment; filename="../x.csv"'), m.attachmentName("inline"), m.attachmentName(null)], ["interventions.csv", null, null, null]);
});

function harness({ lists = [] as (Model.ListResult | Promise<Model.ListResult>)[], exports = [] as (Model.ExportResult | Promise<Model.ExportResult>)[], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: unknown[] = [];
  const saved: [unknown, string][] = [];
  const timers: { f: () => void; ms: number; cleared: boolean }[] = [];
  let s: Model.SearchState = { ...m.SEARCH_INITIAL };
  const c = m.createSearchController({
    api: () => ({ list: async (b) => (calls.push(b), lists.shift() ?? res(200, pageOf([], b.page, 0))), exportCsv: async (b) => (calls.push(b), exports.shift() ?? { status: 503, blob: null, filename: null, csv: false }) }),
    context: { generation: () => ctx.gen, userId: () => ctx.uid },
    set: (n) => (s = n),
    timers: { set: (f, ms) => (timers.push({ f, ms, cleared: false }), timers.length - 1), clear: (h) => void (timers[h as number].cleared = true) },
    save: (blob, name) => void saved.push([blob, name]),
  });
  const flush = () => { for (const t of timers) if (!t.cleared) { t.cleared = true; t.f(); } };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { c, calls, saved, timers, flush, tick, ctx, get: () => s };
}

test("pagination numérotée ; filtre/page/site immédiats ; recherche différée ; réponse périmée ignorée ; identité changée ⇒ aucune suite", async () => {
  const h = harness({ lists: [res(200, pageOf(Array.from({ length: 10 }, (_, i) => row(i + 1)), 1, 23)), res(200, pageOf([row(11)].concat(Array.from({ length: 9 }, (_, i) => row(i + 12))), 2, 23))] });
  h.c.query(F(), 1); await h.tick();
  same([h.get().phase, h.get().items.length, h.get().total, h.get().page, h.get().pages], ["ready", 10, 23, 1, 3]);
  h.c.query(F(), 2); await h.tick();
  same([(h.calls[1] as Model.ListBody).page, h.get().page], [2, 2], "page change ⇒ immediate");
  h.c.query(F({ site_id: S1 }), 1);
  same([h.calls.length, (h.calls[2] as Model.ListBody).site_id, (h.calls[2] as Model.ListBody).page], [3, S1, 1], "site ⇒ site_id, immediate, page 1");
  h.c.query(F({ site_id: S1, search: "t" }), 1);
  h.c.query(F({ site_id: S1, search: "ta" }), 1);
  same([h.calls.length, h.get().phase, h.get().items], [3, "loading", []], "search debounced; nothing stale shown");
  h.flush(); await h.tick();
  same((h.calls[3] as Model.ListBody).search, "ta");
  let slow!: (r: Model.ListResult) => void;
  const g = harness({ lists: [new Promise((r) => (slow = r)), res(200, pageOf([row(2, { status: "paid" })], 1, 1))] });
  g.c.query(F(), 1);
  g.c.query(F({ status: "paid" }), 1); await g.tick();
  slow(res(200, pageOf([row(1)], 1, 1))); await g.tick();
  same(g.get().items.map((x) => x.id), [ID(2)], "the reply for the previous quick filter is dropped");
  let late!: (r: Model.ListResult) => void;
  const i = harness({ lists: [new Promise((r) => (late = r))] });
  i.c.query(F(), 1);
  i.ctx.gen = 1;
  late(res(200, pageOf([row(1)], 1, 1))); await i.tick();
  same([i.get().items, i.get().phase], [[], "loading"]);
  i.c.query(F({ status: "paid" }), 1);
  same(i.calls.length, 1, "a controller never serves another identity");
});

test("vide, erreur + réessai, réponse invalide = erreur, 401/403 ⇒ liste effacée", async () => {
  const h = harness({ lists: [res(503), res(200, { junk: 1 }), res(200, pageOf([], 1, 0))] });
  h.c.query(F(), 1); await h.tick();
  same([h.get().phase, h.get().error], ["error", m.COPY.failed]);
  h.c.retry(h.get().key); await h.tick();
  same(h.get().phase, "error");
  h.c.retry(h.get().key); await h.tick();
  same([h.get().phase, h.get().total, h.calls.length], ["ready", 0, 3]);
  for (const st of [401, 403]) {
    const f = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), res(st)] });
    f.c.query(F(), 1); await f.tick();
    f.c.query(F({ status: "paid" }), 1); await f.tick();
    same([f.get().phase, f.get().items, f.get().total], ["forbidden", [], 0], String(st));
  }
});

test("CSV : blob + nom depuis la réponse ; jeté si l’identité ou les filtres changent pendant l’attente ; refusé pour une autre clé ; 409 / non-CSV / 401", async () => {
  const blob = { kind: "blob" };
  const ok = { status: 200, blob: blob as unknown as Blob, filename: "interventions.csv", csv: true };
  const ready = async (f: Model.Filters, exports: (Model.ExportResult | Promise<Model.ExportResult>)[]) => {
    const x = harness({ lists: [res(200, pageOf([row(1, f.site_id ? { site_id: f.site_id } : {})], 1, 1))], exports });
    x.c.query(f, 1); await x.tick();
    return x;
  };
  let latest: Model.Filters = F({ site_id: S1 });
  const h = await ready(latest, [ok]);
  same(await h.c.exportCsv(latest, () => latest, "other-key"), false, "another render key ⇒ nothing sent");
  same(await h.c.exportCsv(latest, () => latest, h.get().key), true);
  same([h.calls[1], h.saved, h.get().exportNotice], [m.exportBody(latest), [[blob, "interventions.csv"]], m.COPY.exported]);
  let release!: (r: Model.ExportResult) => void;
  latest = F();
  const changed = await ready(latest, [new Promise((r) => (release = r))]);
  const p = changed.c.exportCsv(latest, () => latest, changed.get().key);
  latest = F({ status: "paid" });
  release(ok);
  same([await p, changed.saved, changed.get().exportError], [false, [], m.COPY.exportChanged], "filters changed ⇒ file dropped, said honestly");
  let release2!: (r: Model.ExportResult) => void;
  const who = await ready(F(), [new Promise((r) => (release2 = r))]);
  const q = who.c.exportCsv(F(), () => F(), who.get().key);
  who.ctx.uid = "10000000-0000-4000-8000-000000000002";
  release2(ok);
  same([await q, who.saved], [false, []], "identity changed ⇒ dropped");
  for (const [r, msg] of [[{ status: 409, blob: null, filename: null, csv: false }, m.COPY.exportTooLarge], [{ status: 200, blob: null, filename: null, csv: false }, m.COPY.exportInvalid], [{ status: 200, blob, filename: null, csv: true }, m.COPY.exportInvalid], [{ status: 503, blob: null, filename: null, csv: false }, m.COPY.exportFailed]] as [Model.ExportResult, string][]) {
    const x = await ready(F(), [r]);
    same([await x.c.exportCsv(F(), () => F(), x.get().key), x.saved.length, x.get().exportError], [false, 0, msg], JSON.stringify(r));
  }
  const forb = await ready(F(), [{ status: 403, blob: null, filename: null, csv: false }]);
  await forb.c.exportCsv(F(), () => F(), forb.get().key);
  same([forb.get().phase, forb.get().items], ["forbidden", []], "401/403 ⇒ list cleared");
});

test("clé au rendu : un état d’une autre identité / d’autres filtres / d’une autre page n’est jamais affiché", () => {
  const ctx = { generation: () => 0, userId: () => USER };
  const k = m.viewKey(ctx, F(), 1);
  const st = { ...m.SEARCH_INITIAL, key: k, phase: "ready" as const, items: [row(1) as unknown as Model.EnterpriseRow], total: 1 };
  same(m.viewOf(st, k).items.length, 1);
  for (const other of [m.viewKey(ctx, F({ status: "paid" }), 1), m.viewKey(ctx, F(), 2), m.viewKey(ctx, F({ search: "x" }), 1), m.viewKey({ generation: () => 1, userId: () => USER }, F(), 1)])
    same([m.viewOf(st, other).phase, m.viewOf(st, other).items], ["loading", []], other);
  same(m.viewKey(ctx, F({ search: " x " }), 1), m.viewKey(ctx, F({ search: "x" }), 1), "trimmed search");
});

test("périmètre : un 401/403 tardif de l’organisation A ne vide pas B ; export A→B→A ⇒ aucun fichier ; export dont le scope a changé ⇒ 403 ignoré", async () => {
  let lateA!: (r: Model.ListResult) => void;
  const h = harness({ lists: [new Promise((r) => (lateA = r)), res(200, pageOf([row(7)], 1, 1))] });
  h.c.query(F(), 1);
  h.c.query(F({ organization_id: ORG_B }), 1); await h.tick();
  same([h.get().phase, h.get().items.map((x) => x.id)], ["ready", [ID(7)]]);
  lateA(res(401)); await h.tick();
  same([h.get().phase, h.get().items.map((x) => x.id)], ["ready", [ID(7)]], "late 401 of org A leaves org B intact");
  const blob = { kind: "blob" };
  const ok = { status: 200, blob: blob as unknown as Blob, filename: "interventions.csv", csv: true };
  let rel!: (r: Model.ExportResult) => void;
  const aba = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), res(200, pageOf([row(2)], 1, 1)), res(200, pageOf([row(1)], 1, 1))], exports: [new Promise((r) => (rel = r))] });
  aba.c.query(F(), 1); await aba.tick();
  let latest = F();
  const p = aba.c.exportCsv(latest, () => latest, aba.get().key);
  latest = F({ organization_id: ORG_B }); aba.c.query(latest, 1); await aba.tick();
  latest = F(); aba.c.query(latest, 1); await aba.tick();
  rel(ok);
  same([await p, aba.saved, aba.get().exportError], [false, [], m.COPY.exportChanged], "A→B→A during the export ⇒ no download, said honestly");
  let rel2!: (r: Model.ExportResult) => void;
  const late403 = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), res(200, pageOf([row(3)], 1, 1))], exports: [new Promise((r) => (rel2 = r))] });
  late403.c.query(F(), 1); await late403.tick();
  let l2 = F();
  const q = late403.c.exportCsv(l2, () => l2, late403.get().key);
  l2 = F({ organization_id: ORG_B }); late403.c.query(l2, 1); await late403.tick();
  rel2({ status: 403, blob: null, filename: null, csv: false });
  same([await q, late403.get().phase, late403.get().items.map((x) => x.id)], [false, "ready", [ID(3)]], "a late export 403 of the old scope never clears the new one");
  const page2 = harness({ lists: [res(200, pageOf(Array.from({ length: 10 }, (_, i) => row(i + 1)), 1, 12)), res(200, pageOf([row(11), row(12)], 2, 12))], exports: [ok] });
  page2.c.query(F(), 1); await page2.tick();
  page2.c.query(F(), 2); await page2.tick();
  same(await page2.c.exportCsv(F(), () => F(), page2.get().key), true, "a page change is not a scope change");
});

test("autorisation refusée entre la liste et l’export du même périmètre ; sortie du périmètre pendant l’export", async () => {
  const blob = { kind: "blob" };
  const ok = { status: 200, blob: blob as unknown as Blob, filename: "interventions.csv", csv: true };
  // export 403 while a list GET of the same scope is held ⇒ the late list 200 shows nothing
  let hold2!: (r: Model.ListResult) => void;
  const b = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), new Promise((r) => (hold2 = r))], exports: [{ status: 403, blob: null, filename: null, csv: false }] });
  b.c.query(F(), 1); await b.tick();
  const k = b.get().key;
  const exp = b.c.exportCsv(F(), () => F(), k);
  b.c.retry(k); // a list GET of the same scope is now in flight (held)
  same(await exp, false);
  same(b.get().phase, "forbidden");
  hold2(res(200, pageOf([row(9)], 1, 1))); await b.tick();
  same([b.get().phase, b.get().items], ["forbidden", []], "export 403 ⇒ the late list 200 shows nothing");
  // list 403 while an export is held ⇒ the late CSV 200 is not saved
  let holdExp!: (r: Model.ExportResult) => void;
  const c = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), res(403)], exports: [new Promise((r) => (holdExp = r))] });
  c.c.query(F(), 1); await c.tick();
  const k2 = c.get().key;
  const exp2 = c.c.exportCsv(F(), () => F(), k2);
  c.c.retry(k2); await c.tick();
  same(c.get().phase, "forbidden");
  holdExp(ok);
  same([await exp2, c.saved], [false, []], "list 403 ⇒ the late CSV 200 is never saved");
  // A → no scope → A: the controller is stopped when leaving the scope ⇒ no download
  let holdExp3!: (r: Model.ExportResult) => void;
  const d = harness({ lists: [res(200, pageOf([row(1)], 1, 1))], exports: [new Promise((r) => (holdExp3 = r))] });
  d.c.query(F(), 1); await d.tick();
  const exp3 = d.c.exportCsv(F(), () => F(), d.get().key);
  d.c.stop(); // what the hook does when filters become null
  holdExp3(ok);
  same([await exp3, d.saved], [false, []]);
  const hook = readFileSync("components/features/enterprise-search/use-enterprise-search.ts", "utf8");
  assert.match(hook, /const active = enabled && filters !== null;/);
  assert.match(hook, /\}, \[active, identity\]\);/, "the controller lives only while a scope exists");
});

test("compteurs du tableau de bord (e857e56) : lecture stricte, même périmètre, urgent ≤ open, clé au rendu, 401 tardif ignoré", async () => {
  const body = oc.countsBody(ORG, S1)!;
  const ok = { organization_id: ORG, site_id: S1, counts: { open: 123, urgent: 61 }, captured_at: "2026-11-07T00:00:00Z" };
  same(oc.parseCounts(ok, body)?.counts, { open: 123, urgent: 61 });
  for (const bad of [{ ...ok, extra: 1 }, { ...ok, counts: { open: 1, urgent: 2 } }, { ...ok, counts: { open: 1.5, urgent: 0 } }, { ...ok, counts: { open: 1, urgent: 0, closed: 3 } }, { ...ok, site_id: null }, { ...ok, organization_id: ORG_B }, { ...ok, captured_at: "hier" }, { ...ok, counts: { open: -1, urgent: 0 } }])
    assert.equal(oc.parseCounts(bad, body), null, JSON.stringify(bad).slice(0, 90));
  same(oc.countsBody(ORG, null), { organization_id: ORG, site_id: null });
  same([oc.countsBody("x", null), oc.countsBody(ORG, "y")], [null, null]);
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const k = oc.countsKey(context, ORG, S1);
  const st = { ...oc.COUNTS_INITIAL, key: k, phase: "ready" as const, open: 5, urgent: 1 };
  same(oc.countsView(st, k).open, 5);
  for (const other of [oc.countsKey(context, ORG, null), oc.countsKey(context, ORG_B, S1), oc.countsKey({ generation: () => 1, userId: () => USER }, ORG, S1)])
    same([oc.countsView(st, other).phase, oc.countsView(st, other).open], ["loading", 0], "another scope ⇒ loading, never an old figure");
  const calls: unknown[] = [];
  const replies: (Counts.CountsResult | Promise<Counts.CountsResult>)[] = [];
  let s: Counts.CountsState = oc.COUNTS_INITIAL;
  const c = oc.createCountsController({ api: () => ({ read: async (b) => (calls.push(b), replies.shift() ?? res(503)) }), context, set: (n) => (s = n) });
  let lateA!: (r: Counts.CountsResult) => void;
  replies.push(new Promise((r) => (lateA = r)), res(200, { ...ok, organization_id: ORG_B, site_id: null }));
  c.query(ORG, S1);
  c.query(ORG_B, null);
  await new Promise((r) => setTimeout(r, 0));
  same([s.phase, s.open, calls], ["ready", 123, [{ organization_id: ORG, site_id: S1 }, { organization_id: ORG_B, site_id: null }]]);
  lateA(res(401)); await new Promise((r) => setTimeout(r, 0));
  same([s.phase, s.open], ["ready", 123], "late 401 of the old scope ignored");
  replies.push(res(404), res(200, ok));
  c.query(ORG, S1); await new Promise((r) => setTimeout(r, 0));
  same([s.phase, s.error], ["error", oc.COUNTS_COPY.scope], "404 ⇒ honest scope error, never zero");
  c.retry(s.key); await new Promise((r) => setTimeout(r, 0));
  same([s.phase, s.open, s.urgent], ["ready", 123, 61]);
  replies.push(res(403));
  c.query(ORG_B, S1); await new Promise((r) => setTimeout(r, 0));
  same([s.phase, s.open], ["forbidden", 0], "401/403 ⇒ cleared");
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /useOverviewCounts\(\{ enabled: !c\.demo, context: c\.session\.mutationContext, organizationId: c\.organization\?\.id \|\| null, siteId: c\.activeSite\?\.id \|\| null \}\)/);
  assert.match(src, /value=\{openValue\}\n\s*note=\{openNote\}/);
  assert.match(src, /const openValue = c\.demo \? open : counts\.state\.phase === "ready" \? counts\.state\.open : counts\.state\.phase === "loading" \? "…" : "—";/, "loading / error never shown as zero");
});

test("synthèse professionnelle (7c6eff1) : lecture stricte, fenêtre Martinique, même périmètre, clé au rendu, 401 tardif ignoré, jamais 0 non lu", async () => {
  const body = po.proBody(ORG, S1)!;
  // 2026-11-07T03:00Z is still 6 Nov in Martinique (UTC-4).
  const ok = { organization_id: ORG, site_id: S1, counts: { approvals_pending: 4, deadlines30: 120 }, amounts: { accepted_commitment_cents: 12345, reference_budget_cents: 500000, currency: "eur" }, window: { from: "2026-11-06", to: "2026-12-06", time_zone: "America/Martinique" }, captured_at: "2026-11-07T03:00:00Z" };
  same(po.parseProfessional(ok, body)?.counts, { approvals_pending: 4, deadlines30: 120 });
  for (const bad of [
    { ...ok, extra: 1 },
    { ...ok, counts: { ...ok.counts, overdue: 1 } },
    { ...ok, amounts: { ...ok.amounts, currency: "usd" } },
    { ...ok, amounts: { ...ok.amounts, accepted_commitment_cents: -1 } },
    { ...ok, window: { ...ok.window, from: "2026-11-07", to: "2026-12-07" } },
    { ...ok, window: { ...ok.window, to: "2026-12-07" } },
    { ...ok, window: { ...ok.window, time_zone: "UTC" } },
    { ...ok, site_id: null },
    { ...ok, organization_id: ORG_B },
    { ...ok, counts: { approvals_pending: 1.5, deadlines30: 0 } },
  ])
    assert.equal(po.parseProfessional(bad, body), null, JSON.stringify(bad).slice(0, 100));
  const ctx = { uid: USER as string | null, gen: 0 };
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const k = po.proKey(context, ORG, S1);
  const st = { ...po.PRO_INITIAL, key: k, phase: "ready" as const, data: po.parseProfessional(ok, body) };
  for (const other of [po.proKey(context, ORG, null), po.proKey(context, ORG_B, S1), po.proKey({ generation: () => 1, userId: () => USER }, ORG, S1)])
    same([po.proView(st, other).phase, po.proView(st, other).data], ["loading", null], "another scope ⇒ loading, never old figures");
  const calls: unknown[] = [];
  const replies: (Pro.ProResult | Promise<Pro.ProResult>)[] = [];
  let s: Pro.ProState = po.PRO_INITIAL;
  const c = po.createProController({ api: () => ({ read: async (b) => (calls.push(b), replies.shift() ?? res(503)) }), context, set: (n) => (s = n) });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  let lateA!: (r: Pro.ProResult) => void;
  replies.push(new Promise((r) => (lateA = r)), res(200, { ...ok, organization_id: ORG_B, site_id: null }));
  c.query(ORG, S1);
  c.query(ORG_B, null); await tick();
  same([s.phase, s.data?.counts.deadlines30], ["ready", 120]);
  lateA(res(403)); await tick();
  same(s.phase, "ready", "late 403 of the old scope ignored");
  replies.push(res(404), res(200, ok));
  c.query(ORG, S1); await tick();
  same([s.phase, s.error, s.data], ["error", po.PRO_COPY.scope, null], "404 ⇒ honest, never zero");
  c.retry(s.key); await tick();
  same([s.phase, s.data?.amounts.accepted_commitment_cents], ["ready", 12345]);
  replies.push(res(401));
  c.query(ORG_B, S1); await tick();
  same([s.phase, s.data], ["forbidden", null], "401/403 ⇒ cleared");
  assert.match(po.PRO_COPY.commitment("5 000,00 €"), /pas un solde disponible/);
  assert.match(po.PRO_COPY.commitment(null), /non renseigné/);
  assert.match(po.PRO_COPY.deadlines("2026-11-06", "2026-12-06"), /du 6 nov\. 2026 au 6 déc\. 2026 \(heure de Martinique\), hors échéances dépassées/);
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /useProfessionalOverview\(\{ enabled: !c\.demo, context: c\.session\.mutationContext, organizationId: c\.organization\?\.id \|\| null, siteId: c\.activeSite\?\.id \|\| null \}\)/);
  assert.match(src, /const proPending = pro\.state\.phase === "loading" \|\| pro\.state\.phase === "idle" \? "…" : "—";/, "loading / error never 0");
  assert.match(src, /value=\{c\.demo \? figures\.approvalsPending \?\? placeholder : proData \? proData\.counts\.approvals_pending : proPending\}/);
  assert.match(src, /siteBudgetBars\(scope\.sites, scope\.interventions, scope\.quotes\)/, "charts still from the loaded data, untouched");
});

test("« Actualiser » : relit la même clé (liste, compteurs, synthèse) ; une autre clé ⇒ rien ; démo sans bouton ; une seule alerte de synthèse", async () => {
  const h = harness({ lists: [res(200, pageOf([row(1)], 1, 1)), res(200, pageOf([row(2)], 1, 1))] });
  h.c.query(F(), 1); await h.tick();
  same(h.c.refresh("other"), false);
  same(h.c.refresh(h.get().key), true);
  await h.tick();
  same([h.calls.length, h.calls[1], h.get().items.map((x) => x.id)], [2, m.listBody(F(), 1), [ID(2)]], "same key re-read through the same guards");
  const ctx = { generation: () => 0, userId: () => USER };
  for (const [mod, create, ok] of [[oc, "createCountsController", { organization_id: ORG, site_id: null, counts: { open: 1, urgent: 0 }, captured_at: "2026-11-07T00:00:00Z" }], [po, "createProController", { organization_id: ORG, site_id: null, counts: { approvals_pending: 1, deadlines30: 0 }, amounts: { accepted_commitment_cents: 0, reference_budget_cents: 0, currency: "eur" }, window: { from: "2026-11-06", to: "2026-12-06", time_zone: "America/Martinique" }, captured_at: "2026-11-07T03:00:00Z" }]] as [any, string, unknown][]) {
    const calls: unknown[] = [];
    let st: { key: string } = { key: "" };
    const c = mod[create]({ api: () => ({ read: async (b: unknown) => (calls.push(b), res(200, ok)) }), context: ctx, set: (n: { key: string }) => (st = n) });
    c.query(ORG, null); await h.tick();
    same([c.refresh("other"), calls.length], [false, 1], create);
    same(c.refresh(st.key), true); await h.tick();
    same(calls, [{ organization_id: ORG, site_id: null }, { organization_id: ORG, site_id: null }], create);
  }
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  same((src.match(/data-professional-overview-error=""/g) ?? []).length, 1, "one grouped alert");
  same((src.match(/onClick=\{\(\) => pro\.retry\(\)\}/g) ?? []).length, 1, "one « Réessayer »");
  assert.match(src, /\{!c\.demo && \(\n\s*<button type="button" className="button outline" onClick=\{refreshAll\} data-overview-refresh="">/, "no dashboard refresh in demo");
  assert.match(src, /\{refreshable && list\.live && \(/, "no list refresh in demo");
});

test("câblage : useInterventionList en direct ⇒ recherche serveur ; démo ⇒ liste locale ; KPI non touchés", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  const hook = src.slice(src.indexOf("function useInterventionList"), src.indexOf("function ExportButton"));
  assert.match(hook, /const live = !c\.demo;/);
  assert.match(hook, /site_id: c\.activeSite\?\.id \|\| effective\.site \|\| null/, "global site selection (or the local site filter) ⇒ site_id");
  assert.match(hook, /useEnterpriseSearch\(\{ enabled: live, context: c\.session\.mutationContext/);
  assert.match(src, /onClick=\{\(\) => c\.session\.openIntervention\(i\.id\)\}/, "rows open through the existing detail path");
  assert.match(src, /dashboardFigures\(professionalState, scope,/, "KPIs still computed from the loaded scope (separate lot)");
  assert.doesNotMatch(hook + readFileSync("components/features/enterprise-search/model.ts", "utf8"), /sessionStorage|localStorage|history\.|location\./);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RequestsView, OverviewView } from "./components/role/enterprise-space";
import { useEnterpriseSearch, useOverviewCounts, useProfessionalOverview } from "./components/features/enterprise-search/use-enterprise-search";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const row = (n, over = {}) => ({ id: ID(n), category: "outage", address: n + " rue Victor Hugo", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 12000, created_at: "2025-01-02T10:00:00.000Z", site_id: "${S1}", site_name: "Siège", artisan_assigned: n % 2 === 0, ...over });
const sites = [{ id: "${S1}", name: "Siège", organization_id: "${ORG}" }, { id: "${S2}", name: "Entrepôt", organization_id: "${ORG}" }];
const ctx = (gen, opened, activeSite = null) => ({
  session: { mode: "live", mutationContext: { userId: () => "${USER}", generation: () => gen }, openIntervention: (id) => opened.push(id) },
  demo: false, organization: { id: "${ORG}", name: "Org" }, activeSite, orgSites: sites, orgInterventions: [],
  scope: { sites, interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] },
  siteAccess: null, authority: { canWrite: true, readOnlyReason: null }, canCreateRequest: true, reloadSiteAccess: () => {}, go: () => {},
});
w.frames = async () => {
  w.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (String(url).endsWith("/overview")) return Response.json({ organization_id: b.organization_id, site_id: b.site_id, counts: { open: b.site_id ? 3 : 9, urgent: 1 }, captured_at: "2026-11-07T00:00:00Z" });
    if (String(url).endsWith("/professional")) return Response.json({ organization_id: b.organization_id, site_id: b.site_id, counts: { approvals_pending: b.site_id ? 2 : 7, deadlines30: 1 }, amounts: { accepted_commitment_cents: 100, reference_budget_cents: 0, currency: "eur" }, window: { from: "2026-11-06", to: "2026-12-06", time_zone: "America/Martinique" }, captured_at: "2026-11-07T03:00:00Z" });
    const base = b.organization_id === "${ORG}" ? 100 : 200;
    const total = 12;
    const start = (b.page - 1) * 10;
    const items = Array.from({ length: Math.min(10, total - start) }, (_, i) => row(base + start + i, b.site_id ? { site_id: b.site_id } : {}));
    return Response.json({ items, total, page: { number: b.page, limit: 10, pages: 2 } });
  };
  const frames = [];
  const ctxI = { userId: () => "${USER}", generation: () => 0 };
  function Probe({ org, site, page }) {
    const f = { organization_id: org, site_id: site, category: null, status: null, search: "", sort: "recent" };
    const r = useEnterpriseSearch({ enabled: true, context: ctxI, filters: f, page });
    const k = useOverviewCounts({ enabled: true, context: ctxI, organizationId: org, siteId: site });
    const p = useProfessionalOverview({ enabled: true, context: ctxI, organizationId: org, siteId: site });
    frames.push({ org, site, page, phase: r.state.phase, ids: r.state.items.map((x) => x.id), countsPhase: k.state.phase, open: k.state.open, proPhase: p.state.phase, approvals: p.state.data ? p.state.data.counts.approvals_pending : null });
    return null;
  }
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  const show = (org, site, page) => root.render(h(StrictMode, null, h(Probe, { org, site, page })));
  const steps = {};
  show("${ORG}", null, 1); await tick(300);
  steps.ready = frames[frames.length - 1];
  for (const [name, org, site, page] of [["page", "${ORG}", null, 2], ["site", "${ORG}", "${S1}", 1], ["org", "${ORG_B}", "${S1}", 1]]) {
    const mark = frames.length; show(org, site, page); await tick(300);
    steps[name] = frames.slice(mark);
  }
  root.unmount();
  return steps;
};
w.scopeExit = async () => {
  let release;
  const saved = [];
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = (b) => { saved.push(b.size); return origCreate(b); };
  w.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (b.action === "export") { await new Promise((r) => (release = r)); return new Response("x", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="interventions.csv"' } }); }
    return Response.json({ items: [row(1)], total: 1, page: { number: 1, limit: 10, pages: 1 } });
  };
  const ctxI = { userId: () => "${USER}", generation: () => 0 };
  const A = { organization_id: "${ORG}", site_id: null, category: null, status: null, search: "", sort: "recent" };
  let api = null;
  function Probe({ f }) { api = useEnterpriseSearch({ enabled: true, context: ctxI, filters: f, page: 1 }); return null; }
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(Probe, { f: A }))); await tick(300);
  const p = api.exportCsv();
  await tick(50);
  root.render(h(StrictMode, null, h(Probe, { f: null }))); await tick(100);
  root.render(h(StrictMode, null, h(Probe, { f: { ...A } }))); await tick(300);
  release(); const result = await p; await tick(100);
  URL.createObjectURL = origCreate;
  root.unmount();
  return { result, saved };
};
w.overview = async (proFails) => {
  const calls = [];
  w.fetch = async (url, init) => {
    const u = String(url); const b = JSON.parse(init.body); calls.push(u.replace("/api/enterprise/", "") + (b.action ? ":" + b.action : ""));
    if (u.endsWith("/overview")) return Response.json({ organization_id: b.organization_id, site_id: b.site_id, counts: { open: 4, urgent: 1 }, captured_at: "2026-11-07T00:00:00Z" });
    if (u.endsWith("/professional")) return proFails ? Response.json({ error: "x" }, { status: 503 }) : Response.json({ organization_id: b.organization_id, site_id: b.site_id, counts: { approvals_pending: 2, deadlines30: 1 }, amounts: { accepted_commitment_cents: 100, reference_budget_cents: 0, currency: "eur" }, window: { from: "2026-11-06", to: "2026-12-06", time_zone: "America/Martinique" }, captured_at: "2026-11-07T03:00:00Z" });
    return Response.json({ items: [row(1)], total: 1, page: { number: 1, limit: 10, pages: 1 } });
  };
  const c = { ...ctx(0, []), session: { mode: "live", mutationContext: { userId: () => "${USER}", generation: () => 0 }, openIntervention: () => {}, capabilities: { professional: "loaded" } } };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  root.render(h(StrictMode, null, h(OverviewView, { c })));
  await tick(400);
  const first = calls.slice();
  const alerts = div.querySelectorAll("[data-professional-overview-error]").length;
  const retryButtons = [...div.querySelectorAll("[data-professional-overview-error] button")].length;
  const n = calls.length;
  div.querySelector("[data-overview-refresh]").click(); await tick(400);
  const refreshed = calls.slice(n);
  root.unmount();
  // demo: no button, zero fetch
  const before = calls.length;
  const d = document.createElement("div"); document.body.appendChild(d);
  const r2 = createRoot(d);
  r2.render(h(StrictMode, null, h(OverviewView, { c: { ...c, demo: true, session: { ...c.session, mode: "demo" } } })));
  await tick(300);
  const demo = { calls: calls.length - before, buttons: d.querySelectorAll("[data-overview-refresh], [data-enterprise-list-refresh]").length };
  r2.unmount();
  return { first, alerts, retryButtons, refreshed, demo };
};
w.run = async () => {
  const bodies = [], opened = [], saved = [], revoked = [];
  let exportGate = null;
  w.fetch = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push(b);
    if (b.action === "export") {
      if (exportGate) await exportGate;
      return new Response("\\uFEFFRéférence;Site\\r\\nINT-A00000;Siège", { status: 200, headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="interventions.csv"' } });
    }
    if (b.search === "slow") { await tick(500); return Response.json({ items: [row(1)], total: 1, page: { number: 1, limit: 10, pages: 1 } }); }
    if (b.status === "cancelled") return Response.json({ error: "x" }, { status: 503 });
    if (b.status === "paid") return Response.json({ items: [], total: 0, page: { number: 1, limit: 10, pages: 1 } });
    const total = b.site_id === "${S2}" ? 3 : 23;
    const start = (b.page - 1) * 10;
    const n = Math.min(10, total - start);
    const items = Array.from({ length: n }, (_, i) => row(500 + start + i, b.site_id ? { site_id: b.site_id, site_name: b.site_id === "${S2}" ? "Entrepôt" : "Siège" } : {}));
    return Response.json({ items, total, page: { number: b.page, limit: 10, pages: Math.max(1, Math.ceil(total / 10)) } });
  };
  const origCreate = URL.createObjectURL, origRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => { const u = origCreate(blob); saved.push({ u, size: blob.size, type: blob.type }); return u; };
  URL.revokeObjectURL = (u) => { revoked.push(u); origRevoke(u); };
  const clicks = [];
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  let gen = 0;
  const render = (activeSite = null) => root.render(h(StrictMode, null, h(RequestsView, { c: ctx(gen, opened, activeSite) })));
  render(); await tick(300);
  const out = {};
  out.firstRows = div.querySelectorAll("tbody tr").length;
  out.pageButtons = [...div.querySelectorAll("nav[aria-label='Pagination des interventions'] [aria-label^='Page ']")].map((b) => b.textContent).filter(Boolean);
  out.heading = div.querySelector("h2")?.textContent;
  div.querySelector("[aria-label='Page 2']").click(); await tick(200);
  out.page2Body = bodies[bodies.length - 1];
  out.page2Current = div.querySelector("[aria-current=page]")?.textContent;
  div.querySelector("tbody tr button").click();
  out.opened = opened.slice();
  const selectSite = [...div.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "Tous les sites"));
  const setSel = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("change", { bubbles: true })); };
  setSel(selectSite, "${S2}"); await tick(200);
  out.siteBody = bodies[bodies.length - 1];
  out.siteRows = div.querySelectorAll("tbody tr").length;
  const input = div.querySelector("input[type=search]");
  const setIn = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };
  const before = bodies.length;
  setIn("slow"); await tick(350);
  setIn("slo"); await tick(100);
  const statusSel = [...div.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === "Tous les statuts"));
  setSel(statusSel, "paid"); await tick(700);
  out.quickBodies = bodies.slice(before).map((b) => [b.search, b.status]);
  out.afterQuick = { empty: div.textContent.includes("Aucun dossier ne correspond aux filtres"), rows: div.querySelectorAll("tbody tr").length };
  setSel(statusSel, "cancelled"); await tick(300);
  out.errorShown = !!div.querySelector("[data-enterprise-list-error]");
  setSel(statusSel, ""); setIn(""); await tick(600);
  out.heights = [...div.querySelectorAll("nav[aria-label='Pagination des interventions'] button, tbody button")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0); // hidden columns (existing responsive layout) excluded
  out.overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  // CSV ok
  [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Exporter")).click(); await tick(300);
  out.exportBody = bodies[bodies.length - 1];
  out.saved = saved.slice(); out.clicks = clicks.slice(); out.revoked = revoked.length;
  out.notice = div.querySelector("[data-enterprise-export-notice]")?.textContent ?? null;
  // CSV with a filter change during the await ⇒ dropped
  let open; exportGate = new Promise((r) => (open = r));
  [...div.querySelectorAll("button")].find((b) => b.textContent.includes("Exporter")).click(); await tick(50);
  setSel(statusSel, "requested"); await tick(50);
  open(); await tick(300);
  out.savedAfterChange = saved.length; out.changedMsg = div.querySelector("[data-enterprise-export-error]")?.textContent ?? null;
  exportGate = null;
  // Global site selection ⇒ site_id, local site select hidden
  render(sites[0]); await tick(400);
  out.globalBody = bodies[bodies.length - 1];
  out.localSiteHidden = ![...div.querySelectorAll("select")].some((s) => [...s.options].some((o) => o.textContent === "Tous les sites"));
  // Identity change ⇒ reset + new read
  const n = bodies.length; gen = 1; render(sites[0]); await tick(400);
  out.identityReads = bodies.length - n;
  out.storage = sessionStorage.length + localStorage.length;
  HTMLAnchorElement.prototype.click = origClick;
  return out;
};
`;
test("tableau de bord réel (Chromium) : « Actualiser » relit exactement les 3 lectures du même périmètre ; une seule alerte de synthèse ; démo sans bouton ni appel", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><div></div><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const ok = (await page.evaluate(() => (window as unknown as { overview: (f: boolean) => Promise<unknown> }).overview(false))) as Record<string, any>;
    same([...new Set(ok.first)].sort(), ["interventions/search:list", "overview", "overview/professional"]);
    same([ok.refreshed.slice().sort(), ok.alerts], [["interventions/search:list", "overview", "overview/professional"], 0], "Actualiser ⇒ exactly the 3 reads, once each");
    same(ok.demo, { calls: 0, buttons: 0 }, "demo: no button, zero fetch");
    const ko = (await page.evaluate(() => (window as unknown as { overview: (f: boolean) => Promise<unknown> }).overview(true))) as Record<string, any>;
    same([ko.alerts, ko.retryButtons], [1, 1], "one grouped professional alert with one « Réessayer »");
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("aucun ancien cadre (Chromium, StrictMode) : 1er rendu après changement de page / site / organisation sans anciennes lignes ni ancien compteur", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><div></div><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const exit = (await page.evaluate(() => (window as unknown as { scopeExit: () => Promise<unknown> }).scopeExit())) as { result: boolean; saved: number[] };
    same([exit.result, exit.saved], [false, []], "A → no scope → A during the export ⇒ no download (real hook)");
    const r = (await page.evaluate(() => (window as unknown as { frames: () => Promise<unknown> }).frames())) as Record<string, any>;
    same([r.ready.phase, r.ready.ids.length, r.ready.countsPhase, r.ready.open, r.ready.proPhase, r.ready.approvals], ["ready", 10, "ready", 9, "ready", 7]);
    let prevIds: string[] = r.ready.ids;
    let prevOpen = 9;
    for (const name of ["page", "site", "org"]) {
      const frames = r[name] as { phase: string; ids: string[]; countsPhase: string; open: number; proPhase: string; approvals: number | null }[];
      same([frames[0].phase, frames[0].ids], ["loading", []], `${name}: FIRST render after the change has no old row`);
      const firstReady = frames.findIndex((f) => f.phase === "ready");
      assert.ok(frames.slice(0, firstReady).every((f) => f.ids.length === 0), `${name}: ${JSON.stringify(frames)}`);
      assert.ok(frames.every((f) => JSON.stringify(f.ids) !== JSON.stringify(prevIds)), `${name}: never the previous rows`);
      if (name !== "page") same([frames[0].countsPhase, frames[0].open, frames[0].proPhase, frames[0].approvals], ["loading", 0, "loading", null], `${name}: FIRST render has no old counter / professional figure`);
      else assert.ok(frames.every((f) => f.countsPhase === "ready" && f.open === prevOpen), "page change does not touch the scope counter");
      prevIds = frames[frames.length - 1].ids;
      prevOpen = frames[frames.length - 1].open;
    }
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

for (const width of [390, 1280])
  test(`RequestsView entreprise réelle (Chromium ${width} px, StrictMode) : pages numérotées, site ⇒ site_id, filtre rapide sans réponse périmée, vide/erreur, CSV blob + nom, CSV jeté si filtres changés, site global, identité, ouverture hors cache`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
    const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2"></div><script>${js}</script>`); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
    const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
    try {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
      const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as Record<string, any>;
      same([r.firstRows, r.pageButtons, r.heading.startsWith("23 interventions")], [10, ["1", "2", "3"], true], "numbered pagination from the server total");
      same([r.page2Body.page, r.page2Body.action, r.page2Current], [2, "list", "2"]);
      same(Object.keys(r.page2Body), ["action", "organization_id", "site_id", "category", "status", "search", "sort", "page"]);
      same(r.opened, [ID(510)], "a row beyond the cache opens through session.openIntervention");
      same([r.siteBody.site_id, r.siteBody.page, r.siteRows], [S2, 1, 3], "site selection ⇒ site_id, page 1");
      same(r.quickBodies, [["slow", null], ["slo", "paid"]], "debounced search; the quick status change applies at once with the current text");
      same(r.afterQuick, { empty: true, rows: 0 }, "the slow reply of the earlier search never overrides the quick filter");
      same(r.errorShown, true);
      same(Object.keys(r.exportBody), ["action", "organization_id", "site_id", "category", "status", "search", "sort"]);
      same([r.exportBody.action, r.exportBody.site_id], ["export", S2]);
      same([r.saved.length, r.saved[0].type, r.clicks, r.revoked >= 1], [1, "text/csv; charset=utf-8", ["interventions.csv"], true], "blob + filename from the Response, URL revoked");
      assert.match(r.notice, /Export CSV téléchargé/);
      same([r.savedAfterChange, r.changedMsg], [1, "Le périmètre ou les filtres ont changé pendant la préparation : le fichier n’a pas été enregistré. Relancez l’export."]);
      same([r.globalBody.site_id, r.globalBody.page, r.localSiteHidden], [S1, 1, true], "global site ⇒ site_id");
      assert.ok(r.identityReads >= 1, "identity change ⇒ reset + new read");
      same(r.storage, 0, "nothing persisted");
      assert.ok(r.heights.length > 0 && r.heights.every((x: number) => x >= 40), `targets ${r.heights.join(",")}`);
      // Overflow is checked in the real app below (this isolated mount lacks the enterprise shell layout,
      // so the existing page-title actions do not wrap here — unrelated to the list).
      same(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });

test("app réelle (démo gestionnaire) : interventions et tableau de bord inchangés en local, zéro /api, pas de débordement", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const [route, width] of [["manager-requests", 390], ["manager-requests", 1280], ["manager-overview", 390]] as const) {
      const { page, errors, api } = await open(route, width);
      await page.waitForSelector('[data-enterprise-list="demo"]');
      const rows = await page.locator('[data-enterprise-list="demo"] tbody tr').count();
      const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      assert.ok(rows > 0, `${route} ${width}: ${rows} rows`);
      same([overflow <= 0, api, errors], [true, [], []], `${route} ${width}`);
      await page.context().close();
    }
  });
});
