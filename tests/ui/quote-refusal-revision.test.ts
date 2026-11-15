// Refusal → new version → acceptance, in the real app (demo mode, roles switched with the demo
// selector): each step tells the user what was recorded and the artisan finds the reason.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip, type Page } from "./real-app-harness";

const main = (page: Page): Promise<string> => page.locator("main").innerText();
const goHash = async (page: Page, hash: string) => { await page.evaluate((h: string) => { location.hash = h; }, hash); await page.waitForTimeout(700); };
const role = async (page: Page, r: string) => { await page.getByLabel("Rôle exploré").selectOption(r); await page.waitForTimeout(900); };

for (const width of [390, 1440])
test(`devis refusé puis nouvelle version acceptée, messages explicites (${width} px)`, { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client", width);
    await goHash(page, "#quote/quote-demo-1");
    await page.getByRole("button", { name: /^Refuser/ }).first().click();
    await page.locator("main textarea").first().fill("Non");
    await page.getByRole("button", { name: /Confirmer le refus|Refuser ce devis/ }).first().click();
    await page.waitForTimeout(400);
    assert.match(await main(page), /au moins 5 caractères/, "short reason refused, form kept");
    await page.locator("main textarea").first().fill("Je souhaite une autre solution, moins chère.");
    await page.getByRole("button", { name: /Confirmer le refus|Refuser ce devis/ }).first().click();
    await page.waitForTimeout(800);
    const refused = await main(page);
    assert.match(refused, /Devis refusé\. L’artisan peut vous proposer une nouvelle version\./);
    assert.match(refused, /Vous avez refusé cette version du devis\./);
    assert.doesNotMatch(refused, /Modification enregistrée/);

    await role(page, "artisan");
    await goHash(page, "#detail/demo-001");
    const dossier = await main(page);
    assert.match(dossier, /Le client a refusé DEV-/);
    assert.match(dossier, /Refusé par le client/);
    await page.locator("[data-quote-rejected-hint] button").click();
    await page.waitForTimeout(700);
    assert.match(await page.evaluate(() => location.hash), /^#messages/);
    assert.match(await main(page), /Devis refusé : Je souhaite une autre solution/, "reason readable in the conversation");

    await goHash(page, "#detail/demo-001");
    await page.getByRole("textbox", { name: "Prestation 1", exact: true }).fill("Remplacement simplifié");
    await page.getByLabel("Quantité", { exact: true }).nth(0).fill("1");
    await page.getByLabel("Prix unitaire HT (€)", { exact: true }).nth(0).fill("120");
    await page.getByLabel("Taux de TVA (%)").selectOption({ label: "8,5 %" });
    await page.getByRole("button", { name: "Envoyer le devis au client", exact: true }).click();
    await page.waitForTimeout(800);
    assert.match(await main(page), /Devis (publié|envoyé)/);

    await role(page, "client");
    await goHash(page, "#detail/demo-001");
    assert.match(await main(page), /130,20\s€/);
    await page.getByRole("button", { name: "Voir le devis" }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Accepter le devis" }).first().click();
    await page.waitForTimeout(800);
    assert.match(await main(page), /Devis accepté\. Il sert de base au règlement après l’intervention\./);
    const store = await page.evaluate(() => JSON.parse(localStorage.getItem("courant-demo-v3") || "{}"));
    const qs = store.data.quotes.filter((q: { intervention_id: string }) => q.intervention_id === "demo-001").map((q: { status: string; total_cents: number }) => `${q.status}:${q.total_cents}`);
    assert.deepEqual(qs.sort(), ["accepted:13020", "rejected:22200"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(api, [], "demo: zero /api call");
  });
});
