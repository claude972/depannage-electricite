import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("devis et avenant ouverts : à 320 px le tableau reste consultable au clavier sans élargir la page", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-quote.quote-demo-4", "artisan-detail.demo-004"]) {
      const { page, errors, api } = await open(route, 320);
      await page.getByText("Voir les prestations de l’avenant", { exact: true }).first().click();
      const region = page.locator('details[open] [role="region"]').last();
      assert.equal(await region.getAttribute("tabindex"), "0");
      assert.ok(await region.getAttribute("aria-label"));
      assert.ok(await region.evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth));
      await region.focus();
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(250);
      assert.ok(await region.evaluate((el: HTMLElement) => el.scrollLeft > 0), "table accessible au clavier");
      for (const width of [320, 360, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route}, ${width}: aucun débordement de page`);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(api, []);
      await page.context().close();
    }
  });
});
