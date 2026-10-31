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
