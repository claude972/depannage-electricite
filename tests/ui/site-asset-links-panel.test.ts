// ENT-07/08 equipment / zone ↔ intervention links (backend 726e367). Real model + SSR of the panel.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-asset-links/asset-links-model";

const m = loadModule("components/features/site-asset-links/asset-links-model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/site-asset-links/site-asset-links-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const SITE = "50000000-0000-4000-8000-000000000001";
const JOB = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const EQ = "e0000000-0000-4000-8000-000000000001";
const AREA = "a0000000-0000-4000-8000-000000000001";
const LID = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NEW = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-11-06T10:00:00.000Z";
const row = (n: number, over: Record<string, unknown> = {}) => ({ id: LID(n), site_id: SITE, intervention_id: JOB, kind: "equipment", asset_id: EQ, active: true, version: 1, created_at: AT, updated_at: AT, detached_at: null, intervention: { id: JOB, category: "panel", status: "in_progress", created_at: AT }, asset_archived: false, ...over });
const page = (records: unknown[], over: Record<string, unknown> = {}) => ({ records, page: { limit: 50, has_more: false, next_cursor: null, complete: true }, permissions: { can_write: true }, site_archived: false, limits: { active_per_intervention: 50, history_per_intervention: 100 }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const reply = (cmd: Model.LinkCommand, replayed = false) => res(200, { record: { id: LID(1), site_id: SITE, intervention_id: cmd.intervention_id, kind: cmd.kind, asset_id: cmd.asset_id, active: cmd.action === "link", version: cmd.expected_version === null ? 1 : cmd.expected_version + 1, created_at: AT, updated_at: AT, detached_at: cmd.action === "link" ? null : AT }, replayed });
const ASSETS = { assets: [{ kind: "equipment", id: EQ, label: "TGBT cuisine", archived: false }, { kind: "area", id: AREA, label: "Réserve sèche", archived: false }], complete: true };
function memStore() { const map = new Map<string, string>(); return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => (map.set(k, v), true), remove: (k: string) => void map.delete(k) } }; }
function harness({ lists = [] as Model.AlResult[], posts = [] as ((c: Model.LinkCommand) => Model.AlResult | Promise<Model.AlResult>)[], store = memStore().store, ids = [NEW(1), NEW(2)], demo = false, readOnly = false } = {}) {
  const calls: { kind: string; cursor?: string | null; body?: Model.LinkCommand; stored?: string | null }[] = [];
  let s: Model.AlState = { ...m.AL_INITIAL };
  const c = m.createAlController({
    api: () => ({
      list: async (_s, _j, cursor) => (calls.push({ kind: "GET", cursor }), lists.shift() ?? res(200, page([]))),
      command: async (_s, body) => (calls.push({ kind: "POST", body, stored: store.get(m.commandKey(USER, SITE, JOB)) }), (posts.shift() ?? (() => res(503)))(body)),
    }),
    siteId: SITE, interventionId: JOB, context: { generation: () => 0, userId: () => USER }, store: () => store, newId: () => ids.shift() ?? null, get: () => s, set: (n) => (s = n), demo, readOnly,
  });
  return { c, calls, get: () => s };
}
const ready = (records: unknown[], over: Record<string, unknown> = {}) => {
  const p = m.parseLinksPage(page(records, over), SITE, JOB, true)!;
  return { ...m.AL_INITIAL, phase: "ready", records: p.records, cursor: p.page.next_cursor, canWrite: p.permissions.can_write, siteArchived: p.site_archived } as Model.AlState;
};
const render = (initial: Model.AlState, props: Record<string, unknown> = {}) => renderToString(createElement(ui.SiteAssetLinksPanel, { siteId: SITE, interventionId: JOB, initial, initialAssets: ASSETS, ...props }));

test("lecture stricte : contrat exact, dossier/site, ordre, pagination, site archivé ⇒ jamais d’écriture", () => {
  assert.ok(m.parseLinksPage(page([row(1)]), SITE, JOB, true));
  for (const bad of [null, {}, { ...page([row(1)]), extra: 1 }, page([row(1, { site_id: "50000000-0000-4000-8000-000000000002" })]), page([row(2), row(1)]), page([row(1, { active: false })]),
    page([row(1)], { site_archived: true }), page([row(1)], { page: { limit: 50, has_more: true, next_cursor: null, complete: false } }), page([row(1)], { page: { limit: 50, has_more: false, next_cursor: null, complete: false } }),
    page([row(1, { intervention: { id: LID(9), category: "panel", status: "x", created_at: AT } })]), page([{ ...row(1), contact: "x" }])])
    assert.equal(m.parseLinksPage(bad, SITE, JOB, true), null, JSON.stringify(bad).slice(0, 80));
  assert.ok(m.parseLinksPage(page([row(1)], { page: { limit: 50, has_more: false, next_cursor: null, complete: false } }), SITE, JOB, false));
});

test("lien : commande persistée AVANT le POST, version null puis version courante, relecture même sur replay", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, lists: [res(200, page([])), res(200, page([row(1)]))], posts: [(c) => reply(c, true)] });
  await h.c.load();
  assert.equal(await h.c.link("equipment", EQ, null), true);
  const post = h.calls.find((c) => c.kind === "POST")!;
  same(post.body, { command_id: NEW(1), intervention_id: JOB, kind: "equipment", asset_id: EQ, action: "link", expected_version: null });
  same(JSON.parse(post.stored!), post.body, "persisted before the POST");
  same([h.calls.map((c) => c.kind), mem.map.size, h.get().notice, h.get().records.length], [["GET", "POST", "GET"], 0, m.AL_COPY.replayed, 1]);
  const u = harness({ lists: [res(200, page([row(1, { version: 3 })]))], posts: [reply] });
  await u.c.load();
  await u.c.unlink(u.get().records[0]);
  same(u.calls[1].body, { command_id: NEW(1), intervention_id: JOB, kind: "equipment", asset_id: EQ, action: "unlink", expected_version: 3 });
  const bad = harness({ posts: [(c) => res(200, { record: { ...(reply(c).body as { record: object }).record, version: 7 }, replayed: false })] });
  await bad.c.load(); await bad.c.link("area", AREA, null);
  same([bad.get().writeError, bad.get().pending?.command_id], [m.AL_COPY.replyUnreadable, NEW(1)]);
});

test("réponse perdue / 503 / rechargement ⇒ même commande ; 409 ⇒ aucun rejeu, nouvelle clé après « Actualiser »", async () => {
  const mem = memStore();
  const a = harness({ store: mem.store, posts: [() => res(m.AL_TIMEOUT), () => res(503)] });
  await a.c.load(); await a.c.link("area", AREA, null); await a.c.retry();
  const bodies = a.calls.filter((c) => c.kind === "POST").map((c) => JSON.stringify(c.body));
  same([bodies.length, bodies[0] === bodies[1]], [2, true]);
  assert.equal(await a.c.link("equipment", EQ, null), false, "no new command while the outcome is unknown");
  const b = harness({ store: mem.store, ids: [NEW(9)], posts: [reply] });
  await b.c.load();
  same([JSON.stringify(b.get().pending), b.get().writeError], [bodies[0], m.AL_COPY.resume]);
  await b.c.retry();
  same([JSON.stringify(b.calls[1].body), mem.map.size], [bodies[0], 0]);
  const k = memStore();
  const c = harness({ store: k.store, posts: [() => res(409), reply] });
  await c.c.load(); await c.c.link("area", AREA, null);
  same([c.get().conflict, c.get().pending, k.map.size], [m.AL_COPY.conflict, null, 1]);
  assert.equal(await c.c.retry(), false);
  assert.equal(await c.c.link("area", AREA, null), false);
  await c.c.refresh();
  await c.c.link("area", AREA, null);
  same(c.calls.filter((x) => x.kind === "POST").map((x) => x.body!.command_id), [NEW(1), NEW(2)]);
  for (const [status, copy] of [[403, m.AL_COPY.writeForbidden], [404, m.AL_COPY.notFound], [422, m.AL_COPY.invalid]] as const) {
    const x = harness({ posts: [() => res(status)] });
    await x.c.load(); await x.c.link("area", AREA, null);
    same([x.get().writeError, x.get().pending], [copy, null], String(status));
  }
});

test("lecture seule : non-rédacteur, site archivé ou autorité locale ⇒ aucun bouton ni POST ; libellés jamais inventés", async () => {
  for (const [state, props] of [[ready([row(1)], { permissions: { can_write: false } }), {}], [ready([row(1)], { permissions: { can_write: false }, site_archived: true }), {}], [ready([row(1)]), { readOnly: true }]] as const) {
    const html = render(state as Model.AlState, props);
    assert.doesNotMatch(html, /data-al-unlink|data-al-form|data-al-relink/);
  }
  assert.match(text(render(ready([row(1)], { permissions: { can_write: false }, site_archived: true }))), /Site archivé : les liens restent consultables/);
  const ro = harness({ readOnly: true, lists: [res(200, page([row(1)]))] });
  await ro.c.load();
  same([await ro.c.link("area", AREA, null), await ro.c.unlink(ro.get().records[0]), ro.calls.map((c) => c.kind)], [false, false, ["GET"]]);
  const rw = text(render(ready([row(1), row(2, { kind: "area", asset_id: AREA, active: false, detached_at: AT, version: 2 })])));
  assert.match(rw, /TGBT cuisine Équipement · lié le/);
  assert.match(rw, /Liens détachés \(1 affiché\).*Réserve sèche Zone · détaché le/);
  const unknown = text(render(ready([row(1, { asset_id: "e0000000-0000-4000-8000-000000000099" })]), { initialAssets: { assets: [], complete: false } }));
  assert.match(unknown, /Équipement e0000000 \(libellé non chargé\)/);
  assert.match(unknown, /Liste d’équipements et de zones partielle/);
  assert.match(text(render(ready([]))), /Aucun équipement ni aucune zone rattaché à ce dossier\..*Rattacher un équipement ou une zone/);
});

test("historique paginé par curseur ; démo zéro appel ; câblage dossier ; jetons, 44px, pas d’UUID constant", async () => {
  const cursor = "eyJ4IjoxfQ";
  const h = harness({ lists: [res(200, page([row(1)], { page: { limit: 50, has_more: true, next_cursor: cursor, complete: false } })), res(200, page([row(2, { asset_id: AREA, kind: "area" })], { page: { limit: 50, has_more: false, next_cursor: null, complete: false } }))] });
  await h.c.load();
  await h.c.more();
  same([h.calls.map((c) => c.cursor), h.get().records.length, h.get().cursor], [[null, cursor], 2, null]);
  const d = harness({ demo: true });
  await d.c.load();
  same([await d.c.link("area", AREA, null), d.calls.length, d.get().phase], [false, 0, "demo"]);
  const urls: string[] = [];
  await m.createAlApi((async (u: string, init: RequestInit) => (urls.push(`${init.method} ${u}`), new Response("{}"))) as unknown as typeof fetch).list(SITE, JOB, cursor);
  same(urls, [`GET /api/sites/${SITE}/asset-links?intervention_id=${JOB}&cursor=${cursor}`]);
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /<SiteAssetLinksPanel\s+siteId=\{intervention\.site_id\}\s+interventionId=\{intervention\.id\}\s+assets=\{siteAssetSource\(session, intervention\.site_id\)\}\s+context=\{session\.mutationContext\}\s+demo=\{demo\}\s+readOnly=\{!canOperate\}/);
  const view = readFileSync("components/features/site-asset-links/site-asset-links-panel.tsx", "utf8");
  const model = readFileSync("components/features/site-asset-links/asset-links-model.ts", "utf8");
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(view + model, /00000000-0000-4000-8000-000000000000/);
  const css = readFileSync("components/features/site-asset-links/site-asset-links.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i);
  assert.match(css, /\.tab \{[^}]*min-height: 44px;/);
});
