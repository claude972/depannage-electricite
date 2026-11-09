// E02 (registre phase 2) — SYS-04 : photo en cours et changement de fil.
//  (a) dépôt lancé sur A, ouverture de B, reçu reçu pendant B, retour à A ⇒ le brouillon n’est plus
//      bloqué en « uploading » : reçu repris, « Envoyer la photo » sans second dépôt, message posté sur A ;
//  (b) retour à A AVANT la réponse (nouvelle instance montée) puis reçu ⇒ même reprise ;
//  (c) identité changée pendant le dépôt ⇒ rien n’est appliqué ni envoyé.
// Jamais d’envoi au fil B. Vrai MessageCenter monté (live, StrictMode, Chromium), transports simulés.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MessageCenter } from "./components/app/forms";
${PRELUDE}
const ART = "a0000000-0000-4000-8000-000000000001";
const job = (n) => ({ id: "d0000000-0000-4000-8000-00000000000" + n, client_id: "c0000000-0000-4000-8000-000000000001", artisan_id: ART, site_id: null, category: n === 1 ? "panel" : "socket", description: "Dossier " + n, address: "3 rue", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "assigned", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-11-0" + n + "T10:00:00Z", updated_at: "2026-11-01T10:00:00Z" });
const A = job(1), B = job(2);
const DOC = "f0000000-0000-4000-8000-000000000001";
const fetchHistory = async () => new Response(JSON.stringify({ messages: [], page: { has_more: false, next_cursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
window.uploads = 0; window.sends = []; window.release = null;
const photoFetch = async (url, init) => {
  const u = String(url);
  if (u === "/api/documents") { window.uploads++; await new Promise((r) => { window.release = r; }); return new Response(JSON.stringify({ document: { id: DOC, name: "photo.png", mime_type: "image/png", created_at: "2026-11-08T10:00:00Z" } }), { status: 201, headers: { "content-type": "application/json" } }); }
  if (u === "/api/messages/photo") { const b = JSON.parse(init.body); window.sends.push(b); return new Response(JSON.stringify({ message: { id: b.id, intervention_id: b.intervention_id, author_id: ART, body: b.body, created_at: "2026-11-08T10:00:05Z", attachment_id: b.document_id } }), { status: 201, headers: { "content-type": "application/json" } }); }
  return new Response("{}", { status: 404 });
};
let setUid;
function Host() {
  const [uid, set] = useState(ART); setUid = set;
  const context = { generation: () => (uid === ART ? 1 : 2), userId: () => uid };
  return h(MessageCenter, { interventions: [A, B], messages: [], role: "artisan", profileId: uid, selectedId: A.id, busy: false, onSubmit: async () => true, live: true, fetchHistory, context, photoFetch });
}
const threadBtn = (div, label) => [...div.querySelectorAll(".message-threads button")].find((b) => (b.textContent || "").includes(label));
async function start(div) {
  await until(() => div.querySelector(".message-photo input[type=file]"));
  const input = div.querySelector(".message-photo input[type=file]");
  const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0])], "photo.png", { type: "image/png" }));
  input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => btn(div, "Envoyer la photo"));
  btn(div, "Envoyer la photo").click();
  await until(() => window.release);
}
window.scenarios = {
  async after() {
    const div = mountPoint(); createRoot(div).render(h(StrictMode, null, h(Host)));
    await start(div);
    threadBtn(div, "Prise").click(); await tick(100); // open B
    window.release(); await tick(150); // receipt arrives while B is shown
    threadBtn(div, "Tableau").click(); await tick(200); // back to A
    const phase = div.querySelector("[data-message-photo]")?.getAttribute("data-message-photo");
    const send = btn(div, "Envoyer la photo");
    if (send && !send.disabled) { send.click(); await tick(300); }
    return { phase, uploads: window.uploads, sends: window.sends };
  },
  async before() {
    window.uploads = 0; window.sends = []; window.release = null;
    const div = mountPoint(); createRoot(div).render(h(StrictMode, null, h(Host)));
    await start(div);
    threadBtn(div, "Prise").click(); await tick(100);
    threadBtn(div, "Tableau").click(); await tick(100); // back to A BEFORE the receipt (new instance)
    window.release(); await tick(300);
    const phase = div.querySelector("[data-message-photo]")?.getAttribute("data-message-photo");
    const send = btn(div, "Envoyer la photo");
    if (send && !send.disabled) { send.click(); await tick(300); }
    return { phase, uploads: window.uploads, sends: window.sends };
  },
  async identity() {
    window.uploads = 0; window.sends = []; window.release = null;
    const div = mountPoint(); createRoot(div).render(h(StrictMode, null, h(Host)));
    await start(div);
    setUid("a0000000-0000-4000-8000-000000000009"); await tick(100); // another identity
    window.release(); await tick(300);
    return { sends: window.sends, uploads: window.uploads };
  },
};
`;

test("E02 · reçu arrivé pendant le fil B ⇒ reprise sur A sans second dépôt, message sur A uniquement", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("after") as { phase: string; uploads: number; sends: { intervention_id: string }[] };
    assert.notEqual(r.phase, "uploading", "le brouillon n’est plus bloqué en dépôt");
    assert.equal(r.uploads, 1, "aucun second dépôt");
    assert.equal(r.sends.length, 1, `message photo envoyé une fois (${JSON.stringify(r.sends)})`);
    assert.equal(r.sends[0].intervention_id, "d0000000-0000-4000-8000-000000000001", "envoyé au fil A");
    assert.deepEqual(errors, []);
  });
});

test("E02 · retour à A avant le reçu (nouvelle instance) ⇒ même reprise", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("before") as { phase: string; uploads: number; sends: { intervention_id: string }[] };
    assert.notEqual(r.phase, "uploading", `nouvelle instance mise à jour (phase ${r.phase})`);
    assert.equal(r.uploads, 1);
    assert.equal(r.sends.length, 1);
    assert.equal(r.sends[0].intervention_id, "d0000000-0000-4000-8000-000000000001");
    assert.deepEqual(errors, []);
  });
});

test("E02 · identité changée pendant le dépôt ⇒ rien appliqué ni envoyé", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("identity") as { sends: unknown[] };
    assert.equal(r.sends.length, 0);
    assert.deepEqual(errors, []);
  });
});
