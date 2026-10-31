import test from "node:test";
import assert from "node:assert/strict";
import { canWrite, executeCommand, initialPanelState, panelReducer, previewTotals, readOnlyReason, scopeKey, successMessage, validateAmendmentForm, type PanelEvent, type PanelState } from "../../lib/features/quote-documents/panel-model";
import { quoteDocumentsDemo } from "../../lib/features/quote-documents/demo";
import type { QuoteDocumentsScope } from "../../lib/features/quote-documents/types";

const scope: QuoteDocumentsScope = { userId: "u1", role: "artisan", authority: { canWrite: true } };
const now = new Date("2026-10-31T12:00:00Z");

test("a null (stale) command result changes nothing visible: no notice, no error, no data change", () => {
  let state = panelReducer(initialPanelState("k"), { type: "loaded", overview: quoteDocumentsDemo("artisan") });
  state = panelReducer(state, { type: "command", action: "generate" });
  assert.equal(state.pending, "generate");
  const after = panelReducer(state, { type: "stale" });
  assert.deepEqual({ ...after, pending: "generate" }, state, "only the pending flag is cleared");
  assert.equal(after.notice, null);
  assert.equal(after.commandError, null);
  assert.equal(after.overview, state.overview);
});
test("a scope change resets every form, conflict, notice and loaded data", () => {
  let state: PanelState = { ...initialPanelState("a"), phase: "ready", overview: quoteDocumentsDemo("client"), notice: "x", conflict: { status: 409, message: "c" }, issuerMissing: ["siret"], pending: "accept" };
  state = panelReducer(state, { type: "reset", key: "b" });
  assert.deepEqual(state, initialPanelState("b"));
  assert.notEqual(scopeKey({ ...scope, userId: "u2" }, { interventionId: "i" }), scopeKey(scope, { interventionId: "i" }));
  assert.notEqual(scopeKey({ ...scope, siteId: "s" }, { interventionId: "i" }), scopeKey(scope, { interventionId: "i" }));
  assert.notEqual(scopeKey(scope, { quoteId: "q" }), scopeKey(scope, { interventionId: "q" }));
});
test("server refusals are kept as-is; 409 becomes an explicit reload conflict; issuer_incomplete lists fields", () => {
  const base = panelReducer(initialPanelState("k"), { type: "command", action: "generate" });
  const refused = panelReducer(base, { type: "command_failed", failure: { status: 403, message: "Vous n’avez pas accès à cette action." } });
  assert.equal(refused.commandError?.message, "Vous n’avez pas accès à cette action.");
  assert.equal(refused.pending, null);
  const conflict = panelReducer(base, { type: "command_failed", failure: { status: 409, message: "L’état du dossier a changé." } });
  assert.equal(conflict.conflict?.status, 409);
  assert.equal(conflict.commandError, null);
  const issuer = panelReducer(base, { type: "command_failed", failure: { status: 409, message: "incomplet", code: "issuer_incomplete", missing: ["siret", "address"] } });
  assert.deepEqual(issuer.issuerMissing, ["siret", "address"]);
  assert.equal(issuer.conflict, null);
  assert.equal(panelReducer(base, { type: "command", action: "accept" }).pending, "generate", "double submission ignored while pending");
});
test("success messages describe the exact outcome, including an unchanged document", () => {
  const doc = { id: "d", kind: "quote" as const, reference: "DEV-ABC123", revision: 2, quote_id: "q", amendment_id: null, generated_at: "2026-10-31T00:00:00Z", snapshot_sha256: "a".repeat(64) };
  assert.match(successMessage({ action: "generate", document: doc, created: true }), /révision 2/);
  assert.match(successMessage({ action: "generate", document: doc, created: false }), /déjà à jour/);
  assert.match(successMessage({ action: "set_terms", terms: { quote_id: "q", valid_until: null, validity: "unspecified" } }), /non renseignée/);
  assert.match(successMessage({ action: "accept", amendment: quoteDocumentsDemo("client").quotes[0].amendments[0] }), /règlement en ligne reste/i);
  const done = panelReducer(panelReducer(initialPanelState("k"), { type: "command", action: "generate" }), { type: "command_done", result: { action: "generate", document: doc, created: true } });
  assert.equal(done.pending, null);
  assert.ok(done.notice);
});
test("write controls need the lead authority AND the server permission; the reason is shown otherwise", () => {
  assert.equal(canWrite(scope, true), true);
  assert.equal(canWrite(scope, false), false);
  assert.equal(canWrite({ ...scope, authority: { canWrite: false, reason: "Lecture seule sur ce site." } }, true), false);
  assert.equal(readOnlyReason({ ...scope, authority: { canWrite: false, reason: "Lecture seule sur ce site." } }), "Lecture seule sur ce site.");
  assert.match(readOnlyReason({ ...scope, authority: { canWrite: false } }), /lecture seule/i);
});
test("amendment form validation keeps errors near fields and only emits server-shaped values", () => {
  const invalid = validateAmendmentForm({ lines: [{ label: "", quantity: "0", price: "-1" }], taxRate: "7", reason: "", validUntil: "2026-10-01" }, now);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.deepEqual(Object.keys(invalid.errors.lines[0]).sort(), ["label", "price", "quantity"]);
    assert.ok(invalid.errors.taxRate && invalid.errors.reason && invalid.errors.validUntil);
  }
  const zero = validateAmendmentForm({ lines: [{ label: "Pièce", quantity: "1", price: "0" }], taxRate: "20", reason: "Motif", validUntil: "" }, now);
  assert.equal(zero.ok, false);
  const valid = validateAmendmentForm({ lines: [{ label: " Disjoncteur ", quantity: "2", price: "60,50" }], taxRate: "5.5", reason: " Motif ", validUntil: "2026-11-30" }, now);
  assert.deepEqual(valid, { ok: true, value: { lines: [{ label: "Disjoncteur", quantity: 2, unit_price_cents: 6050 }], tax_rate: 5.5, reason: "Motif", valid_until: "2026-11-30" } });
  assert.equal(validateAmendmentForm({ lines: [], taxRate: "20", reason: "Motif", validUntil: "" }, now).ok, false);
  assert.deepEqual(previewTotals({ lines: [{ label: "x", quantity: "2", price: "60" }], taxRate: "20", reason: "", validUntil: "" }), { subtotal: "120,00 €", tax: "24,00 €", total: "144,00 €", taxLabel: "20 %" });
  assert.equal(previewTotals({ lines: [{ label: "x", quantity: "", price: "60" }], taxRate: "20", reason: "", validUntil: "" }), null);
});

// --- Continuation guard: a command that resolves after a scope/target change changes nothing ---
const overview = () => quoteDocumentsDemo("artisan");
const proposeBody = { action: "propose" as const, base_quote_id: "q", lines: [{ label: "x", quantity: 1, unit_price_cents: 100 }], tax_rate: 20 as const, reason: "m", valid_until: null };
const amendmentResult = { action: "propose" as const, amendment: overview().quotes[0].amendments[0] };
function recorder() {
  const events: PanelEvent[] = [];
  let state = panelReducer(initialPanelState("old"), { type: "loaded", overview: overview() });
  const dispatch = (event: PanelEvent) => {
    events.push(event);
    state = panelReducer(state, event);
  };
  return { events, dispatch, state: () => state };
}
test("a command resolving after the scope changed: false, no notice, no reload, the new scope's form is not reset", async () => {
  let current = true;
  let loads = 0;
  const r = recorder();
  const client = {
    command: async () => {
      current = false; // identity/scope changed while the request was in flight
      return amendmentResult;
    },
    load: async () => {
      loads++;
      return overview();
    },
  };
  let proposingFormOpenInNewScope = true;
  const ok = await executeCommand({ client, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => current, dispatch: r.dispatch });
  if (ok) proposingFormOpenInNewScope = false; // the component callback pattern
  assert.equal(ok, false);
  assert.equal(proposingFormOpenInNewScope, true, "the new scope's form stays open");
  assert.deepEqual(r.events.map((e) => e.type), ["command"], "nothing after the stale await");
  assert.equal(loads, 0, "no reload for a scope that is no longer mounted");
  assert.equal(r.state().notice, null);
});
test("a null command result (stale chain) stops before the reload with no notice", async () => {
  const r = recorder();
  let loads = 0;
  const ok = await executeCommand({ client: { command: async () => null, load: async () => (loads++, overview()) }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => true, dispatch: r.dispatch });
  assert.equal(ok, false);
  assert.deepEqual(r.events.map((e) => e.type), ["command", "stale"]);
  assert.equal(loads, 0);
  assert.equal(r.state().notice, null);
  assert.equal(r.state().pending, null);
});
test("a null reload after a successful command: false, no success notice, no data update", async () => {
  const r = recorder();
  const before = r.state().overview;
  const ok = await executeCommand({ client: { command: async () => amendmentResult, load: async () => null }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => true, dispatch: r.dispatch });
  assert.equal(ok, false);
  assert.deepEqual(r.events.map((e) => e.type), ["command", "stale"]);
  assert.equal(r.state().notice, null);
  assert.equal(r.state().overview, before);
});
test("a scope change during the reload: false, nothing dispatched after the second await", async () => {
  let current = true;
  const r = recorder();
  const ok = await executeCommand({ client: { command: async () => amendmentResult, load: async () => ((current = false), overview()) }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => current, dispatch: r.dispatch });
  assert.equal(ok, false);
  assert.deepEqual(r.events.map((e) => e.type), ["command"]);
  assert.equal(r.state().notice, null);
});
test("a current, successful command applies the fresh read first, then the notice, and returns true", async () => {
  const r = recorder();
  const fresh = overview();
  fresh.history = [];
  const ok = await executeCommand({ client: { command: async () => amendmentResult, load: async () => fresh }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => true, dispatch: r.dispatch });
  assert.equal(ok, true);
  assert.deepEqual(r.events.map((e) => e.type), ["command", "loaded", "command_done"]);
  assert.equal(r.state().overview, fresh);
  assert.match(r.state().notice ?? "", /Avenant n° 1 proposé/);
  const failed = recorder();
  assert.equal(await executeCommand({ client: { command: async () => { throw { status: 403, message: "Refusé par le serveur." }; }, load: async () => fresh }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => true, dispatch: failed.dispatch }), false);
  assert.equal(failed.state().commandError?.message, "Refusé par le serveur.");
  const staleFailure = recorder();
  assert.equal(await executeCommand({ client: { command: async () => { throw { status: 403, message: "x" }; }, load: async () => fresh }, body: proposeBody, target: { interventionId: "i" }, isCurrent: () => false, dispatch: staleFailure.dispatch }), false);
  assert.deepEqual(staleFailure.events.map((e) => e.type), ["command"], "a failure of a stale chain is not shown either");
});
