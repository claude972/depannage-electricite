// E43 (registre phase 2) — ART-07 : l’éditeur qui a envoyé le devis (réponse perdue) ne doit pas
// annoncer « Un devis a été publié par un autre canal » quand la relecture du workspace fait
// apparaître ce nouveau devis ; l’état incertain de SON envoi est expliqué honnêtement.
// Vrai QuoteDraftEditor monté (StrictMode, Chromium), session simulée.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QuoteDraftEditor } from "./components/role/artisan-quote-draft";
${PRELUDE}
const J = "d0000000-0000-4000-8000-000000000001", ART = "a0000000-0000-4000-8000-000000000001";
const OLD = "e1000000-0000-4000-8000-000000000001", NEW = "e1000000-0000-4000-8000-000000000002";
const draft = { intervention_id: J, artisan_id: ART, version: 2, assignment_token: "tok", base_quote_id: OLD, lines: [{ label: "Diagnostic", quantity: 1, unit_price_cents: 10000 }], tax_rate: 20, updated_at: "2026-11-08T10:00:00.000Z" };
const sentQuote = (id, at) => ({ id, intervention_id: J, artisan_id: ART, lines: draft.lines, subtotal_cents: 10000, tax_rate: 20, tax_cents: 2000, total_cents: 12000, status: "sent", created_at: at });
let setQuotes;
window.sends = 0;
function Host() {
  const [quotes, set] = useState([sentQuote(OLD, "2026-11-07T10:00:00.000Z")]); setQuotes = set;
  const session = new Proxy({
    mode: "live", busy: false, profileId: ART, data: { quotes, interventions: [], payments: [] },
    capabilities: new Proxy({}, { get: () => "missing" }),
    loadQuoteDraft: async () => ({ draft, version: 2, assignment_token: "tok", current_quote_id: OLD }),
    quoteDraftCommand: async (_i, body) => { if (body.action === "send") { window.sends++; return { ok: false, conflict: false, message: "La réponse du serveur n’a pas été reçue." }; } return { ok: false, conflict: false, message: "x" }; },
  }, { get: (t, k) => (k in t ? t[k] : typeof k === "string" ? async () => null : undefined) });
  return h(QuoteDraftEditor, { session, interventionId: J, onPublished: () => {} });
}
window.scenarios = {
  async e43() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(Host)));
    const sendBtn = () => [...div.querySelectorAll("button")].find((b) => /Envoyer|Publier/.test(b.textContent || "") && !b.disabled);
    await until(() => sendBtn());
    sendBtn().click();
    await until(() => window.sends === 1);
    await tick(200);
    setQuotes([sentQuote(OLD, "2026-11-07T10:00:00.000Z"), sentQuote(NEW, "2026-11-08T10:01:00.000Z")]); // workspace re-read
    await tick(300);
    return { text: txt(div) };
  },
};
`;

test("E43 · envoi à réponse perdue puis nouveau devis relu ⇒ jamais « autre canal », état de l’envoi expliqué", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e43");
    assert.doesNotMatch(r.text, /publié par un autre canal/, "l’éditeur ne s’attribue pas un autre canal");
    assert.match(r.text, /votre envoi a pu aboutir/i, "issue incertaine de son propre envoi expliquée");
    assert.deepEqual(errors, []);
  }, 1280);
});
