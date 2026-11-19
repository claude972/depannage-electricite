// Site sheet opened by id when the site is absent from the workspace: exact GET of the settings route,
// loading → ready, 404 / 503 / other organisation / demo states, identity guard, archived read-only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-lifecycle/site-lifecycle-model";
import type * as Direct from "../../components/features/site-lifecycle/site-direct";

const m = loadModule("components/features/site-lifecycle/site-lifecycle-model.ts") as unknown as typeof Model;
const d = loadModule("components/features/site-lifecycle/site-direct.tsx") as unknown as typeof Direct;
const ui = loadModule("components/features/site-lifecycle/site-lifecycle-panels.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const ORG = "40000000-0000-4000-8000-000000000001";
const OTHER = "40000000-0000-4000-8000-000000000002";
const SITE = "50000000-0000-4000-8000-000000000077";
const USER = "10000000-0000-4000-8000-000000000001";
const site = (over: Record<string, unknown> = {}) => ({ id: SITE, organization_id: ORG, name: "Entrepôt Nord", address: "4 zone de la Jambette, Fort-de-France", access_notes: "", opening_hours: [], type: "office", budget_cents: 0, settings_version: 2, archived_at: null, created_at: "2026-10-01T10:00:00.000Z", ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
function harness(replies: (Model.SlResult | Promise<Model.SlResult>)[], { demo = false, context = { generation: () => 0, userId: () => USER as string | null } } = {}) {
  const calls: string[] = [];
  let s: Model.SettingsState = { ...m.SETTINGS_INITIAL };
  const states: string[] = [];
  const c = d.createDirectController({
    api: () => ({ settings: async (id) => (calls.push(`settings:${id}`), replies.shift()!), command: async () => assert.fail("never a write"), sites: async () => assert.fail("never a list") }),
    siteId: SITE, context, demo, get: () => s, set: (n) => ((s = n), states.push(n.phase)),
  });
  return { c, calls, states, get: () => s };
}
const render = (initial: Model.SettingsState, organizationId: string | null = ORG) =>
  renderToString(createElement(d.SiteDirectLoader, { siteId: SITE, organizationId, initial, back: createElement("button", { "data-back": "" }, "Retour aux sites"), render: (x: Model.SiteRecord) => createElement("div", { "data-rendered": x.id }, x.name) }));

test("site absent du cache ⇒ GET exact des paramètres, chargement puis prêt ; jamais d’écriture", async () => {
  const h = harness([res(200, { site: site(), can_write: true })]);
  await h.c.load();
  same([h.calls, h.states, d.directOutcome(h.get(), ORG)], [[`settings:${SITE}`], ["loading", "ready"], "ready"]);
  assert.match(render(h.get()), new RegExp(`data-rendered="${SITE}"`));
  assert.match(text(render(m.SETTINGS_INITIAL)), /Lecture du site…/);
  const urls: string[] = [];
  await m.createSlApi((async (u: string, init: RequestInit) => (urls.push(`${init.method} ${u}`), new Response("{}"))) as unknown as typeof fetch).settings(SITE);
  same(urls, [`GET /api/sites/${SITE}/settings`]);
});

test("404 / 403 ⇒ « introuvable ou plus accessible » ; 503 ⇒ Réessayer ; autre organisation ⇒ refus honnête", async () => {
  for (const status of [404, 403]) {
    const h = harness([res(status)]);
    await h.c.load();
    same(d.directOutcome(h.get(), ORG), "not_found");
    const html = text(render(h.get()));
    assert.match(html, /Ce site est introuvable ou n’est plus accessible\./);
    assert.match(html, /Retour aux sites/);
  }
  const e = harness([res(503), res(200, { site: site(), can_write: false })]);
  await e.c.load();
  same(d.directOutcome(e.get(), ORG), "error");
  assert.match(render(e.get()), /data-site-direct-retry=""[^>]*>Réessayer/);
  await e.c.load();
  same(d.directOutcome(e.get(), ORG), "ready");
  const o = harness([res(200, { site: site({ organization_id: OTHER }), can_write: true })]);
  await o.c.load();
  same(d.directOutcome(o.get(), ORG), "other_org");
  const html = render(o.get());
  assert.match(text(html), /Ce site n’appartient pas à l’organisation active/);
  assert.doesNotMatch(html, /data-rendered/);
  same(d.directOutcome(o.get(), null), "other_org", "no active organisation ⇒ refused");
  // Off-contract body ⇒ error, never a guessed site.
  const bad = harness([res(200, { site: { ...site(), extra: 1 }, can_write: true })]);
  await bad.c.load();
  same(d.directOutcome(bad.get(), ORG), "error");
});

test("garde d’identité : réponse d’une autre identité ignorée ; démo : aucun appel", async () => {
  let user: string | null = USER;
  let release!: (r: Model.SlResult) => void;
  const h = harness([new Promise((r) => (release = r))], { context: { generation: () => 0, userId: () => user } });
  const p = h.c.load();
  user = "10000000-0000-4000-8000-000000000009";
  release(res(200, { site: site(), can_write: true }));
  assert.equal(await p, false);
  same(h.get().phase, "loading");
  const demo = harness([], { demo: true });
  await demo.c.load();
  same([demo.calls, demo.get().phase], [[], "demo"]);
  assert.match(text(render({ ...m.SETTINGS_INITIAL, phase: "demo" })), /aucune lecture n’est faite/);
});

test("site archivé ouvert directement : lecture seule, aucune action d’édition ; dossiers chargés seulement", () => {
  const archived = m.applySettings(m.SETTINGS_INITIAL, res(200, { site: site({ archived_at: "2026-11-05T10:00:00.000Z" }), can_write: false }), SITE);
  const panel = renderToString(createElement(ui.SiteSettingsPanel, { siteId: SITE, initial: archived }));
  assert.match(text(panel), /Site archivé : il reste consultable en lecture seule/);
  assert.doesNotMatch(panel, /data-sl-form|data-sl-archive=|<input|<textarea/);
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /if \(!site \|\| site\.archived_at\) return <DirectSiteSheet c=\{c\} id=\{id\} \/>;/);
  assert.match(src, /writableSites = c\.orgSites\.filter\(\(s\) => !s\.archived_at/);
  const body = src.slice(src.indexOf("function DirectSiteSheet"), src.indexOf("function siteAssetSource"));
  assert.match(body, /organizationId=\{c\.organization\?\.id \?\? null\}/);
  assert.match(body, /initial=\{state\}/, "the settings panel is seeded: no second GET");
  assert.match(body, /<SiteAreasPanel [^>]*readOnly=\{archived\}/);
  assert.match(body, /<SiteContactsPanel [^>]*readOnly=\{archived\}/);
  // Realigned (phase 2 lot B): the direct sheet now offers ENT-03 request creation (af676ab) and the
  // compliance « completed » command (0beec1b) — both strictly gated by an ACTIVE site and the server
  // can_write; an archived site still offers no write action (also proven in Chromium by
  // site-records.test.ts: archived ⇒ 0 write action). No budget editor on the direct sheet.
  assert.doesNotMatch(body, /BudgetEditor/);
  assert.match(body, /\{!archived && state\.canWrite && session\.mode !== "demo" \? \(\s*<button[^>]*onClick=\{\(\) => c\.go\("new", site\.id\)\}[^>]*data-direct-new-request=""/);
  assert.equal((body.match(/c\.go\("new"/g) ?? []).length, 1, "a single request entry, the gated one");
  assert.match(body, /canWrite=\{!archived && state\.canWrite\}[\s\S]{0,120}complete=\{\(row\) => session\.professionalCommand\(/);
  assert.equal((body.match(/professionalCommand/g) ?? []).length, 1, "a single command, behind the compliance panel's gated canWrite");
  // ENT-05 / ENT-09 (claude/direct-site-verticals): energy and co-ownership are now mounted on the direct
  // sheet, but ONLY for an active, live, proven site (co-ownership: syndic only) — never for an archived one.
  assert.match(body, /\{!archived && session\.mode !== "demo" && \(\s*<SiteEnergyPanel/);
  assert.match(body, /\{session\.mode !== "demo" && site\.type === "syndic" && \(\s*<CoOwnershipPanel/);
  assert.match(body, /la liste peut être incomplète/);
  assert.doesNotMatch(src, /title="Site introuvable dans l’organisation active"/);
});
