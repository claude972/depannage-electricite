import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_STEPS, currentStepIndex, detailHistory, isSettled, quoteDecisionState, quoteLineCells, recentRowDescriptor } from "../../components/role/client-lists";

const label = (id: string) => ({ panel: "Tableau électrique", outage: "Coupure de courant" })[id] ?? id;
const money = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

test("ligne récente M61 : titre réel, adresse sur une ligne, état et date enregistrés", () => {
  const row = recentRowDescriptor({ category: "panel", address: " 12 rue des Alizés ", postal_code: "97200", city: "Fort-de-France", status: "quoted", created_at: "2026-10-30T10:00:00Z" }, label);
  assert.deepEqual(row, { title: "Tableau électrique", address: "12 rue des Alizés, 97200 Fort-de-France", status: "quoted", createdAt: "2026-10-30T10:00:00Z" });
  assert.equal(recentRowDescriptor({ category: "outage", address: "", postal_code: "", city: "Le Lamentin", status: "paid", created_at: "x" }, label).address, "Le Lamentin");
});
test("cellules d’une ligne de devis : quantité × PU et total HT de ligne, jamais un autre montant", () => {
  assert.deepEqual(quoteLineCells({ quantity: 2, unit_price_cents: 6000 }, money), { unit: "2 × 60,00 €", total_cents: 12000 });
  assert.deepEqual(quoteLineCells({ quantity: 1, unit_price_cents: 0 }, money), { unit: "1 × 0,00 €", total_cents: 0 });
});
test("état de décision d’un devis : actif seulement pour la version envoyée du dossier au statut « devis »", () => {
  const sent = { id: "q2", status: "sent" };
  assert.equal(quoteDecisionState(sent, sent, "quoted"), "active");
  assert.equal(quoteDecisionState(sent, sent, "assigned"), "closed", "dossier déjà repassé en attribution");
  assert.equal(quoteDecisionState({ id: "q1", status: "sent" }, sent, "quoted"), "superseded", "une autre version est la version courante");
  assert.equal(quoteDecisionState({ id: "q1", status: "rejected" }, sent, "quoted"), "superseded");
  assert.equal(quoteDecisionState({ id: "q1", status: "accepted" }, undefined, "accepted"), "accepted");
  assert.equal(quoteDecisionState(sent, undefined, "cancelled"), "closed");
});
test("stepper V8-C07 : cinq étapes alignées sur les statuts réels", () => {
  assert.equal(CLIENT_STEPS.length, 5);
  assert.equal(currentStepIndex("requested"), 0);
  assert.equal(currentStepIndex("assigned"), 1);
  assert.equal(currentStepIndex("quoted"), 2);
  assert.equal(currentStepIndex("accepted"), 2, "accepté = devis validé, intervention pas encore démarrée");
  assert.equal(currentStepIndex("in_progress"), 3);
  assert.equal(currentStepIndex("completed"), 3);
  assert.equal(currentStepIndex("paid"), 4, "payé sans horodatage serveur : dernière étape encore courante");
  assert.equal(currentStepIndex("paid", "2026-10-22T05:00:00Z"), CLIENT_STEPS.length, "règlement confirmé : toutes les étapes terminées");
  assert.equal(currentStepIndex("completed", "2026-10-22T05:00:00Z"), 3, "un horodatage sans statut payé ne termine rien");
  assert.equal(currentStepIndex("cancelled"), -1);
  assert.equal(isSettled({ status: "paid", paid_at: "x" }), true);
  assert.equal(isSettled({ status: "paid", paid_at: null }), false);
  assert.equal(isSettled({ status: "completed", paid_at: "x" }), false);
});
test("chronologie V8-C07 : dates enregistrées seulement, « — » sinon, « À venir » après l’étape courante", () => {
  const format = (iso: string) => `[${iso}]`;
  const history = detailHistory({ status: "in_progress", created_at: "c", completed_at: null, paid_at: null }, { quoteReceivedAt: "r", quoteAcceptedAt: "a", appointmentStartsAt: null }, format);
  assert.deepEqual(history.map((h) => [h.label, h.when, h.state]), [
    ["Demande créée", "[c]", "done"],
    ["Artisan attribué", "—", "done"],
    ["Devis reçu", "[r]", "done"],
    ["Devis accepté", "[a]", "done"],
    ["Intervention", "—", "current"],
    ["Intervention terminée", "À venir", "upcoming"],
    ["Règlement", "À venir", "upcoming"],
  ]);
  const paid = detailHistory({ status: "paid", created_at: "c", completed_at: "f", paid_at: "p" }, { appointmentStartsAt: "s" }, format);
  assert.equal(paid[4].when, "Créneau [s]");
  assert.equal(paid[6].state, "done", "règlement confirmé par le serveur (paid + paid_at) : terminé");
  assert.equal(paid[6].when, "[p]");
  assert.ok(paid.every((h) => h.state === "done"), "un dossier réglé n’a plus d’étape courante ni à venir");
  const pending = detailHistory({ status: "completed", created_at: "c", completed_at: "f", paid_at: null }, {}, format);
  assert.equal(pending[5].state, "current", "terminée, règlement non confirmé : l’étape terminée est courante");
  assert.equal(pending[6].state, "upcoming");
  assert.equal(pending[6].when, "À venir", "jamais de règlement affiché avant la confirmation serveur");
  const paidWithoutStamp = detailHistory({ status: "paid", created_at: "c", completed_at: "f", paid_at: null }, {}, format);
  assert.equal(paidWithoutStamp[6].state, "current", "statut payé sans horodatage : pas de succès anticipé");
  assert.equal(paidWithoutStamp[6].when, "—");
  assert.deepEqual(detailHistory({ status: "cancelled", created_at: "c", completed_at: null, paid_at: null }, {}, format).map((h) => h.label), ["Demande créée", "Demande annulée"]);
});
