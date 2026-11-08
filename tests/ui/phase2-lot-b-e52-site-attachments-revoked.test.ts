// E52 (registre phase 2) — ENT-04 / SYS-06 : droit au site retiré, pièces encore affichées.
// « Ouvrir » reçoit 404 ⇒ attendu : relecture de la liste ; le refus de liste purge noms et boutons.
// Un second clic ne doit plus être possible. Panneau réel monté (StrictMode, Chromium), fetch simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteAttachmentsPanel } from "./components/features/site-attachments/site-attachments-panel";
${PRELUDE}
const SITE = "50000000-0000-4000-8000-000000000001";
const ORG = "51000000-0000-4000-8000-000000000001";
const doc = { id: "62000000-0000-4000-8000-000000000001", site_id: SITE, name: "Plan-tableau-general.pdf", mime_type: "application/pdf", kind: "plan", created_at: "2026-11-01T10:00:00.000Z", version: 1, revision: 1, replaces_id: null, replaced_at: null, archived_at: null };
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
window.scenarios = {
  async e52() {
    let revoked = false;
    const calls = { list: 0, sign: 0 };
    window.open = () => { window.opened = (window.opened || 0) + 1; return null; };
    const fetcher = async (url) => {
      const u = String(url);
      if (u.includes("?id=")) { calls.sign++; return json(revoked ? 404 : 200, revoked ? null : { url: "https://example.invalid/x" }); }
      calls.list++;
      return revoked ? json(404, null) : json(200, { documents: [doc], page: { limit: 25, has_more: false, next_cursor: null } });
    };
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(SiteAttachmentsPanel, { siteId: SITE, organizationId: ORG, context, canUpload: false, archived: false, fetcher })));
    await until(() => div.querySelector("[data-site-attachment-open]"));
    revoked = true;
    const before = calls.list;
    div.querySelector("[data-site-attachment-open]").click();
    await tick(300);
    const b = div.querySelector("[data-site-attachment-open]");
    if (b && !b.disabled) { b.click(); await tick(300); }
    return { relisted: calls.list - before, signs: calls.sign, names: /Plan-tableau-general/.test(txt(div)), openButtons: div.querySelectorAll("[data-site-attachment-open]").length, opened: window.opened || 0 };
  },
};
`;

test("E52 · 404 à l’ouverture ⇒ relecture, noms et boutons purgés, un seul essai de signature", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors, requests }) => {
    const r = await run("e52");
    assert.ok(r.relisted >= 1, `relecture de la liste après le refus (GET : ${r.relisted})`);
    assert.equal(r.names, false, "noms de pièces purgés");
    assert.equal(r.openButtons, 0, "plus de bouton « Ouvrir »");
    assert.equal(r.signs, 1, "aucun second essai de signature");
    assert.equal(r.opened, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => u.startsWith("/api/")), []);
  });
});
