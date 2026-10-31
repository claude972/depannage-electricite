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

// ---- Back-office plateforme : fail-closed sur la réponse serveur ------------------------------
import { platformAuthority, platformEntries } from "../../components/role/anchors";
import type { PlatformAccess } from "../../lib/features/platform-operations/types";

const access = (over: Omit<Partial<PlatformAccess>, "capabilities"> & { capabilities?: Partial<PlatformAccess["capabilities"]> }): PlatformAccess => ({
  super_admin: false,
  scopes: [],
  super_admin_count: null,
  config: { commission: { setting_bps: null, setting_version: null, checkout_bps: null, aligned: null }, payment_provider: { configured: false, mode: null, live_enabled: false }, invoice_issuer: { configured: false } },
  ...over,
  capabilities: { operators: false, audit: false, finance: false, reviews_moderation: false, refund_execution: false, invoice_rendering: false, ...(over.capabilities ?? {}) },
});
const all = () => true;

test("entrées plateforme : aucune sans réponse serveur, même si le rôle est admis", () => {
  assert.deepEqual(platformEntries(null, all), []);
  assert.deepEqual(platformEntries(undefined, all), []);
});

test("entrées plateforme : super-admin voit les trois ; opérateur limité seulement sa capacité", () => {
  assert.deepEqual(platformEntries(access({ super_admin: true }), all).map((e) => e.view), ["platform-operators", "platform-finance", "platform-moderation"]);
  assert.deepEqual(platformEntries(access({ capabilities: { finance: true } }), all).map((e) => e.view), ["platform-finance"]);
  assert.deepEqual(platformEntries(access({ capabilities: { reviews_moderation: true } }), all).map((e) => e.view), ["platform-moderation"]);
});

test("entrées plateforme : le garde de rôle n’est jamais contourné par la capacité", () => {
  assert.deepEqual(platformEntries(access({ super_admin: true }), () => false), []);
  assert.deepEqual(platformEntries(access({ super_admin: true }), (v) => v === "platform-finance").map((e) => e.view), ["platform-finance"]);
});

test("autorité plateforme : écriture par super-admin ou capacité, sinon lecture avec raison", () => {
  assert.deepEqual(platformAuthority(access({ super_admin: true }), "platform-finance"), { canWrite: true });
  assert.deepEqual(platformAuthority(access({ capabilities: { finance: true } }), "platform-finance"), { canWrite: true });
  assert.equal(platformAuthority(access({ capabilities: { finance: true } }), "platform-operators").canWrite, false);
  assert.equal(platformAuthority(null, "platform-moderation").canWrite, false);
  assert.match(platformAuthority(null, "platform-moderation").reason ?? "", /non vérifiés/);
});
