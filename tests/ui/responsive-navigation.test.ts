import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip, openAccountSettings } from "./real-app-harness";

test("rapports entreprise : colonnes consultables au clavier sur téléphone et tablette", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors } = await open("manager-reports", 320);
    const report = page.locator("[data-report]");
    assert.equal(await report.getAttribute("tabindex"), "0");
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const overflow = await report.evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth);
      if (overflow) {
        await report.focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(250);
        assert.ok(await report.evaluate((el: HTMLElement) => el.scrollLeft > 0));
      }
    }
    assert.deepEqual(errors, []);
  });
});

test("menus et paramètres des quatre rôles : utilisables à 320 px et en paysage tablette", { skip }, async () => {
  await withApp(async (open) => {
    for (const role of ["client", "artisan", "manager", "admin"]) {
      for (const width of [320, 768]) {
        const { page, errors } = await open(`${role}-profile`, width);
        await page.setViewportSize({ width, height: 500 });
        await page.getByRole("button", { name: "Ouvrir le menu", exact: true }).click();
        await page.waitForTimeout(300);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role}/${width}: page`);
        const dialogs = role === "manager" ? page.locator("aside").filter({ has: page.getByRole("navigation", { name: "Navigation de l’espace entreprise" }) }) : role === "admin" ? page.locator("#admin-sidebar") : page.getByRole("dialog");
        assert.ok(await dialogs.count(), `${role}/${width}: menu ouvert`);
        const bounds = await dialogs.last().boundingBox();
        assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${role}/${width}: modale contenue`);
        await page.keyboard.press("Escape");
        if (role === "client") {
          await openAccountSettings(page);
          await page.getByRole("heading", { name: "Paramètres du compte", exact: true }).waitFor();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        }
        assert.deepEqual(errors, []);
        await page.context().close();
      }
    }
  });
});


test("avis client : les cinq notes restent visibles et sélectionnables à 320 px", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client-detail.demo-003", 320);
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("courant-demo-v3")!);
      saved.data.reviews = [];
      localStorage.setItem("courant-demo-v3", JSON.stringify(saved));
      history.replaceState(null, "", "#demo/client-detail.demo-003");
    });
    await page.reload();
    await page.getByRole("group", { name: "Votre note sur cinq" }).waitFor();
    for (const width of [320, 360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const options = page.locator(".rating-options label");
      assert.equal(await options.count(), 5);
      for (let i = 0; i < 5; i++) {
        const b = await options.nth(i).boundingBox();
        assert.ok(b && b.x >= 0 && b.x + b.width <= width && b.width >= 44 && b.height >= 44);
        await options.nth(i).click();
        assert.ok(await options.nth(i).locator("input").isChecked());
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(api, []);
  });
});
