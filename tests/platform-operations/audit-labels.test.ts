import assert from "node:assert/strict";
import test from "node:test";
import { auditActionLabel, isSensitiveAction } from "../../lib/features/platform-operations/audit-labels";

test("FIN-06: a settlement entry that could not be written is named in the journal and filtered as sensitive", () => {
  assert.deepEqual(auditActionLabel("settlement_entry_failed"), { label: "Écriture de règlement non enregistrée (à rapprocher)", code: "settlement_entry_failed", known: true });
  assert.equal(isSensitiveAction("settlement_entry_failed"), true);
  assert.equal(auditActionLabel("reconciliation_run").known, true);
});
