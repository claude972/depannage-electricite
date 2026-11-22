// CLI-09 client saved addresses: strict contract parse, form bounds (first/last name included),
// stable id + command_id, honest 409, exact replay after 503 / timeout (no auto retry), single
// flight + write barrier + identity guard, declared (never verified) position, demo without any
// route call, and the request form's explicit preferred-address preselection that never
// overwrites a restored or typed draft.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/client-addresses/client-addresses-model";
import type * as Panel from "../../components/features/client-addresses/client-addresses-panel";
import type * as Forms from "../../components/app/forms";

const m = loadModule("components/features/client-addresses/client-addresses-model.ts") as unknown as typeof Model;
const p = loadModule("components/features/client-addresses/client-addresses-panel.tsx") as unknown as typeof Panel;
const f = loadModule("components/app/forms.tsx") as unknown as typeof Forms;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");

const USER = "10000000-0000-4000-8000-000000000001";
const A1 = "20000000-0000-4000-8000-000000000001";
const A2 = "20000000-0000-4000-8000-000000000002";
const CMD = "30000000-0000-4000-8000-000000000001";
const CMD2 = "30000000-0000-4000-8000-000000000002";
const values = { label: "Domicile", first_name: "Camille", last_name: "Durand", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France", country_code: "FR", latitude: null, longitude: null, geo_source: null, is_preferred: true };
const rec = (id: string, v: Partial<Model.AddressValues> = {}, version = 1) => ({ ...values, ...v, id, user_id: USER, version, created_at: "2026-11-01T10:00:00+00:00", updated_at: "2026-11-01T10:00:00+00:00", archived_at: null });
const list = (records: unknown[], canWrite = true) => ({ records, page: { limit: 50, count: records.length, complete: true }, permissions: { can_write: canWrite } });
const ok = (body: unknown) => ({ status: 200, body, retryAfter: null });

test("liste : contrat strict (compte exact, doublon, deux préférées, archivée, autre utilisateur ⇒ erreur, jamais une liste vide)", () => {
  assert.ok(m.parseAddressList(list([rec(A1), rec(A2, { is_preferred: false, label: "Bureau" })]), USER));
  const bad: [string, unknown][] = [
    ["compte faux", { ...list([rec(A1)]), page: { limit: 50, count: 2, complete: true } }],
    ["incomplet", { ...list([rec(A1)]), page: { limit: 50, count: 1, complete: false } }],
    ["doublon", list([rec(A1), rec(A1, { is_preferred: false })])],
    ["deux préférées", list([rec(A1), rec(A2)])],
    ["archivée", list([{ ...rec(A1, { is_preferred: false }), archived_at: "2026-11-02T10:00:00+00:00" }])],
    ["autre utilisateur", list([{ ...rec(A1), user_id: A2 }])],
    ["champ en trop", list([{ ...rec(A1), email: "x@example.invalid" }])],
    ["géo partielle", list([rec(A1, { latitude: 14.6 } as never)])],
    ["corps null", null],
  ];
  for (const [name, body] of bad) assert.equal(m.parseAddressList(body, USER), null, name);
  const s = m.applyList(m.ADDRESS_INITIAL, ok(bad[0][1]), USER);
  assert.equal(s.phase, "error");
  assert.deepEqual(json(s.records), []);
});

test("formulaire : bornes du contrat, prénom et nom obligatoires, code postal / pays normalisés", () => {
  const form = { ...m.newForm(A1), ...values, postal_code: " 97200 ", country_code: "fr" };
  const out = m.formToValues(form);
  assert.ok("values" in out);
  if ("values" in out) {
    assert.equal(out.values.postal_code, "97200");
    assert.equal(out.values.country_code, "FR");
  }
  const errs = (patch: Partial<Model.AddressForm>) => {
    const r = m.formToValues({ ...form, ...patch });
    return "errors" in r ? Object.keys(r.errors) : [];
  };
  assert.deepEqual(errs({ first_name: " " }), ["first_name"]);
  assert.deepEqual(errs({ last_name: "" }), ["last_name"]);
  assert.deepEqual(errs({ label: "x".repeat(101) }), ["label"]);
  assert.deepEqual(errs({ address: "1 r" }), ["address"]);
  assert.deepEqual(errs({ postal_code: "9" }), ["postal_code"]);
  assert.deepEqual(errs({ postal_code: "97200!" }), ["postal_code"]);
  assert.deepEqual(errs({ postal_code: "9724X" }), ["postal_code"]); // CLI-09: five digits only
  assert.deepEqual(errs({ city: "" }), ["city"]);
  assert.deepEqual(errs({ country_code: "FRA" }), ["country_code"]);
  assert.deepEqual(errs({ latitude: 14.6, longitude: -61, geo_source: null }), ["geo"]);
  const missing = m.formToValues({ ...form, first_name: "" });
  assert.match("errors" in missing ? missing.errors.first_name ?? "" : "", /Prénom : 1 à 100 caractères/);
});

test("écriture : id stable + command_id, 409 honnête sans renvoi, 503 / délai ⇒ même commande renvoyée à l’identique", async () => {
  const sent: string[] = [];
  const replies = [{ status: 503, body: null, retryAfter: 2 }, ok({ record: rec(A1) })];
  let state: Model.AddressState = { ...m.ADDRESS_INITIAL, phase: "ready" as const, canWrite: true };
  const ctrl = m.createAddressController({
    api: () => ({ list: async () => ok(list([])), command: async (b) => { sent.push(JSON.stringify(b)); return replies.shift()!; } }),
    context: { generation: () => 1, userId: () => USER },
    get: () => state,
    set: (s) => { state = s; },
  });
  const command = { action: "save" as const, id: A1, command_id: CMD, expected_version: null, values };
  await ctrl.save(command);
  assert.equal(state.writeError, m.ADDRESS_COPY.retry);
  assert.deepEqual(json(state.pending), json(command));
  assert.equal(sent.length, 1, "no automatic retry");
  await ctrl.retry();
  assert.equal(sent.length, 2);
  assert.equal(sent[1], sent[0], "identical body (same id, command_id, expected_version, values)");
  assert.equal(state.pending, null);
  assert.equal(state.saved, "Adresse enregistrée.");
  assert.equal(state.records[0].id, A1);
  // Timeout → same replay path; 409 → honest conflict, nothing kept to resend.
  assert.equal(m.applyCommand(state, { status: m.ADDRESS_TIMEOUT, body: null, retryAfter: null }, command, USER).writeError, m.ADDRESS_COPY.timeout);
  const conflict = m.applyCommand(state, { status: 409, body: { error: "x" }, retryAfter: null }, { ...command, expected_version: 1, command_id: CMD2 }, USER);
  assert.equal(conflict.writeError, m.ADDRESS_COPY.conflict);
  assert.equal(conflict.pending, null);
  // A 200 that is not exactly the commanded record is not a success.
  const wrongVersion = m.applyCommand(state, ok({ record: rec(A1, {}, 3) }), command, USER);
  assert.ok(wrongVersion.pending && !wrongVersion.saved);
  const wrongValue = m.applyCommand(state, ok({ record: rec(A1, { city: "Autre" }) }), command, USER);
  assert.ok(wrongValue.pending && !wrongValue.saved);
});

test("préférée explicite et archivage : commandes versionnées exactes", async () => {
  const sent: Model.AddressCommand[] = [];
  const r = rec(A2, { is_preferred: false, label: "Bureau" }, 4);
  let state: Model.AddressState = { ...m.ADDRESS_INITIAL, phase: "ready" as const, canWrite: true, records: [r] as Model.ClientAddress[] };
  const ctrl = m.createAddressController({
    api: () => ({ list: async () => ok(list([])), command: async (b) => { sent.push(b); return ok({ record: b.action === "archive" ? { ...r, version: 5, archived_at: "2026-11-02T10:00:00+00:00" } : { ...r, version: 5, is_preferred: true } }); } }),
    context: { generation: () => 1, userId: () => USER },
    get: () => state,
    set: (s) => { state = s; },
  });
  await ctrl.setPreferred(r, true, CMD);
  assert.deepEqual(json(sent[0]), { action: "save", id: A2, command_id: CMD, expected_version: 4, values: { ...m.recordValues(r), is_preferred: true } });
  assert.equal(state.records[0].is_preferred, true);
  await ctrl.archive(r, CMD2);
  assert.deepEqual(json(sent[1]), { action: "archive", id: A2, command_id: CMD2, expected_version: 4 });
  assert.equal(state.records.length, 0);
});

test("un seul envoi à la fois, barrière d’écriture et changement d’identité", async () => {
  let resolveList: (v: Model.AddressResult) => void = () => {};
  let resolveCmd: (v: Model.AddressResult) => void = () => {};
  let calls = 0;
  let uid: string | null = USER;
  let state: Model.AddressState = { ...m.ADDRESS_INITIAL };
  const ctrl = m.createAddressController({
    api: () => ({ list: () => new Promise((r) => (resolveList = r)), command: () => { calls++; return new Promise((r) => (resolveCmd = r)); } }),
    context: { generation: () => 1, userId: () => uid },
    get: () => state,
    set: (s) => { state = s; },
  });
  const loading = ctrl.load();
  state = { ...state, canWrite: true };
  const command = { action: "save" as const, id: A1, command_id: CMD, expected_version: null, values };
  const write = ctrl.save(command);
  assert.equal(await ctrl.save(command), false, "second write refused while one is in flight");
  assert.equal(calls, 1);
  resolveList(ok(list([])));
  await loading;
  assert.equal(state.phase, "loading", "a list started before the write never applies (barrier)");
  resolveCmd(ok({ record: rec(A1) }));
  await write;
  assert.equal(state.records.length, 1);
  // Identity change: a reply for the previous user is dropped.
  const again = ctrl.load();
  uid = "10000000-0000-4000-8000-000000000099";
  resolveList(ok(list([rec(A2)])));
  await again;
  assert.notEqual(state.records[0]?.id, A2);
});

test("rendu : prénom/nom, préférée marquée, position déclarée jamais « vérifiée » ; démo sans appel ; vide / erreur", () => {
  const geo = rec(A2, { is_preferred: false, label: "Bureau", latitude: 14.6, longitude: -61.07, geo_source: "device_reported" });
  const ready = { ...m.ADDRESS_INITIAL, phase: "ready" as const, canWrite: true, records: [rec(A1), geo] as Model.ClientAddress[] };
  const out = html(createElement(p.ClientAddressesPanel as never, { demo: false, initial: ready, api: { list: async () => { throw new Error("no call"); }, command: async () => { throw new Error("no call"); } } } as never));
  assert.match(out, /<dt>Contact<\/dt><dd>Camille Durand<\/dd>/);
  assert.match(out, /data-address-preferred="true"/);
  assert.match(out, /Adresse préférée/);
  assert.match(out, /<dt>Position déclarée<\/dt><dd>position transmise par l’appareil, non vérifiée<\/dd>/);
  assert.doesNotMatch(out, /vérifiée par|position exacte|GPS/i);
  assert.match(out, /<button(?=[^>]*data-address-prefer="")(?=[^>]*disabled="")[^>]*>Définir comme préférée/, "another preferred exists ⇒ choose explicitly after removing it");
  let called = 0;
  const demo = html(createElement(p.ClientAddressesPanel as never, { demo: true, api: { list: async () => (called++, ok(list([]))), command: async () => (called++, ok(null)) } } as never));
  assert.match(demo, /data-client-addresses="demo"/);
  assert.match(demo, /En démonstration, aucune adresse n’est enregistrée/);
  assert.equal(called, 0);
  const empty = html(createElement(p.ClientAddressesPanel as never, { demo: false, initial: { ...ready, records: [] } } as never));
  assert.match(empty, /data-address-empty=""/);
  const failed = html(createElement(p.ClientAddressesPanel as never, { demo: false, initial: { ...m.ADDRESS_INITIAL, phase: "error", error: m.ADDRESS_COPY.loadFailed } } as never));
  assert.match(failed, /Vos adresses n’ont pas pu être vérifiées\. Réessayez\./);
  assert.match(failed, /Réessayer/);
});

test("position : uniquement sur action explicite, refus / indisponible / délai honnêtes, jamais de position inventée", () => {
  assert.deepEqual(json(m.devicePosition(14.6, -61.07)), { latitude: 14.6, longitude: -61.07, geo_source: "device_reported" });
  for (const [lat, lng] of [[NaN, 0], [91, 0], [0, 181], ["14", 0], [null, null]] as const) assert.equal(m.devicePosition(lat, lng), null);
  assert.match(m.geoErrorMessage(1), /Position refusée : l’adresse reste enregistrée sans position/);
  assert.match(m.geoErrorMessage(3), /non obtenue à temps/);
  assert.match(m.geoErrorMessage(2), /indisponible/);
  assert.match(m.geoErrorMessage(null), /indisponible/);
  const src = readFileSync("components/features/client-addresses/client-addresses-panel.tsx", "utf8");
  assert.match(src, /geolocation\.getCurrentPosition\(/);
  assert.equal((src.match(/getCurrentPosition\(/g) || []).length, 1, "single explicit call site");
  assert.match(src, /onClick=\{locate\}/);
  assert.match(m.newForm(A1).geo_source === null ? "ok" : "", /ok/, "a new address has no position by default");
  // No constant UUID fallback.
  assert.doesNotMatch(src, /00000000-0000-4000|randomUUID\(\) \|\| "|\?\? "[0-9a-f]{8}-/);
});

test("formulaire de demande : présélection de l’adresse préférée sur un brouillon neuf, jamais sur un brouillon saisi", () => {
  const preferred = { label: "Domicile", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France" };
  const fresh = { category: "panel" as const, description: "", address: "", postal_code: "", city: "", urgency: "scheduled" as const };
  assert.deepEqual(json(f.preferredPrefill(fresh, null, preferred)), { ...fresh, address: preferred.address, postal_code: preferred.postal_code, city: preferred.city });
  const typed = { ...fresh, address: "5 rue Victor Hugo" };
  assert.equal(f.preferredPrefill(typed, null, preferred), null, "typed address never overwritten");
  const restored = { ...fresh, description: "Disjoncteur qui saute sans arrêt", city: "Le Lamentin" };
  assert.equal(f.preferredPrefill(restored, restored, preferred), null, "restored draft untouched");
  assert.equal(f.preferredPrefill({ ...fresh }, { ...fresh }, preferred), null, "any restored draft, even empty, is left as is");
  assert.equal(f.preferredPrefill(fresh, null, null), null);
  assert.equal(f.isPreferredSelection({ ...fresh, ...preferred }, preferred), true);
  assert.equal(f.isPreferredSelection({ ...fresh, ...preferred, city: "Autre" }, preferred), false, "marker disappears once edited");
  const note = html(createElement(f.PreferredAddressNote as never, { preferred, onClear() {} } as never));
  assert.match(note, /data-preferred-address=""/);
  assert.match(note, /Adresse préférée « Domicile » présélectionnée : vous pouvez la modifier ci-dessous\./);
  assert.match(note, /Ne pas l’utiliser/);
  // Wiring: client space passes the preferred address; restored drafts stay the form's initialValues.
  const space = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(space, /usePreferredAddress\(\{ enabled: !demo && view === "new", context: session\.mutationContext \}\)/);
  assert.match(space, /initialValues=\{session\.pendingDraft\}\s*preferredAddress=\{preferredAddress\}/);
  assert.match(space, /<ClientAddressesPanel key=/);
  assert.doesNotMatch(space, /title="Adresses enregistrées et moyens de paiement"/);
  assert.match(space, /<SavedPaymentMethodsPanel key=/); // FIN-08 replaced the unavailable block
});
