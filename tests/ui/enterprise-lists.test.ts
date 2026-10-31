import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_FILTERS,
  budgetTone,
  filterInterventions,
  isFiltered,
  pageWindow,
  siteAlerts,
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
