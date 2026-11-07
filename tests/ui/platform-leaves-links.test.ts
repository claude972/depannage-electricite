// Platform-operations leaves (finance, moderation, operators, support queue): every row that names
// a dossier / client account opens its exact target (dossier ⇒ #detail/<id> with the admin dossier
// view's own loading / not-found; account ⇒ #admin-clients/<id>); no dead link; real app demo admin,
// zero /api call, no page error.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withApp, skip, type Page } from "./real-app-harness";

const hash = (page: Page) => page.evaluate(() => location.hash) as Promise<string>;
async function clickAndExpect(page: Page, selector: string, attr: string, prefix: string) {
  const el = page.locator(selector).first();
  await el.waitFor();
  const target = await el.getAttribute(attr);
  assert.ok(target, `${selector} carries its target id`);
  await el.click();
  await page.waitForTimeout(700);
  assert.equal(await hash(page), `${prefix}${target}`, selector);
  return target!;
}

test("finance : facture et litige ouvrent le dossier exact (et pas une liste)", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-platform-finance");
    await page.getByRole("tab", { name: "Factures et avoirs" }).click();
    const id = await clickAndExpect(page, "[data-finance-open-dossier]", "data-finance-open-dossier", "#detail/");
    // The admin dossier view resolves it with its own point-read: an honest state, never a wrong page.
    await page.waitForTimeout(500);
    const shown = await page.locator("main").innerText();
    if (process.env.SHOW_TEXT) console.log("SHOWN", shown.slice(0, 400));
    assert.match(shown, /introuvable|indisponible|non chargé/i, "unknown dossier: honest state from the dossier view");
    assert.doesNotMatch(shown, new RegExp(`Dossier ${id.slice(0, 6)}.*Tableau électrique`));
    await page.evaluate(() => history.back());
    await page.waitForTimeout(700);
    await page.getByRole("tab", { name: "Litiges" }).click();
    await clickAndExpect(page, "[data-dispute-open-dossier]", "data-dispute-open-dossier", "#detail/");
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});

test("modération : l’auteur de l’avis ouvre sa fiche client ; le dossier ouvre le dossier exact", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-platform-moderation");
    await clickAndExpect(page, "[data-review-open-author]", "data-review-open-author", "#admin-clients/");
    await page.waitForTimeout(500);
    assert.match(await page.locator("main").innerText(), /Fiche client|indisponible|introuvable/i, "the client record (or its honest unavailable state) is shown");
    const { page: p2 } = await open("admin-platform-moderation");
    await clickAndExpect(p2, "[data-review-open-dossier]", "data-review-open-dossier", "#detail/");
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});

test("opérateurs : sans rôle serveur, le compte reste du texte ; file d’assistance chargée", { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("admin-platform-operators");
    // Demo grants carry no profile role: the account stays text (never a guessed record).
    await page.locator("table").first().waitFor();
    assert.equal(await page.locator("[data-grant-open-account]").count(), 0);
    const q = await open("admin-support-queue");
    await q.page.waitForTimeout(800);
    assert.match(await q.page.locator("main").innerText(), /assistance/i);
    assert.deepEqual([...api, ...q.api], []);
    assert.deepEqual([...errors, ...q.errors], []);
  });
});

test("câblage : le point d’ancrage mappe dossier, client et artisan vers leurs vues exactes", () => {
  const src = readFileSync("components/role/platform-anchor.tsx", "utf8");
  assert.match(src, /onNavigate: session\.role === "admin" && access\?\.super_admin/);
  assert.match(src, /if \(target === "intervention" && param\) session\.openIntervention\(param\);/);
  assert.match(src, /else if \(target === "client" && param\) session\.go\("admin-clients", param\);/);
  assert.match(src, /else if \(target === "artisan" && param\) session\.go\("admin-artisan", param\);/);
});
