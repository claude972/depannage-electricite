import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// ADM-02 — migration 20261122170000 makes the database refuse the resubmission of a refused
// application. The route keeps its early check and answers the same 409 when the database refuses.
const route = readFileSync(new URL("../app/api/artisan/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261122170000_artisan_refusal_guard.sql", import.meta.url), "utf8");

test("the route maps the database refusal to the same 409 as its own check", () => {
  const sqlMessage = /raise exception '([^']+)' using errcode='P0001'/.exec(migration)?.[1];
  assert.equal(sqlMessage, "Application refused by the operator");
  assert.ok(route.includes(`result.error?.code === "P0001" && result.error.message === "${sqlMessage}"`), "exact SQL message matched");
  assert.equal(route.split("throw new ApiError(409, APPLICATION_REFUSED)").length - 1, 2, "one message for both refusals");
  assert.match(route, /const APPLICATION_REFUSED = "Votre candidature a été refusée par l’exploitant : elle ne peut pas être soumise à nouveau\./);
});
