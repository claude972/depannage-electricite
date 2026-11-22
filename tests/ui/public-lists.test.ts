import test from "node:test";
import assert from "node:assert/strict";
import { ABOUT_VALUES, FAQ, FORBIDDEN_PUBLIC_CLAIMS, HELP_PROCESS, HOME_FACTS, HOME_STEPS, JOIN_FACTS, JOIN_STEPS, JOIN_TILES, LEGAL_SECTIONS, PRIVACY_DATA, forbiddenClaims, numbered, pricingRows, publicStrings } from "../../components/role/public-lists";
import { CATEGORIES, category } from "../../components/app/format";

test("no public string carries a promise, delay, counter, rating or contact copied from the mockups", () => {
  const offenders = publicStrings().map((s) => [s, forbiddenClaims(s)] as const).filter(([, hits]) => hits.length);
  assert.deepEqual(offenders, []);
  // The guard itself catches the reference examples.
  for (const sample of ["Intervention sous 24h à 48h", "Disponible 24h/24 – 7j/7", "Garantie 1 an", "Aucune majoration 24/7", "Prix fixe", "Plus de 4,8/5 de moyenne", "2 500+ électriciens", "Jusqu’à 85 % reversés", "06 12 34 56 78", "contact@elecpro.fr", "Artisans certifiés", "Couverture nationale", "des milliers de clients"])
    assert.ok(forbiddenClaims(sample).length > 0, sample);
  assert.ok(FORBIDDEN_PUBLIC_CLAIMS.length >= 15);
});
test("steps, facts, tiles and questions are unique, non-empty and sized like their references", () => {
  const unique = (items: { title: string }[]) => assert.equal(new Set(items.map((i) => i.title)).size, items.length);
  assert.equal(HOME_STEPS.length, 3); unique(HOME_STEPS);
  assert.equal(HOME_FACTS.length, 4); unique(HOME_FACTS);
  assert.equal(HELP_PROCESS.length, 4); unique(HELP_PROCESS);
  assert.equal(JOIN_STEPS.length, 5); unique(JOIN_STEPS);
  assert.equal(JOIN_FACTS.length, 3); unique(JOIN_FACTS);
  assert.equal(JOIN_TILES.length, 4); unique(JOIN_TILES);
  assert.equal(ABOUT_VALUES.length, 3); unique(ABOUT_VALUES);
  assert.equal(new Set(FAQ.map((f) => f.question)).size, FAQ.length);
  for (const s of publicStrings()) assert.ok(s.trim().length > 0);
  for (const item of [...HOME_STEPS, ...HOME_FACTS, ...HELP_PROCESS, ...JOIN_STEPS, ...JOIN_FACTS, ...JOIN_TILES, ...ABOUT_VALUES, ...FAQ]) assert.match(item.icon, /^[a-z]+$/);
});
test("pricing rows come from the domain categories with ordered bounds and no hand-typed amount", () => {
  const rows = pricingRows(CATEGORIES, category);
  assert.equal(rows.length, CATEGORIES.length);
  for (const row of rows) { assert.ok(row.min > 0 && row.max > row.min, row.label); assert.ok(row.description.length > 0); }
  assert.deepEqual(rows.map((r) => r.id), CATEGORIES.map((c) => c.id));
});
test("legal and privacy documents keep their fields and number their sections like M63 / V8-C05", () => {
  assert.equal(numbered(0, "Éditeur"), "1. Éditeur");
  assert.equal(numbered(3, "Données personnelles"), "4. Données personnelles");
  // Éditeur carries the « Immatriculation » row (owner-validated registration) since 2026-11-21.
  assert.deepEqual(LEGAL_SECTIONS.map((s) => s.fields.length), [6, 3, 1, 2]);
  assert.deepEqual(LEGAL_SECTIONS[0].fields.filter((f) => /SIREN|Immatriculation|Directeur/.test(f)), ["Numéro SIREN et numéro de TVA", "Immatriculation", "Directeur ou directrice de la publication"]);
  assert.equal(PRIVACY_DATA.length, 15);
  for (const label of ["Lieu d’intervention", "Demande de rappel", "Notifications du navigateur", "Préanalyse d’une photo"]) {
    assert.ok(PRIVACY_DATA.some((entry) => entry.label === label), label);
  }
  assert.ok(PRIVACY_DATA.every((d) => /^[a-zé]/i.test(d.text)));
});
