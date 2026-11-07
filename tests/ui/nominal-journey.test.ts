// Nominal client / artisan journeys through the REAL app (CourantApp, demo mode, no API) in a
// single-process Chromium, with the real globals.css. Each test pins one reproduced finding.
// Skipped — never passed — without local Playwright/Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("devis accepté avec avenant : le texte ne prétend plus que les avenants acceptés sont exclus du règlement", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-quote.quote-demo-4", "artisan-detail.demo-004"]) {
      const { page, errors } = await open(route);
      const text = await page.locator("main").innerText();
      // The demo amendment belongs to the quote actually shown (DEV-DEMO-4, 192 €), never a constant dossier.
      assert.match(text, /AV-1-DEV-DEMO-4/, `${route}: amendment panel rendered`);
      assert.doesNotMatch(text, /DEV-DEMO01|268,80/, `${route}: no other dossier`);
      // The platform checkout amount is the accepted quote PLUS its accepted amendments
      // (migration 20261107014010_platform_deferred_checkout.sql); saying otherwise is false.
      assert.doesNotMatch(text, /avenants acceptés ne sont pas encore reliés au paiement/, route);
      assert.match(text, /Le règlement sur la plateforme porte sur le devis accepté et ses avenants acceptés\./, route);
      assert.deepEqual(errors, []);
    }
  });
});

test("démo artisan, offres : clic sur une offre demo-* ⇒ résumé local ⇒ acceptation simulée ⇒ dossier de démo ; aucun appel API", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("artisan-missions");
    const p = page as unknown as {
      locator(s: string): { first(): { getAttribute(n: string): Promise<string | null>; click(): Promise<void>; waitFor(): Promise<void> }; count(): Promise<number>; innerText(): Promise<string> };
      evaluate(f: string): Promise<unknown>;
    };
    assert.ok((await p.locator("[data-available-offer]").count()) > 0, "demo offers listed");
    const id = await p.locator("[data-available-offer]").first().getAttribute("data-available-offer");
    assert.match(String(id), /^demo-/, "real demo ids are not UUIDs");
    await p.locator("[data-available-offer]").first().click();
    await p.locator('[data-available-point="ready"]').first().waitFor();
    const summary = await p.locator('[data-available-point="ready"]').innerText();
    assert.match(summary, /Distance\s*non calculée/);
    assert.match(summary, /\d{3}\*\*/, "masked postal code");
    await p.locator("[data-available-accept]").first().click();
    await page.waitForTimeout(800);
    const hash = String(await p.evaluate("location.hash"));
    assert.match(hash, new RegExp(`${String(id)}$`), `opened the accepted demo dossier (${hash})`);
    assert.deepEqual(api, [], "no API call in demo");
    assert.deepEqual(errors, []);
  });
});
