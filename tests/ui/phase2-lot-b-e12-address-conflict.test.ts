// E12 (registre phase 2) — CLI-09 : reprise d’une édition d’adresse après modification ailleurs.
// Ouvrir v1, changer le libellé ; une autre session change la ville (v2). L’envoi reçoit 409.
// Attendu (P1 409) : relecture DANS le formulaire — ville v2 rechargée, libellé saisi conservé,
// conflit signalé ; l’envoi suivant porte expected_version 2 (jamais encore v1).
// Vrai ClientAddressesPanel monté (StrictMode, Chromium), API simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClientAddressesPanel } from "./components/features/client-addresses/client-addresses-panel";
${PRELUDE}
const USER = "10000000-0000-4000-8000-000000000001";
const A1 = "20000000-0000-4000-8000-000000000001";
const values = { label: "Domicile", first_name: "Camille", last_name: "Durand", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France", country_code: "FR", latitude: null, longitude: null, geo_source: null, is_preferred: true };
let row = { ...values, id: A1, user_id: USER, version: 1, created_at: "2026-11-01T10:00:00+00:00", updated_at: "2026-11-01T10:00:00+00:00", archived_at: null };
const context = { generation: () => 1, userId: () => USER };
const field = (div, label) => [...div.querySelectorAll("label")].find((l) => (l.textContent || "").startsWith(label))?.querySelector("input");
window.scenarios = {
  async e12() {
    const posts = [];
    const api = {
      list: async () => ({ status: 200, retryAfter: null, body: { records: [row], page: { limit: 50, count: 1, complete: true }, permissions: { can_write: true } } }),
      command: async (c) => {
        posts.push(JSON.parse(JSON.stringify(c)));
        if (c.expected_version !== row.version) return { status: 409, body: null, retryAfter: null };
        row = { ...row, ...c.values, version: row.version + 1 };
        return { status: 200, retryAfter: null, body: { record: row } };
      },
    };
    const div = mountPoint();
    let n = 0;
    createRoot(div).render(h(StrictMode, null, h(ClientAddressesPanel, { demo: false, api, context, newId: () => "30000000-0000-4000-8000-00000000000" + ++n })));
    await until(() => btn(div, "Modifier")); btn(div, "Modifier").click();
    await until(() => field(div, "Nom de l’adresse"));
    setInput(field(div, "Nom de l’adresse"), "Maison");
    row = { ...row, city: "Le Lamentin", version: 2 }; // other session
    div.querySelector("[data-address-save]").click();
    await tick(400);
    const after = { label: field(div, "Nom de l’adresse")?.value, city: field(div, "Ville")?.value, text: txt(div) };
    div.querySelector("[data-address-save]")?.click();
    await tick(400);
    return { after, posts, row };
  },
};
`;

test("E12 · 409 ⇒ ville v2 rechargée dans le formulaire, libellé conservé, renvoi en v2", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e12");
    assert.equal(r.after.city, "Le Lamentin", `ville concurrente rechargée (reçu ${r.after.city})`);
    assert.equal(r.after.label, "Maison", "libellé saisi conservé");
    assert.match(r.after.text, /changé|modifiée/i, "conflit signalé");
    assert.equal(r.posts[1]?.expected_version, 2, `renvoi en v2 (reçu ${r.posts[1]?.expected_version})`);
    assert.equal(r.row.city, "Le Lamentin", "modification concurrente conservée");
    assert.equal(r.row.label, "Maison");
    assert.deepEqual(errors, []);
  });
});
