// Phase 2 lot B (suite R01) — profils réels en démonstration : chaque panneau de compte est monté une
// seule fois (aucune collision de clé React entre panneaux frères : données du compte, adresses,
// moyens de paiement, abonnements). Vraie app (démo, aucun /api), Chromium 360 et 1280 px.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("profils client et artisan démo : chaque panneau de compte monté une seule fois", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-profile", "artisan-profile"])
      for (const width of [360, 1280]) {
        const { page, errors, api } = await open(route, width);
        await page.waitForTimeout(1200);
        const where = `${route} ${width}px`;
        const counts = (await page.evaluate(`({
          data: document.querySelectorAll('[data-account-data]').length,
          addresses: document.querySelectorAll('[data-client-addresses]').length,
          methods: document.querySelectorAll('[data-saved-methods]').length,
          subscriptions: document.querySelectorAll('[data-subscriptions]').length,
        })`)) as Record<string, number>;
        assert.equal(counts.data, 1, `${where} données du compte ${JSON.stringify(counts)}`);
        assert.ok(counts.subscriptions <= 1, `${where} abonnements ${JSON.stringify(counts)}`);
        if (route === "client-profile") {
          assert.ok(counts.addresses <= 1 && counts.methods <= 1, `${where} ${JSON.stringify(counts)}`);
        }
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
