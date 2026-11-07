// Phase 8 (enterprise + admin, real app in demo, Chromium): one test per reproduced finding.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("admin « Devis & Factures » : le lien vers Finance plateforme est une cible ≥ 44 px (360 et 1280)", { skip }, async () => {
  await withApp(async (open) => {
    for (const w of [360, 1280]) {
      const { page, errors, api } = await open("admin", w);
      await page.evaluate(() => { location.hash = "#admin-quotes"; });
      await page.waitForTimeout(800);
      const h = await page.evaluate(`(() => { const l = [...document.querySelectorAll("main a")].find((x) => /Factures, avoirs et registre/.test(x.textContent)); return l ? l.getBoundingClientRect().height : -1; })()`) as number;
      assert.ok(h >= 44, `${w}px: link height ${h}`);
      assert.deepEqual(api, []);
      assert.deepEqual(errors, []);
    }
  });
});

test("entreprise : un lien #quote/<id du devis> ouvre le dossier de ce devis (jamais « introuvable »)", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("manager", 1280);
    await page.evaluate(() => { location.hash = "#quote/quote-demo-1"; });
    await page.waitForTimeout(900);
    const text = await page.locator("main").innerText();
    assert.doesNotMatch(text, /Dossier introuvable sur ce périmètre/);
    assert.match(text, /INT-DEMO-001/, "the dossier of quote-demo-1 (demo-001)");
    // A dossier id still works as before on #quote/<id>, and an unknown id stays honest.
    await page.evaluate(() => { location.hash = "#quote/demo-001"; });
    await page.waitForTimeout(700);
    assert.match(await page.locator("main").innerText(), /INT-DEMO-001/);
    await page.evaluate(() => { location.hash = "#quote/inconnu-42"; });
    await page.waitForTimeout(700);
    assert.match(await page.locator("main").innerText(), /introuvable|absent/i);
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
