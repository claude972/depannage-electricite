// CLI-04: the client dossier says who set the slot. No confirmation state exists server-side
// (save_intervention_appointment overwrites), so the wording never claims a confirmation.
import test from "node:test";
import assert from "node:assert/strict";
import { appointmentOrigin } from "../../components/app/format";

const CLIENT = "10000000-0000-4000-8000-000000000001";
const ARTISAN = "10000000-0000-4000-8000-000000000002";

test("slot origin: artisan proposal, own slot, unknown author — never « confirmé »", () => {
  const by = (updatedBy: string | null | undefined, editable = true) => appointmentOrigin({ updatedBy, viewerId: CLIENT, artisanId: ARTISAN, editable });
  assert.equal(by(ARTISAN), "Créneau proposé par l’artisan — modifiez-le s’il ne vous convient pas.");
  assert.equal(by(ARTISAN, false), "Créneau proposé par l’artisan.");
  assert.equal(by(CLIENT), "Créneau enregistré par vous — l’artisan peut encore le modifier.");
  assert.equal(by(CLIENT, false), "Créneau enregistré par vous.");
  for (const unknown of [undefined, null, "", "10000000-0000-4000-8000-000000000009"]) assert.equal(by(unknown), null);
  assert.equal(appointmentOrigin({ updatedBy: ARTISAN, viewerId: CLIENT, artisanId: null, editable: true }), null);
  for (const text of [by(ARTISAN), by(ARTISAN, false), by(CLIENT), by(CLIENT, false)]) assert.doesNotMatch(text ?? "", /confirm/i);
});
