// CLI-07 — in-app notifications of quote amendments written by the route after the SQL command.
import test from "node:test";
import assert from "node:assert/strict";
import { amendmentFacts, buildAmendmentNotification, interventionReference, notifyAmendment } from "../../lib/features/quote-documents/amendment-notifications";
import { notificationLabel, preferenceLabel } from "../../lib/features/notifications/kinds";

const CLIENT = "c0000000-0000-4000-8000-000000000001", ARTISAN = "a0000000-0000-4000-8000-000000000001";
const AMENDMENT = { id: "e2000000-0000-4000-8000-000000000001", intervention_id: "d0192d95-c17b-4048-9368-f7ab7a6ec02c", base_quote_id: "e1000000-0000-4000-8000-000000000001", artisan_id: ARTISAN, reference: "AV-1-DEV-A83117", total_cents: 4340, status: "proposed" };

function fakeAdmin(clientId: string | null = CLIENT, rpcError: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: clientId ? { client_id: clientId } : null, error: null }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: rpcError }; },
  };
  return { calls, get: () => admin as never };
}

test("each event tells the other party, with an amendment title, the dossier and the server amount", () => {
  const facts = amendmentFacts(AMENDMENT)!;
  assert.equal(interventionReference(AMENDMENT.intervention_id), "INT-D0192D");
  const proposed = buildAmendmentNotification("proposed", facts);
  assert.equal(proposed.recipient, "requester");
  assert.equal(proposed.kind, "quote_received");
  assert.equal(proposed.title, "Avenant proposé");
  assert.match(proposed.body, /AV-1-DEV-A83117 \(43,40\s€ TTC\).*INT-D0192D.*sans votre accord/);
  assert.equal(proposed.dedupe, `amendment:${AMENDMENT.id}:proposed`);
  assert.deepEqual([buildAmendmentNotification("accepted", facts).recipient, buildAmendmentNotification("accepted", facts).kind, buildAmendmentNotification("accepted", facts).title], ["artisan", "quote_accepted", "Avenant accepté"]);
  assert.deepEqual([buildAmendmentNotification("rejected", facts).recipient, buildAmendmentNotification("rejected", facts).kind, buildAmendmentNotification("rejected", facts).title], ["artisan", "quote_rejected", "Avenant refusé"]);
  assert.deepEqual([buildAmendmentNotification("withdrawn", facts).recipient, buildAmendmentNotification("withdrawn", facts).kind], ["requester", "quote_received"]);
  for (const event of ["proposed", "withdrawn", "accepted", "rejected"] as const) {
    const n = buildAmendmentNotification(event, facts);
    assert.ok(n.title.length <= 160 && n.body.length <= 600 && n.dedupe.length <= 200);
    assert.equal(n.payload.subject, "quote_amendment");
    assert.equal(n.payload.amendment_id, AMENDMENT.id);
  }
});

test("the notification is written through notify for the right recipient; never to the actor, never on an untrusted amendment", async () => {
  const proposal = fakeAdmin();
  assert.equal(await notifyAmendment(proposal.get, "proposed", AMENDMENT, ARTISAN), true);
  assert.equal(proposal.calls.length, 1);
  assert.equal(proposal.calls[0].name, "notify");
  assert.equal(proposal.calls[0].args.p_recipient, CLIENT);
  assert.equal(proposal.calls[0].args.p_actor, ARTISAN);
  assert.equal(proposal.calls[0].args.p_intervention, AMENDMENT.intervention_id);
  const decision = fakeAdmin();
  assert.equal(await notifyAmendment(decision.get, "accepted", AMENDMENT, CLIENT), true);
  assert.equal(decision.calls[0].args.p_recipient, ARTISAN);
  assert.equal(decision.calls[0].args.p_kind, "quote_accepted");
  const self = fakeAdmin(ARTISAN);
  assert.equal(await notifyAmendment(self.get, "proposed", AMENDMENT, ARTISAN), false);
  assert.equal(self.calls.length, 0);
  let built = 0;
  assert.equal(await notifyAmendment(() => { built++; return fakeAdmin().get(); }, "proposed", { id: AMENDMENT.id, version: 1, status: "proposed", total_cents: 14400 }, ARTISAN), false);
  assert.equal(built, 0, "no service client for an incomplete amendment");
  // A failing notification never throws: the confirmed command is not undone.
  assert.equal(await notifyAmendment(() => { throw new Error("no service key"); }, "proposed", AMENDMENT, ARTISAN), false);
  assert.equal(await notifyAmendment(fakeAdmin(CLIENT, { message: "x" }).get, "proposed", AMENDMENT, ARTISAN), false);
});

test("the notification centre labels an amendment as such, and the preference option says what it mutes", () => {
  assert.equal(notificationLabel({ kind: "quote_received", payload: { subject: "quote_amendment", event: "proposed" } }), "Avenant proposé");
  assert.equal(notificationLabel({ kind: "quote_accepted", payload: { subject: "quote_amendment", event: "accepted" } }), "Avenant accepté");
  assert.equal(notificationLabel({ kind: "quote_rejected", payload: { subject: "quote_amendment", event: "rejected" } }), "Avenant refusé");
  assert.equal(notificationLabel({ kind: "quote_received", payload: { quote_id: "x" } }), "Devis reçu");
  assert.equal(notificationLabel({ kind: "quote_received", payload: { subject: "quote_amendment", event: "constructor" } }), "Devis reçu");
  assert.match(preferenceLabel("quote_received"), /avenant/);
  assert.equal(preferenceLabel("message_received"), "Nouveau message");
});
