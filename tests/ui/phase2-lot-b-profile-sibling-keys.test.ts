// Profils réels en démonstration : le profil client affiche ses adresses et demandes.
// Les panneaux de compte sont montés une seule fois dans les paramètres client ou le profil artisan.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("profils client et artisan démo : chaque panneau de compte monté une seule fois", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-profile", "artisan-profile"])
      for (const width of [360, 1280]) {
        const { page, errors, api } = await open(route, width);
        if (route === "client-profile") {
          await page.getByRole("heading", { name: "Mon profil", exact: true }).waitFor();
          assert.equal(await page.locator("[data-client-addresses]").count(), 1);
          assert.equal(await page.locator("[data-profile-requests]").count(), 2);
          assert.equal(await page.locator("[data-account-data],[data-saved-methods],[data-subscriptions]").count(), 0);
          await page.getByRole("button", { name: "Paramètres du compte" }).click();
        }
        await page.locator("[data-account-data]").waitFor();
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
