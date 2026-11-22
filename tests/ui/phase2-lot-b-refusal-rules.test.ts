// Phase 2 lot B — shared P1 refusal rules (components/app/refusal.ts): one classification for every
// panel, and every corrected panel model goes through it (no local 401/403/404 copies).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterWriteRefusal, classifyRefusal, readRefused } from "../../components/app/refusal";

test("classification commune des refus", () => {
  assert.equal(classifyRefusal(200), null);
  assert.equal(classifyRefusal(201), null);
  assert.equal(classifyRefusal(401), "session");
  assert.equal(classifyRefusal(403), "access");
  assert.equal(classifyRefusal(404), "access");
  assert.equal(classifyRefusal(409), "conflict");
  for (const s of [400, 422, 429]) assert.equal(classifyRefusal(s), "invalid");
  for (const s of [0, -1, 500, 502, 503]) assert.equal(classifyRefusal(s), "transient");
  for (const s of [401, 403, 404]) assert.equal(readRefused(s), true);
  for (const s of [200, 409, 422, 503, 0]) assert.equal(readRefused(s), false);
  assert.deepEqual(afterWriteRefusal(401), { purge: true, reread: false });
  assert.deepEqual(afterWriteRefusal(403), { purge: false, reread: true });
  assert.deepEqual(afterWriteRefusal(404), { purge: false, reread: true });
  for (const s of [200, 409, 422, 503, 0]) assert.deepEqual(afterWriteRefusal(s), { purge: false, reread: false });
});

test("les panneaux corrigés passent par les règles communes", () => {
  const files = [
    "components/features/refund-execution/refund-execution-model.ts",
    "components/features/energy/energy-model.ts",
    "components/features/co-ownership/coownership-model.ts",
    "components/features/customer-invoices/invoices-model.ts",
    "components/features/saved-payment-methods/model.ts",
    "components/features/credential-reviews/credential-reviews-model.ts",
    "components/features/site-attachments/site-attachments-panel.tsx",
  ];
  for (const f of files) assert.match(readFileSync(f, "utf8"), /from "\.\.\/\.\.\/app\/refusal"/, f);
});
