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
