import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Fixtures, guardWrites } from "../lib/fixtures.mjs";
import { createStopGate, StopRequestedError } from "../lib/lifecycle.mjs";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const cohort = { runId: "abc123abc123", email: (l) => `qa-${l}@qa.invalid`, fullName: (l) => `QA ${l}`, name: (l) => `QA ${l}`, description: (d) => `QA-${d}` };
const redactor = { add() {} };

/** Fake service client recording every call; `insert` returns rows with server-generated ids. */
function fakeDb({ approvalsByQuote = {}, hooks = {} } = {}) {
  const calls = [];
  let seq = 100;
  return {
    calls,
    async select(table, filters, columns) {
      calls.push(["select", table, filters, columns]);
      if (table === "approvals") {
        const quoteId = String(filters.quote_id || "").replace(/^eq\./, "");
        return approvalsByQuote[quoteId] ? [approvalsByQuote[quoteId]] : [];
      }
      return [];
    },
    async insert(table, rows) {
      calls.push(["insert", table, rows]);
      await hooks.beforeInsertResolves?.(table);
      return rows.map((r) => ({ id: uuid(++seq), ...r }));
    },
    async upsert(table, rows) {
      calls.push(["upsert", table, rows]);
      return rows;
    },
    async update(table, filters, patch) {
      calls.push(["update", table, filters, patch]);
      return [{ id: String(filters.id || "").replace(/^eq\./, ""), ...patch }];
    },
    async delete(table, filters) {
      calls.push(["delete", table, filters]);
    },
    async createAuthUser() {
      calls.push(["createAuthUser"]);
      return uuid(++seq);
    },
  };
}

async function withFixtures(db, gate, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "qa-fixtures-test-"));
  try {
    const fixtures = new Fixtures({ db, cohort, manifestPath: path.join(dir, "manifest.json"), context: { sha: "x" }, redactor, gate });
    const manifest = async () => JSON.parse(await readFile(fixtures.manifestPath, "utf8"));
    return await fn(fixtures, manifest);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ensureApproval reuses the approval the DB trigger already queued (UNIQUE quote_id) and tracks it", async () => {
  const quote = { id: uuid(1), total_cents: 12000 };
  const site = { id: uuid(2) };
  const trigger = { id: uuid(3), quote_id: quote.id, site_id: site.id, status: "pending", decided_by: null, note: "" };
  const db = fakeDb({ approvalsByQuote: { [quote.id]: trigger } });
  await withFixtures(db, createStopGate(), async (fixtures, manifest) => {
    const approval = await fixtures.ensureApproval({ quote, site });
    assert.equal(approval.id, trigger.id);
    assert.equal(approval.status, "pending");
    assert.equal(approval.origin, "trigger");
    assert.equal(db.calls.filter((c) => c[0] === "insert" && c[1] === "approvals").length, 0, "re-inserting the quote_id would violate the UNIQUE constraint (23505)");
    assert.deepEqual((await manifest()).created.approvals, [trigger.id]);
  });
});

test("ensureApproval inserts a pending approval only when the trigger created none, and tracks it", async () => {
  const quote = { id: uuid(4), total_cents: 12000 };
  const site = { id: uuid(5) };
  const db = fakeDb();
  await withFixtures(db, createStopGate(), async (fixtures, manifest) => {
    const approval = await fixtures.ensureApproval({ quote, site });
    assert.equal(approval.origin, "inserted");
    const inserts = db.calls.filter((c) => c[0] === "insert" && c[1] === "approvals");
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0][2], [{ quote_id: quote.id, site_id: site.id, status: "pending" }]);
    assert.deepEqual((await manifest()).created.approvals, [approval.id]);
  });
});

test("ensureApproval resets a trigger row that is no longer pending and refuses a row queued on another site", async () => {
  const quote = { id: uuid(6) };
  const site = { id: uuid(7) };
  const decided = { id: uuid(8), quote_id: quote.id, site_id: site.id, status: "approved", decided_by: uuid(9), note: "x" };
  const db = fakeDb({ approvalsByQuote: { [quote.id]: decided } });
  await withFixtures(db, createStopGate(), async (fixtures) => {
    const approval = await fixtures.ensureApproval({ quote, site });
    assert.equal(approval.status, "pending");
    assert.match(approval.origin, /reset to pending/);
    assert.equal(db.calls.filter((c) => c[0] === "insert").length, 0);
  });
  const elsewhere = fakeDb({ approvalsByQuote: { [quote.id]: { ...decided, site_id: uuid(10) } } });
  await withFixtures(elsewhere, createStopGate(), async (fixtures) => {
    await assert.rejects(fixtures.ensureApproval({ quote, site }), /queued quote .* on site/);
  });
});

test("guardWrites refuses every write after the stop signal, reads stay allowed", async () => {
  const gate = createStopGate();
  const db = fakeDb();
  const guarded = guardWrites(db, gate);
  await guarded.insert("sites", [{ name: "before" }]);
  gate.stop("fatal:test");
  await assert.rejects(guarded.insert("sites", [{ name: "after" }]), StopRequestedError);
  await assert.rejects(guarded.upsert("x", []), StopRequestedError);
  await assert.rejects(guarded.update("x", { id: "eq.1" }, {}), StopRequestedError);
  await assert.rejects(guarded.createAuthUser({}), StopRequestedError);
  assert.deepEqual(await guarded.select("documents", {}), []);
  assert.equal(db.calls.filter((c) => c[0] === "insert").length, 1, "the refused insert never reached the client");
});

test("a creation helper refuses to start once the run is stopping (no insert issued)", async () => {
  const gate = createStopGate();
  const db = fakeDb();
  await withFixtures(db, gate, async (fixtures, manifest) => {
    const owner = await fixtures.createUser("owner", "manager");
    gate.stop("fatal:unhandledRejection");
    await assert.rejects(fixtures.createOrganization(owner, "Org"), StopRequestedError);
    await assert.rejects(fixtures.createIntervention({ client: owner }), StopRequestedError);
    assert.equal(db.calls.filter((c) => c[0] === "insert").length, 0);
    const m = await manifest();
    assert.deepEqual(m.created.auth_users, [owner.id]);
    assert.deepEqual(m.created.interventions, []);
    assert.equal(gate.pending, 0);
  });
});

test("a creation in flight when the signal is raised still records its id in the manifest before the drain completes", async () => {
  const gate = createStopGate();
  let release;
  const gateInsert = new Promise((resolve) => (release = resolve));
  const db = fakeDb({ hooks: { beforeInsertResolves: (table) => (table === "sites" ? gateInsert : null) } });
  await withFixtures(db, gate, async (fixtures, manifest) => {
    await fixtures.init(); // manifest already on disk: the insert is sent before the signal (durability contract)
    const org = { id: uuid(11) };
    const pending = fixtures.createSite(org, "Site A"); // insert sent, response not yet received
    await new Promise((r) => setImmediate(r));
    assert.equal(gate.pending, 1);
    gate.stop("fatal:uncaughtException");
    assert.deepEqual(fixtures.manifest.created.sites, [], "the id is unknown until the insert answers (manifest file not yet written)");
    const draining = gate.drain(5000);
    release(); // the server answers after the signal
    const drain = await draining;
    assert.deepEqual(drain, { ...drain, pending: 0, settled: 1, timedOut: false });
    const site = await pending;
    assert.deepEqual((await manifest()).created.sites, [site.id], "created after the signal, still recorded for deletion");
    // A follow-up creation after the drain is refused.
    await assert.rejects(fixtures.createSite(org, "Site B"), StopRequestedError);
  });
});
