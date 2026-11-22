// Public operator profile: public pages show the PUBLISHED values (never the draft), which win over
// the owner-validated facts of shared/commercial-facts.ts; null / error ⇒ those validated facts,
// and pending for every field the owner has not validated; admin editor: command_id stored before the POST, lost reply ⇒ same command,
// 409 ⇒ no replay + reload, publish blocked without the minimum fields, withdraw ⇒ public pending
// again; non-admin ⇒ no editor; demo ⇒ zero calls. Values come only from these contract fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import { PENDING } from "../../components/role/public-lists";
import { VALIDATED_OPERATOR as V } from "../../shared/commercial-facts";
import type * as Model from "../../components/features/public-operator-profile/model";
import type * as Editor from "../../components/features/public-operator-profile/operator-profile-editor";

const m = loadModule("components/features/public-operator-profile/model.ts") as unknown as typeof Model;
const e = loadModule("components/features/public-operator-profile/operator-profile-editor.tsx") as unknown as typeof Editor;
const site = loadModule("components/role/public-site.tsx", {
  "./public-home": { PublicHome: () => null },
  "./public-chrome": { PublicChrome: (props: { children: unknown }) => props.children },
  "../app/forms": { RequestForm: () => null, AuthForm: () => null },
}) as { PublicSite: unknown };
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const session = (view: string) => new Proxy({ view, error: "", notice: "", categoryId: "outage", pendingDraft: null, busy: false, authMode: "login" } as Record<string, unknown>, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : () => {}) });
const page = (view: string, operatorProfile: unknown) => html(createElement(site.PublicSite as never, { session: session(view), operatorProfile } as never));

// Contract fixtures (QA values, clearly synthetic).
const PUBLISHED_PROFILE = {
  legal_name: "Exploitant QA SAS", legal_form: "SAS", siren: "000000000", hq_address: "Adresse QA du siège", publication_director: "Directrice QA",
  public_email: "contact@exploitant-qa.invalid", privacy_email: "donnees@exploitant-qa.invalid", host_name: "Hébergeur QA", host_address: "Adresse QA hébergeur",
  host_contact: "support@hebergeur-qa.invalid", rights_holder: "Exploitant QA SAS", service_area: "Zone QA", public_phone: "+596000000000",
};
const DRAFT_ONLY = { legal_name: "BROUILLON NON PUBLIÉ", about_text: "Texte de brouillon" };
const published = (version = 3) => ({ phase: "ready", published: { version, profile: PUBLISHED_PROFILE, published_at: "2026-11-07T10:00:00+00:00" } });

test("pages publiques : valeurs PUBLIÉES uniquement, avec « publié le … (version N) »", () => {
  const legal = text(page("legal", published()));
  assert.match(legal, /Raison sociale et forme juridique : Exploitant QA SAS, SAS/);
  assert.match(legal, /Numéro SIREN et numéro de TVA : 000000000/);
  assert.match(legal, /Nom de l’hébergeur : Hébergeur QA/);
  assert.match(legal, /Contact pour l’exercice des droits : donnees@exploitant-qa\.invalid/);
  assert.match(legal, /Informations publiées par l’exploitant le 7 novembre 2026 \(version 3\)\./);
  assert.doesNotMatch(legal, /Mentions légales à compléter/);
  const about = page("about", published());
  assert.match(text(about), /Zone d’intervention couverte : Zone QA/);
  assert.match(text(about), /Équipe : À renseigner par l’exploitant/, "a field the contract does not carry stays pending");
  assert.match(about, /href="mailto:contact@exploitant-qa\.invalid"/);
  assert.match(about, /href="tel:\+596000000000"/);
  assert.match(text(page("privacy", published())), /Contact pour l’exercice des droits \(accès, rectification, suppression\) : donnees@exploitant-qa\.invalid/);
  assert.match(text(page("pricing", published())), /Zone desservie : Zone QA/);
  // The draft never reaches a public page (the public state only ever carries `published`).
  for (const view of ["legal", "about", "privacy", "help"]) assert.doesNotMatch(page(view, published()), /BROUILLON|Texte de brouillon/);
});

test("rien de publié, erreur ou chargement ⇒ « À renseigner par l’exploitant », aucune valeur", async () => {
  for (const state of [{ phase: "ready", published: null }, { phase: "error", published: null }, { phase: "loading", published: null }]) {
    const legal = text(page("legal", state));
    // Owner-validated identity (shared/commercial-facts.ts) stands in; nothing else is filled in.
    assert.ok(legal.includes(`Raison sociale et forme juridique : ${V.legal_name}, ${V.legal_form} `), state.phase);
    assert.ok(legal.includes(`Numéro SIREN et numéro de TVA : ${V.siren} `), state.phase);
    for (const f of ["Adresse de contact", "Nom de l’hébergeur", "Adresse", "Coordonnées de contact", "Titulaire des droits sur le nom, le logo et les contenus", "Contact pour l’exercice des droits"]) assert.match(legal, new RegExp(`${f} : ${PENDING}`), `${state.phase}: ${f}`);
    assert.match(legal, /Mentions légales à compléter/);
    assert.doesNotMatch(legal, /publiées par l’exploitant le/);
    assert.doesNotMatch(text(page("about", state)), /@|tel:/);
    // Field by field: validated facts only where the owner validated one, null otherwise.
    for (const [field, value] of Object.entries(V)) assert.equal(m.publishedValue(state as never, field as never), value, `${state.phase}: ${field}`);
    for (const field of ["public_email", "public_phone", "privacy_email", "host_name", "host_address", "host_contact", "rights_holder", "vat_number", "team_text", "network_terms", "about_text"]) assert.equal(m.publishedValue(state as never, field as never), null, `${state.phase}: ${field}`);
  }
  // A published value always wins over the validated fact.
  for (const field of ["legal_name", "legal_form", "siren", "hq_address", "publication_director", "service_area"] as const) assert.equal(m.publishedValue(published() as never, field), PUBLISHED_PROFILE[field], field);
  // Public read: strict, 200 null ⇒ nothing published; malformed / 503 ⇒ error (pending wording).
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await Promise.all([
    m.loadPublished(reply(200, { published: null })).then((s) => assert.deepEqual(json(s), { phase: "ready", published: null })),
    m.loadPublished(reply(200, { published: { version: 1, profile: { legal_name: "x" }, published_at: "2026-11-07T10:00:00+00:00" } })).then((s) => assert.equal(s.phase, "error", "a publication without the minimum is refused")),
    m.loadPublished(reply(503, { error: "x" })).then((s) => assert.equal(s.phase, "error")),
  ]);
});

type Data = { version: number; draft: Record<string, string>; published: unknown };
function harness(replies: Model.Result[], data: Data = { version: 2, draft: { ...PUBLISHED_PROFILE, ...DRAFT_ONLY }, published: null }) {
  const posts: { body: unknown; storedBefore: string | null }[] = [];
  const mem = new Map<string, string>();
  const store = { get: (k: string) => mem.get(k) ?? null, set: (k: string, v: string) => void mem.set(k, v), remove: (k: string) => void mem.delete(k) };
  let state: Model.EditorView = { ...m.EDITOR_INITIAL };
  let loads = 0;
  let current = data;
  const ids = ["10000000-0000-4000-8000-000000000001", "10000000-0000-4000-8000-000000000002", "10000000-0000-4000-8000-000000000003"];
  const ctrl = m.createEditorController({
    api: () => ({
      load: async () => { loads++; return { status: 200, body: current }; },
      command: async (body) => { posts.push({ body: json(body), storedBefore: mem.get(m.pendingKey("admin-1", 1)) ?? null }); const r = replies.shift() ?? { status: 503, body: null }; if (r.status === 200) current = { ...current, version: current.version + 1 }; return r; },
    }),
    store: () => store,
    newId: () => ids.shift() ?? null,
    context: { userId: () => "admin-1", generation: () => 1 },
    get: () => state,
    set: (s) => { state = s; },
  });
  return { ctrl, posts, get: () => state, mem, loads: () => loads, setData: (d: Data) => { current = d; } };
}

test("éditeur : command_id mémorisé AVANT le POST ; réponse perdue ⇒ la même commande ; succès ⇒ effacé", async () => {
  const h = harness([{ status: 0, body: null }, { status: 200, body: { version: 3, action: "save" } }]);
  await h.ctrl.load();
  await h.ctrl.save({ legal_name: "Exploitant QA SAS" });
  assert.equal(h.posts.length, 1);
  assert.deepEqual(JSON.parse(h.posts[0].storedBefore ?? "null").command, h.posts[0].body, "command persisted in tab storage before the POST");
  assert.equal(h.get().error, m.PROFILE_COPY.retry);
  assert.equal(await h.ctrl.save({ legal_name: "autre" }), false, "no new command while one is pending");
  await h.ctrl.retry();
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.posts[1].body, h.posts[0].body, "identical replay (same command_id, version, profile)");
  assert.equal(h.mem.get(m.pendingKey("admin-1", 1)), undefined, "cleared after the verified success");
  assert.equal(h.get().notice, "Brouillon enregistré.");
});

test("éditeur : 409 ⇒ message honnête, aucune relance, commande oubliée", async () => {
  const h = harness([{ status: 409, body: { error: "x" } }]);
  await h.ctrl.load();
  await h.ctrl.save({ legal_name: "X" });
  assert.equal(h.get().error, m.PROFILE_COPY.conflict);
  assert.equal(h.get().pending, null);
  assert.equal(h.mem.get(m.pendingKey("admin-1", 1)), undefined);
  assert.equal(await h.ctrl.retry(), false);
  assert.equal(h.posts.length, 1, "never replayed");
});

test("publication bloquée sans le minimum (liste affichée) ; retrait ⇒ public de nouveau « à renseigner »", async () => {
  const h = harness([], { version: 1, draft: { legal_name: "Exploitant QA SAS" }, published: null });
  await h.ctrl.load();
  assert.equal(await h.ctrl.publish(), false);
  assert.equal(h.posts.length, 0);
  const out = html(createElement(e.OperatorProfileEditor as never, { demo: false, superAdmin: true, initial: h.get() } as never));
  assert.match(out, /data-operator-publish=""[^>]*disabled=""|disabled=""[^>]*data-operator-publish=""/);
  assert.match(text(out), /Publication impossible tant que ces champs du brouillon enregistré manquent : Forme juridique, SIREN \(9 chiffres\)/);
  const w = harness([{ status: 200, body: { version: 4, action: "withdraw" } }], { version: 3, draft: PUBLISHED_PROFILE, published: published(3).published as never });
  await w.ctrl.load();
  w.setData({ version: 4, draft: PUBLISHED_PROFILE, published: null });
  await w.ctrl.withdraw();
  assert.deepEqual((w.posts[0].body as { action: string }).action, "withdraw");
  assert.equal(w.get().data?.published, null);
  // After the withdrawal the public page is back to the owner-validated identity; the withdrawn values are gone.
  const withdrawn = text(page("legal", { phase: "ready", published: null }));
  assert.ok(withdrawn.includes(`Raison sociale et forme juridique : ${V.legal_name}, ${V.legal_form} `));
  assert.doesNotMatch(withdrawn, /Exploitant QA|Hébergeur QA|exploitant-qa\.invalid/);
  assert.match(withdrawn, new RegExp(`Adresse de contact : ${PENDING}`));
  assert.match(withdrawn, new RegExp(`Nom de l’hébergeur : ${PENDING}`));
  const src = readFileSync("components/features/public-operator-profile/operator-profile-editor.tsx", "utf8");
  assert.match(src, /data-operator-withdraw-confirm=""/, "withdraw asks for confirmation");
});

test("non super-admin ⇒ refus honnête, aucun éditeur ; démo ⇒ aucun appel", () => {
  let calls = 0;
  const api = { load: async () => (calls++, { status: 200, body: null }), command: async () => (calls++, { status: 200, body: null }) };
  const refused = html(createElement(e.OperatorProfileEditor as never, { demo: false, superAdmin: false, api } as never));
  assert.match(refused, /data-operator-editor="forbidden"/);
  assert.doesNotMatch(refused, /<form|<input/);
  const demo = html(createElement(e.OperatorProfileEditor as never, { demo: true, superAdmin: true, api } as never));
  assert.match(demo, /data-operator-editor="demo"/);
  assert.equal(calls, 0);
  const admin = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.match(admin, /<OperatorProfileEditor key=\{[^}]*mutationContext[^}]*\}[^>]*superAdmin=\{session\.platformAccess\?\.super_admin === true\} context=\{session\.mutationContext\} \/>/);
});
