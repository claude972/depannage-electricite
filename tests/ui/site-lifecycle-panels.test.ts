// Enterprise site lifecycle leaf (backend 9d23fff). Real model functions + SSR of the real panels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-lifecycle/site-lifecycle-model";

const m = loadModule("components/features/site-lifecycle/site-lifecycle-model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/site-lifecycle/site-lifecycle-panels.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const ORG = "40000000-0000-4000-8000-000000000001";
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SID = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-11-01T10:00:00.000Z";
const site = (over: Record<string, unknown> = {}) => ({ id: SITE, organization_id: ORG, name: "Résidence Les Palmiers", address: "12 rue des Flamboyants, Fort-de-France", access_notes: "Badge au gardien", opening_hours: [{ day: 1, opens: "08:00", closes: "12:00" }], type: "syndic", budget_cents: 500000, settings_version: 3, archived_at: null, created_at: AT, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const settings = (over: Record<string, unknown> = {}, canWrite = true) => res(200, { site: site(over), can_write: canWrite });
const replyFor = (cmd: Model.SiteCommand) => res(200, { site: site({ settings_version: cmd.expected_version + 1, ...(cmd.action === "save" ? cmd.values : { archived_at: "2026-11-07T10:00:00.000Z" }) }) });
function memStore() { const map = new Map<string, string>(); return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => (map.set(k, v), true), remove: (k: string) => void map.delete(k) } }; }
const api = (h: { calls: { kind: string; body?: unknown; stored?: string | null; after?: string | null; state?: string }[] }, reads: Model.SlResult[], posts: ((c: Model.SiteCommand) => Model.SlResult | Promise<Model.SlResult>)[], store: Model.SlStore, pages: Model.SlResult[] = []): Model.SlApi => ({
  settings: async () => (h.calls.push({ kind: "GET" }), reads.shift() ?? settings()),
  command: async (_s, body) => (h.calls.push({ kind: "POST", body, stored: store.get(m.commandKey(USER, SITE, body.expected_version)) }), (posts.shift() ?? (() => res(503)))(body)),
  sites: async (_o, state, after) => (h.calls.push({ kind: "LIST", state, after }), pages.shift() ?? res(200, { sites: [], next_after: null })),
});
function settingsHarness({ reads = [] as Model.SlResult[], posts = [] as ((c: Model.SiteCommand) => Model.SlResult | Promise<Model.SlResult>)[], store = memStore().store, ids = [NEW(1), NEW(2)], demo = false } = {}) {
  const h = { calls: [] as { kind: string; body?: unknown; stored?: string | null }[] };
  let s: Model.SettingsState = { ...m.SETTINGS_INITIAL };
  const changed: unknown[] = [];
  const c = m.createSettingsController({ api: () => api(h, reads, posts, store), siteId: SITE, context: { generation: () => 0, userId: () => USER }, store: () => store, newId: () => ids.shift() ?? null, get: () => s, set: (n) => (s = n), demo, onChanged: (x) => changed.push(x) });
  return { c, calls: h.calls, changed, get: () => s };
}
const form = (over: Partial<Model.SiteForm> = {}): Model.SiteForm => ({ ...m.formFromSite(m.parseSettings(settings().body, SITE)!.site), ...over });

test("lecture stricte : site exact, can_write faux si archivé, horaires sans chevauchement, page « after » ordonnée", () => {
  assert.ok(m.parseSettings(settings().body, SITE));
  for (const bad of [null, {}, { site: site(), can_write: true, extra: 1 }, { site: site({ id: SID(2) }), can_write: true }, { site: site({ archived_at: AT }), can_write: true }, { site: site({ type: "hotel" }), can_write: false },
    { site: site({ opening_hours: [{ day: 1, opens: "08:00", closes: "12:00" }, { day: 1, opens: "11:00", closes: "13:00" }] }), can_write: false }, { site: site({ opening_hours: [{ day: 8, opens: "08:00", closes: "09:00" }] }), can_write: false }, { site: { ...site(), budget: 1 }, can_write: false }])
    assert.equal(m.parseSettings(bad, SITE), null, JSON.stringify(bad).slice(0, 90));
  const fifty = Array.from({ length: 50 }, (_, i) => site({ id: SID(i + 10), name: `Site ${i}` }));
  assert.ok(m.parseSitesPage({ sites: fifty, next_after: SID(59) }, ORG, "active", null));
  assert.ok(m.parseSitesPage({ sites: [site({ id: SID(70) })], next_after: null }, ORG, "active", SID(59)));
  for (const [body, state, after] of [[{ sites: fifty, next_after: SID(10) }, "active", null], [{ sites: [site()], next_after: SID(1) }, "active", null], [{ sites: [site({ id: SID(3) }), site({ id: SID(2) })], next_after: null }, "active", null],
    [{ sites: [site({ id: SID(2) })], next_after: null }, "active", SID(5)], [{ sites: [site()], next_after: null }, "archived", null], [{ sites: [site({ organization_id: SID(99) })], next_after: null }, "active", null]] as const)
    assert.equal(m.parseSitesPage(body, ORG, state as Model.SiteState, after), null, JSON.stringify(body).slice(0, 80));
});

test("formulaire : valeurs nettoyées, bornes du contrat, créneaux valides", () => {
  same(m.formToValues(form({ name: "  Résidence  ", access_notes: " Code 1234 " })), { values: { name: "Résidence", address: "12 rue des Flamboyants, Fort-de-France", access_notes: "Code 1234", opening_hours: [{ day: 1, opens: "08:00", closes: "12:00" }] } });
  for (const bad of [{ name: " " }, { address: "abc" }, { access_notes: "x".repeat(2001) }, { opening_hours: [{ day: 2, opens: "12:00", closes: "08:00" }] }, { opening_hours: [{ day: 2, opens: "08:00", closes: "12:00" }, { day: 2, opens: "11:00", closes: "14:00" }] }, { opening_hours: Array.from({ length: 29 }, () => ({ day: 1, opens: "08:00", closes: "09:00" })) }])
    assert.ok("errors" in m.formToValues(form(bad as Partial<Model.SiteForm>)), JSON.stringify(bad).slice(0, 60));
});

test("écriture : commande persistée AVANT le POST, version attendue, relecture ; inchangé ⇒ aucun POST", async () => {
  const mem = memStore();
  const h = settingsHarness({ store: mem.store, reads: [settings(), settings({ settings_version: 4, name: "Résidence B" })], posts: [replyFor] });
  await h.c.load();
  assert.equal(await h.c.save(form()), false, "unchanged ⇒ no POST");
  same(h.calls.map((c) => c.kind), ["GET"]);
  assert.equal(await h.c.save(form({ name: "Résidence B" })), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same((post.body as Model.SaveCommand).command_id, NEW(1));
  same([(post.body as Model.SaveCommand).expected_version, (post.body as Model.SaveCommand).action, (post.body as Model.SaveCommand).values.name], [3, "save", "Résidence B"]);
  same(JSON.parse(post.stored!), post.body, "persisted before the POST");
  same([h.calls.map((c) => c.kind), mem.map.size, h.get().site!.settings_version, h.changed.length], [["GET", "POST", "GET"], 0, 4, 1]);
  // A reply that does not match the command is an unknown outcome.
  const bad = settingsHarness({ posts: [(c) => res(200, { site: site({ settings_version: c.expected_version + 2 }) })] });
  await bad.c.load(); await bad.c.save(form({ name: "X" }));
  same([bad.get().writeError, (bad.get().pending as Model.SaveCommand).command_id], [m.SL_COPY.replyUnreadable, NEW(1)]);
});

test("réponse perdue / 503 / rechargement ⇒ même commande ; 409 ⇒ aucun rejeu, nouvelle clé après « Actualiser »", async () => {
  const mem = memStore();
  const a = settingsHarness({ store: mem.store, posts: [() => res(m.SL_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.save(form({ name: "Résidence C" }));
  await a.c.retry();
  const bodies = a.calls.filter((c) => c.kind === "POST").map((c) => JSON.stringify(c.body));
  same([bodies.length, bodies[0] === bodies[1]], [2, true]);
  assert.equal(await a.c.save(form({ name: "Autre" })), false, "no new command while the outcome is unknown");
  const b = settingsHarness({ store: mem.store, ids: [NEW(9)], posts: [replyFor] });
  await b.c.load();
  same([JSON.stringify(b.get().pending), b.get().writeError], [bodies[0], m.SL_COPY.resume]);
  await b.c.retry();
  same([JSON.stringify(b.calls[1].body), mem.map.size], [bodies[0], 0]);
  const k = memStore();
  const c = settingsHarness({ store: k.store, posts: [() => res(409), replyFor] });
  await c.c.load(); await c.c.save(form({ name: "D" }));
  same([c.get().conflict, c.get().pending, k.map.size], [m.SL_COPY.conflict, null, 1]);
  assert.equal(await c.c.retry(), false);
  assert.equal(await c.c.save(form({ name: "D" })), false, "no new key before the explicit refresh");
  await c.c.refresh();
  same(k.map.size, 0);
  await c.c.save(form({ name: "D" }));
  same(c.calls.filter((x) => x.kind === "POST").map((x) => (x.body as Model.SiteCommand).command_id), [NEW(1), NEW(2)]);
  for (const [status, copy] of [[403, m.SL_COPY.writeForbidden], [404, m.SL_COPY.notFound], [422, m.SL_COPY.invalid]] as const) {
    const x = settingsHarness({ posts: [() => res(status)] });
    await x.c.load(); await x.c.save(form({ name: "E" }));
    same([x.get().writeError, x.get().pending], [copy, null], String(status));
  }
});

test("archivage : sens unique, confirmé, version attendue ; archivé ⇒ lecture seule sans formulaire", async () => {
  const h = settingsHarness({ reads: [settings(), settings({ settings_version: 4, archived_at: "2026-11-07T10:00:00.000Z" }, false)], posts: [replyFor] });
  await h.c.load();
  await h.c.archive();
  same([(h.calls[1].body as Model.ArchiveCommand), h.get().site!.archived_at !== null, h.get().canWrite], [{ command_id: NEW(1), expected_version: 3, action: "archive" }, true, false]);
  const html = renderToString(createElement(ui.SiteSettingsPanel, { siteId: SITE, initial: h.get() }));
  assert.match(text(html), /Site archivé : il reste consultable en lecture seule\. La restauration n’est pas proposée/);
  assert.doesNotMatch(html, /data-sl-form|data-sl-archive=|Restaurer/);
  assert.doesNotMatch(readFileSync("components/features/site-lifecycle/site-lifecycle-model.ts", "utf8"), /action: "restore"|"unarchive"/);
});

test("lecture seule (can_write faux) : aucun formulaire ni POST ; écriture : formulaire + archivage confirmé", async () => {
  const ro = m.applySettings(m.SETTINGS_INITIAL, settings({}, false), SITE);
  const html = renderToString(createElement(ui.SiteSettingsPanel, { siteId: SITE, initial: ro }));
  assert.match(text(html), /Lecture seule : vos droits ne permettent pas de modifier ce site.*Horaires Lundi 08:00–12:00/);
  assert.doesNotMatch(html, /data-sl-form|<input|<textarea/);
  const h = settingsHarness({ reads: [settings({}, false)] });
  await h.c.load();
  same([await h.c.save(form({ name: "Z" })), await h.c.archive(), h.calls.map((c) => c.kind)], [false, false, ["GET"]]);
  const rw = renderToString(createElement(ui.SiteSettingsPanel, { siteId: SITE, initial: m.applySettings(m.SETTINGS_INITIAL, settings(), SITE) }));
  assert.match(rw, /data-sl-form=""/);
  assert.match(rw, /data-sl-archive=""/);
  for (const [status, phase] of [[404, "unavailable"], [403, "unavailable"], [503, "error"]] as const) same(m.applySettings(m.SETTINGS_INITIAL, res(status), SITE).phase, phase, String(status));
});

test("portefeuille : onglets actifs / archivés, pagination « after », jamais présenté comme exhaustif, vide", async () => {
  const calls: { kind: string; after?: string | null; state?: string }[] = [];
  const fifty = Array.from({ length: 50 }, (_, i) => site({ id: SID(i + 10), name: `Site ${i}` }));
  const pages = [res(200, { sites: fifty, next_after: SID(59) }), res(200, { sites: [site({ id: SID(70), name: "Dernier" })], next_after: null }), res(200, { sites: [], next_after: null })];
  let s: Model.ListState = { ...m.LIST_INITIAL };
  const c = m.createListController({ api: () => api({ calls }, [], [], memStore().store, pages), organizationId: ORG, context: { generation: () => 0, userId: () => USER }, get: () => s, set: (n) => (s = n) });
  await c.load("active");
  assert.match(text(renderToString(createElement(ui.OrganizationSitesList, { organizationId: ORG, initial: s }))), /50 site\(s\) affiché\(s\)\. D’autres sites existent : affichez la suite\./);
  await c.more();
  same([s.sites.length, s.nextAfter, calls.map((x) => [x.state, x.after])], [51, null, [["active", null], ["active", SID(59)]]]);
  assert.doesNotMatch(text(renderToString(createElement(ui.OrganizationSitesList, { organizationId: ORG, initial: s }))), /D’autres sites existent|data-sl-more/);
  await c.load("archived");
  same([s.state, s.sites.length, calls.at(-1)], ["archived", 0, { kind: "LIST", state: "archived", after: null }]);
  assert.match(text(renderToString(createElement(ui.OrganizationSitesList, { organizationId: ORG, initial: s }))), /Aucun site archivé\./);
  const urls: string[] = [];
  const real = m.createSlApi((async (u: string, init: RequestInit) => (urls.push(`${init.method} ${u}`), new Response("{}"))) as unknown as typeof fetch);
  await real.sites(ORG, "archived", SID(59)); await real.settings(SITE);
  same(urls, [`GET /api/organizations/${ORG}/sites?state=archived&after=${SID(59)}`, `GET /api/sites/${SITE}/settings`]);
});

test("démo : zéro appel ; clés des panneaux, jetons, 44px, pas d’UUID constant", async () => {
  const d = settingsHarness({ demo: true });
  await d.c.load();
  same([await d.c.save(form({ name: "X" })), d.calls.length, d.get().phase], [false, 0, "demo"]);
  const calls: unknown[] = [];
  let s: Model.ListState = { ...m.LIST_INITIAL };
  await m.createListController({ api: () => api({ calls: calls as never }, [], [], memStore().store), organizationId: ORG, get: () => s, set: (n) => (s = n), demo: true }).load("active");
  same([calls.length, s.phase], [0, "demo"]);
  assert.match(text(renderToString(createElement(ui.SiteSettingsPanel, { siteId: SITE, demo: true }))), /Démonstration : les paramètres du site ne sont ni lus ni enregistrés/);
  const view = readFileSync("components/features/site-lifecycle/site-lifecycle-panels.tsx", "utf8");
  const model = readFileSync("components/features/site-lifecycle/site-lifecycle-model.ts", "utf8");
  assert.match(view, /key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{props\.siteId\}`\}/);
  assert.match(view, /if \(!initial\) void c\.load\(\);/);
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(view + model, /00000000-0000-4000-8000-000000000000/);
  const css = readFileSync("components/features/site-lifecycle/site-lifecycle.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.tab \{[^}]*min-height: 44px;/);
  assert.match(css, /\.textarea \{[^}]*min-height: 44px;/);
});
