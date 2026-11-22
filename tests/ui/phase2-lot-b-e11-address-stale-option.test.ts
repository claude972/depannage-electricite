// E11 (registre phase 2) — CLI-01 : choix au clavier d’une adresse après modification de la saisie.
// Chercher « Rue de la République Fort-de-France », activer la suggestion (flèche bas), remplacer la
// saisie par « Rue Victor Hugo Fort-de-France » et appuyer IMMÉDIATEMENT sur Entrée (avant toute
// nouvelle recherche). Attendu : l’ancienne option n’est plus active ; aucun champ n’est remplacé.
// Vrai AddressField monté (StrictMode, Chromium, vrai clavier), recherche simulée (aucun appel IGN).
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AddressField } from "./components/app/address-field";
${PRELUDE}
const search = async (q) => ({ candidates: q.includes("République") ? [{ id: "c1", label: "Rue de la République, 97200 Fort-de-France", address: "Rue de la République", postal_code: "97200", city: "Fort-de-France" }] : [], attribution: "test" });
window.value = { address: "", postal_code: "", city: "" };
function Host() { const [v, set] = useState(window.value); return h(AddressField, { value: v, onChange: (n) => { window.value = n; set(n); }, search }); }
window.scenarios = { async mount() { const div = mountPoint(); createRoot(div).render(h(StrictMode, null, h(Host))); await tick(50); return true; } };
`;

test("E11 · saisie modifiée puis Entrée immédiate ⇒ l’ancienne suggestion n’est pas choisie", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, page }) => {
    await run("mount");
    const street = page.locator("input").first();
    await street.click();
    await street.pressSequentially("Rue de la République Fort-de-France", { delay: 5 });
    await page.getByRole("option").first().waitFor();
    await street.press("ArrowDown");
    await street.fill("Rue Victor Hugo Fort-de-France");
    await street.press("Enter"); // immediately, before the debounced search
    const value = (await page.evaluate("window.value")) as { address: string; postal_code: string; city: string };
    assert.equal(value.address, "Rue Victor Hugo Fort-de-France", `saisie conservée, ancienne rue non appliquée (reçu ${JSON.stringify(value)})`);
    assert.equal(value.postal_code, "", "code postal non rempli par l’ancienne suggestion");
    assert.deepEqual(errors, []);
  });
});
