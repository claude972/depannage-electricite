import test from "node:test";
import assert from "node:assert/strict";
import { appointmentSlotState, missionSegmentOptions } from "../../components/role/artisan-lists";

const now = new Date(2026, 9, 31, 9, 0, 0); // 31 octobre 2026, heure locale

test("horaire de mission : lecture, indisponible, à fixer — jamais déduit", () => {
  assert.deepEqual(appointmentSlotState(undefined, now), { kind: "loading" });
  assert.deepEqual(appointmentSlotState(null, now), { kind: "unavailable" });
  assert.deepEqual(appointmentSlotState({ appointment: null }, now), { kind: "unscheduled" });
});

test("horaire de mission : rendez-vous réel, aujourd’hui ou à une autre date", () => {
  const today = new Date(2026, 9, 31, 14, 0, 0).toISOString();
  const todayEnd = new Date(2026, 9, 31, 16, 0, 0).toISOString();
  const other = new Date(2026, 10, 2, 10, 0, 0).toISOString();
  const otherEnd = new Date(2026, 10, 2, 12, 0, 0).toISOString();
  const entry = (starts_at: string, ends_at: string) =>
    ({ appointment: { intervention_id: "x", starts_at, ends_at, note: "", updated_by: "u", updated_at: starts_at } }) as const;
  assert.deepEqual(appointmentSlotState(entry(today, todayEnd), now), {
    kind: "scheduled",
    today: true,
    startsAt: today,
    endsAt: todayEnd,
  });
  assert.deepEqual(appointmentSlotState(entry(other, otherEnd), now), {
    kind: "scheduled",
    today: false,
    startsAt: other,
    endsAt: otherEnd,
  });
});

test("segments de missions : trois états avec compteurs réels", () => {
  assert.deepEqual(missionSegmentOptions({ offers: 1, active: 2, done: 0 }), [
    ["available", "Disponibles (1)"],
    ["active", "En cours (2)"],
    ["done", "Terminées (0)"],
  ]);
});

// ---- Performance M36 : six tuiles, deux indisponibles, aucune valeur inventée ---------------
import { perfTiles } from "../../components/role/artisan-lists";
import { money } from "../../components/app/format";
import type { Performance } from "../../components/app/session";

const perf: Performance = {
  rating: { average: 4.66, count: 3 },
  monthRevenueCents: 14400,
  monthPaidCount: 1,
  completedCount: 1,
  onTimeRate: null,
  period: "octobre 2026",
  basis: "dossiers chargés",
};

test("tuiles de performance : valeurs réelles formatées, ordre M36", () => {
  const tiles = perfTiles(perf, "2 mois");
  assert.deepEqual(tiles.map((t) => t.id), ["satisfaction", "rating", "completed", "seniority", "punctuality", "revenue"]);
  const rating = tiles[1];
  assert.equal(rating.kind, "value");
  if (rating.kind === "value") {
    assert.equal(rating.value, "4,7 / 5");
    assert.equal(rating.note, "3 avis clients");
  }
  const revenue = tiles[5];
  if (revenue.kind === "value") {
    assert.equal(revenue.value, money(14400)); // même formateur que l’affichage (espace insécable)
    assert.equal(revenue.note, "1 règlement — octobre 2026");
  }
  const seniority = tiles[3];
  if (seniority.kind === "value") assert.equal(seniority.note, "Depuis l’inscription");
});

test("tuiles de performance : sans source, état indisponible explicite ; sans avis, tiret", () => {
  const tiles = perfTiles({ ...perf, rating: null }, null);
  const unavailable = tiles.filter((t) => t.kind === "unavailable");
  assert.deepEqual(unavailable.map((t) => t.id), ["satisfaction", "punctuality"]);
  assert.ok(unavailable.every((t) => t.kind === "unavailable" && t.reason.length > 0 && !("value" in t)));
  const rating = tiles[1];
  if (rating.kind === "value") {
    assert.equal(rating.value, "—");
    assert.equal(rating.note, "Aucun avis encore");
  }
  const seniority = tiles[3];
  if (seniority.kind === "value") {
    assert.equal(seniority.value, "—");
    assert.equal(seniority.note, "Date d’inscription non transmise");
  }
});

// ---- Devis M34 : totaux d’affichage -----------------------------------------------------------
import { quoteLineTotalCents, quoteTotals } from "../../components/role/artisan-lists";

test("devis : total de ligne et totaux HT / TVA / TTC", () => {
  assert.equal(quoteLineTotalCents(2, 6000), 12000);
  assert.equal(quoteLineTotalCents(3, 3333), 9999);
  const lines = [
    { quantity: 1, unit_price_cents: 8000 },
    { quantity: 2, unit_price_cents: 12000 },
    { quantity: 1, unit_price_cents: 12000 },
  ];
  assert.deepEqual(quoteTotals(lines, 20), { subtotal: 44000, tax: 8800, total: 52800 });
  assert.deepEqual(quoteTotals(lines, 5.5), { subtotal: 44000, tax: 2420, total: 46420 });
  assert.deepEqual(quoteTotals(lines, 0), { subtotal: 44000, tax: 0, total: 44000 });
});

test("devis : sans taux de TVA, TVA et TTC restent inconnus ; sans ligne, zéro", () => {
  assert.deepEqual(quoteTotals([{ quantity: 1, unit_price_cents: 8000 }], null), { subtotal: 8000, tax: null, total: null });
  assert.deepEqual(quoteTotals([], 20), { subtotal: 0, tax: 0, total: 0 });
});

// ---- Planning : lecture seule honnête, semaine de démonstration --------------------------------
import { demoPlanningRange, planningAuthority } from "../../components/role/artisan-lists";

test("planning : suspendu ou non activé en réel → lecture seule avec raison ; sinon écriture", () => {
  assert.equal(planningAuthority("live", true, "approved").canWrite, true);
  assert.equal(planningAuthority("demo", undefined, undefined).canWrite, true);
  const suspended = planningAuthority("live", true, "suspended");
  assert.equal(suspended.canWrite, false);
  assert.match(suspended.reason ?? "", /suspendu/);
  const notApproved = planningAuthority("live", false, "submitted");
  assert.equal(notApproved.canWrite, false);
  assert.match(notApproved.reason ?? "", /pas encore activé/);
  // En démonstration, l’approbation inconnue n’interdit rien (la feuille est de toute façon en lecture seule).
  assert.equal(planningAuthority("demo", false, "submitted").canWrite, true);
});

test("planning : la semaine de démonstration commence le lundi du fuseau Martinique", () => {
  // Samedi 31 octobre 2026 12:00 UTC = 08:00 en Martinique → lundi 26 octobre.
  assert.deepEqual(demoPlanningRange(new Date("2026-10-31T12:00:00Z"), "America/Martinique"), {
    from: "2026-10-26T00:00:00",
    to: "2026-11-02T00:00:00",
  });
  // Lundi 02:00 UTC = dimanche 22:00 en Martinique → encore la semaine précédente.
  assert.deepEqual(demoPlanningRange(new Date("2026-11-02T02:00:00Z"), "America/Martinique").from, "2026-10-26T00:00:00");
});

// ---- Documents obligatoires M14 -----------------------------------------------------------------
import { credentialDateLabel, credentialSummary } from "../../components/role/artisan-lists";
import { date as formatDate } from "../../components/app/format";

test("documents : compte réel de pièces transmises, complet seulement à 3/3, aucun pourcentage", () => {
  const cred = { created_at: "2026-10-01T00:00:00Z" };
  assert.deepEqual(credentialSummary([{ key: "missing" }, { key: "missing" }, { key: "missing" }]), {
    transmitted: 0, total: 3, complete: false, label: "0/3 pièces transmises",
  });
  assert.deepEqual(credentialSummary([{ key: "pending", credential: cred }, { key: "expired", credential: cred }, { key: "missing" }]).label, "2/3 pièces transmises");
  const all = credentialSummary([{ key: "valid", credential: cred }, { key: "pending", credential: cred }, { key: "expired", credential: cred }]);
  assert.equal(all.complete, true);
  assert.ok(!/%/.test(all.label));
});

test("documents : libellé de date issu de expires_on uniquement", () => {
  assert.equal(credentialDateLabel({ key: "missing" }), null);
  assert.equal(credentialDateLabel({ key: "pending", credential: { created_at: "2026-10-01T00:00:00Z", expires_on: null } }), "Sans date d’expiration renseignée");
  assert.equal(credentialDateLabel({ key: "valid", credential: { created_at: "2026-10-01T00:00:00Z", expires_on: "2027-06-15" } }), `Valide jusqu’au ${formatDate("2027-06-15")}`);
  assert.equal(credentialDateLabel({ key: "expired", credential: { created_at: "2026-10-01T00:00:00Z", expires_on: "2024-05-10" } }), `Expiré le ${formatDate("2024-05-10")}`);
});

// ---- Candidature M65 ----------------------------------------------------------------------------
import { applicationSteps, stepsSummary } from "../../components/role/artisan-lists";

const blank = { personalDone: false, companyName: "", siret: "", legalStatus: "", address: "", postalCodes: [], categories: [], credentialsComplete: false, hasProfile: false };

test("candidature : sections renseignées seulement d’après les valeurs et pièces réelles", () => {
  const empty = applicationSteps(blank);
  assert.deepEqual(empty.map((s) => s.n), [1, 2, 3, 4, 5]);
  assert.ok(empty.every((s) => !s.done));
  assert.equal(stepsSummary(empty), "0 section sur 5 renseignée");
  const full = applicationSteps({ personalDone: true, companyName: "Martin Élec", siret: "12345678901234", legalStatus: "EURL", address: "3 rue des Ateliers", postalCodes: ["97200"], categories: ["panel"], credentialsComplete: true, hasProfile: true });
  assert.ok(full.every((s) => s.done));
  assert.equal(stepsSummary(full), "5 sections sur 5 renseignées");
  // Société incomplète (SIRET de 13 chiffres) → section 2 à compléter, les autres inchangées.
  const partial = applicationSteps({ ...blank, personalDone: true, companyName: "Martin Élec", siret: "1234567890123", legalStatus: "EURL", address: "3 rue des Ateliers" });
  assert.deepEqual(partial.map((s) => s.done), [true, false, false, false, false]);
});

// ---- ART-CREDENTIAL-001 : aucune validation par pièce déduite de l’approbation --------------------
import { credentialState } from "../../components/role/artisan-lists";
import type { ArtisanCredential } from "../../components/app/types";

const cred = (kind: ArtisanCredential["kind"], created_at: string, expires_on: string | null = null): ArtisanCredential => ({
  id: `c-${kind}-${created_at}`, user_id: "u", document_id: `d-${kind}`, kind, expires_on, created_at,
});

test("pièce ajoutée après approbation : « Transmis », jamais « Validé »", () => {
  // L’approbation de la candidature n’est pas un paramètre : la pièce ne peut pas en hériter.
  const s = credentialState([cred("registration", "2026-10-31T10:00:00Z", "2027-06-15")], "registration", "2026-10-31");
  assert.equal(s.key, "pending");
  assert.equal(s.label, "Transmis");
  assert.ok(!/valid/i.test(s.label));
  assert.equal(credentialState([], "qualification", "2026-10-31").label, "Manquant");
});

test("pièce expirée : « À renouveler » (date dépassée), dernière pièce du type retenue", () => {
  const s = credentialState([cred("liability", "2024-01-10T00:00:00Z", "2024-05-10")], "liability", "2026-10-31");
  assert.equal(s.key, "expired");
  assert.equal(s.label, "À renouveler");
  assert.equal(credentialDateLabel(s), `Expiré le ${formatDate("2024-05-10")}`);
  // Une pièce plus récente du même type remplace l’ancienne expirée.
  const renewed = credentialState([cred("liability", "2024-01-10T00:00:00Z", "2024-05-10"), cred("liability", "2026-10-30T00:00:00Z", "2027-05-10")], "liability", "2026-10-31");
  assert.equal(renewed.label, "Transmis");
});
