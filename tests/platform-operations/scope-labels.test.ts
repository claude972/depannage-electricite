import test from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_SCOPES, type OperatorGrant } from "../../lib/features/platform-operations/types";
import { SCOPE_DESCRIPTIONS, SCOPE_FAMILIES, SCOPE_LABELS, WRITE_SCOPES_REQUIRING_READ, writeScopeWithoutRead } from "../../lib/features/platform-operations/scope-labels";
test("every platform scope, including the three support scopes, has a French label, a description and a family", () => {
  assert.equal(PLATFORM_SCOPES.length, 7);
  for (const scope of PLATFORM_SCOPES) {
    assert.ok(SCOPE_LABELS[scope].length > 3, scope); assert.ok(SCOPE_DESCRIPTIONS[scope].length > 20, scope); assert.ok(SCOPE_FAMILIES[scope], scope);
    assert.doesNotMatch(SCOPE_LABELS[scope] + SCOPE_DESCRIPTIONS[scope], /platform_|\/api\/|rpc|rls/i);
  }
  assert.equal(SCOPE_LABELS.support_read, "Assistance — lecture de la file");
  assert.equal(SCOPE_LABELS.support_reply, "Assistance — réponse");
  assert.equal(SCOPE_LABELS.support_status, "Assistance — changement de statut");
  assert.equal(new Set(Object.values(SCOPE_LABELS)).size, 7);
  assert.deepEqual(WRITE_SCOPES_REQUIRING_READ, { support_reply: "support_read", support_status: "support_read" });
});
test("the write-without-read warning derives only from active listed grants of that account", () => {
  const grant = (user_id: string, scope: OperatorGrant["scope"], status: OperatorGrant["status"] = "active") => ({ user_id, scope, status });
  const u = "0a1b2c3d-0000-4000-8000-000000000001", other = "0a1b2c3d-0000-4000-8000-000000000002";
  assert.equal(writeScopeWithoutRead([], u, "support_reply"), true);
  assert.equal(writeScopeWithoutRead([grant(u, "support_read", "revoked")], u, "support_status"), true);
  assert.equal(writeScopeWithoutRead([grant(other, "support_read")], u, "support_reply"), true);
  assert.equal(writeScopeWithoutRead([grant(u, "support_read")], u.toUpperCase(), "support_reply"), false);
  assert.equal(writeScopeWithoutRead([], u, "support_read"), false);
  assert.equal(writeScopeWithoutRead([], u, "finance_write"), false);
});
