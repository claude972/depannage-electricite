import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { harness } from "./harness";
import { canEdit, reduceCommand, reduceLoad, scopeKey, type LeafScope, type PlanningClient } from "../../lib/features/planning/leaf";
import { demoPlanning } from "../../lib/features/planning/demo";
import type { PlanningView } from "../../lib/features/planning/types";

const scope = (over: Partial<LeafScope> = {}): LeafScope => ({ userId: "artisan-a", role: "artisan", authority: { canWrite: true }, ...over });
const view = demoPlanning({ from: "2026-11-02T04:00:00+00:00", to: "2026-11-09T04:00:00+00:00" });
function trackingClient(): PlanningClient & { calls: string[] } {
  const calls: string[] = [];
  return { calls, load: async () => { calls.push("load"); return view; }, command: async () => { calls.push("command"); return null; } };
}
function render(props: Record<string, unknown>) {
  const h = harness();
  const { ArtisanPlanning } = h.load("components/features/planning/artisan-planning.tsx") as { ArtisanPlanning: (p: unknown) => unknown };
  return renderToString(createElement(ArtisanPlanning as never, props as never)).replaceAll("<!-- -->", "");
}

test("scope key and stale-chain reducers never let data or success leak across identities", () => {
  assert.equal(scopeKey(scope()), "artisan-a||");
  assert.notEqual(scopeKey(scope()), scopeKey(scope({ userId: "artisan-b" })));
  assert.notEqual(scopeKey(scope()), scopeKey(scope({ organizationId: "org-1" })));
  const previous = { status: "ready" as const, data: view };
  assert.equal(reduceLoad<PlanningView>(previous, null), previous);
  assert.deepEqual(reduceLoad<PlanningView>({ status: "loading" }, null), { status: "loading" });
  assert.deepEqual(reduceLoad<PlanningView>(previous, { error: "Refusé" }), { status: "error", message: "Refusé" });
  assert.deepEqual(reduceCommand(null), { kind: "stale" });
  assert.deepEqual(reduceCommand({ ok: false, conflict: true, message: "Créneau déjà occupé" }), { kind: "conflict", message: "Créneau déjà occupé" });
  assert.deepEqual(reduceCommand({ ok: false, conflict: false, message: "Accès refusé" }), { kind: "refused", message: "Accès refusé" });
  assert.deepEqual(reduceCommand({ ok: true, data: { rule: view.rules[0], replayed: true } }), { kind: "success", replayed: true });
  assert.deepEqual(reduceCommand({ ok: true, data: { deleted: true, id: "x" } }), { kind: "success", replayed: false });
});
test("write permission requires both the integrator authority and the server view", () => {
  assert.deepEqual(canEdit(scope(), view), { allowed: true, reason: null });
  assert.equal(canEdit(scope({ authority: { canWrite: false, reason: "Compte suspendu." } }), view).reason, "Compte suspendu.");
  assert.equal(canEdit(scope({ authority: { canWrite: false } }), null).allowed, false);
  assert.equal(canEdit(scope(), { ...view, permissions: { can_edit: false, reason: "Lecture seule serveur." } }).reason, "Lecture seule serveur.");
});
test("unavailable contract renders the common message and no planning controls", () => {
  const client = trackingClient();
  for (const state of ["missing", "unavailable", "unknown"] as const) {
    const html = render({ state, unavailableMessage: "Fonction non activée sur ce service.", scope: scope(), client });
    assert.match(html, /Fonction non activée sur ce service\./);
    assert.doesNotMatch(html, /Ajouter une plage|Semaine du/);
    assert.match(html, /data-blocker="capability:planning"/);
  }
  assert.deepEqual(client.calls, []);
});
test("read-only scope hides every write control and shows the reason; writable scope shows them", () => {
  const client = trackingClient();
  const readOnly = render({ state: "available", unavailableMessage: "", scope: scope({ authority: { canWrite: false, reason: "Votre compte est suspendu." } }), client, demo: view });
  assert.match(readOnly, /Lecture seule/);
  assert.match(readOnly, /Votre compte est suspendu\./);
  assert.doesNotMatch(readOnly, /Ajouter une plage|Ajouter une entrée|Supprimer|Modifier/);
  assert.match(readOnly, /Libre/);
  assert.match(readOnly, /Rendez-vous INT-DEMOA1/);
  const serverReadOnly = render({ state: "available", unavailableMessage: "", scope: scope(), client, demo: { ...view, permissions: { can_edit: false, reason: "Planning verrouillé." } } });
  assert.match(serverReadOnly, /Planning verrouillé\./);
  assert.doesNotMatch(serverReadOnly, /Ajouter une plage/);
  const writable = render({ state: "available", unavailableMessage: "", scope: scope(), client, demo: view });
  assert.match(writable, /Démonstration/);
  assert.doesNotMatch(writable, /Ajouter une plage/, "demo data is never editable");
  assert.match(writable, /Lundi<\/strong> 08:00 – 12:00/);
  assert.match(writable, /heure de Martinique/);
  assert.deepEqual(client.calls, []);
});
test("an empty planning states the next action instead of an empty grid", () => {
  const empty: PlanningView = { ...view, rules: [], entries: [], appointments: [], free: [] };
  const html = render({ state: "available", unavailableMessage: "", scope: scope(), client: trackingClient(), demo: empty });
  assert.match(html, /Rien de prévu cette semaine/);
  assert.match(html, /Aucune disponibilité déclarée/);
});
