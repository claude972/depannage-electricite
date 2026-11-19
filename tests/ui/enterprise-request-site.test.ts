// Enterprise space: a new request always belongs to an organisation site (required, the header's
// active site preselected), so it never leaves the organisation's lists.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("entreprise : site obligatoire dans la demande, site actif présélectionné (390 px)", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors } = await open("manager", 390);
    await page.evaluate(() => { location.hash = "#new"; });
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /Prise ou interrupteur/ }).click();
    await page.getByRole("button", { name: "Continuer", exact: true }).first().click();
    await page.waitForTimeout(500);
    const site = page.getByLabel("Site professionnel", { exact: true });
    assert.equal(await site.getAttribute("required"), "", "site required");
    assert.equal(await site.locator("option").first().innerText(), "Choisir un site");
    assert.equal(await page.getByText("Adresse personnelle ou autre lieu").count(), 0);
    await site.selectOption("");
    await page.getByRole("button", { name: "Continuer", exact: true }).first().click();
    await page.getByText("Choisissez le site professionnel concerné par cette demande.", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await site.getAttribute("aria-invalid"), "true");
    assert.ok(await site.getAttribute("aria-describedby"), "error associated with site control");
    const validSite = await site.locator("option").nth(1).getAttribute("value");
    await site.selectOption(validSite!);
    assert.notEqual(await site.getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByText("Choisissez le site professionnel concerné par cette demande.", { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  });
});
