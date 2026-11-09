// E08 (registre phase 2) — ENT-14.2 : conflit de mise à jour d’une ligne budgétaire.
// Ouvrir v1, modifier seulement le montant ; un autre gestionnaire change la note (v2). Le premier
// envoi reçoit 409. Attendu (P1 409) : relecture DANS le formulaire — la note concurrente remplace
// la note non modifiée, le montant saisi est conservé, le conflit est signalé ; l’envoi suivant porte
// expected_version 2 et la note v2 (jamais l’écrasement silencieux de la note concurrente).
// Vraie SiteOperationsView montée (StrictMode, Chromium), rapport de démonstration, client simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteOperationsView } from "./components/features/site-operations/site-operations-view";
import { demoReport } from "./lib/features/site-operations/demo";
import { ApiRequestError } from "./components/app/api";
${PRELUDE}
window.scenarios = {
  async e08() {
    const base = demoReport();
    let server = { version: 1, note: "Note v1", amount_cents: 480000 };
    const posts = [];
    const client = {
      load: async () => { const r = JSON.parse(JSON.stringify(base)); Object.assign(r.snapshot.budget_lines[0], server); return r; },
      command: async (c) => {
        posts.push(c);
        if (c.expected_version !== server.version) throw new ApiRequestError(409, "La ligne a changé.");
        server = { version: server.version + 1, note: c.note, amount_cents: c.amount_cents };
        return { action: c.action, result: {} };
      },
    };
    const scope = { userId: "u1", role: "manager", organizationId: base.snapshot.site.organization_id, siteId: base.snapshot.site.id, authority: { canWrite: true } };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(SiteOperationsView, { state: "available", unavailableMessage: "", scope, client })));
    await until(() => btn(div, "Budget")); btn(div, "Budget").click();
    const lineBtn = () => [...div.querySelectorAll("table button")].find((b) => (b.textContent || "").trim() === "Modifier");
    await until(() => lineBtn()); lineBtn().click();
    await until(() => div.querySelector("form h4"));
    const form = () => [...div.querySelectorAll("form")].find((f) => f.querySelector("h4"));
    const inputs = () => form().querySelectorAll("input");
    setInput(inputs()[0], "5000");
    server = { version: 2, note: "Note concurrente v2", amount_cents: 480000 }; // other manager
    await tick(20);
    form().requestSubmit();
    await tick(400);
    const after = { amount: inputs()[0].value, note: inputs()[1].value, text: txt(form()) };
    form().requestSubmit();
    await tick(400);
    return { after, posts, server };
  },
};
`;

test("E08 · 409 ⇒ note concurrente rechargée dans le formulaire, montant saisi conservé, renvoi en v2 sans écraser la note", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e08");
    assert.equal(r.after.note, "Note concurrente v2", `note non modifiée rechargée (reçu ${r.after.note})`);
    assert.equal(r.after.amount, "5000", "montant saisi conservé");
    assert.match(r.after.text, /modifi|changé/i, "conflit signalé");
    assert.equal(r.posts[1]?.expected_version, 2);
    assert.equal(r.server.note, "Note concurrente v2", "la note concurrente n’est pas écrasée");
    assert.equal(r.server.amount_cents, 500000);
    assert.deepEqual(errors, []);
  }, 1280);
});
