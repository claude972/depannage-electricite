import test from "node:test";
import assert from "node:assert/strict";
import { adminKpis, dashboardRows, loadedNote } from "../../components/role/admin-lists";
import { money } from "../../components/app/format";
import type { AdminOverview, Intervention } from "../../components/app/types";

const intervention = (id: string, status: Intervention["status"], created_at: string): Intervention => ({
  id, category: "panel", description: "", address: "", postal_code: "", city: "Fort-de-France", urgency: "scheduled",
  status, created_at, estimate_min_cents: 0, estimate_max_cents: 0,
});
const overview: AdminOverview = {
  counts: { interventions: 128, active_interventions: 32, artisans: 9, pending_applications: 2, clients: 20, organizations: 3 },
  financial: { paid_service_cents: 2485000, currency: "EUR", platform_revenue_cents: null, note: "Montant des prestations payées." },
  artisans: [
    { id: "a1", full_name: "A", role: "artisan", application_status: "submitted", created_at: "2026-10-01T00:00:00Z" },
    { id: "a2", full_name: "B", role: "artisan", application_status: "approved", created_at: "2026-10-05T00:00:00Z" },
    { id: "a3", full_name: "C", role: "artisan", application_status: "submitted", created_at: "2026-10-09T00:00:00Z" },
  ],
  clients: [], organizations: [],
  interventions: [
    intervention("i1", "paid", "2026-10-30T00:00:00Z"),
    ...Array.from({ length: 8 }, (_, k) => intervention(`i${k + 2}`, "in_progress", `2026-10-${String(10 + k).padStart(2, "0")}T00:00:00Z`)),
    intervention("i10", "cancelled", "2026-10-29T00:00:00Z"),
  ],
  audit: [],
  capabilities: { dispatch_before_quote_acceptance: false, refunds: false, invoices: false, support_tickets: false, list_limit: 100 },
};

test("indicateurs : quatre valeurs issues des totaux serveur, notes courtes, aucune tendance", () => {
  const kpis = adminKpis(overview);
  assert.deepEqual(kpis.map((k) => k.id), ["interventions", "active", "paid", "pending"]);
  assert.deepEqual(kpis.map((k) => k.value), ["128", "32", money(2485000), "2"]);
  for (const k of kpis) {
    assert.ok(k.note.length <= 40, `note courte : ${k.note}`);
    assert.ok(!/%|vs |mois en cours|année/i.test(k.note + k.value), "aucune période ni tendance");
    assert.ok(!("trend" in k));
  }
  assert.match(kpis[2].basis, /Revenu plateforme : non calculé/);
});

test("tableau de bord : candidatures soumises triées, six dossiers actifs les plus récents", () => {
  const rows = dashboardRows(overview);
  assert.deepEqual(rows.pending.map((a) => a.id), ["a3", "a1"]);
  assert.equal(rows.active.length, 6);
  assert.ok(rows.active.every((i) => i.status !== "paid" && i.status !== "cancelled"));
  assert.deepEqual(rows.active.map((i) => i.id).slice(0, 2), ["i9", "i8"]);
  assert.equal(loadedNote(100), "parmi les 100 derniers chargés");
});
