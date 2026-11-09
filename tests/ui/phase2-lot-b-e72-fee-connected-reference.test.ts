// E72 (registre phase 2) — ART-11 / ADM-05 / FIN-06 : preuve de commission Connect.
// Contrat A (signal Codex) : connected_charge_id accepte exactement ch_ ou py_ (feeConnectedReference) ;
// charge_id plateforme reste ch_ ; liaisons (payment_id, event_id) inchangées.
// Vraie ProofSection montée (StrictMode, Chromium), API simulée, identifiants synthétiques.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProofSection } from "./components/features/finance-proofs/proofs-panel";
${PRELUDE}
const PAY = "40000000-0000-4000-8000-000000000001";
const EVT = "evt_recette0001";
const qual = (src) => ({ qualification: { event_id: EVT, payment_id: PAY, source: { payment_id: PAY, event_id: EVT, live: false, fee_id: "fee_recette1", charge_id: "ch_recetteplateforme", connected_charge_id: "py_recetteconnectee", destination_account: "acct_recette1", amount_cents: 900, currency: "eur", observation_fingerprint: "a".repeat(64), observation_created: "2026-11-08T10:00:00.000Z", ...src }, provider_amount_refunded_cents: 0, provider_refunded: false, fee_created: 1762596000, provider_observed_at: "2026-11-08T10:01:00.000Z", qualified_at: "2026-11-08T10:02:00.000Z" } });
const context = { generation: () => 1, userId: () => "f0000000-0000-4000-8000-000000000003" };
async function show(body) {
  const div = mountPoint();
  const api = { read: async () => ({ status: 200, body, retryAfter: null }), qualify: async () => ({ status: 503, body: null, retryAfter: null }) };
  createRoot(div).render(h(StrictMode, null, h(ProofSection, { target: { kind: "fee", paymentId: PAY, eventId: EVT }, title: "Commission", canWrite: false, context, api })));
  await until(() => { const p = div.querySelector("[data-proof]")?.getAttribute("data-proof-phase"); return p === "ready" || p === "error"; });
  await tick(50);
  return { phase: div.querySelector("[data-proof]").getAttribute("data-proof-phase"), text: txt(div) };
}
window.scenarios = {
  async py() { return show(qual({})); },
  async ch() { return show(qual({ connected_charge_id: "ch_recetteconnectee" })); },
  async platformPy() { return show(qual({ charge_id: "py_recetteplateforme" })); },
  async otherPrefix() { return show(qual({ connected_charge_id: "pi_recetteconnectee" })); },
  async foreignPayment() { return show(qual({ payment_id: "40000000-0000-4000-8000-000000000002" })); },
};
`;

test("E72 · connected_charge_id py_ ou ch_ accepté ; charge_id plateforme ch_ seulement ; autres préfixes et liaisons refusés", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const py = await run("py");
    assert.equal(py.phase, "ready", "py_ accepté pour la charge connectée");
    assert.match(py.text, /py_recetteconnectee/);
    assert.equal((await run("ch")).phase, "ready", "ch_ toujours accepté");
    assert.equal((await run("platformPy")).phase, "error", "charge plateforme py_ refusée");
    assert.equal((await run("otherPrefix")).phase, "error", "autre préfixe refusé");
    assert.equal((await run("foreignPayment")).phase, "error", "liaison au paiement conservée");
    assert.deepEqual(errors, []);
  });
});
