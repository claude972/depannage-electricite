import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_FILTERS,
  budgetFigures,
  budgetTone,
  filterInterventions,
  isFiltered,
  pageWindow,
  reconcileFilters,
  siteAlertSummary,
  siteAlerts,
  wholePercent,
} from "../../components/role/enterprise-lists";
import type { Approval, ComplianceRecord, Intervention, Quote } from "../../components/app/types";

const intervention = (id: string, over: Partial<Intervention> = {}): Intervention => ({
  id,
  category: "panel",
  description: "Disjoncteur",
  address: "1 rue A",
  postal_code: "97200",
  city: "Fort-de-France",
  urgency: "scheduled",
  status: "requested",
  created_at: "2026-10-01T10:00:00Z",
  estimate_min_cents: 0,
  estimate_max_cents: 0,
  ...over,
});

const rows = [
  intervention("a", { site_id: "s1", created_at: "2026-10-03T10:00:00Z", status: "in_progress" }),
  intervention("b", { site_id: "s2", created_at: "2026-10-01T10:00:00Z", category: "lighting" }),
  intervention("c", { site_id: "s1", created_at: "2026-10-02T10:00:00Z", description: "Prise grillée" }),
];
const text = (i: Intervention) => `${i.description} ${i.id}`;

test("filtres combinés et tri récent par défaut", () => {
  assert.deepEqual(filterInterventions(rows, NO_FILTERS, text).map((i) => i.id), ["a", "c", "b"]);
  assert.deepEqual(
    filterInterventions(rows, { ...NO_FILTERS, site: "s1" }, text).map((i) => i.id),
    ["a", "c"],
  );
  assert.deepEqual(
    filterInterventions(rows, { ...NO_FILTERS, site: "s1", status: "in_progress" }, text).map((i) => i.id),
    ["a"],
  );
  assert.deepEqual(
    filterInterventions(rows, { ...NO_FILTERS, type: "lighting" }, text).map((i) => i.id),
    ["b"],
  );
  assert.deepEqual(
    filterInterventions(rows, { ...NO_FILTERS, search: "  GRILL " }, text).map((i) => i.id),
    ["c"],
  );
});

test("tri du plus ancien au plus récent, sans muter la source", () => {
  const before = rows.map((i) => i.id);
  assert.deepEqual(
    filterInterventions(rows, { ...NO_FILTERS, sort: "oldest" }, text).map((i) => i.id),
    ["b", "c", "a"],
  );
  assert.deepEqual(rows.map((i) => i.id), before);
});

test("isFiltered ignore le tri et les espaces", () => {
  assert.equal(isFiltered(NO_FILTERS), false);
  assert.equal(isFiltered({ ...NO_FILTERS, sort: "oldest", search: "  " }), false);
  assert.equal(isFiltered({ ...NO_FILTERS, status: "paid" }), true);
});

test("pagination numérotée avec ellipses", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(2, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(1, 10), [1, 2, 3, 4, null, 10]);
  assert.deepEqual(pageWindow(5, 10), [1, null, 4, 5, 6, null, 10]);
  assert.deepEqual(pageWindow(10, 10), [1, null, 7, 8, 9, 10]);
});

test("alertes d’un site : approbations et conformité réelles uniquement", () => {
  const quotes = [{ id: "q1", intervention_id: "a" }, { id: "q2", intervention_id: "b" }] as Quote[];
  const approvals = [
    { id: "p1", quote_id: "q1", status: "pending" },
    { id: "p2", quote_id: "q2", status: "pending" },
    { id: "p3", quote_id: "q1", site_id: "s1", status: "approved" },
  ] as Approval[];
  const compliance = [
    { id: "r1", site_id: "s1", status: "pending", due_on: "2026-09-01" },
    { id: "r2", site_id: "s1", status: "scheduled", due_on: "2026-12-01" },
    { id: "r3", site_id: "s1", status: "completed", due_on: "2026-01-01" },
    { id: "r4", site_id: "s2", status: "pending", due_on: "2026-01-01" },
  ] as ComplianceRecord[];
  assert.deepEqual(siteAlerts("s1", approvals, compliance, rows, quotes, "2026-10-31"), {
    approvalsPending: 1,
    complianceOpen: 2,
    overdue: 1,
  });
  assert.deepEqual(siteAlerts("s3", approvals, compliance, rows, quotes, "2026-10-31"), {
    approvalsPending: 0,
    complianceOpen: 0,
    overdue: 0,
  });
});

test("teinte du budget portée par l’état", () => {
  assert.equal(budgetTone(10, false), "normal");
  assert.equal(budgetTone(80, false), "warning");
  assert.equal(budgetTone(100, true), "over");
});

// ---- VIS-REV-003 : taux réel affiché, barre seule plafonnée ------------------------------
test("budget : le pourcentage réel est conservé, seule la largeur de barre est plafonnée", () => {
  assert.deepEqual(budgetFigures(0, 10000), { ratio: 0, width: 0, over: false });
  assert.deepEqual(budgetFigures(4500, 10000), { ratio: 45, width: 45, over: false });
  assert.deepEqual(budgetFigures(8000, 10000), { ratio: 80, width: 80, over: false });
  assert.deepEqual(budgetFigures(10000, 10000), { ratio: 100, width: 100, over: false });
  assert.deepEqual(budgetFigures(15000, 10000), { ratio: 150, width: 100, over: true });
  assert.equal(wholePercent(150), "150 %");
  assert.equal(wholePercent(79.6), "80 %");
  assert.equal(budgetTone(150, true), "over");
  assert.equal(budgetTone(80, false), "warning");
  assert.equal(budgetTone(45, false), "normal");
});

test("budget manquant ou nul : aucun taux déduit", () => {
  assert.deepEqual(budgetFigures(15000, 0), { ratio: null, width: 0, over: false });
  assert.deepEqual(budgetFigures(0, 0), { ratio: null, width: 0, over: false });
  assert.equal(wholePercent(null), null);
});

// ---- VIS-REV-002 : filtre local de site invalidé par le périmètre global ------------------
const all = { organizationId: "org-1", siteId: "" };
const siteB = { organizationId: "org-1", siteId: "s2" };
const sites = ["s1", "s2"];

test("périmètre inchangé : filtres et référence conservés, pas de remise à zéro", () => {
  const filters = { ...NO_FILTERS, site: "s1", status: "paid" };
  const out = reconcileFilters(filters, all, all, sites);
  assert.equal(out.filters, filters);
  assert.equal(out.reset, false);
});

test("site global choisi après un site local : le site local est effacé, la page repart à 1", () => {
  const filters = { ...NO_FILTERS, site: "s1", status: "paid", search: "prise", sort: "oldest" as const };
  const out = reconcileFilters(filters, all, siteB, sites);
  assert.deepEqual(out.filters, { ...NO_FILTERS, site: "", status: "paid", search: "prise", sort: "oldest" });
  assert.equal(out.reset, true);
  // Le prédicat effectif ne demande plus s1 (tri « ancien » conservé) : le dossier de s2 reste visible.
  assert.deepEqual(
    filterInterventions(rows, { ...out.filters, status: "", search: "" }, text).map((i) => i.id),
    ["b", "c", "a"],
  );
  assert.ok(filterInterventions(rows, { ...out.filters, status: "", search: "" }, text).some((i) => i.site_id === "s2"));
});

test("retour à « Tous les sites » et changement d’organisation : même invalidation", () => {
  const filters = { ...NO_FILTERS, site: "s2" };
  assert.deepEqual(reconcileFilters(filters, siteB, all, sites), { filters: { ...NO_FILTERS, site: "" }, reset: true });
  assert.deepEqual(
    reconcileFilters(filters, all, { organizationId: "org-2", siteId: "" }, ["s9"]),
    { filters: { ...NO_FILTERS, site: "" }, reset: true },
  );
});

test("changement de périmètre sans site local : remise à la première page seulement", () => {
  const filters = { ...NO_FILTERS, status: "paid" };
  const out = reconcileFilters(filters, all, siteB, sites);
  assert.equal(out.filters, filters);
  assert.equal(out.reset, true);
});

test("site local absent du périmètre courant : effacé même sans transition", () => {
  const out = reconcileFilters({ ...NO_FILTERS, site: "s-gone" }, all, all, sites);
  assert.deepEqual(out.filters, NO_FILTERS);
  assert.equal(out.reset, true);
});

// ---- VIS-REV-001 : l’absence d’alerte n’est jamais affirmée sans données ------------------
const none = { approvalsPending: 0, complianceOpen: 0, overdue: 0 };

test("alertes : état explicite tant que les données professionnelles ne sont pas chargées", () => {
  assert.deepEqual(siteAlertSummary("unknown", none), { kind: "checking" });
  assert.deepEqual(siteAlertSummary("unavailable", none), { kind: "unverified" });
  assert.deepEqual(siteAlertSummary("missing", none), { kind: "unverified" });
  // Des compteurs à zéro en état indisponible ne deviennent jamais « Aucune ».
  assert.notEqual(siteAlertSummary("unavailable", none).kind, "none");
});

test("alertes : données chargées, libellés réels avec accord du pluriel", () => {
  assert.deepEqual(siteAlertSummary("available", none), { kind: "none" });
  assert.deepEqual(siteAlertSummary("available", { approvalsPending: 1, complianceOpen: 0, overdue: 0 }), {
    kind: "alerts",
    parts: ["1 devis à approuver"],
    overdue: false,
  });
  assert.deepEqual(siteAlertSummary("available", { approvalsPending: 2, complianceOpen: 3, overdue: 2 }), {
    kind: "alerts",
    parts: ["2 devis à approuver", "2 échéances dépassées", "1 contrôle à traiter"],
    overdue: true,
  });
});

import { overviewFigures, siteBudgetBars } from "../../components/role/enterprise-lists";

test("chiffres du tableau de bord V5-C05 : urgences = dossiers ouverts urgents, échéances à 30 jours bornées, rien d’autre", () => {
  const isOpen = (s: string) => !["paid", "cancelled"].includes(s);
  const figures = overviewFigures(
    {
      interventions: [
        { status: "requested", urgency: "urgent" },
        { status: "in_progress", urgency: "urgent" },
        { status: "paid", urgency: "urgent" },
        { status: "assigned", urgency: "scheduled" },
      ],
      compliance: [
        { status: "pending", due_on: "2026-11-01" },
        { status: "pending", due_on: "2026-12-01" },
        { status: "pending", due_on: "2026-12-02" },
        { status: "completed", due_on: "2026-11-10" },
        { status: "pending", due_on: "2026-10-31" },
      ],
    },
    "2026-11-01",
    isOpen as never,
  );
  assert.deepEqual(figures, { open: 3, urgent: 2, deadlines30: 2 }, "aujourd’hui et J+30 inclus, dépassées et terminées exclues");
  assert.deepEqual(overviewFigures({ interventions: [], compliance: [] }, "2026-11-01", isOpen as never), { open: 0, urgent: 0, deadlines30: 0 });
});
test("budget par site : engagé = devis acceptés du site, taux réel ou null sans budget", () => {
  const bars = siteBudgetBars(
    [
      { id: "s1", name: "Siège", budget_cents: 100000 },
      { id: "s2", name: "Annexe", budget_cents: 0 },
    ],
    [
      { id: "i1", site_id: "s1" },
      { id: "i2", site_id: "s1" },
      { id: "i3", site_id: "s2" },
    ],
    [
      { intervention_id: "i1", status: "accepted", total_cents: 60000 },
      { intervention_id: "i2", status: "sent", total_cents: 99999 },
      { intervention_id: "i2", status: "accepted", total_cents: 90000 },
      { intervention_id: "i3", status: "accepted", total_cents: 5000 },
    ],
  );
  assert.equal(bars.length, 2);
  assert.deepEqual(bars[0], { id: "s1", name: "Siège", committed: 150000, budget: 100000, ratio: 150, width: 100, over: true }, "taux réel non plafonné, barre plafonnée");
  assert.deepEqual(bars[1], { id: "s2", name: "Annexe", committed: 5000, budget: 0, ratio: null, width: 0, over: false }, "sans budget : aucun taux déduit");
});

import { FIGURE_PLACEHOLDER, dashboardFigures, figureState, overviewSubtitle } from "../../components/role/enterprise-lists";

test("chiffres professionnels du tableau de bord : jamais un 0 tant que le contrat n’est pas réellement chargé", () => {
  const isOpen = ((s: string) => !["paid", "cancelled"].includes(s)) as never;
  const scope = { interventions: [{ status: "requested", urgency: "urgent" }], compliance: [], approvals: [], quotes: [] } as never;
  for (const state of ["unknown", "unavailable", "missing"] as const) {
    const f = dashboardFigures(state, scope, "2026-11-01", isOpen);
    assert.equal(f.deadlines30, null, `${state}: échéances non chiffrées`);
    assert.equal(f.approvalsPending, null, `${state}: approbations non chiffrées`);
    assert.equal(f.committedCents, null, `${state}: budget non chiffré`);
    assert.notEqual(typeof f.deadlines30, "number");
    assert.equal(f.open, 1, "les dossiers de l’espace de travail restent chiffrés");
    assert.equal(f.urgent, 1);
    assert.equal(f.professional, state === "unknown" ? "checking" : "unverified");
    assert.ok(FIGURE_PLACEHOLDER[f.professional as "checking" | "unverified"]);
  }
  const loaded = dashboardFigures("available", scope, "2026-11-01", isOpen);
  assert.deepEqual([loaded.deadlines30, loaded.approvalsPending, loaded.committedCents, loaded.professional], [0, 0, 0, "loaded"], "chargé et vide : 0 qualifié");
  const full = dashboardFigures(
    "available",
    { interventions: [], compliance: [{ status: "pending", due_on: "2026-11-15" }], approvals: [{ status: "pending" }, { status: "approved" }], quotes: [{ status: "accepted", total_cents: 500 }, { status: "sent", total_cents: 999 }] } as never,
    "2026-11-01",
    isOpen,
  );
  assert.deepEqual([full.deadlines30, full.approvalsPending, full.committedCents], [1, 1, 500]);
  assert.equal(figureState("unknown"), "checking");
  assert.equal(figureState("missing"), "unverified");
});
test("sous-titre du tableau de bord : « parmi les données chargées » seulement quand elles le sont", () => {
  const note = "Données chargées (100 derniers dossiers)";
  assert.equal(overviewSubtitle("available", "Maison & lieux", note), "Maison & lieux · parmi les données chargées (100 derniers dossiers)");
  assert.match(overviewSubtitle("unknown", "Maison & lieux", note), /vérification des données professionnelles en cours/);
  assert.doesNotMatch(overviewSubtitle("unknown", "Maison & lieux", note), /données chargées/i);
  assert.match(overviewSubtitle("unavailable", "Maison & lieux", note), /non vérifiées/);
  assert.doesNotMatch(overviewSubtitle("missing", "Maison & lieux", note), /chargées/);
});
