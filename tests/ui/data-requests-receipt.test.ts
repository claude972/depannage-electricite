// SYS-07: the erasure POST reply now adds `request` (Astra c0df158 / 0ebab8f). The existing receipt
// must keep working: without request ⇒ ok; valid request ⇒ ok and kept; invalid request ⇒ ignored
// (receipt kept); any other unknown key ⇒ still refused (strict).
import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/account-data/model";

const m = loadModule("components/features/account-data/model.ts") as unknown as typeof Model;
const T = "70000000-0000-4000-8000-000000000900";
const R = "70000000-0000-4000-8000-000000000901";
const base = { ticket_id: T, status: "open", replayed: false };
const request = { id: R, ticket_id: T, state: "requested", execution_state: "not_started", version: 1, created_at: "2026-11-07T21:00:00Z", updated_at: "2026-11-07T21:00:00Z" };

test("reçu sans `request` ⇒ accepté (inchangé)", () => {
  assert.equal(JSON.stringify(m.parseReceipt(base)), JSON.stringify(base));
});
test("reçu avec `request` valide ⇒ accepté, demande conservée", () => {
  const r = m.parseReceipt({ ...base, request })!;
  assert.equal(r.ticket_id, T);
  assert.equal(r.request!.state, "requested");
  assert.equal(r.request!.execution_state, "not_started");
});
test("`request` invalide ⇒ ignoré, reçu conservé", () => {
  for (const bad of [{ ...request, execution_state: "done" }, { ...request, version: 0 }, { ...request, version: 101 }, { ...request, extra: 1 }, { ...request, ticket_id: R }, "x", null]) {
    const r = m.parseReceipt({ ...base, request: bad });
    assert.ok(r, JSON.stringify(bad));
    assert.equal(r!.ticket_id, T);
    assert.equal(r!.request, undefined);
  }
});
test("autre clé inconnue ⇒ toujours refusé", () => {
  assert.equal(m.parseReceipt({ ...base, request, surprise: true }), null);
  assert.equal(m.parseReceipt({ ...base, status: "deleted" }), null);
});
