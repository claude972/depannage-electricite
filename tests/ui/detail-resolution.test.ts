import test from "node:test";
import assert from "node:assert/strict";
import { DetailAttemptMemory, decideDetail, detailAttemptKey } from "../../components/app/detail-resolution";

test("decision: present ⇒ show, whatever the attempt", () => {
  assert.equal(decideDetail({ present: true, live: true, attempt: { state: "failed", status: 503 } }), "show");
  assert.equal(decideDetail({ present: true, live: false, attempt: undefined }), "show");
});

test("decision: absent in demo ⇒ not_found without any refresh", () => {
  assert.equal(decideDetail({ present: false, live: false, attempt: undefined }), "not_found");
});

test("decision: absent in live — refresh, then loading, then not_found ONLY after a loaded read", () => {
  assert.equal(decideDetail({ present: false, live: true, attempt: undefined }), "refresh");
  assert.equal(decideDetail({ present: false, live: true, attempt: { state: "pending" } }), "loading");
  assert.equal(decideDetail({ present: false, live: true, attempt: { state: "loaded" } }), "not_found");
});

test("decision: a failed refresh (503 / transport) is an error, never not_found", () => {
  assert.equal(decideDetail({ present: false, live: true, attempt: { state: "failed", status: 503 } }), "error");
  assert.equal(decideDetail({ present: false, live: true, attempt: { state: "failed", status: 0 } }), "error");
});

test("memory: one attempt per (context, view, id); re-renders of the same id find the same attempt", () => {
  const m = new DetailAttemptMemory(4);
  m.useContext("g1|client||");
  const k = detailAttemptKey("g1|client||", "client-detail", "a");
  m.set(k, { state: "pending" });
  m.useContext("g1|client||"); // same context: kept
  assert.deepEqual(m.get(k), { state: "pending" });
  assert.notEqual(detailAttemptKey("g1|client||", "artisan-mission", "a"), k, "views do not share attempts");
});

test("memory: a context change (identity, role, organisation, site) clears every attempt", () => {
  const m = new DetailAttemptMemory(4);
  m.useContext("g1|manager|o1|s1");
  m.set(detailAttemptKey("g1|manager|o1|s1", "enterprise-dossier", "a"), { state: "loaded" });
  m.useContext("g1|manager|o1|s2");
  assert.equal(m.size, 0);
});

test("memory: bounded LRU — arbitrary ids never grow it past the limit, the oldest is evicted", () => {
  const m = new DetailAttemptMemory(3);
  m.useContext("c");
  for (const id of ["a", "b", "c"]) m.set(detailAttemptKey("c", "v", id), { state: "loaded" });
  m.get(detailAttemptKey("c", "v", "a"));
  m.set(detailAttemptKey("c", "v", "a"), { state: "loaded" }); // refresh "a" as most recent
  m.set(detailAttemptKey("c", "v", "d"), { state: "loaded" });
  assert.equal(m.size, 3);
  assert.equal(m.get(detailAttemptKey("c", "v", "b")), undefined, "least recent evicted");
  assert.ok(m.get(detailAttemptKey("c", "v", "a")));
  for (let i = 0; i < 100; i++) m.set(detailAttemptKey("c", "v", `x${i}`), { state: "pending" });
  assert.equal(m.size, 3);
});
