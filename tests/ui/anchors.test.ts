import test from "node:test";
import assert from "node:assert/strict";
import { anchorEntryVisible, leafScope } from "../../components/role/anchors";

test("entrée d’ancrage : jamais visible sans accès du rôle, quelle que soit la capacité", () => {
  for (const state of ["unknown", "available", "missing", "unavailable"] as const) {
    assert.equal(anchorEntryVisible(false, state), false);
    assert.equal(anchorEntryVisible(false, state, true), false);
  }
});

test("entrée d’ancrage : visible si disponible ou en vérification ; sinon seulement vers l’état honnête", () => {
  assert.equal(anchorEntryVisible(true, "available"), true);
  assert.equal(anchorEntryVisible(true, "unknown"), true);
  assert.equal(anchorEntryVisible(true, "missing", true), true);
  assert.equal(anchorEntryVisible(true, "unavailable", true), true);
  assert.equal(anchorEntryVisible(true, "missing", false), false);
  assert.equal(anchorEntryVisible(true, "unavailable", false), false);
});

test("portée de feuille : identité et contexte réaffichés, raison de lecture seule conservée", () => {
  assert.deepEqual(leafScope("u1", "artisan", { canWrite: true }), {
    userId: "u1",
    role: "artisan",
    authority: { canWrite: true },
  });
  assert.deepEqual(
    leafScope("u2", "manager", { canWrite: false, reason: "Lecture seule sur ce site." }, { organizationId: "org", siteId: "s1" }),
    { userId: "u2", role: "manager", organizationId: "org", siteId: "s1", authority: { canWrite: false, reason: "Lecture seule sur ce site." } },
  );
  // Contexte vide : aucune clé organisation/site n’est inventée.
  assert.deepEqual(Object.keys(leafScope("u3", "client", { canWrite: true }, {})), ["userId", "role", "authority"]);
});
