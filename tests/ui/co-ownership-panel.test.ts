// ENT-05 co-ownership leaf — REAL exported functions + SSR (fake API, no network): strict parse
// (capabilities must stay false), status / freeze rules, exact amounts and instants, honest 409 /
// 404 / 422, replay of the same command, write barrier, pagination, read-only, demo, no constant
// UUID, and NEVER quorum / payment / « envoyé » wording.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/co-ownership/coownership-model";

const m = loadModule("components/features/co-ownership/coownership-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/co-ownership/co-ownership-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const SITE = "50000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000009";
const NOW = "2026-11-07T10:00:00.000Z";
const ID = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CMD = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const meta = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), site_id: SITE, version: 1, created_by: USER, updated_by: USER, created_at: NOW, updated_at: NOW, archived_at: null, ...over });
const meeting = (n: number, values: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({ ...meta(n, over), kind: "meeting", values: { title: `AG ${n}`, starts_at: "2026-10-01T18:00:00.000Z", ends_at: null, location: "Salle commune", agenda: "Budget", minutes: "", decisions: [], status: "scheduled", ...values } });
const call = (n: number, values: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({ ...meta(n, over), kind: "fund_call", values: { label: `Appel ${n}`, reference: `AF-${n}`, due_on: "2026-12-01", amount_cents: 123456, document_reference: "PV AG 2026", issued_on: null, note: "", meeting_id: null, status: "draft", ...values } });
const page = (records: unknown[], over: Record<string, unknown> = {}) => ({ records, page: { limit: 50, total: records.length, remaining: records.length, has_more: false, next_cursor: null, complete: true }, permissions: { can_write: true }, basis: "human_documentary_records", capabilities: { sends_notices: false, collects_funds: false, legal_validation: false }, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const ready = (kind: Model.CoKind, records: unknown[], over: Record<string, unknown> = {}) => m.applyCoList(m.CO_INITIAL, res(200, page(records, over)), false, SITE, kind);
const flush = () => new Promise((r) => setTimeout(r, 0));
const render = (props: Record<string, unknown>) => renderToString(createElement(panel.CoOwnershipPanel, { siteId: SITE, ...props }));

test("analyse stricte : capacités toujours fausses, base documentaire, type et site exacts ; sinon erreur", () => {
  assert.ok(m.parseCoPage(page([meeting(1)]), SITE, "meeting", true));
  for (const b of [null, {}, { ...page([meeting(1)]), extra: 1 }, page([meeting(1)], { capabilities: { sends_notices: true, collects_funds: false, legal_validation: false } }), page([meeting(1)], { capabilities: { sends_notices: false, collects_funds: true, legal_validation: false } }), page([meeting(1)], { capabilities: { sends_notices: false, collects_funds: false, legal_validation: true } }), page([meeting(1)], { basis: "legal_minutes" }),
    page([call(1)]), page([meeting(1, {}, { site_id: "50000000-0000-4000-8000-000000000002" })]), page([meeting(1, { status: "paid" })]), page([meeting(2), meeting(1)]),
    page([meeting(1)], { page: { limit: 50, total: 2, remaining: 1, has_more: false, next_cursor: null, complete: true } })])
    assert.equal(m.parseCoPage(b, SITE, "meeting", true), null, JSON.stringify(b).slice(0, 120));
  assert.equal(m.parseCoPage(page([call(1, { status: "paid" })]), SITE, "fund_call", true), null); // aucun statut « payé »
  for (const r of [res(503), res(200, { records: [] }), res(m.CO_TIMEOUT)]) assert.equal(m.applyCoList(m.CO_INITIAL, r, false, SITE, "meeting").phase, "error");
  same([m.applyCoList(m.CO_INITIAL, res(422), false, SITE, "meeting").error, m.applyCoList(m.CO_INITIAL, res(404), false, SITE, "meeting").phase], [m.CO_COPY.notSyndic, "unavailable"]);
});

test("assemblées : statuts exacts, tenue/annulée ne se rouvrent pas, tenue jamais future, instants ISO", () => {
  same(m.meetingStatusOptions(null), ["draft", "scheduled", "held", "cancelled"]);
  same([m.meetingStatusOptions("held"), m.meetingStatusOptions("cancelled")], [["held"], ["cancelled"]]);
  const now = new Date("2026-11-07T12:00:00Z");
  const f = { ...m.newMeetingForm(ID(9)), title: " AG annuelle ", starts_local: "2026-10-01T18:00", location: "Salle", agenda: "Budget", decisions: "Budget voté par les présents\n\nTravaux reportés", status: "held" as const };
  const out = m.meetingFormToCommand(f, CMD(1), now) as { command: Model.SaveMeeting };
  same([out.command.values.title, out.command.values.decisions, out.command.values.status, out.command.values.starts_at], ["AG annuelle", ["Budget voté par les présents", "Travaux reportés"], "held", new Date("2026-10-01T18:00").toISOString()]);
  assert.ok("errors" in m.meetingFormToCommand({ ...f, starts_local: "2026-12-01T18:00" }, CMD(2), now)); // tenue dans le futur
  assert.ok("errors" in m.meetingFormToCommand({ ...f, status: "scheduled", location: "" }, CMD(3), now)); // planifiée sans lieu
  assert.ok("errors" in m.meetingFormToCommand({ ...m.editMeetingForm(m.parseCoPage(page([meeting(1, { status: "held" })]), SITE, "meeting", true)!.records[0] as Model.MeetingRecord), status: "draft" }, CMD(4), now));
  assert.ok("errors" in m.meetingFormToCommand({ ...f, ends_local: "2026-10-01T17:00" }, CMD(5), now)); // fin avant début
  assert.ok("errors" in m.meetingFormToCommand({ ...f, decisions: Array.from({ length: 21 }, (_, i) => `D${i}`).join("\n") }, CMD(6), now));
});

test("appels de fonds : centimes exacts, émis ⇒ date ≤ aujourd’hui, échéance ≥ émission, champs figés après émission, assemblée liée active", () => {
  same([m.eurosToCents("1 234,56"), m.eurosToCents("12"), m.eurosToCents("0,01")], [123456, 1200, 1]);
  for (const bad of ["0", "-5", "12,345", "x"]) assert.equal(m.eurosToCents(bad), null, bad);
  const meetings = m.parseCoPage(page([meeting(1), meeting(2, { status: "cancelled" })]), SITE, "meeting", true)!.records;
  const now = new Date("2026-11-07T12:00:00Z");
  const f = { ...m.newFundForm(ID(9)), label: "Travaux toiture", reference: "AF-9", due_on: "2026-12-01", amount_euros: "1 234,56", document_reference: "PV AG 2026", issued_on: "2026-11-01", meeting_id: ID(1), status: "issued" as const };
  same((m.fundFormToCommand(f, CMD(1), meetings, now) as { command: Model.SaveFundCall }).command.values, { label: "Travaux toiture", reference: "AF-9", due_on: "2026-12-01", amount_cents: 123456, document_reference: "PV AG 2026", issued_on: "2026-11-01", note: "", meeting_id: ID(1), status: "issued" });
  for (const bad of [{ issued_on: "2026-11-30" }, { issued_on: "" }, { due_on: "2026-10-01" }, { meeting_id: ID(2) }, { amount_euros: "0" }]) assert.ok("errors" in m.fundFormToCommand({ ...f, ...bad }, CMD(2), meetings, now), JSON.stringify(bad));
  // Émis : champs financiers renvoyés à l’identique, seuls la note et l’annulation changent.
  const issued = m.parseCoPage(page([call(3, { status: "issued", issued_on: "2026-11-01" })]), SITE, "fund_call", true)!.records[0] as Model.FundCallRecord;
  same(m.fundStatusOptions("issued"), ["issued", "cancelled"]);
  const edit = { ...m.editFundForm(issued), amount_euros: "1,00", label: "Autre", note: "Relance papier", status: "cancelled" as const };
  same((m.fundFormToCommand(edit, CMD(3), meetings, now) as { command: Model.SaveFundCall }).command.values, { ...issued.values, note: "Relance papier", status: "cancelled" });
  assert.ok("errors" in m.fundFormToCommand({ ...m.editFundForm(issued), status: "draft" }, CMD(4), meetings, now));
  const html = render({ initial: { meeting: ready("meeting", []), fund_call: ready("fund_call", [issued]) }, tab: "fund_call" });
  assert.match(text(html), /Montant déclaré 1\s234,56 €/);
});

test("409 (version / statut / dépendances / référence / quota 500) ⇒ message honnête + Actualiser, pas de rejeu ; 404 lié ; 503 / délai ⇒ même commande", async () => {
  const bodies: string[] = [];
  const replies = [res(409), res(404), res(503), res(m.CO_TIMEOUT), res(200, { record: meeting(1, { title: "AG modifiée" }, { version: 2 }) })];
  let s = ready("meeting", [meeting(1)]);
  const ctrl = m.createCoController({ api: () => ({ list: async () => res(200, page([meeting(1)])), command: async (_s, b) => (bodies.push(JSON.stringify(b)), replies.shift()!) }), siteId: SITE, kind: "meeting", get: () => s, set: (n) => (s = n) });
  const cmd = (m.meetingFormToCommand({ ...m.editMeetingForm(s.records[0] as Model.MeetingRecord), title: "AG modifiée" }, CMD(7), new Date("2026-11-07T12:00:00Z")) as { command: Model.SaveMeeting }).command;
  await ctrl.save(cmd);
  same([s.writeError, s.pending], [m.CO_COPY.conflict.meeting, null]);
  for (const w of ["modifiée entre-temps", "ne se rouvre pas", "appels de fonds actifs y sont liés", "500"]) assert.ok(m.CO_COPY.conflict.meeting.includes(w), w);
  for (const w of ["référence est déjà utilisée", "figés", "500"]) assert.ok(m.CO_COPY.conflict.fund_call.includes(w), w);
  assert.equal(await ctrl.retry(), false);
  await ctrl.save(cmd); // 404
  same(s.writeError, m.CO_COPY.dependencyMissing);
  await ctrl.save(cmd); // 503
  same(s.pending, cmd);
  await ctrl.retry(); // délai
  await ctrl.retry(); // succès
  same([s.pending, (s.records[0] as Model.MeetingRecord).values.title, s.saved], [null, "AG modifiée", "Dossier enregistré."]);
  assert.ok(bodies.slice(2).every((b) => b === bodies[2]));
  same([JSON.parse(bodies[2]).command_id, JSON.parse(bodies[2]).kind, JSON.parse(bodies[2]).expected_version], [CMD(7), "meeting", 1]);
  // Archivage d’une assemblée : les appels actifs liés, parmi les chargés, sont listés honnêtement.
  const linked = m.linkedCalls(m.parseCoPage(page([call(5, { meeting_id: ID(1) }), call(6, { meeting_id: ID(1), status: "cancelled" })]), SITE, "fund_call", true)!.records, ID(1));
  same(linked.map((c) => c.id), [ID(5)]);
});

test("barrière d’écriture : liste en vol → enregistrement → liste périmée non appliquée ; rechargement causal", async () => {
  const lists: ((r: Model.CoResult) => void)[] = [];
  const calls: (string | null)[] = [];
  let s = ready("fund_call", [call(1)]);
  const saved = call(2);
  const ctrl = m.createCoController({ api: () => ({ list: (_s, _k, c) => (calls.push(c), calls.length === 1 ? new Promise((r) => lists.push(r)) : Promise.resolve(res(200, page([call(1), saved])))), command: async () => res(200, { record: saved }) }), siteId: SITE, kind: "fund_call", get: () => s, set: (n) => (s = n) });
  const a = ctrl.load();
  const f = { ...m.newFundForm(ID(2)), label: "Appel 2", reference: "AF-2", due_on: "2026-12-01", amount_euros: "1234,56", document_reference: "PV AG 2026" };
  const save = ctrl.save((m.fundFormToCommand(f, CMD(9), []) as { command: Model.SaveFundCall }).command);
  assert.equal(await ctrl.load(), false);
  await save;
  lists[0](res(200, page([call(90)])));
  assert.equal(await a, false);
  await flush();
  assert.ok(s.records.some((r) => r.id === ID(2)) && !s.records.some((r) => r.id === ID(90)));
  same([calls.length, s.phase], [2, "ready"]);
});

test("pagination, lecture seule, démo, pas d’UUID constant, clé, jetons, vocabulaire interdit absent", async () => {
  const cursor = "eyJraW5kIjoibWVldGluZyJ9";
  const first = Array.from({ length: 50 }, (_, i) => meeting(i + 1));
  const asked: (string | null)[] = [];
  const replies = [res(200, page(first, { page: { limit: 50, total: 51, remaining: 51, has_more: true, next_cursor: cursor, complete: false } })), res(200, page([meeting(51)], { page: { limit: 50, total: 51, remaining: 1, has_more: false, next_cursor: null, complete: false } }))];
  let s: Model.CoState = { ...m.CO_INITIAL };
  const ctrl = m.createCoController({ api: () => ({ list: async (_s, _k, c) => (asked.push(c), replies.shift()!), command: async () => res(503) }), siteId: SITE, kind: "meeting", get: () => s, set: (n) => (s = n) });
  await ctrl.load();
  assert.match(text(render({ initial: { meeting: s, fund_call: ready("fund_call", []) } })), /50 dossier\(s\) affiché\(s\) sur 51\./);
  await ctrl.more();
  same([asked, s.records.length, s.total], [[null, cursor], 51, 51]);
  const urls: string[] = [];
  await m.createCoApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch).list(SITE, "fund_call", cursor);
  same(urls, [`/api/sites/${SITE}/co-ownership?kind=fund_call&cursor=${cursor}`]);
  const ro = render({ initial: { meeting: ready("meeting", [meeting(1)], { permissions: { can_write: false } }), fund_call: ready("fund_call", []) } });
  assert.match(ro, /data-co-readonly=""/);
  assert.doesNotMatch(ro, /data-co-add|>Modifier<|>Archiver<|data-co-form/);
  let demoCalls = 0;
  let d: Model.CoState = { ...m.CO_INITIAL };
  await m.createCoController({ api: () => ({ list: async () => (demoCalls++, res(200)), command: async () => (demoCalls++, res(200)) }), siteId: SITE, kind: "meeting", get: () => d, set: (n) => (d = n), demo: true }).load();
  same([d.phase, demoCalls], ["demo", 0]);
  const view = readFileSync("components/features/co-ownership/co-ownership-panel.tsx", "utf8"), model = readFileSync("components/features/co-ownership/coownership-model.ts", "utf8");
  assert.match(model, /crypto\.randomUUID\(\) : null\)/);
  assert.doesNotMatch(model + view, /00000000-0000-4000-8000-000000000000/);
  assert.equal((view.match(/if \(!(?:id|commandId)\) return setNoId\(true\);/g) ?? []).length, 3);
  assert.match(view, /<SitePanel key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{props\.siteId\}`\} \{\.\.\.props\} \/>/);
  assert.doesNotMatch(readFileSync("components/features/co-ownership/co-ownership.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,6}\b|rgb\(/i);
  // Rendu : bandeau d’honnêteté ; jamais quorum calculé, payé, encaissé, envoyé.
  const html = text(render({ initial: { meeting: ready("meeting", [meeting(1, { status: "held", minutes: "Compte rendu", decisions: ["Budget adopté"] })]), fund_call: ready("fund_call", [call(1, { status: "issued", issued_on: "2026-11-01" })]) } }));
  assert.match(html, /n’envoie aucune convocation ni aucun appel, n’encaisse aucun fonds, ne calcule aucun quorum et ne valide rien juridiquement/);
  const ui = (view + html).replace(/n’envoie aucune|n’encaisse aucun|ne calcule aucun quorum|Aucun quorum ni résultat de vote n’est calculé|l’application n’encaisse rien et n’indique aucun paiement/g, "");
  assert.doesNotMatch(ui, /\bpayé|\bencaissé|\benvoyée?s?\b|quorum atteint|majorité calculée/i);
});
