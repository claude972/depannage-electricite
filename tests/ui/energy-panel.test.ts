// ENT-09 site energy UI leaf: strict parse, exact units, totals completeness wording, write rights,
// 409 keeps values, idempotent replay, pagination dedupe with the cursor unchanged — against the
// REAL exported functions (fake API only, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/energy/energy-model";

const m = loadModule("components/features/energy/energy-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/energy/site-energy-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-06T10:00:00.000Z";
const rec = (n: number, over: Record<string, unknown> = {}) => ({
  id: `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`, site_id: SITE, meter_label: `Compteur ${n}`, period_start: "2026-10-01", period_end: "2026-10-31",
  consumption_wh: 12345, cost_cents: 2500, source_kind: "invoice", source_reference: `F-${n}`, note: "", version: 1,
  created_by: USER, created_at: NOW, updated_by: USER, updated_at: NOW, archived_at: null, ...over,
});
const page = (records: unknown[], over: Record<string, unknown> = {}) => ({
  records, page: { limit: 100, has_more: false, next_cursor: null }, totals: { consumption_wh: 12345 * records.length, cost_cents: 2500 * records.length, complete: true, cost_complete: true },
  permissions: { can_write: true }, basis: "recorded_periods_fully_inside_range", ...over,
});
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });

test("analyse stricte : contrat exact accepté ; formes inattendues, totaux incohérents, autre site ⇒ null", () => {
  assert.ok(m.parseEnergyPage(page([rec(1)]), SITE));
  const bad = [
    null, {}, { ...page([rec(1)]), extra: 1 }, page([rec(1, { consumption_wh: 1.5 })]), page([rec(1, { source_kind: "solar" })]), page([rec(1, { period_end: "2026-09-01" })]),
    page([rec(1)], { basis: "prorata" }), page([rec(1)], { page: { limit: 50, has_more: false, next_cursor: null } }),
    page([rec(1)], { page: { limit: 100, has_more: true, next_cursor: null } }), page([rec(1), rec(1)]),
    page([rec(1)], { totals: { consumption_wh: 1, cost_cents: null, complete: false, cost_complete: false } }), // total sur sélection partielle
    page([rec(1)], { totals: { consumption_wh: 1, cost_cents: 5, complete: true, cost_complete: false } }),
    page([rec(1)], { permissions: { can_write: "yes" } }),
  ];
  for (const b of bad) assert.equal(m.parseEnergyPage(b, SITE), null, JSON.stringify(b).slice(0, 120));
  assert.equal(m.parseEnergyPage(page([rec(1, { site_id: "50000000-0000-4000-8000-000000000002" })]), SITE), null);
  // Chargement : 503 / forme inattendue ⇒ erreur + Réessayer, jamais une liste vide.
  for (const r of [res(503), res(200, { records: [] }), res(m.ENERGY_TIMEOUT)]) same([m.applyList(m.ENERGY_INITIAL, r, false, SITE).phase], ["error"]);
  assert.equal(m.applyList(m.ENERGY_INITIAL, res(404), false, SITE).phase, "unavailable");
});

test("unités exactes : kWh → Wh sans flottant (helper backend), € → centimes, affichage jamais arrondi", () => {
  same([m.kwhToWh("12.345"), m.kwhToWh("12,345"), m.kwhToWh("0"), m.kwhToWh("7"), m.kwhToWh("0.001"), m.kwhToWh("1000000.5")], [12345, 12345, 0, 7000, 1, 1000000500]);
  for (const bad of ["12.3456", "-1", "1e3", "", "abc", "99999999999", "1.2.3"]) assert.equal(m.kwhToWh(bad), null, bad);
  same([m.eurosToCents("12,34"), m.eurosToCents("12"), m.eurosToCents("0,5"), m.eurosToCents("10000000")], [1234, 1200, 50, 1_000_000_000]);
  for (const bad of ["12,345", "-3", "10000000,01", "x", "1e2"]) assert.equal(m.eurosToCents(bad), null, bad);
  const g = (s: string) => s.replace(/\s/g, " ");
  same([m.formatWh(12345), m.formatWh(12000), m.formatWh(1), m.formatWh(1234567891)].map(g), ["12,345 kWh", "12 kWh", "0,001 kWh", "1 234 567,891 kWh"]);
  same([m.formatCents(2500), m.formatCents(null)].map(g), ["25,00 €", "non renseigné"]);
  // Aller-retour exact pour l’édition.
  for (const wh of [12345, 7000, 1, 9_000_000_000_000]) assert.equal(m.kwhToWh(m.whToKwhInput(wh)), wh, String(wh));
});

test("totaux : affichés seulement avec leur complétude ; jamais une somme partielle présentée comme exhaustive", () => {
  same(m.totalsView({ consumption_wh: 24690, cost_cents: 5000, complete: true, cost_complete: true }), { consumption: "24,69 kWh", cost: "50,00 €".replace(" ", " "), notes: [] });
  const partial = m.totalsView({ consumption_wh: null, cost_cents: null, complete: false, cost_complete: false });
  same([partial.consumption, partial.cost], ["total partiel", "total partiel"]);
  assert.match(partial.notes[0], /^Total partiel : d’autres périodes ne sont pas chargées/);
  const costs = m.totalsView({ consumption_wh: 24690, cost_cents: null, complete: true, cost_complete: false });
  same([costs.cost, costs.notes], ["coûts incomplets", [m.ENERGY_COPY.costIncomplete]]);
  // Charger la page suivante ne transforme jamais les totaux en somme côté client.
  const s1 = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(1)], { page: { limit: 100, has_more: true, next_cursor: "abc" }, totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })), false, SITE);
  const s2 = m.applyList(s1, res(200, page([rec(2)], { totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })), true, SITE);
  same(s2.totals, { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false });
  const html = renderToString(createElement(panel.SiteEnergyPanel, { siteId: SITE, initial: s2 }));
  assert.match(html, /data-energy-totals="partial"/);
  assert.match(text(html), /Consommation total partiel/);
  assert.match(text(html), /Seules les périodes entièrement comprises dans l’intervalle choisi sont comptées \(aucun prorata\)\./);
});

test("droits : lecture seule ⇒ aucun formulaire ni bouton d’écriture, note courte ; écriture refusée côté contrôleur", async () => {
  const ro = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(1)], { permissions: { can_write: false } })), false, SITE);
  const html = renderToString(createElement(panel.SiteEnergyPanel, { siteId: SITE, initial: ro }));
  assert.match(html, /data-energy-readonly=""/);
  assert.doesNotMatch(html, /data-energy-add|>Modifier<|>Archiver<|data-energy-form/);
  let calls = 0;
  let s = ro;
  const ctrl = m.createEnergyController({ api: () => ({ list: async () => res(200, page([])), command: async () => (calls++, res(200, null)) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  const form = { ...m.newForm("60000000-0000-4000-8000-000000000099"), meter_label: "A", period_start: "2026-10-01", period_end: "2026-10-31", consumption_kwh: "1", source_reference: "F" };
  const out = m.formToCommand(form);
  assert.ok("command" in out);
  assert.equal(await ctrl.save((out as { command: Model.SaveCommand }).command), false);
  assert.equal(await ctrl.archive(m.parseEnergyPage(page([rec(1)]), SITE)!.records[0]), false);
  assert.equal(calls, 0);
  const rw = renderToString(createElement(panel.SiteEnergyPanel, { siteId: SITE, initial: m.applyList(m.ENERGY_INITIAL, res(200, page([rec(1)])), false, SITE) }));
  assert.match(rw, /data-energy-add="">Ajouter une période</);
  assert.match(rw, />Modifier</);
  assert.match(rw, />Archiver</);
});

test("formulaire : création (id stable, expected_version null), édition (version), erreurs de champs exactes", () => {
  const id = "60000000-0000-4000-8000-000000000077";
  const f = { ...m.newForm(id), meter_label: " Compteur général ", period_start: "2026-10-01", period_end: "2026-10-31", consumption_kwh: "12,345", cost_euros: "25", source_reference: " F-1 ", note: "" };
  const out = m.formToCommand(f) as { command: Model.SaveCommand };
  same(out.command, { action: "save", id, expected_version: null, values: { meter_label: "Compteur général", period_start: "2026-10-01", period_end: "2026-10-31", consumption_wh: 12345, cost_cents: 2500, source_kind: "invoice", source_reference: "F-1", note: "" } });
  const edit = m.editForm(m.parseEnergyPage(page([rec(3, { version: 4, cost_cents: null })]), SITE)!.records[0]);
  same([edit.expected_version, edit.consumption_kwh, edit.cost_euros], [4, "12,345", ""]);
  assert.equal((m.formToCommand(edit) as { command: Model.SaveCommand }).command.expected_version, 4);
  const errs = (m.formToCommand({ ...f, meter_label: "", period_end: "2026-09-01", consumption_kwh: "1.2345", cost_euros: "1,234", source_reference: "" }) as { errors: Model.FormErrors }).errors;
  same(Object.keys(errs).sort(), ["consumption_kwh", "cost_euros", "meter_label", "period_end", "source_reference"]);
  assert.equal(errs.period_end, "La fin de période précède son début.");
});

test("409 ⇒ message « modifié entre-temps ou chevauchement », valeurs du formulaire gardées ; 503 ⇒ rejeu identique (même id + version)", async () => {
  const bodies: string[] = [];
  const replies = [res(409), res(503), res(m.ENERGY_TIMEOUT), res(200, { record: rec(7, { version: 5 }) })];
  let s = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(7, { version: 4 })])), false, SITE);
  const ctrl = m.createEnergyController({ api: () => ({ list: async () => res(200, page([])), command: async (_site, body) => (bodies.push(JSON.stringify(body)), replies.shift()!) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  const form = m.editForm(s.records[0]);
  const cmd = (m.formToCommand(form) as { command: Model.SaveCommand }).command;
  await ctrl.save(cmd);
  same([s.writeError, s.pending], [m.ENERGY_COPY.conflict, null]);
  // Le formulaire (état de vue) n’est jamais remplacé par le contrôleur : les valeurs restent.
  const html = renderToString(createElement(panel.SiteEnergyPanel, { siteId: SITE, initial: s }));
  assert.match(text(html), /Modifié entre-temps ou période qui chevauche une autre : actualisez la liste\. Votre saisie est conservée\./);
  await ctrl.save(cmd); // 503
  same([s.writeError, s.pending], [m.ENERGY_COPY.retry, cmd]);
  await ctrl.retry(); // délai
  assert.equal(s.writeError, m.ENERGY_COPY.timeout);
  await ctrl.retry(); // succès
  same([s.pending, s.writeError, s.records[0].version, s.saved], [null, "", 5, "Période enregistrée."]);
  assert.ok(bodies.length === 4 && bodies.every((b) => b === bodies[0]), "même corps (id + expected_version) à chaque rejeu");
  same(JSON.parse(bodies[0]).id, rec(7).id);
  same(JSON.parse(bodies[0]).expected_version, 4);
  // Après une écriture, les totaux affichés sont masqués (plus exhaustifs).
  assert.equal(s.totals?.complete, false);
});

test("vol unique, garde génération/UID, démontage ; archivage avec version attendue", async () => {
  let resolve!: (r: Model.EnergyResult) => void;
  let calls = 0;
  let gen = 1;
  let s = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(8, { version: 2 })])), false, SITE);
  const bodies: unknown[] = [];
  const ctrl = m.createEnergyController({ api: () => ({ list: async () => res(200, page([])), command: (_s, b) => (calls++, bodies.push(b), new Promise((r) => (resolve = r))) }), siteId: SITE, context: { generation: () => gen, userId: () => USER }, get: () => s, set: (n) => (s = n) });
  const p = ctrl.archive(s.records[0]);
  assert.equal(await ctrl.archive(s.records[0]), false);
  assert.equal(calls, 1);
  same(bodies[0], { action: "archive", id: rec(8).id, expected_version: 2 });
  gen = 2;
  resolve(res(200, { record: rec(8, { version: 3, archived_at: NOW }) }));
  assert.equal(await p, false); // génération changée : ignorée
  assert.equal(s.records.length, 1);
  // Réponse d’archivage valide ⇒ retirée de la liste ; réponse incohérente (autre id) ⇒ rejouable.
  let s2 = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(8, { version: 2 })])), false, SITE);
  const archive: Model.ArchiveCommand = { action: "archive", id: rec(8).id, expected_version: 2 };
  s2 = m.applyCommand(s2, res(200, { record: rec(9, { archived_at: NOW }) }), archive, SITE);
  same([s2.records.length, s2.pending], [1, archive]);
  s2 = m.applyCommand(s2, res(200, { record: rec(8, { version: 3, archived_at: NOW }) }), archive, SITE);
  same([s2.records.length, s2.saved], [0, "Période archivée."]);
  // Confirmation d’archivage rendue (état de vue) — et aucune action sans elle côté source.
  const src = (await import("node:fs")).readFileSync("components/features/energy/site-energy-panel.tsx", "utf8");
  assert.match(src, /role="alertdialog" aria-label="Confirmer l’archivage"/);
  assert.match(src, /archiving\?\.id === r\.id \?/);
});

test("pagination : « Afficher plus » renvoie le curseur opaque tel quel, dédoublonne par id", async () => {
  const cursor = "eyJkYXkiOiIyMDI2LTEwLTAxIiwiaWQiOiJ4In0";
  const queries: unknown[] = [];
  const replies = [
    res(200, page([rec(1), rec(2)], { page: { limit: 100, has_more: true, next_cursor: cursor }, totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })),
    res(200, page([rec(2), rec(3)], { totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })),
  ];
  let s: Model.EnergyState = { ...m.ENERGY_INITIAL, filters: { from: "2026-01-01", to: "2026-12-31" } };
  const ctrl = m.createEnergyController({ api: () => ({ list: async (_site, q) => (queries.push(q), replies.shift()!), command: async () => res(503) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  await ctrl.load();
  await ctrl.more();
  same(queries, [{ from: "2026-01-01", to: "2026-12-31", cursor: null }, { from: "2026-01-01", to: "2026-12-31", cursor }]);
  same(s.records.map((r) => r.id), [rec(1).id, rec(2).id, rec(3).id]);
  // URL réelle : curseur et filtres sans altération, pas de site_id en query.
  const urls: string[] = [];
  await m.createEnergyApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch).list(SITE, { from: "2026-01-01", to: null, cursor });
  same(urls, [`/api/sites/${SITE}/energy?from=2026-01-01&cursor=${cursor}`]);
});

test("curseur lié aux filtres : changer de période repart de la page 1 ; jamais de curseur réutilisé ; réponse d’un ancien filtre ignorée", async () => {
  const cursor = "eyJkYXkiOiIyMDI2LTEwLTAxIn0";
  const queries: (Model.EnergyFilters & { cursor: string | null })[] = [];
  let resolveOld!: (r: Model.EnergyResult) => void;
  const replies: (Model.EnergyResult | Promise<Model.EnergyResult>)[] = [
    res(200, page([rec(1)], { page: { limit: 100, has_more: true, next_cursor: cursor }, totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })),
    new Promise((r) => (resolveOld = r)), // « Afficher plus » de l’ancien filtre, en vol
    res(200, page([rec(5)])), // nouveau filtre, page 1
  ];
  let s: Model.EnergyState = { ...m.ENERGY_INITIAL, filters: { from: "2026-01-01", to: "2026-06-30" } };
  const ctrl = m.createEnergyController({ api: () => ({ list: async (_site, q) => (queries.push(q), replies.shift()!), command: async () => res(503) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  await ctrl.load();
  const more = ctrl.more();
  await ctrl.load({ from: "2026-07-01", to: "2026-12-31" }); // changement de période
  resolveOld(res(200, page([rec(2)])));
  assert.equal(await more, false);
  same(queries.map((q) => q.cursor), [null, cursor, null]);
  same(queries[2], { from: "2026-07-01", to: "2026-12-31", cursor: null });
  same(s.records.map((r) => r.id), [rec(5).id]); // rien de l’ancien filtre
  same([s.page?.next_cursor, s.cursorFilters], [null, { from: "2026-07-01", to: "2026-12-31" }]);
  // Curseur d’un filtre différent du filtre appliqué ⇒ « Afficher plus » refusé (aucune requête).
  const before = queries.length;
  s = { ...s, page: { limit: 100, has_more: true, next_cursor: cursor }, cursorFilters: { from: "2026-01-01", to: "2026-06-30" } };
  assert.equal(await ctrl.more(), false);
  assert.equal(queries.length, before);
  // Autre site ⇒ panneau neuf (clé = site).
  const src = (await import("node:fs")).readFileSync("components/features/energy/site-energy-panel.tsx", "utf8");
  assert.match(src, /<SitePanel key=\{props\.siteId\} \{\.\.\.props\} \/>/);
});

test("409 ⇒ conflit honnête + « Actualiser la liste », jamais d’écrasement automatique ni de rejeu", async () => {
  let calls = 0;
  let s = m.applyList(m.ENERGY_INITIAL, res(200, page([rec(7, { version: 4 })])), false, SITE);
  const ctrl = m.createEnergyController({ api: () => ({ list: async () => res(200, page([rec(7, { version: 6 })])), command: async () => (calls++, res(409)) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  const cmd = (m.formToCommand(m.editForm(s.records[0])) as { command: Model.SaveCommand }).command;
  await ctrl.save(cmd);
  same([s.writeError, s.pending, calls], [m.ENERGY_COPY.conflict, null, 1]);
  assert.equal(await ctrl.retry(), false); // aucun rejeu automatique d’un 409
  assert.equal(calls, 1);
  await ctrl.load(); // Actualiser : nouvelle version lue, rien n’est réécrit
  same([s.records[0].version, calls], [6, 1]);
  const src = (await import("node:fs")).readFileSync("components/features/energy/site-energy-panel.tsx", "utf8");
  assert.match(src, /data-energy-reload="">Actualiser la liste</);
});

// ---- Barrière d’écriture (revue ROOT) : une liste démarrée avant une écriture ne s’applique jamais après
function raceHarness(initialRecords: unknown[]) {
  const calls: { cursor: string | null }[] = [];
  const pendingLists: ((r: Model.EnergyResult) => void)[] = [];
  let reloadReply: Model.EnergyResult = res(200, page([]));
  let commandReply: Model.EnergyResult = res(503);
  let s = m.applyList(m.ENERGY_INITIAL, res(200, page(initialRecords, { page: { limit: 100, has_more: true, next_cursor: "c1" }, totals: { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } })), false, SITE);
  const ctrl = m.createEnergyController({
    api: () => ({
      list: (_site, q) => {
        calls.push({ cursor: q.cursor });
        if (pendingLists.length < 1 && calls.length === 1) return new Promise((r) => pendingLists.push(r)); // A : en retard
        return Promise.resolve(reloadReply); // rechargement causal
      },
      command: async () => commandReply,
    }),
    siteId: SITE,
    get: () => s,
    set: (n) => (s = n),
  });
  return { ctrl, get: () => s, calls, resolveA: (r: Model.EnergyResult) => pendingLists[0](r), setReload: (r: Model.EnergyResult) => (reloadReply = r), setCommand: (r: Model.EnergyResult) => (commandReply = r) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test("barrière : liste A démarrée → enregistrement réussi → A répond tard ⇒ enregistrement conservé, lignes de A ignorées, rechargement causal", async () => {
  const h = raceHarness([rec(1)]);
  const saved = rec(7, { meter_label: "Nouveau" });
  h.setCommand(res(200, { record: saved }));
  h.setReload(res(200, page([saved, rec(1)])));
  const a = h.ctrl.load(); // A en vol (liste vidée, phase loading)
  const form = { ...m.newForm(saved.id), meter_label: "Nouveau", period_start: "2026-10-01", period_end: "2026-10-31", consumption_kwh: "12,345", cost_euros: "25", source_reference: "F-7" };
  const save = h.ctrl.save((m.formToCommand(form) as { command: Model.SaveCommand }).command);
  assert.equal(await h.ctrl.load(), false); // aucune liste pendant l’écriture
  await save;
  h.resolveA(res(200, page([rec(90)]))); // A, périmée, sans l’enregistrement
  assert.equal(await a, false);
  await flush();
  assert.ok(h.get().records.some((r) => r.id === saved.id), "enregistrement visible");
  assert.ok(!h.get().records.some((r) => r.id === rec(90).id), "lignes de A non appliquées");
  same([h.calls.length, h.calls[1].cursor, h.get().phase], [2, null, "ready"]); // rechargement causal depuis la page 1
});

test("barrière : même course avec un archivage (la ligne archivée ne revient pas) et avec « Afficher plus »", async () => {
  const h = raceHarness([rec(8, { version: 2 }), rec(1)]);
  h.setCommand(res(200, { record: rec(8, { version: 3, archived_at: NOW }) }));
  h.setReload(res(200, page([rec(1)])));
  const a = h.ctrl.load();
  await h.ctrl.archive(m.parseEnergyPage(page([rec(8, { version: 2 })]), SITE)!.records[0]);
  h.resolveA(res(200, page([rec(8, { version: 2 }), rec(1)]))); // A contient encore la ligne archivée
  assert.equal(await a, false);
  await flush();
  same(h.get().records.map((r) => r.id), [rec(1).id]);
  // « Afficher plus » en vol puis écriture : la page tardive n’est pas ajoutée.
  const k = raceHarness([rec(1)]);
  const saved = rec(7);
  k.setCommand(res(200, { record: saved }));
  k.setReload(res(200, page([saved, rec(1)])));
  const more = k.ctrl.more();
  assert.equal(k.calls[0].cursor, "c1");
  const form = { ...m.newForm(saved.id), meter_label: "Compteur 7", period_start: "2026-10-01", period_end: "2026-10-31", consumption_kwh: "12,345", cost_euros: "25", source_reference: "F-7" };
  await k.ctrl.save((m.formToCommand(form) as { command: Model.SaveCommand }).command);
  assert.equal(k.get().loadingMore, false);
  k.resolveA(res(200, page([rec(91)])));
  assert.equal(await more, false);
  await flush();
  assert.ok(k.get().records.some((r) => r.id === saved.id));
  assert.ok(!k.get().records.some((r) => r.id === rec(91).id));
});
