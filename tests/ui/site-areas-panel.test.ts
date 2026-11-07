// ENT-08 site floors / zones / common areas leaf — REAL exported functions + SSR (fake API):
// strict parse, hierarchy as returned (orphans flagged), parent options (active, same site,
// depth ≤ 4, never self/descendant), honest 409 / 404, replay of the same command, write barrier,
// pagination never presented as an exhaustive tree, read-only, demo without call, no constant UUID.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-areas/areas-model";

const m = loadModule("components/features/site-areas/areas-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/site-areas/site-areas-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-07T10:00:00.000Z";
const ID = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CMD = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const area = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), site_id: SITE, parent_id: null, label: `Étage ${n}`, kind: "floor", reference: "", note: "", depth: 1, version: 1, created_by: USER, created_at: NOW, updated_by: USER, updated_at: NOW, archived_at: null, ...over });
const page = (records: unknown[], over: Record<string, unknown> = {}) => ({ records, page: { limit: 100, total: records.length, remaining: records.length, has_more: false, next_cursor: null, complete: true }, limits: { max_depth: 4, max_active: 1000 }, permissions: { can_write: true }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const ready = (records: unknown[], over: Record<string, unknown> = {}) => m.applyAreasList(m.AREAS_INITIAL, res(200, page(records, over)), false, SITE);
const flush = () => new Promise((r) => setTimeout(r, 0));
// Tree: 1 (floor) → 2 (zone) → 3 (zone) → 4 (common area, depth 4); 5 root.
const TREE = [area(1), area(2, { parent_id: ID(1), depth: 2, kind: "zone", label: "Aile nord" }), area(3, { parent_id: ID(2), depth: 3, kind: "zone", label: "Couloir" }), area(4, { parent_id: ID(3), depth: 4, kind: "common_area", label: "Hall", reference: "PC-1" }), area(5, { label: "Sous-sol" })];

test("analyse stricte : contrat exact ; autre site, archivée, ordre, profondeur incohérente, comptes, limites ⇒ null", () => {
  assert.ok(m.parseAreasPage(page(TREE), SITE, true));
  for (const b of [null, {}, { ...page(TREE), extra: 1 }, page([area(1, { kind: "building" })]), page([area(1, { depth: 2 })]), page([area(1, { site_id: "50000000-0000-4000-8000-000000000002" })]), page([area(1, { archived_at: NOW })]), page([area(2), area(1)]),
    page([area(1), area(2, { parent_id: ID(1), depth: 3 })]), page(TREE, { limits: { max_depth: 5, max_active: 1000 } }),
    page([area(1)], { page: { limit: 100, total: 3, remaining: 1, has_more: false, next_cursor: null, complete: true } }), page([area(1)], { page: { limit: 100, total: 1, remaining: 1, has_more: false, next_cursor: null, complete: false } })])
    assert.equal(m.parseAreasPage(b, SITE, true), null, JSON.stringify(b).slice(0, 120));
  for (const r of [res(503), res(200, { records: [] }), res(m.AREAS_TIMEOUT)]) assert.equal(m.applyAreasList(m.AREAS_INITIAL, r, false, SITE).phase, "error");
  assert.equal(m.applyAreasList(m.AREAS_INITIAL, res(404), false, SITE).phase, "unavailable");
});

test("hiérarchie telle que renvoyée : parcours par parent chargé ; enfant dont le parent est sur une autre page signalé, jamais rattaché ailleurs", () => {
  const rows = m.areaRows(m.parseAreasPage(page(TREE), SITE, true)!.records);
  same(rows.map((r) => [r.area.id, r.orphan]), [[ID(1), false], [ID(2), false], [ID(3), false], [ID(4), false], [ID(5), false]]);
  const partial = m.parseAreasPage(page([area(3, { parent_id: ID(99), depth: 3, kind: "zone", label: "Couloir" }), area(5, { label: "Sous-sol" })]), SITE, true)!.records;
  same(m.areaRows(partial).map((r) => [r.area.id, r.orphan, r.area.depth]), [[ID(5), false, 1], [ID(3), true, 3]]);
  const html = renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, initial: ready([area(3, { parent_id: ID(99), depth: 3, kind: "zone", label: "Couloir" }), area(5, { label: "Sous-sol" })]) }));
  assert.match(text(html), /Couloir Zone · niveau 3 · parent sur une autre page/);
  const labels = renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, initial: ready(TREE) }));
  assert.match(text(labels), /Étage 1 Étage · niveau 1/);
  assert.match(text(labels), /Hall Partie commune · niveau 4/);
  assert.match(text(labels), /Référence PC-1/);
  assert.doesNotMatch(text(labels), /assemblée|quorum|fonds|tantième/i); // classification seulement
});

test("parent : actif, même site, profondeur < 4, jamais soi-même ni un descendant, sous-arbre ≤ 4 niveaux", () => {
  const recs = m.parseAreasPage(page(TREE), SITE, true)!.records;
  same(m.parentOptions(recs, null).map((r) => r.id), [ID(1), ID(2), ID(3), ID(5)]); // 4 est au niveau 4
  // 2 porte 2 niveaux en dessous (3, 4) : seul un parent de niveau 1 garde le tout ≤ 4 ; jamais 2/3/4 eux-mêmes.
  same(m.parentOptions(recs, ID(2)).map((r) => r.id), [ID(1), ID(5)]);
  same(m.parentOptions(recs, ID(3)).map((r) => r.id), [ID(1), ID(2), ID(5)]);
  same(m.parentOptions(recs, ID(4)).map((r) => r.id), [ID(1), ID(2), ID(3), ID(5)]);
  // Une zone archivée n’est jamais proposée.
  same(m.parentOptions([...recs, { ...recs[4], id: ID(6), archived_at: NOW }] as Model.SiteArea[], null).map((r) => r.id), [ID(1), ID(2), ID(3), ID(5)]);
});

test("formulaire : valeurs exactes, parent impossible refusé, command_id de l’appelant", () => {
  const recs = m.parseAreasPage(page(TREE), SITE, true)!.records;
  const f = { ...m.newAreaForm(ID(9), ID(1)), label: " Aile sud ", kind: "zone" as const, reference: " Z-2 ", note: " Accès badge " };
  same((m.areaFormToCommand(f, CMD(1), recs) as { command: Model.SaveArea }).command, { action: "save", id: ID(9), command_id: CMD(1), expected_version: null, values: { label: "Aile sud", kind: "zone", reference: "Z-2", note: "Accès badge", parent_id: ID(1) } });
  for (const parent of [ID(4), ID(2), ID(42)]) {
    const edit = { ...m.editAreaForm(recs[1]), parent_id: parent }; // déplacer 2 sous 4 (descendant), sous lui-même, ou sous un parent non chargé
    assert.ok("errors" in m.areaFormToCommand(edit, CMD(2), recs), parent);
  }
  same(Object.keys((m.areaFormToCommand({ ...f, label: "" }, CMD(3), recs) as { errors: Model.AreaErrors }).errors), ["label"]);
});

test("409 (nom / référence / hiérarchie / version / quota) et 404 parent ⇒ message honnête, pas de rejeu ; 503 / délai ⇒ même commande", async () => {
  const bodies: string[] = [];
  const replies = [res(409), res(404), res(503), res(m.AREAS_TIMEOUT), res(200, { record: area(5, { version: 2, label: "Sous-sol B" }) })];
  let s = ready(TREE);
  const ctrl = m.createAreasController({ api: () => ({ list: async () => res(200, page(TREE)), command: async (_s, b) => (bodies.push(JSON.stringify(b)), replies.shift()!) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  const cmd = (m.areaFormToCommand({ ...m.editAreaForm(s.records[4]), label: "Sous-sol B" }, CMD(7), s.records) as { command: Model.SaveArea }).command;
  await ctrl.save(cmd);
  same([s.writeError, s.pending], [m.AREAS_COPY.conflict, null]);
  for (const words of ["modifiée entre-temps", "nom existe déjà au même niveau", "référence est déjà utilisée", "boucle, plus de 4 niveaux, zone ayant encore des sous-zones actives", "limite de 1000 zones"]) assert.ok(m.AREAS_COPY.conflict.includes(words), words);
  assert.equal(await ctrl.retry(), false);
  await ctrl.save(cmd); // 404
  same([s.writeError, s.pending], [m.AREAS_COPY.parentMissing, null]);
  await ctrl.save(cmd); // 503
  same(s.pending, cmd);
  await ctrl.retry(); // délai
  await ctrl.retry(); // succès
  same([s.pending, s.records.find((r) => r.id === ID(5))?.label, s.saved], [null, "Sous-sol B", "Élément enregistré."]);
  assert.ok(bodies.slice(2).every((b) => b === bodies[2]));
  same(JSON.parse(bodies[2]).command_id, CMD(7));
  // Réponse incohérente (valeurs différentes de la commande) ⇒ non appliquée, rejouable.
  const odd = m.applyAreaCommand(ready(TREE), res(200, { record: area(5, { version: 2, label: "Autre" }) }), cmd, SITE);
  same([odd.pending?.command_id, odd.records.find((r) => r.id === ID(5))?.label], [CMD(7), "Sous-sol"]);
  const html = renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, initial: { ...ready(TREE), writeError: m.AREAS_COPY.conflict } }));
  assert.match(html, /data-areas-reload="">Actualiser</);
});

test("barrière d’écriture : liste en vol → archivage → liste périmée tardive non appliquée ; rechargement causal", async () => {
  const lists: ((r: Model.AreasResult) => void)[] = [];
  const calls: (string | null)[] = [];
  let s = ready(TREE);
  const ctrl = m.createAreasController({
    api: () => ({ list: (_s, c) => (calls.push(c), calls.length === 1 ? new Promise((r) => lists.push(r)) : Promise.resolve(res(200, page(TREE.slice(0, 4))))), command: async () => res(200, { record: area(5, { version: 2, archived_at: NOW }) }) }),
    siteId: SITE, get: () => s, set: (n) => (s = n),
  });
  const a = ctrl.load();
  const archive = ctrl.archive(m.parseAreasPage(page(TREE), SITE, true)!.records[4], CMD(8));
  assert.equal(await ctrl.load(), false);
  await archive;
  lists[0](res(200, page(TREE))); // A contient encore la zone archivée
  assert.equal(await a, false);
  await flush();
  assert.ok(!s.records.some((r) => r.id === ID(5)));
  same([calls.length, calls[1], s.phase], [2, null, "ready"]);
});

test("pagination : jamais une arborescence exhaustive tant qu’il reste des pages ; curseur tel quel ; dédoublonnage", async () => {
  const cursor = "eyJzaXRlX2lkIjoieCJ9";
  const first = Array.from({ length: 100 }, (_, i) => area(i + 1, { label: `Étage ${i + 1}` }));
  const asked: (string | null)[] = [];
  const replies = [res(200, page(first, { page: { limit: 100, total: 101, remaining: 101, has_more: true, next_cursor: cursor, complete: false } })), res(200, page([area(101, { parent_id: ID(1), depth: 2, kind: "zone", label: "Aile" })], { page: { limit: 100, total: 101, remaining: 1, has_more: false, next_cursor: null, complete: false } }))];
  let s: Model.AreasState = { ...m.AREAS_INITIAL };
  const ctrl = m.createAreasController({ api: () => ({ list: async (_s, c) => (asked.push(c), replies.shift()!), command: async () => res(503) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  await ctrl.load();
  assert.match(text(renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, initial: s }))), /100 élément\(s\) affiché\(s\) sur 101 : l’arborescence n’est pas complète tant que tout n’est pas chargé\./);
  await ctrl.more();
  same([asked, s.records.length, s.total, s.page?.has_more], [[null, cursor], 101, 101, false]);
  const urls: string[] = [];
  await m.createAreasApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch).list(SITE, cursor);
  same(urls, [`/api/sites/${SITE}/areas?cursor=${cursor}`]);
});

test("lecture seule, démo sans appel, pas d’UUID constant, clé = identité + portée, jetons de thème uniquement", async () => {
  const ro = renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, initial: ready(TREE, { permissions: { can_write: false } }) }));
  assert.match(ro, /data-areas-readonly=""/);
  assert.doesNotMatch(ro, /data-areas-add|>Modifier<|>Archiver<|Ajouter dessous|data-areas-form/);
  let calls = 0;
  let d: Model.AreasState = { ...m.AREAS_INITIAL };
  const c = m.createAreasController({ api: () => ({ list: async () => (calls++, res(200)), command: async () => (calls++, res(200)) }), siteId: SITE, get: () => d, set: (n) => (d = n), demo: true });
  await c.load();
  same([d.phase, calls], ["demo", 0]);
  assert.match(text(renderToString(createElement(panel.SiteAreasPanel, { siteId: SITE, demo: true, initial: d }))), /En démonstration, l’organisation du site/);
  const model = readFileSync("components/features/site-areas/areas-model.ts", "utf8"), view = readFileSync("components/features/site-areas/site-areas-panel.tsx", "utf8");
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(model + view, /00000000-0000-4000-8000-000000000000/);
  assert.equal((view.match(/if \(!(?:id|commandId)\) return setNoId\(true\);/g) ?? []).length, 3);
  assert.match(view, /<SitePanel key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{props\.siteId\}`\} \{\.\.\.props\} \/>/);
  const css = readFileSync("components/features/site-areas/site-areas.module.css", "utf8");
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b|rgb\(/i); // couleurs = --ui-* uniquement
});
