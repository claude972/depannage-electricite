// Régression : GET /api/interventions/[id]/operations renvoie la ligne intervention_appointments telle
// quelle (révision du créneau = `reminder_version`). Le contrat mobile doit la lire, sinon tout le bloc
// opérations (rendez-vous, compte rendu, signature) devient illisible dès qu’un créneau existe.
import assert from "node:assert/strict";
import test from "node:test";
import { operations } from "../apps/mobile/src/lib/contracts";

const dossier = "10000000-0000-4000-8000-000000000002";
const artisan = "10000000-0000-4000-8000-000000000001";
const base = {
  participants: [], history: [], history_limit: 100, travel_stage: "planned",
  report: null, report_evidence_required: true, report_receipt: null,
};
// Colonnes de public.intervention_appointments après la migration appointment_reminders.
const slot = {
  intervention_id: dossier, starts_at: "2026-11-12T13:00:00+00:00", ends_at: "2026-11-12T15:00:00+00:00",
  note: "", updated_by: artisan, updated_at: "2026-11-10T10:00:00.123456+00:00", reminder_version: 2,
};

test("le contrat mobile lit les opérations d’un dossier sans créneau", () => {
  assert.equal(operations.parse({ ...base, appointment: null }).appointment, null);
});

test("le contrat mobile lit le créneau serveur et expose sa révision pour expected_version", () => {
  const parsed = operations.parse({ ...base, appointment: slot });
  assert.equal(parsed.appointment?.reminder_version, 2);
  assert.equal(parsed.appointment?.starts_at, slot.starts_at);
});

test("un créneau sans révision reste refusé plutôt qu’enregistré à l’aveugle", () => {
  const withoutRevision = { starts_at: slot.starts_at, ends_at: slot.ends_at, note: slot.note };
  assert.equal(operations.safeParse({ ...base, appointment: withoutRevision }).success, false);
  assert.equal(operations.safeParse({ ...base, appointment: { ...withoutRevision, version: 2 } }).success, false);
});
