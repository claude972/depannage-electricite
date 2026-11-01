import { test } from "node:test";
import assert from "node:assert/strict";
import { createServiceClient } from "../lib/supabase.mjs";
import { createRedactor } from "../lib/redact.mjs";
import { emptyManifest, runCleanup } from "../lib/cleanup.mjs";

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UID = id(1), OTHER = id(2), WHEN = "2026-11-01T00:00:00.123456Z";
const absent = { code: 404, error_code: "user_not_found", msg: "User not found" };
const file = (n) => ({ name: `file-${String(n).padStart(5, "0")}`, id: id(n + 10), created_at: WHEN, updated_at: WHEN, last_accessed_at: WHEN, metadata: { size: 1, mimetype: "image/jpeg" } });
const folder = (name) => ({ name, id: null, created_at: null, updated_at: null, last_accessed_at: null, metadata: null });
async function withFetch(fetchFn, run) {
  const saved = globalThis.fetch;
  globalThis.fetch = fetchFn;
  const db = createServiceClient({ url: "https://qa.example.test", serviceKey: "test-service-key-only", redactor: createRedactor(["test-service-key-only"]), timeoutMs: 10000 });
  try { return await run(db); } finally { globalThis.fetch = saved; }
}
const reply = (body, status = 200) => Response.json(body, { status });

test("Auth200 proves only the exact requested UUID and an email; only the exact legacy404 proves absence", async () => {
  await withFetch(async (_url, init) => { assert.equal(init.method, "GET"); return reply({ id: UID, email: "qa@test.invalid" }); }, async db => assert.equal(await db.authUserExists(UID), true));
  await withFetch(async () => reply(absent, 404), async db => assert.equal(await db.authUserExists(UID), false));
});
test("Auth malformed/wrong identity/other404/transport are UNKNOWN, never false absence", async () => {
  for (const [status, body] of [
    [200, null], [200, {}], [200, []], [200, { id: OTHER, email: "qa@test.invalid" }], [200, { id: UID }], [200, { id: UID, email: null }],
    [404, {}], [404, { error: "Not found" }], [404, { ...absent, extra: true }], [404, { ...absent, msg: "" }], [404, { ...absent, error_code: "other" }], [503, absent],
  ]) await withFetch(async () => reply(body, status), async db => assert.rejects(db.authUserExists(UID), /UNKNOWN/));
  for (const status of [200, 404]) await withFetch(async () => new Response("not JSON", { status }), async db => assert.rejects(db.authUserExists(UID), /UNKNOWN/));
  await withFetch(async () => { throw new Error("test-service-key-only private error"); }, async db => assert.rejects(db.authUserExists(UID), e => /UNKNOWN/.test(e.message) && !e.message.includes("test-service-key-only")));
  await withFetch(async () => { throw new Error("must not fetch invalid id"); }, async db => assert.rejects(db.authUserExists("broken"), /UNKNOWN invalid requested id/));
});
test("Storage returns[] only for a valid empty200 page; errors/malformed rows are UNKNOWN", async () => {
  await withFetch(async () => reply([]), async db => assert.deepEqual(await db.storageList("intervention-documents", UID), []));
  for (const status of [400, 401, 403, 404, 500]) await withFetch(async () => reply([], status), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN/));
  for (const body of [{}, null, [null], ["row"], [{}], [{ id: id(3) }], [{ name: "x", id: "not-uuid" }], [{ ...file(1), metadata: [] }], [{ ...file(1), created_at: null }], [{ ...folder("x"), updated_at: "bad" }], [{ ...file(1), name: "../file" }]])
    await withFetch(async () => reply(body), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN/));
  await withFetch(async () => new Response("not JSON"), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN/));
  await withFetch(async () => { throw new Error("test-service-key-only private error"); }, async db => assert.rejects(db.storageList("intervention-documents", UID), e => /UNKNOWN/.test(e.message) && !e.message.includes("test-service-key-only")));
});
test("Storage reads beyond1000, includes proven folders, and requires a terminal empty page", async () => {
  const rows = [...Array.from({ length: 1000 }, (_, n) => file(n)), folder("nested"), file(1001)], offsets = [];
  await withFetch(async (_url, init) => {
    assert.equal(init.method, "POST"); const args = JSON.parse(init.body); offsets.push(args.offset);
    assert.deepEqual(args.sortBy, { column: "name", order: "asc" }); assert.equal(args.prefix, UID); assert.equal(args.limit, 1000);
    return reply(rows.slice(args.offset, args.offset + 1000));
  }, async db => { const listed = await db.storageList("intervention-documents", UID); assert.equal(listed.length, 1002); assert.equal(listed[1000].id, null); });
  assert.deepEqual(offsets, [0, 1000, 1002]);
});
test("a short provider page is not assumed exhaustive, and a later error never returns a partial list", async () => {
  const rows = Array.from({ length: 5 }, (_, n) => file(n)); const offsets = [];
  await withFetch(async (_url, init) => { const { offset } = JSON.parse(init.body); offsets.push(offset); return reply(rows.slice(offset, offset + 2)); }, async db => assert.equal((await db.storageList("intervention-documents", UID)).length, 5));
  assert.deepEqual(offsets, [0, 2, 4, 5]);
  let reads = 0;
  await withFetch(async () => ++reads === 1 ? reply([file(1)]) : reply({}, 503), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN/));
});
test("repeated names, overfull pages and missing exhaustion within50 pages stay UNKNOWN", async () => {
  await withFetch(async () => reply([file(1)]), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN.*repeated/));
  await withFetch(async () => reply([file(1), { ...file(2), id: file(1).id }]), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN.*repeated object id/));
  await withFetch(async () => reply(Array.from({ length: 1001 }, (_, n) => file(n))), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN/));
  let reads = 0;
  await withFetch(async () => reply([file(reads++)]), async db => assert.rejects(db.storageList("intervention-documents", UID), /UNKNOWN.*50 pages/));
  assert.equal(reads, 50);
});
test("cleanup remains incomplete for unknown Auth/Storage reads and counts folder evidence instead of dropping it", async () => {
  const manifest = emptyManifest(); manifest.created.storage_paths = [`${UID}/target`]; manifest.created.auth_users = [UID];
  await withFetch(async url => url.includes("/storage/") ? reply({}, 404) : reply({ error: "generic404" }, 404), async db => {
    // The two real read methods are exercised; no real or mocked HTTP write is emitted.
    const safeDb = { ...db, async storageRemove() {}, async deleteAuthUser() {} };
    const result = await runCleanup(safeDb, manifest);
    assert.equal(result.ok, false); assert.equal(result.steps.length, 2);
    assert.ok(result.steps.every(step => step.status === "fail" && step.remaining === null));
  });
  let page = 0;
  await withFetch(async () => reply(page++ ? [] : [folder("target")]), async db => {
    const storageOnly = emptyManifest(); storageOnly.created.storage_paths = [`${UID}/target`];
    const result = await runCleanup({ ...db, async storageRemove() {} }, storageOnly);
    assert.equal(result.ok, false); assert.equal(result.steps[0].remaining, 1);
  });
});
