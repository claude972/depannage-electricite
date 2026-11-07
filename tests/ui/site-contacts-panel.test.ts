// ENT-04 site contacts UI leaf — against the REAL exported functions (fake API, no network):
// strict parse, validation, read-only, stable ids + command_id replay, 409 honest conflict, write
// barrier, pagination dedupe with the cursor unchanged, no constant UUID fallback.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/site-contacts/contacts-model";

const m = loadModule("components/features/site-contacts/contacts-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/site-contacts/site-contacts-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-07T10:00:00.000Z";
const ID = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CMD = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rec = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), site_id: SITE, first_name: "Camille", last_name: `Durand ${n}`, role_label: "Gardienne", phone: "0696 12 34 56", email: null, note: "Badge à l’accueil", is_primary: false, version: 1, created_by: USER, updated_by: USER, created_at: NOW, updated_at: NOW, archived_at: null, ...over });
const page = (records: unknown[], over: Record<string, unknown> = {}) => ({ records, page: { limit: 100, has_more: false, next_cursor: null, remaining_count: records.length, complete: true }, permissions: { can_write: true }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const ready = (records: unknown[], over: Record<string, unknown> = {}) => m.applyContactsList(m.CONTACTS_INITIAL, res(200, page(records, over)), false, SITE);
const flush = () => new Promise((r) => setTimeout(r, 0));

test("analyse stricte : contrat exact ; formes inattendues, deux principaux, autre site, ordre, comptes incohérents ⇒ null", () => {
  assert.ok(m.parseContactsPage(page([rec(1), rec(2, { is_primary: true })]), SITE, true));
  for (const b of [null, {}, { ...page([rec(1)]), extra: 1 }, page([rec(1, { phone: null, email: null })]), page([rec(1, { is_primary: true }), rec(2, { is_primary: true })]), page([rec(2), rec(1)]), page([rec(1, { site_id: "50000000-0000-4000-8000-000000000002" })]), page([rec(1, { archived_at: NOW })]), page([rec(1)], { page: { limit: 100, has_more: true, next_cursor: null, remaining_count: 1, complete: false } }), page([rec(1)], { page: { limit: 100, has_more: false, next_cursor: null, remaining_count: 3, complete: true } }), page([rec(1)], { page: { limit: 100, has_more: false, next_cursor: null, remaining_count: 1, complete: false } }), page([rec(1)], { permissions: { can_write: 1 } })])
    assert.equal(m.parseContactsPage(b, SITE, true), null, JSON.stringify(b).slice(0, 100));
  for (const r of [res(503), res(200, { records: [] }), res(m.CONTACTS_TIMEOUT)]) assert.equal(m.applyContactsList(m.CONTACTS_INITIAL, r, false, SITE).phase, "error");
  assert.equal(m.applyContactsList(m.CONTACTS_INITIAL, res(404), false, SITE).phase, "unavailable");
});

test("formulaire : valeurs exactes du contrat, téléphone ou email requis, erreurs par champ ; command_id fourni par l’appelant", () => {
  const f = { ...m.newContactForm(ID(9)), first_name: " Camille ", last_name: "Durand", role_label: "Gardienne", phone: " 0696 12 34 56 ", email: "", note: " Badge ", is_primary: true };
  same((m.contactFormToCommand(f, CMD(1)) as { command: Model.SaveContact }).command, { action: "save", id: ID(9), command_id: CMD(1), expected_version: null, values: { first_name: "Camille", last_name: "Durand", role_label: "Gardienne", phone: "0696 12 34 56", email: null, note: "Badge", is_primary: true } });
  const none = (m.contactFormToCommand({ ...f, phone: "", email: "" }, CMD(2)) as { errors: Model.ContactErrors }).errors;
  assert.equal(none.reach, "Renseignez un téléphone ou un email.");
  const errs = (m.contactFormToCommand({ ...f, first_name: "", role_label: "", phone: "12", email: "pas-un-email" }, CMD(3)) as { errors: Model.ContactErrors }).errors;
  same(Object.keys(errs).sort(), ["email", "first_name", "phone", "role_label"]);
  const edit = m.editContactForm(m.parseContactsPage(page([rec(4, { version: 3, email: "a@b.fr", phone: null })]), SITE, true)!.records[0]);
  same([edit.expected_version, edit.phone, edit.email], [3, "", "a@b.fr"]);
  assert.equal((m.contactFormToCommand(edit, CMD(4)) as { command: Model.SaveContact }).command.expected_version, 3);
});

test("lecture seule : aucun formulaire ni bouton ; écriture refusée par le contrôleur ; données personnelles telles que renvoyées", async () => {
  const ro = ready([rec(1, { email: "camille@example.test" })], { permissions: { can_write: false } });
  const html = renderToString(createElement(panel.SiteContactsPanel, { siteId: SITE, initial: ro }));
  assert.match(html, /data-contacts-readonly=""/);
  assert.doesNotMatch(html, /data-contacts-add|>Modifier<|>Archiver<|data-contacts-form/);
  assert.match(text(html), /Téléphone 0696 12 34 56/);
  assert.match(text(html), /Email camille@example\.test/);
  let calls = 0;
  let s = ro;
  const ctrl = m.createContactsController({ api: () => ({ list: async () => res(200, page([])), command: async () => (calls++, res(200)) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  assert.equal(await ctrl.archive(s.records[0], CMD(1)), false);
  assert.equal(calls, 0);
  const rw = renderToString(createElement(panel.SiteContactsPanel, { siteId: SITE, initial: ready([rec(1, { is_primary: true })]) }));
  assert.match(rw, /data-contacts-add="">Ajouter un contact</);
  assert.match(text(rw), /Contact principal/);
});

test("pas d’UUID constant : générateur nul ⇒ refus explicite, aucun formulaire ouvert ni requête", () => {
  const src = readFileSync("components/features/site-contacts/contacts-model.ts", "utf8");
  assert.match(src, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(src + readFileSync("components/features/site-contacts/site-contacts-panel.tsx", "utf8"), /00000000-0000-4000-8000-000000000000/);
  const panelSrc = readFileSync("components/features/site-contacts/site-contacts-panel.tsx", "utf8");
  assert.equal((panelSrc.match(/if \(!(?:id|commandId)\) return setNoId\(true\);/g) ?? []).length, 3, "add, save and archive all refuse a null id");
});

test("409 ⇒ conflit honnête, pas de rejeu ; 503 / délai ⇒ rejeu de la même commande (id + command_id + version)", async () => {
  const bodies: string[] = [];
  const replies = [res(409), res(503), res(m.CONTACTS_TIMEOUT), res(200, { record: rec(5, { version: 3 }) })];
  let s = ready([rec(5, { version: 2 })]);
  const ctrl = m.createContactsController({ api: () => ({ list: async () => res(200, page([rec(5, { version: 2 })])), command: async (_s, b) => (bodies.push(JSON.stringify(b)), replies.shift()!) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  const cmd = (m.contactFormToCommand(m.editContactForm(s.records[0]), CMD(7)) as { command: Model.SaveContact }).command;
  await ctrl.save(cmd);
  same([s.writeError, s.pending], [m.CONTACTS_COPY.conflict, null]);
  assert.equal(await ctrl.retry(), false); // jamais de rejeu d’un 409
  assert.match(text(renderToString(createElement(panel.SiteContactsPanel, { siteId: SITE, initial: s }))), /un autre contact est déjà le contact principal : actualisez la liste\. Votre saisie est conservée\. Actualiser la liste/);
  await ctrl.save(cmd); // 503
  same(s.pending, cmd);
  await ctrl.retry(); // délai
  assert.equal(s.writeError, m.CONTACTS_COPY.timeout);
  await ctrl.retry(); // succès
  same([s.pending, s.records[0].version, s.saved], [null, 3, "Contact enregistré."]);
  assert.ok(bodies.slice(1).every((b) => b === bodies[1]));
  same([JSON.parse(bodies[1]).id, JSON.parse(bodies[1]).command_id, JSON.parse(bodies[1]).expected_version], [ID(5), CMD(7), 2]);
  // Réponse incohérente (version inattendue, autre id) ⇒ non appliquée, rejouable.
  const odd = m.applyContactCommand(ready([rec(6)]), res(200, { record: rec(6, { version: 5 }) }), { action: "archive", id: ID(6), command_id: CMD(8), expected_version: 1 }, SITE);
  same([odd.records.length, odd.pending?.command_id], [1, CMD(8)]);
});

test("barrière d’écriture : liste en vol → enregistrement → liste périmée tardive non appliquée ; rechargement causal ; « Afficher plus » idem", async () => {
  const lists: ((r: Model.ContactsResult) => void)[] = [];
  let reload: Model.ContactsResult = res(200, page([]));
  let s = ready([rec(1)]);
  assert.equal(s.canWrite, true);
  const calls: (string | null)[] = [];
  const ctrl = m.createContactsController({
    api: () => ({ list: (_s, cursor) => (calls.push(cursor), calls.length === 1 ? new Promise((r) => lists.push(r)) : Promise.resolve(reload)), command: async () => res(200, { record: rec(3) }) }),
    siteId: SITE, get: () => s, set: (n) => (s = n),
  });
  reload = res(200, page([rec(1), rec(3)]));
  const a = ctrl.load();
  const form = { ...m.newContactForm(ID(3)), first_name: "Camille", last_name: "Durand 3", role_label: "Gardienne", phone: "0696 12 34 56", note: "Badge à l’accueil" };
  const save = ctrl.save((m.contactFormToCommand(form, CMD(9)) as { command: Model.SaveContact }).command);
  assert.equal(await ctrl.load(), false); // aucune liste pendant l’écriture
  assert.equal(await ctrl.more(), false);
  await save;
  lists[0](res(200, page([rec(90)])));
  assert.equal(await a, false);
  await flush();
  assert.ok(s.records.some((r) => r.id === ID(3)) && !s.records.some((r) => r.id === ID(90)));
  same([calls.length, calls[1], s.phase], [2, null, "ready"]);
});

test("pagination : curseur opaque renvoyé tel quel, dédoublonnage, total du premier chargement ; panneau clé = site", async () => {
  const cursor = "eyJpZCI6IngiLCJzaXRlX2lkIjoieSJ9";
  const asked: (string | null)[] = [];
  const first = Array.from({ length: 100 }, (_, i) => rec(i + 1));
  const replies = [
    res(200, page(first, { page: { limit: 100, has_more: true, next_cursor: cursor, remaining_count: 102, complete: false } })),
    res(200, page([rec(100), rec(101)], { page: { limit: 100, has_more: false, next_cursor: null, remaining_count: 2, complete: false } })), // rec(100) en double
  ];
  let s: Model.ContactsState = { ...m.CONTACTS_INITIAL };
  const ctrl = m.createContactsController({ api: () => ({ list: async (_s, c) => (asked.push(c), replies.shift()!), command: async () => res(503) }), siteId: SITE, get: () => s, set: (n) => (s = n) });
  await ctrl.load();
  assert.match(text(renderToString(createElement(panel.SiteContactsPanel, { siteId: SITE, initial: s }))), /100 contact\(s\) affiché\(s\) sur 102\./);
  await ctrl.more();
  same(asked, [null, cursor]);
  same([s.records.length, s.records.at(-1)!.id, new Set(s.records.map((r) => r.id)).size, s.total, s.page?.has_more], [101, ID(101), 101, 102, false]);
  const urls: string[] = [];
  await m.createContactsApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch).list(SITE, cursor);
  same(urls, [`/api/sites/${SITE}/contacts?cursor=${cursor}`]);
  assert.match(readFileSync("components/features/site-contacts/site-contacts-panel.tsx", "utf8"), /<SitePanel key=\{props\.siteId\} \{\.\.\.props\} \/>/);
});
