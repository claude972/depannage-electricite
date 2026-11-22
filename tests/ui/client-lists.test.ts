import test from "node:test";
import assert from "node:assert/strict";
import { acceptedQuoteSummary, CLIENT_STEPS, currentStepIndex, detailHistory, requestAmount, isSettled, quoteDecisionState, quoteLineCells, recentRowDescriptor } from "../../components/role/client-lists";

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
  assert.equal(currentStepIndex("accepted"), 3, "devis validé : préparation de l’intervention");
  assert.equal(currentStepIndex("in_progress"), 3);
  assert.equal(currentStepIndex("completed"), 4);
  assert.equal(currentStepIndex("paid"), 4, "payé sans horodatage serveur : dernière étape encore courante");
  assert.equal(currentStepIndex("paid", "2026-10-22T05:00:00Z"), CLIENT_STEPS.length, "règlement confirmé : toutes les étapes terminées");
  assert.equal(currentStepIndex("completed", "2026-10-22T05:00:00Z"), 4, "un horodatage sans statut payé ne termine rien");
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
  assert.equal(pending[5].state, "done", "les travaux sont terminés");
  assert.equal(pending[6].state, "current");
  assert.equal(pending[6].when, "—", "aucune date de règlement inventée");
  const paidWithoutStamp = detailHistory({ status: "paid", created_at: "c", completed_at: "f", paid_at: null }, {}, format);
  assert.equal(paidWithoutStamp[6].state, "current", "statut payé sans horodatage : pas de succès anticipé");
  assert.equal(paidWithoutStamp[6].when, "—");
  assert.deepEqual(detailHistory({ status: "cancelled", created_at: "c", completed_at: null, paid_at: null }, {}, format).map((h) => h.label), ["Demande créée", "Demande annulée"]);
});


test("montant client : estimation, devis accepté et paiement horodaté restent distincts", () => {
  const intervention = { id: "i1", status: "accepted" as const, estimate_min_cents: 12000, estimate_max_cents: 28000 };
  const quote = { id: "q1", intervention_id: "i1", status: "accepted", total_cents: 19200, accepted_total_cents: 19200, created_at: "2026-11-01", lines: [], subtotal_cents: 16000, tax_cents: 3200, tax_rate: 20 as const };
  const payment = { id: "p1", quote_id: "q1", total_cents: 14400, currency: "eur", status: "paid", created_at: "2026-11-02", paid_at: "2026-11-02" };
  assert.equal(requestAmount(intervention, [], [], money), "Estimation : 120,00 € – 280,00 €");
  assert.equal(requestAmount(intervention, [{ ...quote, status: "sent" }], [payment], money), "Devis reçu : 192,00 €");
  assert.equal(requestAmount(intervention, [quote], [], money), "Devis accepté : 192,00 €");
  assert.equal(requestAmount(intervention, [quote], [{ ...payment, paid_at: null }], money), "Devis accepté : 192,00 €");
  assert.equal(requestAmount(intervention, [quote], [{ ...payment, status: "pending" }], money), "Devis accepté : 192,00 €");
  assert.equal(requestAmount(intervention, [quote], [{ ...payment, quote_id: "other" }], money), "Devis accepté : 192,00 €");
  assert.equal(requestAmount(intervention, [quote], [payment], money), "Montant payé : 144,00 €");
  assert.equal(requestAmount(intervention, [quote], [{ ...payment, method: "on_site_declared" }], money), "Règlement déclaré : 144,00 €");
});

test("chronologie : un devis accepté est terminé, l’intervention reste à préparer", () => {
  const history = detailHistory({ status: "accepted", created_at: "c", completed_at: null, paid_at: null }, { quoteAcceptedAt: "a" }, (x) => x);
  assert.equal(history[3].state, "done");
  assert.equal(history[3].when, "a");
  assert.equal(history[4].state, "current");
  assert.equal(history[5].state, "upcoming");
});


test("montant client : dernier devis envoyé du dossier et montant accepté à régler après travaux", () => {
  const intervention = { id: "i1", status: "quoted" as const, estimate_min_cents: 12000, estimate_max_cents: 28000 };
  const quote = { id: "q1", intervention_id: "i1", status: "sent", total_cents: 19200, created_at: "2026-11-01", lines: [], subtotal_cents: 16000, tax_cents: 3200, tax_rate: 20 as const };
  const latest = { ...quote, id: "q2", total_cents: 22200, created_at: "2026-11-02" };
  const irrelevant = [{ ...latest, id: "q3", status: "rejected", total_cents: 99000 }, { ...latest, id: "q4", intervention_id: "other", total_cents: 88000 }];
  assert.equal(requestAmount(intervention, [quote, ...irrelevant, latest], [], money), "Devis reçu : 222,00 €");
  assert.equal(requestAmount(intervention, irrelevant, [], money), "Estimation : 120,00 € – 280,00 €");
  const accepted = { ...quote, status: "accepted", accepted_total_cents: 24200 };
  assert.equal(requestAmount({ ...intervention, status: "completed" }, [accepted, latest], [], money), "À régler : 242,00 €", "includes server accepted total, never treats completed as paid");
  assert.equal(requestAmount({ ...intervention, status: "paid" }, [accepted], [], money), "Devis accepté : 242,00 €", "paid dossier alone is not a payment receipt");
});

test("CLI-07 : avenants du devis accepté — total cohérent avec le montant dû, avenant proposé jamais compté", () => {
  const quote = { id: "q1", total_cents: 16780, accepted_total_cents: 16780 };
  const a = (id: string, status: string, total_cents: number, base_quote_id = "q1") => ({ id, base_quote_id, reference: `AV-${id}`, status, reason: "", total_cents });
  // Lecture des avenants inconnue : total accepté du serveur, sinon total de base.
  assert.deepEqual(acceptedQuoteSummary({ ...quote, accepted_total_cents: 21120 }, null), { pending: [], accepted: [], due_cents: 21120 });
  assert.equal(acceptedQuoteSummary({ id: "q1", total_cents: 16780 }, null).due_cents, 16780);
  // Avenant proposé : visible, mais le total reste celui du devis.
  const proposed = acceptedQuoteSummary(quote, [a("1", "proposed", 4340)]);
  assert.deepEqual(proposed.pending.map((x) => x.id), ["1"]);
  assert.equal(proposed.due_cents, 16780);
  // Accepté : devis + avenants acceptés ; refusé, retiré ou d’un autre devis : ignorés.
  const mixed = acceptedQuoteSummary(quote, [a("1", "accepted", 4340), a("2", "rejected", 999), a("3", "withdrawn", 999), a("4", "accepted", 999, "q2"), a("5", "proposed", 1000)]);
  assert.deepEqual(mixed.accepted.map((x) => x.id), ["1"]);
  assert.deepEqual(mixed.pending.map((x) => x.id), ["5"]);
  assert.equal(mixed.due_cents, 21120);
});
