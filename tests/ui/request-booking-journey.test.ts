import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip } from "./real-app-harness";

test("demande générique : choix explicite, reprise intacte et erreur de règlement près du contrôle sans envoi", { skip }, async () => {
  await withApp(async (open) => {
    const { page, api, errors } = await open("client", 320);
    const consoleErrors: string[] = [];
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.evaluate(() => { location.hash = "new"; });
    const choices = page.getByRole("group", { name: "Choisir le problème" });
    await choices.waitFor();
    assert.equal(await choices.locator('[aria-pressed="true"]').count(), 0);
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    assert.match(await page.locator("#request-category-error").innerText(), /Choisissez le problème/);
    assert.equal(await page.getByRole("heading", { name: "Que se passe-t-il ?" }).count(), 1);
    await choices.getByRole("button", { name: /Prise ou interrupteur/ }).click();
    assert.equal(await choices.locator('[aria-pressed="true"]').count(), 1);
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByLabel("Adresse d’intervention", { exact: true }).fill("1 rue de la Démonstration");
    await page.getByLabel("Code postal", { exact: true }).fill("97200");
    await page.getByLabel("Commune", { exact: true }).fill("Fort-de-France");
    await page.getByLabel("Téléphone de contact (obligatoire)", { exact: true }).fill("0696000000");
    assert.match(await page.locator("[data-booking-point-unconfirmed]").innerText(), /ne sera pas utilisé/);
    await page.getByRole("button", { name: "Continuer vers le règlement", exact: true }).click();
    await page.locator("[data-booking-confirm]").waitFor();
    assert.equal(await page.locator('ol[aria-label="Étapes de la demande"] li').count(), 3);
    assert.match(await page.locator('[aria-current="step"]').innerText(), /Règlement et confirmation/);
    assert.match(await page.locator(".recap-list").innerText(), /Intervention à planifier/);
    assert.match(await page.locator(".recap-list").innerText(), /Aucune description ajoutée/);
    await page.getByRole("button", { name: "Envoyer ma demande", exact: true }).click();
    const error = page.locator("#booking-payment-error");
    assert.match(await error.innerText(), /rien n’a été envoyé/);
    assert.equal(await page.locator('.booking-payment-options #booking-payment-error').count(), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-booking-choose")), "on_site");
    await page.locator('[data-booking-choose="on_site"]').click();
    assert.equal(await page.locator('[data-booking-payment="on_site"]').count(), 1);
    assert.equal(await error.count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
    await page.getByRole("button", { name: "Modifier la demande", exact: true }).click();
    assert.equal(await page.locator('.category-grid [aria-pressed="true"]').count(), 1);
    assert.match(await page.locator('.category-grid [aria-pressed="true"]').innerText(), /Prise ou interrupteur/);
    assert.deepEqual(api, [], "la démo ne soumet rien au serveur");
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors, []);
    await page.context().close();
  });
});

test("une entrée explicite par catégorie garde sa présélection", { skip }, async () => {
  await withApp(async (open) => {
    const { page } = await open("client", 390);
    await page.evaluate(() => { location.hash = "new/lighting"; });
    const selected = page.locator('.category-grid [aria-pressed="true"]');
    await selected.waitFor();
    assert.match(await selected.innerText(), /Éclairage/);
    await page.getByRole("button", { name: "Continuer", exact: true }).click();
    await page.getByRole("heading", { name: "Où faut-il intervenir ?" }).waitFor();
    await page.context().close();
  });
});
