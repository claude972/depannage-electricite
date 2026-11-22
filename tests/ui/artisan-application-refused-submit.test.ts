// ADM-02 — after a definitive refusal (status stays "changes_requested", decisions API says
// refused: true) the application form must not offer "Soumettre ma candidature": the server answers
// 409 until the operator reopens. The decisions notice reports the flag; the form disables submission.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const notice = readFileSync("components/features/credential-reviews/application-decisions-notice.tsx", "utf8");
const space = readFileSync("components/role/artisan-space.tsx", "utf8");

test("the decisions notice forwards the server's refused flag", () => {
  assert.match(notice, /onRefusedChange\?: \(refused: boolean\) => void/);
  assert.match(notice, /onRefusedChange\?\.\(body\.refused === true\)/);
});

test("the application form cannot submit while refused and says why", () => {
  assert.match(space, /const canSubmit = \(status === "draft" \|\| status === "changes_requested"\) && !refused;/);
  assert.match(space, /onRefusedChange=\{setRefused\}/);
  assert.match(space, /Candidature refusée par l’exploitant : elle ne peut pas être soumise à nouveau tant qu’il ne l’a pas rouverte\./);
});
