// E06 / E22 / E26 / E27 (registre phase 2) — opérations de site (vraie SiteOperationsView montée,
// StrictMode, Chromium ; rapport de démonstration et client simulé).
// E26 : accès organisation retiré ⇒ « Publier » répond 403 ; attendu (P1) : relecture du rapport ;
//       tarifs, note et commande retirés ; un seul POST.
// E27 : grille déjà publiée ailleurs ⇒ 409 ; attendu : relecture, statut « Publiée », plus de bouton.
// E22 : deux soumissions dans la même boucle ⇒ un seul POST (verrou synchrone de useSubmit).
// E06 : droit d’écriture retiré puis « Actualiser » ⇒ le formulaire déjà ouvert n’émet aucun POST.
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
const fillCalendar = (form) => {
  setInput(form.querySelector("input[maxlength='160']"), "Calendrier recette");
  setInput(form.querySelector("input[maxlength='64']"), "America/Martinique");
  const inputs = [...form.querySelectorAll("input")];
  setInput(inputs[2], "08:00");
  setInput(inputs[3], "17:00");
};
const tab = (div, label) => [...div.querySelectorAll("button,[role=tab]")].find((b) => (b.textContent || "").trim() === label);
function mount(makeReport, onCommand) {
  const base = demoReport();
  const calls = { load: 0, command: 0 };
  const client = {
    load: async () => { calls.load++; return makeReport(JSON.parse(JSON.stringify(base)), calls.load); },
    command: async (c) => { calls.command++; return onCommand(c, calls); },
  };
  const scope = { userId: "u1", role: "manager", organizationId: base.snapshot.site.organization_id, siteId: base.snapshot.site.id, authority: { canWrite: true } };
  const div = mountPoint();
  createRoot(div).render(h(StrictMode, null, h(SiteOperationsView, { state: "available", unavailableMessage: "", scope, client })));
  return { div, calls };
}
const draftGrid = (r) => { r.snapshot.contract_grids[0].status = "draft"; r.snapshot.contract_grids[0].published_at = null; r.snapshot.contract_grids[0].lines[0].note = "Note interne tarifaire"; return r; };
window.scenarios = {
  async e26() {
    let revoked = false;
    const { div, calls } = mount((r) => { draftGrid(r); if (revoked) { r.snapshot.contract_grids = []; r.snapshot.limits.contract_grids_readable = false; r.snapshot.limits.can_write_organization = false; } return r; }, () => { throw new ApiRequestError(403, "Accès refusé."); });
    await until(() => tab(div, "Grilles")); tab(div, "Grilles").click();
    await until(() => btn(div, "Publier (irréversible)"));
    revoked = true;
    const before = calls.load;
    btn(div, "Publier (irréversible)").click();
    await tick(400);
    const again = btn(div, "Publier (irréversible)");
    if (again && !again.disabled) { again.click(); await tick(300); }
    return { reloads: calls.load - before, commands: calls.command, publish: !!btn(div, "Publier (irréversible)"), note: /Note interne tarifaire/.test(txt(div)), price: /45,00/.test(txt(div)) };
  },
  async e27() {
    let publishedElsewhere = false;
    const { div, calls } = mount((r) => { if (!publishedElsewhere) draftGrid(r); return r; }, () => { throw new ApiRequestError(409, "La grille a changé."); });
    await until(() => tab(div, "Grilles")); tab(div, "Grilles").click();
    await until(() => btn(div, "Publier (irréversible)"));
    publishedElsewhere = true;
    const before = calls.load;
    btn(div, "Publier (irréversible)").click();
    await tick(400);
    return { reloads: calls.load - before, publish: !!btn(div, "Publier (irréversible)"), draftTag: /Brouillon/.test(txt(div.querySelector("[aria-label='Grilles contractuelles']"))) };
  },
  async e22() {
    const { div, calls } = mount((r) => r, async (c) => { await tick(50); return { action: c.action, result: {} }; });
    await until(() => tab(div, "Délais")); tab(div, "Délais").click();
    await until(() => btn(div, "Ajouter un calendrier"));
    btn(div, "Ajouter un calendrier").click();
    await until(() => div.querySelector("form h4"));
    const form = [...div.querySelectorAll("form")].find((f) => /Nouveau calendrier/.test(txt(f)));
    fillCalendar(form);
    await tick(20);
    form.requestSubmit(); form.requestSubmit(); // two submissions in the same loop, before any render
    await tick(400);
    return { commands: calls.command, formText: txt(form).slice(0, 600) };
  },
  async e06() {
    let readOnly = false;
    const { div, calls } = mount((r) => { if (readOnly) { r.snapshot.limits.can_write_site = false; r.snapshot.limits.can_write_organization = false; } return r; }, async (c) => ({ action: c.action, result: {} }));
    await until(() => tab(div, "Délais")); tab(div, "Délais").click();
    await until(() => btn(div, "Ajouter un calendrier"));
    btn(div, "Ajouter un calendrier").click();
    await until(() => div.querySelector("form h4"));
    const form = () => [...div.querySelectorAll("form")].find((f) => /Nouveau calendrier/.test(txt(f)));
    fillCalendar(form());
    readOnly = true;
    btn(div, "Actualiser").click();
    await until(() => /lecture seule|Lecture seule/i.test(txt(div)));
    await tick(100);
    const f = form();
    if (f) { f.requestSubmit(); await tick(300); }
    return { commands: calls.command, formOpen: !!f };
  },
};
`;

test("E26 · 403 à la publication ⇒ relecture, tarifs/note/commande retirés, un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e26");
    assert.ok(r.reloads >= 1, `relecture après le refus (GET : ${r.reloads})`);
    assert.equal(r.publish, false, "plus de commande Publier");
    assert.equal(r.note, false, "note interne retirée");
    assert.equal(r.commands, 1, "aucun second POST");
    assert.deepEqual(errors, []);
  }, 1280);
});

test("E27 · 409 à la publication ⇒ relecture, plus de « Brouillon » ni de bouton Publier", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e27");
    assert.ok(r.reloads >= 1, `relecture après le conflit (GET : ${r.reloads})`);
    assert.equal(r.publish, false);
    assert.equal(r.draftTag, false);
    assert.deepEqual(errors, []);
  }, 1280);
});

test("E22 · deux soumissions dans la même boucle ⇒ un seul POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e22");
    assert.equal(r.commands, 1, `un seul POST (reçus : ${r.commands}) ${r.formText}`);
    assert.deepEqual(errors, []);
  }, 1280);
});

test("E06 · écriture retirée puis Actualiser ⇒ le formulaire ouvert n’émet aucun POST", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e06");
    assert.equal(r.commands, 0, `aucun POST depuis le formulaire périmé (reçus : ${r.commands})`);
    assert.deepEqual(errors, []);
  }, 1280);
});
