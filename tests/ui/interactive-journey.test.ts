// Interactive nominal journey in the REAL app (CourantApp, demo mode), ONE Chromium page, roles
// switched with the app's own demo role selector while the stored demo workspace persists:
// client request → artisan accepts the offer → quote at 8,5 % → client accepts that version →
// artisan start / compte rendu / complete → client payment CTA + invoices panel (honest demo).
// Each step checks the visible state AND the stored demo data; zero /api call, zero page error.
// Demo proves the UI flow only — never bank, payment-provider or RLS behaviour.
import test from "node:test";
import assert from "node:assert/strict";
import { withApp, skip, type Page } from "./real-app-harness";

type Store = { data: { interventions: { id: string; status: string; category: string; description: string; artisan_id: string | null }[]; quotes: { id: string; intervention_id: string; status: string; subtotal_cents: number; tax_cents: number; total_cents: number; tax_rate: number; lines: unknown[] }[] } };
const store = (page: Page): Promise<Store> => page.evaluate(() => JSON.parse(localStorage.getItem("courant-demo-v3") || "{}"));
const main = (page: Page): Promise<string> => page.locator("main").innerText();
const click = async (page: Page, name: string) => {
  await page.getByRole("button", { name, exact: true }).first().click();
  await page.waitForTimeout(500);
};
const goHash = async (page: Page, hash: string) => {
  await page.evaluate((h: string) => { location.hash = h; }, hash);
  await page.waitForTimeout(700);
};
const DESCRIPTION = "La prise du salon ne fonctionne plus depuis hier soir.";

for (const width of [390, 1440])
test(`parcours interactif client ↔ artisan (démo) à ${width} px : demande → offre → devis 8,5 % → acceptation → intervention → règlement`, { skip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("client-new", width);
    // 1. Client request: problem → validated address → payment choice → single final recap/confirmation.
    await page.getByRole("button", { name: /Prise ou interrupteur/ }).click();
    await page.getByLabel(/Décrivez le problème/).fill(DESCRIPTION);
    await click(page, "Continuer");
    await page.getByLabel("Adresse d’intervention").fill("8 rue Victor Hugo");
    await page.getByLabel("Code postal").fill("97200");
    await page.getByLabel("Ville").fill("Fort-de-France");
    await page.getByLabel("Téléphone de contact (obligatoire)").fill("0696 12 34 56");
    const place = await main(page);
    // Nothing is sent on the address step: no « Enregistrer », the next step is the payment choice.
    assert.match(place, /Rien n’est encore envoyé : vous choisirez ensuite le mode de règlement, puis vous confirmerez l’envoi de votre demande\./);
    assert.equal(await page.getByRole("button", { name: /Enregistrer la demande/ }).count(), 0);
    await click(page, "Continuer vers le règlement");
    assert.doesNotMatch(await main(page), /Votre demande, en clair\./, "no intermediate recap duplicating the final confirmation");
    await page.waitForTimeout(400);
    const confirm = await main(page);
    assert.match(confirm, /Confirmez l’envoi de votre demande/);
    assert.match(confirm, /Choisissez votre mode de règlement/);
    assert.ok(!(await store(page)).data.interventions.some((i) => i.description === DESCRIPTION), "nothing created before the confirmation");
    assert.match(confirm, /\+596696123456/, "phone entered on the previous step is kept");
    await page.locator('[data-booking-choose="on_site"]').click();
    await page.locator("[data-booking-send]").click();
    await page.waitForTimeout(600);
    const created = await main(page);
    assert.match(created, /Demande enregistrée dans la démonstration/);
    assert.match(created, /Règlement choisi : Après intervention — paiement sur la plateforme \(démonstration, rien n’est payé\)/);
    let s = await store(page);
    const job = s.data.interventions.find((i) => i.description === DESCRIPTION)!;
    assert.ok(job, "stored demo request");
    assert.equal(job.status, "requested");
    assert.ok(!job.artisan_id, "no artisan yet");

    // 2. Artisan: « Disponibles » → anonymized summary → accept → private demo dossier.
    await page.getByLabel("Explorer un autre espace").selectOption("artisan");
    await page.waitForTimeout(900);
    await goHash(page, "#missions");
    await page.locator(`[data-available-offer="${job.id}"]`).click();
    const summary = await page.locator("[data-available-point]").innerText();
    assert.match(summary, /972\*\*/);
    assert.match(summary, /non calculée/);
    assert.doesNotMatch(summary, /8 rue Victor Hugo|salon/, "no address / description before acceptance");
    await page.locator("[data-available-accept]").click();
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => location.hash), `#detail/${job.id}`);
    assert.match(await main(page), /8 rue Victor Hugo/, "private dossier after acceptance");
    s = await store(page);
    assert.equal(s.data.interventions.find((i) => i.id === job.id)!.status, "assigned");

    // 3. Quote draft with lines, explicit VAT 8,5 % (« Choisir un taux » first), send.
    assert.equal(await page.getByLabel("Taux de TVA (%)").inputValue(), "", "no rate preselected");
    assert.match(await page.getByLabel("Taux de TVA (%)").locator("option").first().innerText(), /Choisir un taux/);
    await page.getByRole("textbox", { name: "Prestation 1", exact: true }).fill("Remplacement de la prise");
    await page.getByLabel("Quantité", { exact: true }).nth(0).fill("1");
    await page.getByLabel("Prix unitaire HT (€)", { exact: true }).nth(0).fill("60");
    await page.getByRole("textbox", { name: "Prestation 2", exact: true }).fill("Déplacement");
    await page.getByLabel("Quantité", { exact: true }).nth(1).fill("1");
    await page.getByLabel("Prix unitaire HT (€)", { exact: true }).nth(1).fill("40");
    await page.getByLabel("Taux de TVA (%)").selectOption({ label: "8,5 %" });
    assert.match(await main(page), /TVA \(8,5 %\)\s*8,50\s€\s*Total TTC\s*108,50\s€/);
    await click(page, "Envoyer le devis au client");
    await page.waitForTimeout(800);
    s = await store(page);
    const quotes = s.data.quotes.filter((q) => q.intervention_id === job.id);
    assert.equal(quotes.length, 1);
    assert.deepEqual([quotes[0].status, quotes[0].subtotal_cents, quotes[0].tax_rate, quotes[0].tax_cents, quotes[0].total_cents], ["sent", 10000, 8.5, 850, 10850]);
    assert.equal(s.data.interventions.find((i) => i.id === job.id)!.status, "quoted");

    // 4. Client sees and accepts THAT version (8,5 %, 108,50 €).
    await page.getByLabel("Rôle exploré").selectOption("client");
    await page.waitForTimeout(900);
    await goHash(page, `#detail/${job.id}`);
    const detail = await main(page);
    assert.match(detail, /Devis à valider/);
    assert.match(detail, /108,50\s€/);
    assert.match(detail, /TVA \(8,5 %\)/, "French decimal comma on the client detail");
    assert.doesNotMatch(detail, /8\.5 %/);
    await click(page, "Voir le devis");
    assert.equal(await page.evaluate(() => location.hash), `#quote/${quotes[0].id}`);
    const quotePage = await main(page);
    assert.match(quotePage, /TVA \(8,5 %\)\s*8,50\s€/);
    assert.match(quotePage, /Total TTC\s*108,50\s€/);
    assert.doesNotMatch(quotePage, /8\.5 %/);
    await click(page, "Accepter le devis");
    await page.waitForTimeout(800);
    // The demo quote documents are built from THIS dossier only: its own reference, never the
    // seed dossier's DEV-DEMO01 / AV-1-DEV-DEMO01 (nor any other dossier's data).
    const ownRef = `DEV-${quotes[0].id.slice(0, 6).toUpperCase()}`;
    const afterAccept = await main(page);
    assert.match(afterAccept, new RegExp(`Devis ${ownRef}`));
    assert.doesNotMatch(afterAccept, /DEV-DEMO01|AV-1-DEV-DEMO01|DEV-DEMO-\d/, "no seed/other dossier data on the new dossier");
    const refs = [...afterAccept.matchAll(/\b(?:AV-\d+-)?DEV-[A-Z0-9-]+/g)].map((m) => m[0]);
    assert.ok(refs.length > 0 && refs.every((r) => r === ownRef || r === `AV-1-${ownRef}`), `only this dossier's references: ${[...new Set(refs)].join(", ")}`);
    s = await store(page);
    assert.equal(s.data.quotes.find((q) => q.id === quotes[0].id)!.status, "accepted");
    assert.equal(s.data.interventions.find((i) => i.id === job.id)!.status, "accepted");

    // 5. Artisan: start → compte rendu → complete.
    await page.getByLabel("Explorer un autre espace").selectOption("artisan");
    await page.waitForTimeout(900);
    await goHash(page, `#detail/${job.id}`);
    await click(page, "Démarrer l’intervention");
    await click(page, "Démarrer");
    assert.equal((await store(page)).data.interventions.find((i) => i.id === job.id)!.status, "in_progress");
    await click(page, "Rédiger le compte rendu");
    await page.getByLabel("Résumé des travaux réalisés").fill("Prise du salon remplacée, circuit contrôlé et remis en service.");
    await page.getByRole("textbox", { name: "Contrôle 1", exact: true }).fill("Serrage des bornes");
    await page.getByRole("textbox", { name: "Contrôle 2", exact: true }).fill("Test de continuité");
    await page.getByLabel("Nom déclaré").fill("Alex Martin");
    await click(page, "Enregistrer le compte rendu");
    assert.ok(await page.getByRole("button", { name: "Modifier le compte rendu", exact: true }).count(), "report saved");
    const reports = await page.evaluate(() => localStorage.getItem("courant-demo-operations-v1") || "");
    assert.match(reports, /Prise du salon remplacée/, "stored demo report");
    await click(page, "Terminer l’intervention");
    await click(page, "Terminer");
    assert.equal((await store(page)).data.interventions.find((i) => i.id === job.id)!.status, "completed");

    // 6. Client: platform payment CTA (amount-free explanation) + invoices panel (honest demo).
    await page.getByLabel("Rôle exploré").selectOption("client");
    await page.waitForTimeout(900);
    await goHash(page, `#detail/${job.id}`);
    const done = await main(page);
    assert.match(done, /À régler/);
    assert.match(done, /Le montant à régler comprend le devis accepté et tous les avenants acceptés\. Il est calculé par la plateforme/);
    assert.ok(await page.getByRole("button", { name: "Simuler le règlement", exact: true }).count());
    assert.match(done, /Factures et avoirs de ce dossier/);
    assert.match(done, /En démonstration, aucune facture n’est émise/);
    assert.match(done, /Prise du salon remplacée/, "client sees the compte rendu");

    assert.deepEqual(api, [], "zero /api call in demo");
    assert.deepEqual(errors, [], "zero page error");
  });
});

// Signed-in #new: payment choice step (lead fix, formerly a TODO finding).
test("#new connecté : le choix de règlement est proposé après l’adresse ; envoi sans choix refusé, rien créé", { skip }, async () => {
  await withApp(async (open) => {
    const { page } = await open("client-new");
    await page.getByRole("button", { name: /Prise ou interrupteur/ }).click();
    await page.getByLabel(/Décrivez le problème/).fill(DESCRIPTION);
    // Stepper announces the real third step on the booking path.
    assert.match(await page.locator("ol.stepper").innerText(), /Règlement et confirmation/);
    assert.doesNotMatch(await page.locator("ol.stepper").innerText(), /Le récapitulatif/);
    const png = (name: string) => ({ name, mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4d40000000049454e44ae426082", "hex") });
    await page.locator('input[type="file"]').setInputFiles([png("tableau.png")]);
    await click(page, "Continuer");
    await page.getByLabel("Adresse d’intervention").fill("8 rue Victor Hugo");
    await page.getByLabel("Code postal").fill("97200");
    // Revalidation: an empty city blocks the hand-off (native validation), nothing moves forward.
    await page.getByLabel("Ville").fill("");
    await click(page, "Continuer vers le règlement");
    await page.waitForTimeout(200);
    assert.match(await main(page), /Où faut-il intervenir \?/, "still on the address step");
    await page.getByLabel("Ville").fill("Fort-de-France");
    const phone = page.getByLabel("Téléphone de contact (obligatoire)");
    await phone.fill("");
    await click(page, "Continuer vers le règlement");
    assert.equal(await phone.evaluate((el: HTMLInputElement) => el.validity.valueMissing), true);
    await phone.fill("1234");
    await click(page, "Continuer vers le règlement");
    assert.match(await main(page), /Saisissez un numéro de téléphone valide/);
    await phone.fill("+590 690 12 34 56");
    await click(page, "Continuer vers le règlement");
    await page.waitForTimeout(400);
    assert.match(await main(page), /Après intervention — paiement sur la plateforme/);
    assert.match(await main(page), /Empreinte bancaire/);
    await page.locator("[data-booking-send]").click();
    await page.waitForTimeout(300);
    assert.match(await main(page), /Choisissez un mode de paiement avant d’envoyer ; rien n’a été envoyé\./);
    // Back / edit: « Modifier la demande » reopens the form with the kept values; a changed address
    // comes back to the SAME final confirmation (choice kept), nothing created in between.
    await page.locator('[data-booking-choose="on_site"]').click();
    await click(page, "Modifier la demande");
    await page.waitForTimeout(300);
    assert.equal(await page.getByLabel(/Décrivez le problème/).inputValue(), DESCRIPTION, "kept problem text");
    // Photos already chosen are kept, shown and editable (contract: same 6-photo cap).
    const photosList = () => page.locator('ul[aria-label="Photos sélectionnées"]').innerText();
    assert.match(await photosList(), /tableau\.png/, "existing photo shown in edit");
    await page.getByRole("button", { name: "Retirer tableau.png" }).click();
    await page.locator('input[type="file"]').setInputFiles([png("prise.png")]);
    assert.match(await photosList(), /prise\.png/);
    await click(page, "Continuer");
    assert.equal(await page.getByLabel("Adresse d’intervention").inputValue(), "8 rue Victor Hugo", "kept address");
    await page.getByLabel("Adresse d’intervention").fill("12 rue Lamartine");
    await click(page, "Revenir à la confirmation");
    await page.waitForTimeout(400);
    const again = await main(page);
    assert.match(again, /Confirmez l’envoi de votre demande/);
    assert.match(again, /12 rue Lamartine, 97200 Fort-de-France/);
    assert.match(again, /\+590690123456/, "contact phone kept after editing the address");
    assert.match(again, /Après intervention — paiement sur la plateforme/, "payment choice kept");
    assert.equal((await store(page)).data.interventions.filter((i) => i.description === DESCRIPTION).length, 0, "nothing created between the steps");
    // The edited photo set is what the kept booking now holds.
    await click(page, "Modifier la demande");
    await page.waitForTimeout(300);
    const kept = await photosList();
    assert.match(kept, /prise\.png/);
    assert.doesNotMatch(kept, /tableau\.png/, "removed photo not resurrected");
  });
});
