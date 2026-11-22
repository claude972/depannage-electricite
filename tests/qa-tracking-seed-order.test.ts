// @ts-nocheck — drives the untyped ESM harness through tsx.
// WEB-TRACKING-QA-006 amendment A9 — the authenticated unknown-UUID 404 preflight runs in a DEDICATED
// context closed in every path; no scenario session opens before the complete seed. T6/T9/T14/T16
// bodies are pinned to the harness root ran (integration), so their assertions are unchanged.
// LIVE-WORKSPACE-001 (stale workspace of a session opened before a dossier exists) stays a PRODUCT
// finding owned by the lead; this precondition does not close it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { setupCohort, PREFLIGHT_SESSION } from "../scripts/qa-tracking/scenarios.mjs";
import { PreflightError } from "../scripts/qa/lib/config.mjs";

function fakeCtx({ preflightStatus = 404, openFails = false } = {}) {
  const events = [];
  const user = (label, role) => ({ id: randomUUID(), label, role });
  const tf = {
    createUser: async (label, role) => (events.push(`user:${label}`), user(label, role)),
    createOrganization: async () => (events.push("org"), { id: randomUUID() }),
    addMember: async () => events.push("member"),
    createSite: async () => (events.push("site"), { id: randomUUID() }),
    setSiteScope: async () => events.push("scope"),
    createIntervention: async ({ description }) => (events.push(`job:${description}`), { id: randomUUID() }),
  };
  const ctx = {
    tf,
    log: () => {},
    session: async (label) => (events.push(`open:${label}`), { page: {} }),
    freshSession: async (label) => {
      events.push(`open:${label}`);
      if (openFails) throw new Error("login failed");
      return { page: {} };
    },
    closeSession: async (label) => events.push(`close:${label}`),
    api: { get: async () => (events.push("preflight-get"), { status: preflightStatus, cache: "private, no-store" }) },
  };
  return { ctx, events };
}

test("A9 — success: preflight in a dedicated context closed before the next account; no session during or after the seed", async () => {
  const { ctx, events } = fakeCtx();
  await setupCohort(ctx);
  assert.deepEqual(events.slice(0, 4), ["user:client", `open:${PREFLIGHT_SESSION}`, "preflight-get", `close:${PREFLIGHT_SESSION}`]);
  assert.equal(events[4], "user:artisan-a", "the dedicated context is closed before any other creation");
  const opens = events.filter((e) => e.startsWith("open:"));
  assert.deepEqual(opens, [`open:${PREFLIGHT_SESSION}`], "setup opens no scenario session (client included)");
  const firstJob = events.findIndex((e) => e.startsWith("job:"));
  assert.ok(firstJob > 0);
  assert.equal(events.slice(firstJob).filter((e) => e.startsWith("open:")).length, 0, "no session between the first dossier and the end of the seed");
  assert.equal(events.filter((e) => e.startsWith("job:")).length, 10);
});

test("A9 — refusal: a non-404 preflight still closes the dedicated context and creates nothing else", async () => {
  const { ctx, events } = fakeCtx({ preflightStatus: 200 });
  await assert.rejects(setupCohort(ctx), PreflightError);
  assert.deepEqual(events, ["user:client", `open:${PREFLIGHT_SESSION}`, "preflight-get", `close:${PREFLIGHT_SESSION}`]);
});

test("A9 — exception while opening: the dedicated context is still closed (try/finally)", async () => {
  const { ctx, events } = fakeCtx({ openFails: true });
  await assert.rejects(setupCohort(ctx), /login failed/);
  assert.deepEqual(events, ["user:client", `open:${PREFLIGHT_SESSION}`, `close:${PREFLIGHT_SESSION}`]);
});

test("A9 — T6/T9/T14/T16 bodies unchanged (pinned to the harness ROOT ran); no relogin added at a failure point", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../scripts/qa-tracking/scenarios.mjs"), "utf8");
  const pinned = {
    T6: "6ac7c3b01c4a7856db29a82d1163aa13159dcbb8940fcf8423517c1542e4672b",
    T9: "dbab3a6bac6128a900ac421a11567b423001841df9d67ddef864f4a61ed955b9",
    T14: "245cf503f8da1cdc628f21268693ddb391ca0a26054ce95f0b9b5bef2c2cf5be", // A10: precondition + no catch (tests/qa-tracking-t14.test.ts); was 3975d069… at the run-552 harness
    T16: "7ffd4e23592ce92b0f48c79dbc655e0d4c8d358a9bcfcb4fedcf51e0fc6bfef4",
  };
  for (const [name, hash] of Object.entries(pinned)) {
    const a = source.indexOf(`  async ${name}(ctx, s) {`);
    assert.ok(a > 0, name);
    const body = source.slice(a, source.indexOf("\n  },\n", a));
    assert.equal(createHash("sha256").update(body).digest("hex"), hash, `${name} body changed`);
  }
  const t6 = source.slice(source.indexOf("  async T6(ctx, s) {"), source.indexOf("  async T7(ctx, s) {"));
  assert.match(t6, /await expectVisible\(card\(client\.page\), `client card « \$\{UI\.clientCardTitle\} »`\);/);
  assert.match(t6, /getByText\(\/Position périmée\/\)/);
  assert.doesNotMatch(t6, /freshSession|reload\(|login\(/, "no relogin/reload inside T6");
});
