import test from "node:test";
import assert from "node:assert/strict";
import { buildTicketDeadlines, ruleFor, ticketDeadline, type TicketRow } from "../lib/features/enterprise-ticket-deadlines/model";
import { buildAccountingCsv, exportInvoice, exportSummary, type ExportSettlement } from "../lib/features/enterprise-accounting-export/model";
import type { Equipment, SlaCalendar, SlaCase, SlaPolicy } from "../lib/features/site-operations/types";

const audited = { version: 1, created_by: "u", created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" };
const calendar: SlaCalendar = { ...audited, id: "cal", organization_id: "org", name: "7j/7", timezone: "UTC", windows: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: "00:00", end: "23:59" })), closed_dates: [] };
const policy = (over: Partial<SlaPolicy> = {}): SlaPolicy => ({ ...audited, id: "p-urgent", site_id: "site", name: "Urgence", calendar_id: "cal", urgency: "urgent", response_target_minutes: 60, resolution_target_minutes: 240, status: "active", ...over });
const ticket = (over: Partial<TicketRow> = {}): TicketRow => ({ id: "t1", status: "requested", urgency: "urgent", category: "outage", description: "", created_at: "2026-11-20T10:00:00.000Z", completed_at: null, ...over });
const base = { policies: [policy()], calendars: [calendar], cases: [] as SlaCase[], respondedAt: null as string | null };

test("an open urgent ticket gets its response then resolution deadline from the site rule", () => {
  const d = ticketDeadline(ticket(), base, "2026-11-20T10:30:00.000Z");
  assert.equal(d.basis, "site_rule");
  assert.equal(d.state, "pending");
  assert.equal(d.due_kind, "response");
  assert.equal(d.due_at, "2026-11-20T11:00:00.000Z");
  assert.equal(d.resolution?.deadline_at, "2026-11-20T14:00:00.000Z");
  const answered = ticketDeadline(ticket({ status: "assigned" }), { ...base, respondedAt: "2026-11-20T10:20:00.000Z" }, "2026-11-20T10:30:00.000Z");
  assert.equal(answered.response?.status, "met");
  assert.equal(answered.due_kind, "resolution");
  assert.equal(answered.due_at, "2026-11-20T14:00:00.000Z");
});
test("past the deadline the open ticket is overdue; a completed one is met or missed, never overdue", () => {
  assert.equal(ticketDeadline(ticket(), base, "2026-11-20T11:00:01.000Z").state, "overdue");
  assert.equal(ticketDeadline(ticket({ status: "completed", completed_at: "2026-11-20T12:00:00.000Z" }), { ...base, respondedAt: "2026-11-20T10:10:00.000Z" }, "2026-11-21T00:00:00.000Z").state, "met");
  assert.equal(ticketDeadline(ticket({ status: "completed", completed_at: "2026-11-20T16:00:00.000Z" }), { ...base, respondedAt: "2026-11-20T10:10:00.000Z" }, "2026-11-21T00:00:00.000Z").state, "missed");
});
test("no active rule for the urgency ⇒ no commitment, no invented delay; cancelled ⇒ not tracked", () => {
  const none = ticketDeadline(ticket({ urgency: "scheduled" }), base, "2026-11-25T00:00:00.000Z");
  assert.deepEqual([none.basis, none.state, none.due_at, none.rule], ["none", "none", null, null]);
  assert.equal(ticketDeadline(ticket(), { ...base, policies: [policy({ status: "archived" })] }, "2026-11-25T00:00:00.000Z").basis, "none");
  assert.equal(ticketDeadline(ticket({ status: "cancelled" }), base, "2026-11-25T00:00:00.000Z").state, "cancelled");
});
test("a rule without calendar is not calculable rather than assumed 24/7", () => {
  const d = ticketDeadline(ticket(), { ...base, policies: [policy({ calendar_id: null })] }, "2026-11-25T00:00:00.000Z");
  assert.equal(d.state, "not_measurable");
  assert.equal(d.due_at, null);
  assert.deepEqual(d.reasons, ["no_calendar"]);
});
test("rule choice: exact urgency before every-urgency, then the most recently updated", () => {
  const any = policy({ id: "p-any", urgency: null, updated_at: "2026-11-10T00:00:00Z" });
  const newer = policy({ id: "p-new", updated_at: "2026-11-05T00:00:00Z" });
  assert.equal(ruleFor([any, policy(), newer], "urgent")?.id, "p-new");
  assert.equal(ruleFor([any, policy()], "scheduled")?.id, "p-any");
  assert.equal(ruleFor([policy()], "scheduled"), null);
});
test("a delay case linked to the ticket prevails, with its observed dates", () => {
  const linked: SlaCase = { ...audited, id: "c1", site_id: "site", policy_id: "p-urgent", intervention_id: "t1", reference: "Appel", opened_at: "2026-11-20T05:00:00.000Z", responded_at: null, resolved_at: null, notes: "", pauses: [], pauses_total: 0 };
  const d = ticketDeadline(ticket(), { ...base, cases: [linked] }, "2026-11-20T10:30:00.000Z");
  assert.deepEqual([d.basis, d.state, d.due_at, d.case_reference], ["linked_case", "overdue", "2026-11-20T06:00:00.000Z", "Appel"]);
});
test("dashboard: open tickets on critical equipment first, figures counted on open tickets only", () => {
  const eq = (id: string, criticality: Equipment["criticality"], status: Equipment["status"]): Equipment => ({ ...audited, id, site_id: "site", name: id, category: "other", criticality, location: "", reference: "", installed_on: null, status, notes: "" });
  const r = buildTicketDeadlines({
    site: { id: "site", name: "Resto", type: "restaurant", organization_id: "org" },
    tickets: [ticket({ id: "plain", urgency: "scheduled" }), ticket({ id: "high" }), ticket({ id: "crit", created_at: "2026-11-20T10:20:00.000Z" }), ticket({ id: "done", status: "completed", completed_at: "2026-11-20T10:30:00.000Z" })],
    equipment: [eq("e-crit", "critical", "out_of_service"), eq("e-high", "high", "in_service"), eq("e-old", "critical", "retired")],
    policies: [policy()], calendars: [calendar], cases: [],
    links: new Map([["crit", ["e-crit"]], ["high", ["e-high"]], ["done", ["e-crit"]]]),
    responded: new Map(), partial: [], now: "2026-11-20T11:10:00.000Z",
  });
  assert.deepEqual(r.tickets.map((t) => t.id), ["crit", "high", "plain", "done"]);
  assert.deepEqual(r.summary, { open: 3, open_critical: 1, overdue: 1, without_commitment: 1, critical_equipment: 1, critical_equipment_not_in_service: 1 });
  assert.deepEqual(r.critical_equipment.map((e) => [e.id, e.open_tickets, e.tickets]), [["e-crit", 1, 2], ["e-high", 1, 1]]);
});

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("accounting export: stored amounts as is, credit note points to its invoice, formulas neutralised", () => {
  const invoice = exportInvoice.parse({ id: U(1), kind: "invoice", basis: "service", number: "F2026-000002", issuer: { legal_name: "=Artisan", siret: "12345678901234" }, recipient: { name: "Org" }, payment_id: U(2), quote_id: U(3), intervention_id: U(4), related_invoice_id: null, subtotal_cents: 10850, tax_rate: 8.5, tax_cents: 922, total_cents: 11772, currency: "eur", issued_at: "2026-11-22T14:27:03.481559+00:00" });
  const note = exportInvoice.parse({ ...invoice, id: U(5), kind: "credit_note", number: "A2026-000002", related_invoice_id: U(1), subtotal_cents: 922, tax_cents: 78, total_cents: 1000 });
  const settlement: ExportSettlement = { id: U(2), quote_id: U(3), intervention_id: U(4), site_name: "Bureaux", total_cents: 11772, status: "paid", method: "stripe", paid_at: "2026-11-22T03:57:52Z", created_at: "2026-11-22T03:50:00Z" };
  const csv = buildAccountingCsv([invoice, note], [settlement], new Map([[U(4), "Bureaux"]]));
  const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^"Facture";"F2026-000002";"2026-11-22";"INT-000000";"DEV-000000";"Bureaux";"'=Artisan";"12345678901234";"Org";"108,50";"8,5";"9,22";"117,72";"";"";"";/);
  assert.match(lines[2], /^"Avoir";"A2026-000002";.*;"10,00";"F2026-000002";/);
  assert.match(lines[3], /^"Règlement";"";"2026-11-22";.*;"117,72";"";"Paiement en ligne \(carte\)";"Réglé \(confirmé par la plateforme\)";/);
  assert.deepEqual(exportSummary([invoice, note], [settlement]), { invoices: 1, credit_notes: 1, settlements: 1, settlements_paid: 1 });
  assert.equal(exportInvoice.safeParse({ ...invoice, total_cents: 11773 }).success, false);
});
