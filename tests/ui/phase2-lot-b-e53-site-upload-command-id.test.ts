// E53 (registre phase 2) — ENT-04 / SYS-06 : dépôt de pièce doublé après perte de la réponse.
// Contrat A vérifié (phase3-bloquants-livres.md) : POST multipart /api/sites/{id}/documents exige le
// champ texte command_id (UUID) stable jusqu’à réception du 201 ; même fichier, type et replaces_id ;
// id du document = command_id.
// Vrai SiteAttachmentsPanel monté (StrictMode, Chromium), fetch simulé.
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
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
window.uploads = []; window.lose = true;
const docs = [];
const fetcher = async (url, init) => {
  if (init && init.method === "POST") {
    const f = init.body;
    const id = f.get("command_id");
    window.uploads.push({ command_id: id, kind: f.get("kind"), name: f.get("file")?.name ?? null });
    const doc = { id: id || "63000000-0000-4000-8000-00000000000" + window.uploads.length, site_id: SITE, name: "plan.pdf", mime_type: "application/pdf", kind: f.get("kind"), created_at: "2026-11-08T10:00:00.000Z", version: 1, revision: 1, replaces_id: null, replaced_at: null, archived_at: null };
    if (!docs.some((d) => d.id === doc.id)) docs.push(doc);
    if (window.lose) { window.lose = false; return json(502, null); }
    return json(201, { document: doc });
  }
  return json(200, { documents: docs.slice(), page: { limit: 25, has_more: false, next_cursor: null } });
};
window.scenarios = {
  async e53() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(SiteAttachmentsPanel, { siteId: SITE, organizationId: ORG, context, canUpload: true, archived: false, fetcher })));
    await until(() => div.querySelector("input[type=file]"));
    const input = div.querySelector("input[type=file]");
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([37, 80, 68, 70, 45])], "plan.pdf", { type: "application/pdf" }));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await tick(50);
    const submit = () => input.form.querySelector("button[type=submit]").click();
    submit();
    await until(() => window.uploads.length === 1);
    await tick(300);
    submit(); // explicit resend after the lost reply
    await until(() => window.uploads.length === 2);
    await tick(300);
    return { uploads: window.uploads, docs: docs.length };
  },
};
`;

test("E53 · réponse perdue ⇒ renvoi avec le même command_id, un seul document", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e53");
    assert.match(String(r.uploads[0].command_id), /^[0-9a-f-]{36}$/i, `command_id transmis (reçu ${JSON.stringify(r.uploads[0].command_id)})`);
    assert.equal(r.uploads[1].command_id, r.uploads[0].command_id, "même clé au renvoi");
    assert.equal(r.uploads[1].kind, r.uploads[0].kind);
    assert.equal(r.docs, 1, "aucun doublon");
    assert.deepEqual(errors, []);
  });
});
