// ADM-08 settings: the stale « Territoire couvert : À définir par l’exploitant » entry is gone now
// that the published postal coverage editor (PUB-03) lives on the same screen; the editor remains.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withApp, skip } from "./real-app-harness";

test("source : plus d’entrée « Territoire couvert » à définir ; l’éditeur de zone reste monté", () => {
  const src = readFileSync("components/role/admin-space.tsx", "utf8");
  assert.doesNotMatch(src, /"Territoire couvert"/);
  assert.match(src, /\["Taux de commission", "TVA par défaut", "Barème public"\]/);
  assert.match(src, /<CoverageEditor key=/);
});

test("app réelle : Paramètres admin (démo) — éditeur de zone présent, aucune mention « Territoire couvert »", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-admin-settings", 390);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('[data-coverage-editor="demo"]').count(), 1);
    assert.doesNotMatch(await page.locator("main").innerText(), /Territoire couvert/);
    assert.match(await page.locator("main").innerText(), /Taux de commission/);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
