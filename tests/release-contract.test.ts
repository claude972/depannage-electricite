// Contrôle de version et de frontière Web / mobile. Échoue si :
//   - shared/release.ts, les deux package.json (et leurs verrous) ou app.json portent des versions
//     ou des compteurs de build différents ;
//   - les schémas des trois lectures publiées réellement partagées (zone par code postal, profil de
//     l’exploitant, conditions de garantie) divergent entre le Web (lib/features/*/contract.ts), le
//     mobile (apps/mobile/src/lib/published-info.ts), la description commune
//     (shared/public-contract.ts) et la règle SQL en vigueur.
// Valeurs d’essai manifestement synthétiques ; aucune n’est publiée.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import { coverageSchema, isPostalCode, operatorProfileSchema, operatorPublicationSchema, warrantyTermsSchema } from "../apps/mobile/src/lib/published-info";
import { RELEASE as MOBILE_RELEASE } from "../apps/mobile/src/lib/release";
import { PUBLIC_PATH as WEB_COVERAGE_PATH } from "../components/features/coverage/model";
import { PUBLIC_PROFILE_PATH } from "../components/features/public-operator-profile/model";
import { PUBLIC_TERMS_PATH } from "../components/features/warranty-policy/model";
import { postalCode, publicCoverage } from "../lib/features/coverage/contract";
import { MINIMUM_FIELDS, operatorProfile, publication } from "../lib/features/public-operator-profile/contract";
import { published as warrantyPublished } from "../lib/features/warranty-policy/contract";
import { COVERAGE, EMAIL_PATTERN, MAX_VERSION, OPERATOR_PROFILE_FIELDS, OPERATOR_PROFILE_REQUIRED, POSTAL_CODE_PATTERN, PUBLIC_PATHS, WARRANTY_TERMS, type FieldRule } from "../shared/public-contract";
import { RELEASE, releaseLabel } from "../shared/release";

const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const MOBILE = "apps/mobile";
/** Dernier build préparé : les compteurs ne redescendent jamais en dessous. */
const BUILD_FLOOR = 2;

test("une seule version : source commune, package.json Web et mobile, verrous et configuration Expo", () => {
  const { version, build } = RELEASE;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const web = json("package.json"), mobile = json(`${MOBILE}/package.json`), expo = json(`${MOBILE}/app.json`).expo;
  assert.equal(web.version, version, "package.json");
  assert.equal(mobile.version, version, `${MOBILE}/package.json`);
  assert.equal(expo.version, version, `${MOBILE}/app.json`);
  for (const lock of ["package-lock.json", `${MOBILE}/package-lock.json`]) {
    if (!existsSync(lock)) continue;
    assert.equal(json(lock).version, version, lock);
    assert.equal(json(lock).packages?.[""]?.version, version, lock);
  }
  assert.equal(MOBILE_RELEASE, RELEASE, "le mobile lit la source commune, sans copie");
  assert.equal(releaseLabel(), `Version ${version}`);
  assert.equal(releaseLabel("ios"), `Version ${version} (build ${build.ios})`);
  assert.equal(releaseLabel("android"), `Version ${version} (build ${build.android})`);
  assert.equal(releaseLabel("web"), `Version ${version}`);

  // Compteurs de build : entiers, jamais en recul, identiques à ceux qu’EAS lira dans app.json.
  for (const counter of [build.ios, build.android]) assert.ok(Number.isSafeInteger(counter) && counter >= BUILD_FLOOR && counter <= 2100000000, String(counter));
  assert.equal(expo.ios.buildNumber, String(build.ios), "ios.buildNumber");
  assert.equal(expo.android.versionCode, build.android, "android.versionCode");
  const eas = json(`${MOBILE}/eas.json`);
  assert.equal(eas.cli.appVersionSource, "local", "version lue dans le dépôt, pas sur les serveurs EAS");
  for (const [name, profile] of Object.entries<Record<string, unknown>>(eas.build)) assert.equal("autoIncrement" in profile, false, name);
  // Une configuration dynamique pourrait remplacer ces valeurs sans que ce contrôle le voie.
  for (const dynamic of ["app.config.js", "app.config.ts"]) assert.equal(existsSync(`${MOBILE}/${dynamic}`), false, dynamic);

  // La frontière est validée par zod des deux côtés : même version majeure.
  const major = (range: string) => /\d+/.exec(range)?.[0];
  assert.equal(major(mobile.dependencies.zod), major(web.dependencies.zod), "zod");
});

test("profils EAS : preview et identifiants conservés, simulateur et appareil distincts, ni production ni envoi aux stores", () => {
  const eas = json(`${MOBILE}/eas.json`), expo = json(`${MOBILE}/app.json`).expo;
  assert.deepEqual(eas.build.preview, { distribution: "internal", environment: "preview", android: { buildType: "apk", credentialsSource: "local" }, ios: { simulator: true, scheme: "DomDepannage" } });
  assert.equal(eas.cli.requireCommit, true);
  assert.equal("submit" in eas, false);
  assert.equal("production" in eas.build, false);
  assert.equal(eas.build.simulator.ios.simulator, true);
  assert.equal("credentialsSource" in eas.build.simulator.ios, false, "aucune signature pour le simulateur iOS");
  assert.equal(eas.build.device.ios.simulator, false);
  assert.equal(eas.build.device.ios.credentialsSource, "remote", "iOS physique : identifiants déjà enregistrés uniquement");
  for (const [name, profile] of Object.entries<{ distribution: string; environment: string; android: Record<string, unknown> }>(eas.build)) {
    assert.equal(profile.distribution, "internal", name);
    assert.equal(profile.environment, "preview", name);
    assert.deepEqual(profile.android, { buildType: "apk", credentialsSource: "local" }, `${name} : keystore local existant uniquement`);
  }
  assert.equal(expo.ios.bundleIdentifier, "com.claude972.depannageelectrique.preview");
  assert.equal(expo.android.package, "com.claude972.depannageelectrique.preview");
  assert.equal(expo.owner, "claude972");
  assert.equal(expo.slug, "depannage-electrique-mobile");
  assert.equal(expo.extra.eas.projectId, "70af13e9-0f42-410f-93c9-f53b8966e056");
  const ignored = readFileSync(`${MOBILE}/.gitignore`, "utf8").split(/\r?\n/);
  for (const secret of ["credentials.json", "*.jks", "*.p8", "*.p12", "*.mobileprovision"]) assert.ok(ignored.includes(secret), `${secret} doit rester hors du dépôt`);
});

test("mêmes chemins publics des deux côtés, servis par des routes existantes", () => {
  assert.deepEqual({ ...PUBLIC_PATHS }, { coverage: WEB_COVERAGE_PATH, operatorProfile: PUBLIC_PROFILE_PATH, warrantyTerms: PUBLIC_TERMS_PATH });
  for (const path of Object.values(PUBLIC_PATHS)) assert.ok(existsSync(`app${path}/route.ts`), path);
});

// ---- Profil de l’exploitant ----------------------------------------------------------------------
const rules: Record<string, FieldRule> = OPERATOR_PROFILE_FIELDS;
const CODE_SAMPLES: Record<string, { ok: string[]; ko: string[] }> = {
  siren: { ok: ["000000000"], ko: ["00000000", "0000000000", "00000000A", " 000000000"] },
  siret: { ok: ["00000000000000"], ko: ["0000000000000", "000000000000000", "0000000000000A"] },
  vat_number: { ok: ["FR00", `FR${"0".repeat(14)}`], ko: ["fr00000000000", "F000", `FR${"0".repeat(15)}`] },
  public_phone: { ok: ["+5960000000", `+5${"0".repeat(14)}`], ko: ["0596000000", "+0596000000", "+59600", `+5${"0".repeat(15)}`] },
};
const emailForm = new RegExp(EMAIL_PATTERN);
/** Ce que la description commune admet pour un champ : la référence des deux implémentations. */
function admitted(rule: FieldRule, value: string): boolean {
  if (rule.kind === "code") return new RegExp(rule.pattern).test(value) && value.length <= rule.max;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= rule.max && (rule.kind === "text" || emailForm.test(trimmed));
}
function probes(key: string, rule: FieldRule): string[] {
  if (rule.kind === "code") return [...CODE_SAMPLES[key].ok, ...CODE_SAMPLES[key].ko];
  if (rule.kind === "email") return ["a@b.co", `${"a".repeat(rule.max - 5)}@b.co`, `${"a".repeat(rule.max - 4)}@b.co`, "a@b", "a b@c.de", "", " a@b.co "];
  return ["x", "x".repeat(rule.max), "x".repeat(rule.max + 1), "", "   ", "  x  "];
}
// Un SIRET n’est admis qu’avec son SIREN : la sonde l’accompagne du SIREN qu’il prolonge.
const candidate = (key: string, value: string) => (key === "siret" ? { siren: value.slice(0, 9), siret: value } : { [key]: value });

test("profil de l’exploitant : mêmes champs, mêmes limites et mêmes formats côté Web, mobile et description commune", () => {
  const expected = Object.keys(rules).sort();
  assert.deepEqual(Object.keys(operatorProfile.shape).sort(), expected, "champs du contrat Web");
  assert.deepEqual(Object.keys(operatorProfileSchema.shape).sort(), expected, "champs du lecteur mobile");
  assert.deepEqual([...MINIMUM_FIELDS].sort(), [...OPERATOR_PROFILE_REQUIRED].sort(), "champs requis pour publier");
  assert.equal(OPERATOR_PROFILE_REQUIRED.includes("siret"), false, "le SIRET reste facultatif");

  for (const [key, rule] of Object.entries(rules)) {
    if (rule.kind === "code") {
      assert.ok(CODE_SAMPLES[key], `échantillons à ajouter pour ${key}`);
      for (const value of CODE_SAMPLES[key].ok) assert.equal(admitted(rule, value), true, `${key} ${value}`);
      for (const value of CODE_SAMPLES[key].ko) assert.equal(admitted(rule, value), false, `${key} ${value}`);
    }
    for (const value of probes(key, rule)) {
      const wanted = admitted(rule, value), shown = JSON.stringify(value.length > 24 ? `${value.slice(0, 12)}…(${value.length})` : value);
      assert.equal(operatorProfile.safeParse(candidate(key, value)).success, wanted, `Web ${key} ${shown}`);
      assert.equal(operatorProfileSchema.safeParse(candidate(key, value)).success, wanted, `mobile ${key} ${shown}`);
    }
  }

  // Champ hors contrat : le Web le refuse (écriture comprise) ; le mobile l’ignore sans l’afficher.
  assert.equal(operatorProfile.safeParse({ legal_name: "Exploitant QA", internal_key: "x" }).success, false);
  const tolerant = operatorProfileSchema.safeParse({ legal_name: "Exploitant QA", internal_key: "x" });
  assert.ok(tolerant.success);
  assert.deepEqual(tolerant.data, { legal_name: "Exploitant QA" });

  // SIRET cohérent avec le SIREN, des deux côtés.
  for (const [side, schema] of [["Web", operatorProfile], ["mobile", operatorProfileSchema]] as const) {
    assert.equal(schema.safeParse({ siren: "000000001", siret: "00000000100012" }).success, true, side);
    assert.equal(schema.safeParse({ siren: "000000002", siret: "00000000100012" }).success, false, `${side} : autre SIREN`);
    assert.equal(schema.safeParse({ siret: "00000000100012" }).success, false, `${side} : SIRET sans SIREN`);
    assert.equal(schema.safeParse({ siren: "000000001" }).success, true, `${side} : SIREN seul`);
  }
});

const MINIMUM = {
  legal_name: "Exploitant QA", legal_form: "Société QA", siren: "000000001", hq_address: "Adresse de test",
  publication_director: "Direction QA", public_email: "public@example.invalid", privacy_email: "privacy@example.invalid",
  host_name: "Hébergeur QA", host_address: "Adresse QA", host_contact: "hosting@example.invalid", rights_holder: "Titulaire QA",
};
const AT = "2026-11-07T10:00:00+00:00";

test("publication de l’exploitant : la même réponse est admise ou refusée par le Web et par le mobile", () => {
  const web = z.object({ published: publication.nullable() }).strict();
  const { host_name: _omitted, ...incomplete } = MINIMUM;
  void _omitted;
  const cases: [string, unknown, boolean][] = [
    ["rien de publié", { published: null }, true],
    ["publication minimale", { published: { version: 3, profile: MINIMUM, published_at: AT } }, true],
    ["avec SIRET", { published: { version: 3, profile: { ...MINIMUM, siret: "00000000100012" }, published_at: AT } }, true],
    ["SIRET d’un autre SIREN", { published: { version: 3, profile: { ...MINIMUM, siret: "00000000200012" }, published_at: AT } }, false],
    ["champ requis manquant", { published: { version: 3, profile: incomplete, published_at: AT } }, false],
    ["version nulle", { published: { version: 0, profile: MINIMUM, published_at: AT } }, false],
    ["date sans fuseau", { published: { version: 3, profile: MINIMUM, published_at: "2026-11-07T10:00:00" } }, false],
    ["réponse vide", {}, false],
  ];
  for (const [name, body, wanted] of cases) {
    assert.equal(web.safeParse(body).success, wanted, `Web : ${name}`);
    assert.equal(operatorPublicationSchema.safeParse(body).success, wanted, `mobile : ${name}`);
  }
});

test("zone par code postal : mêmes statuts, mêmes versions et même forme de code", () => {
  const cases: [unknown, boolean][] = [
    [{ status: COVERAGE.unpublished, version: null }, true],
    [{ status: COVERAGE.unpublished, version: 1 }, false],
    ...COVERAGE.published.flatMap((status): [unknown, boolean][] => [
      [{ status, version: 1 }, true], [{ status, version: null }, false], [{ status, version: 0 }, false], [{ status, version: 1.5 }, false],
    ]),
    [{ status: "partial", version: 1 }, false],
    [{ version: 1 }, false],
  ];
  for (const [body, wanted] of cases) {
    assert.equal(publicCoverage.safeParse(body).success, wanted, `Web ${JSON.stringify(body)}`);
    assert.equal(coverageSchema.safeParse(body).success, wanted, `mobile ${JSON.stringify(body)}`);
  }
  const form = new RegExp(POSTAL_CODE_PATTERN);
  for (const value of ["97200", "00000", "9720", "972000", "9720a", " 97200", ""]) {
    assert.equal(postalCode.safeParse(value).success, form.test(value), `Web ${JSON.stringify(value)}`);
    assert.equal(isPostalCode(value), form.test(value), `mobile ${JSON.stringify(value)}`);
  }
});

test("conditions de garantie : mêmes limites de version, de titre et de texte", () => {
  const web = z.object({ published: warrantyPublished.nullable() }).strict();
  const terms = { version: 2, title: "Conditions QA", body: "Texte QA", published_at: AT };
  const cases: [string, unknown, boolean][] = [
    ["rien de publié", null, true],
    ["publication", terms, true],
    ["titre vide", { ...terms, title: "" }, false],
    ["titre à la limite", { ...terms, title: "x".repeat(WARRANTY_TERMS.titleMax) }, true],
    ["titre trop long", { ...terms, title: "x".repeat(WARRANTY_TERMS.titleMax + 1) }, false],
    ["texte vide", { ...terms, body: "" }, false],
    ["texte à la limite", { ...terms, body: "x".repeat(WARRANTY_TERMS.bodyMax) }, true],
    ["texte trop long", { ...terms, body: "x".repeat(WARRANTY_TERMS.bodyMax + 1) }, false],
    ["version nulle", { ...terms, version: 0 }, false],
    ["version maximale", { ...terms, version: MAX_VERSION }, true],
    ["version hors borne", { ...terms, version: MAX_VERSION + 1 }, false],
    ["date sans fuseau", { ...terms, published_at: "2026-11-07T10:00:00" }, false],
  ];
  for (const [name, published, wanted] of cases) {
    assert.equal(web.safeParse({ published }).success, wanted, `Web : ${name}`);
    assert.equal(warrantyTermsSchema.safeParse({ published }).success, wanted, `mobile : ${name}`);
  }
});

test("la règle SQL en vigueur admet exactement les champs, longueurs et formats de la frontière", () => {
  const dir = "supabase/migrations";
  const defining = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
    .filter((name) => /create (?:or replace )?function public\.valid_public_operator_profile\(/.test(readFileSync(`${dir}/${name}`, "utf8")));
  const latest = defining.at(-1);
  assert.ok(latest, "aucune migration ne définit valid_public_operator_profile");
  const definition = (file: string) => {
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    const start = sql.indexOf("function public.valid_public_operator_profile(");
    return sql.slice(start, sql.indexOf("$$;", start));
  };
  const body = definition(latest);
  const listed = [...body.matchAll(/when '([a-z_]+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])] as const);
  assert.equal(listed.length, Object.keys(rules).length, `${latest} : nombre de champs`);
  assert.deepEqual(Object.fromEntries(listed), Object.fromEntries(Object.entries(rules).map(([key, rule]) => [key, rule.max])), latest);
  for (const [key, rule] of Object.entries(rules)) {
    if (rule.kind === "code") assert.ok(body.includes(`entry.key = '${key}' and value_text !~ '${rule.pattern}'`), `${latest} : format de ${key}`);
  }
  assert.match(body, /left\(value_text, 9\) is distinct from \(p_profile ->> 'siren'\)/, "SIRET cohérent avec le SIREN");
  // Dérivée de 20261108043254 sans retirer de règle : chaque contrôle d’origine est toujours là.
  const checks = (source: string) => source.split("\n").map((line) => line.trim()).filter((line) => /^(?:when '|if )/.test(line));
  const kept = checks(body);
  for (const line of checks(definition("20261108043254_operator_privacy_publication.sql"))) assert.ok(kept.includes(line), `${latest} a perdu : ${line}`);
});
