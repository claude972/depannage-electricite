// E61 (registre phase 2) — ENT-15 : rapport consolidé au-delà de 1 000 sites. Contrat A (fa9d690) :
// GET /api/reports accepte after=<UUID> (périmètre organisation), pages de 1 000 sites triées par
// site_id, champ optionnel page {limit:1000,has_more,next_after}, scope.complete=false pour toute
// page d’un périmètre découpé ; totaux = page seulement ; CSV complet sans after.
// Attendu : parseur strict acceptant `page`, navigation Suivant/Précédent avec relecture, totaux
// présentés comme ceux de la page. Vraie ReportsView montée (StrictMode, Chromium), fetch simulé.
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ORG = "20000000-0000-4000-8000-000000000001", USER = "10000000-0000-4000-8000-000000000001";
const BASIS = { accepted: "accepted_base_and_all_accepted_amendments", paid: "server_registered_stripe_paid_rows_with_paid_at_not_live_bank_verification", historical: "on_site_declared_separate_not_bank_confirmation", refunds: "settled_request_and_matching_immutable_provider_event_ledger", net: "net_client_expense_not_artisan_payout_or_platform_revenue", committed: "active_accepted_less_gross_recorded_settlements_no_automatic_debt_reopening_after_refund" };
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReportsView } from "./components/role/enterprise-space";
${PRELUDE}
const ORG = "${ORG}", USER = "${USER}";
const SID = (n) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
const KEYS = ["budget_cents", "accepted_cents", "active_accepted_cents", "paid_cents", "declared_paid_cents", "unverified_paid_cents", "refunded_cents", "net_paid_cents", "committed_cents"];
const site = (n) => ({ site_id: SID(n), name: "Site " + n, type: "office", budget_cents: 1000, paid_cents: 100, committed_cents: 0, interventions: 1, accepted_cents: 100, active_accepted_cents: 100, declared_paid_cents: 0, unverified_paid_cents: 0, refunded_cents: 0, net_paid_cents: 100, financial_complete: true });
const totalsOf = (rows) => ({ ...Object.fromEntries(KEYS.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)])), financial_complete: rows.every((r) => r.financial_complete) });
const pageOf = (rows, next) => ({ sites: rows, totals: totalsOf(rows), currency: "eur", scope: { kind: "visible_sites", site_id: null, organization_id: ORG, complete: false }, basis: ${JSON.stringify(BASIS)}, page: { limit: 1000, has_more: next !== null, next_after: next } });
const P1 = [site(1), site(2), site(3)], P2 = [site(4)];
window.urls = [];
window.fetch = async (url) => {
  const u = String(url); window.urls.push(u);
  if (u.startsWith("/api/reports")) return Response.json(u.includes("after=" + SID(3)) ? pageOf(P2, null) : pageOf(P1, SID(3)));
  return Response.json({ error: "x" }, { status: 503 });
};
const cacheSites = [];
const c = { session: { mode: "live", mutationContext: { userId: () => USER, generation: () => 0 }, data: { interventions: [], quotes: [], payments: [], documents: [] } }, demo: false, organization: { id: ORG, name: "Org" }, activeSite: null, orgSites: cacheSites, scope: { sites: cacheSites, interventions: [], quotes: [], payments: [], approvals: [], compliance: [], documents: [], rules: [] }, authority: { canWrite: true, readOnlyReason: null }, go: () => {} };
window.scenarios = {
  async e61() {
    const div = mountPoint();
    createRoot(div).render(h(StrictMode, null, h(ReportsView, { c })));
    await until(() => div.querySelector("[data-report-site]") || div.querySelector("[data-report='error']"), 3000);
    const first = { rows: div.querySelectorAll("[data-report-site]").length, phase: div.querySelector("[data-report]")?.getAttribute("data-report"), next: !!btn(div, "Page suivante"), totalLabel: txt(div.querySelector("[data-report-total]")) };
    btn(div, "Page suivante")?.click();
    await until(() => div.querySelectorAll("[data-report-site]").length === 1);
    const second = { rows: div.querySelectorAll("[data-report-site]").length, prev: !!btn(div, "Page précédente"), next: !!btn(div, "Page suivante") };
    btn(div, "Page précédente")?.click();
    await until(() => div.querySelectorAll("[data-report-site]").length === 3);
    return { first, second, back: div.querySelectorAll("[data-report-site]").length, urls: window.urls.filter((u) => u.startsWith("/api/reports")), csv: div.querySelector("[data-report-csv]") ? true : false };
  },
};
`;

test("E61 · page découpée acceptée, Suivant/Précédent relisent, totaux de page non présentés comme globaux", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e61") as { first: { phase: string; rows: number; totalLabel: string; next: boolean }; second: { rows: number; prev: boolean; next: boolean }; back: number; urls: string[] };
    assert.equal(r.first.phase, "ready", `réponse paginée acceptée par le parseur strict (phase ${r.first.phase})`);
    assert.equal(r.first.rows, 3);
    assert.match(r.first.totalLabel, /page/i, "totaux présentés comme ceux de la page");
    assert.equal(r.first.next, true, "page suivante proposée");
    assert.equal(r.second.rows, 1);
    assert.equal(r.second.prev, true);
    assert.equal(r.second.next, false);
    assert.equal(r.back, 3, "retour : relecture de la page 1");
    assert.ok(r.urls.some((u) => u.includes("after=30000000-0000-4000-8000-000000000003")), "page suivante demandée avec after");
    assert.ok(r.urls.filter((u) => !u.includes("after=")).length >= 2, "retour = nouvelle lecture (pas de cache)");
    assert.ok(r.urls.every((u) => !(u.includes("format=csv") && u.includes("after="))), "CSV jamais avec after");
    assert.deepEqual(errors, []);
  }, 1280);
});
