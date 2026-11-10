// Aide mobile : projection des informations publiées (zone, exploitant, contact, garantie) et états
// réels « chargement / panne / rien de publié / publié ». Valeurs d’essai synthétiques uniquement.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  contactChannels, coveragePath, coverageResult, coverageSchema, operatorPublicationSchema, operatorRows, publishedStamp, publishedState,
  warrantyTermsSchema,
} from "../apps/mobile/src/lib/published-info";

const MINIMUM = {
  legal_name: "Exploitant QA", legal_form: "Société QA", siren: "000000001", hq_address: "Adresse de test",
  publication_director: "Direction QA", public_email: "public@example.invalid", privacy_email: "privacy@example.invalid",
  host_name: "Hébergeur QA", host_address: "Adresse QA", host_contact: "hosting@example.invalid", rights_holder: "Titulaire QA",
};
const AT = "2026-11-07T10:00:00+00:00";
const wire = (profile: Record<string, string>) => operatorPublicationSchema.parse({ published: { version: 3, profile, published_at: AT } });
const done = <T,>(data: T) => ({ data, error: null, loading: false });

test("états de lecture : chargement, panne, rien de publié et publié restent distincts", () => {
  assert.deepEqual(publishedState({ data: null, error: null, loading: true }), { phase: "loading" });
  assert.deepEqual(publishedState({ data: null, error: "x", loading: false }), { phase: "error" });
  assert.deepEqual(publishedState({ data: null, error: "x", loading: true }), { phase: "error" }, "une panne reste affichée pendant la reprise");
  assert.deepEqual(publishedState({ data: null, error: null, loading: false }), { phase: "error" }, "sans réponse, rien n’est présenté comme publié");
  assert.deepEqual(publishedState(done({ published: null })), { phase: "absent" });
  assert.deepEqual(publishedState(done(wire(MINIMUM))), { phase: "published", value: { version: 3, profile: MINIMUM, published_at: AT } });
  // Une réponse déjà lue reste affichée pendant un rechargement.
  assert.equal(publishedState({ data: { published: null }, error: null, loading: true }).phase, "absent");
});

test("exploitant : seules les valeurs publiées sont projetées, le SIRET après le SIREN quand il existe", () => {
  const minimal = wire(MINIMUM).published;
  assert.ok(minimal);
  assert.deepEqual(operatorRows(minimal.profile), [
    { label: "Raison sociale et forme juridique", value: "Exploitant QA, Société QA" },
    { label: "SIREN", value: "000000001" },
    { label: "Adresse du siège", value: "Adresse de test" },
    { label: "Direction de la publication", value: "Direction QA" },
  ]);
  assert.equal(publishedStamp(minimal), "Publié par l’exploitant le 7 novembre 2026 (version 3).");

  const full = wire({ ...MINIMUM, display_name: "Service QA", siret: "00000000100012", vat_number: "FR00000000001" }).published;
  assert.ok(full);
  assert.deepEqual(operatorRows(full.profile).map((row) => `${row.label} : ${row.value}`), [
    "Nom du service : Service QA",
    "Raison sociale et forme juridique : Exploitant QA, Société QA",
    "SIREN : 000000001",
    "SIRET de l’établissement : 00000000100012",
    "TVA intracommunautaire : FR00000000001",
    "Adresse du siège : Adresse de test",
    "Direction de la publication : Direction QA",
  ]);
  assert.deepEqual(operatorRows({}), [], "profil vide : aucune ligne, aucune valeur de remplacement");

  // Un champ ajouté plus tard côté Web n’est ni affiché ni bloquant ; un champ connu mal formé rend
  // la publication illisible (état « panne »), elle n’est jamais affichée à moitié.
  assert.deepEqual(wire({ ...MINIMUM, future_field: "x" }).published?.profile, MINIMUM);
  assert.equal(operatorPublicationSchema.safeParse({ published: { version: 3, profile: { ...MINIMUM, siret: "00000000200012" }, published_at: AT } }).success, false);
  assert.equal(operatorPublicationSchema.safeParse({ published: { version: 3, profile: { ...MINIMUM, public_phone: "0596000000" }, published_at: AT } }).success, false);
});

test("contact : uniquement les canaux publiés ; le téléphone n’apparaît que s’il est publié", () => {
  const minimal = wire(MINIMUM).published;
  assert.ok(minimal);
  assert.deepEqual(contactChannels(minimal.profile), [
    { label: "Adresse e-mail de contact", value: "public@example.invalid", action: "Écrire à l’exploitant", url: "mailto:public@example.invalid" },
    { label: "Données personnelles", value: "privacy@example.invalid", action: "Écrire au sujet de mes données", url: "mailto:privacy@example.invalid" },
  ]);
  const phone = wire({ ...MINIMUM, public_phone: "+596000000000", public_email: "aide+qa@example.invalid" }).published;
  assert.ok(phone);
  assert.deepEqual(contactChannels(phone.profile).map((channel) => [channel.label, channel.url]), [
    ["Adresse e-mail de contact", "mailto:aide%2Bqa@example.invalid"],
    ["Téléphone", "tel:+596000000000"],
    ["Données personnelles", "mailto:privacy@example.invalid"],
  ]);
  assert.deepEqual(contactChannels({}), []);
});

test("zone par code postal : aucun appel sans code valide, trois statuts libellés en toutes lettres", () => {
  assert.equal(coveragePath("97200"), "/api/public/coverage?postal_code=97200");
  for (const typed of ["", "9720", "972000", "9720a", "97200&x=1"]) assert.equal(coveragePath(typed), null, JSON.stringify(typed));
  const covered = coverageResult("97200", coverageSchema.parse({ status: "covered", version: 4 }));
  assert.equal(covered.label, "Dans la zone publiée");
  assert.match(covered.message, /97200 figure dans la zone publiée/);
  const outside = coverageResult("97201", coverageSchema.parse({ status: "not_covered", version: 4 }));
  assert.equal(outside.label, "Hors de la zone publiée");
  assert.match(outside.message, /97201 ne figure pas .* Vous pouvez tout de même déposer une demande\./);
  const unknown = coverageResult("97200", coverageSchema.parse({ status: "unknown", version: null }));
  assert.equal(unknown.label, "Zone non publiée");
  assert.doesNotMatch(unknown.message, /97200/, "aucune conclusion sur le code tant que rien n’est publié");
});

test("garantie : rien de publié reste « absent » ; une publication garde titre, texte et version", () => {
  assert.deepEqual(publishedState(done(warrantyTermsSchema.parse({ published: null }))), { phase: "absent" });
  const terms = { version: 2, title: "Conditions QA", body: "Texte QA", published_at: AT };
  const state = publishedState(done(warrantyTermsSchema.parse({ published: terms })));
  assert.deepEqual(state, { phase: "published", value: terms });
  assert.equal(publishedStamp(terms), "Publié par l’exploitant le 7 novembre 2026 (version 2).");
});

test("écran d’aide : lit les sources publiées, sans coordonnée ni identité écrite en dur", () => {
  const screen = readFileSync("apps/mobile/src/app/aide-mobile.tsx", "utf8");
  assert.match(screen, /useResource\(PUBLIC_PATHS\.operatorProfile, operatorPublicationSchema\)/);
  assert.match(screen, /useResource\(PUBLIC_PATHS\.warrantyTerms, warrantyTermsSchema\)/);
  assert.match(screen, /useResource\(checked \? coveragePath\(checked\) : null, coverageSchema\)/);
  assert.match(screen, /releaseLabel\(Platform\.OS\)/);
  assert.doesNotMatch(screen, /mailto:|tel:|\+\d{6,}|[\w.]+@[\w-]+\.[a-z]{2,}|\b\d{9,14}\b|Courant/);
  for (const state of ["loading", "absent", "error"]) assert.ok(screen.includes(`state.phase === '${state}'`), state);
});
