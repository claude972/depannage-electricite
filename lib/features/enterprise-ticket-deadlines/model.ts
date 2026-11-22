// ENT-06 — target deadline of each ticket (intervention) of ONE site, computed server-side from data
// the organisation itself recorded. Pure module (no I/O). Rule, stated on screen as well:
//   1. a delay case of the site explicitly linked to the ticket prevails (its observed dates and pauses);
//   2. otherwise the ACTIVE delay rule of the site that matches the ticket's urgency applies (a rule for
//      this exact urgency before a rule for every urgency, then the most recently updated one):
//      opening = creation of the request, response = first taking in charge recorded in the dossier
//      journal, resolution = end of the intervention; minutes are counted on the rule's calendar;
//   3. no matching active rule ⇒ no commitment: nothing is computed and no default delay is assumed.
// A cancelled ticket is never tracked. Nothing here is a contractual or legal statement.
import { evaluateSlaCase } from "../site-operations/sla";
import type { Criticality, Equipment, NotMeasurableReason, SlaCalendar, SlaCase, SlaPolicy, SlaTrack, Urgency } from "../site-operations/types";

export const OPEN_TICKET_STATUSES = ["requested", "assigned", "quoted", "accepted", "in_progress"] as const;
export type TicketRow = {
  id: string;
  status: string;
  urgency: string;
  category: string;
  description: string;
  created_at: string;
  completed_at: string | null;
};
export type DeadlineBasis = "linked_case" | "site_rule" | "none" | "cancelled";
export type DeadlineState = "overdue" | "pending" | "met" | "missed" | "paused" | "not_measurable" | "none" | "cancelled";
export type TicketDeadline = {
  basis: DeadlineBasis;
  state: DeadlineState;
  /** Next instant that matters: response deadline while unanswered, else resolution deadline. */
  due_at: string | null;
  due_kind: "response" | "resolution" | null;
  rule: { id: string; name: string; urgency: Urgency | null; calendar_name: string | null; response_target_minutes: number | null; resolution_target_minutes: number | null } | null;
  case_reference: string | null;
  opened_at: string | null;
  responded_at: string | null;
  resolved_at: string | null;
  response: SlaTrack | null;
  resolution: SlaTrack | null;
  paused_now: boolean;
  reasons: NotMeasurableReason[];
};
export type TicketEquipment = { id: string; name: string; criticality: Criticality; status: Equipment["status"]; location: string };
export type Ticket = TicketRow & { open: boolean; equipment: TicketEquipment[]; critical: boolean; deadline: TicketDeadline };
export type CriticalEquipment = TicketEquipment & { category: Equipment["category"]; open_tickets: number; tickets: number };
export type TicketDeadlinesReport = {
  site: { id: string; name: string; type: string; organization_id: string };
  computed_at: string;
  rules: { active: number; calendars: number };
  summary: { open: number; open_critical: number; overdue: number; without_commitment: number; critical_equipment: number; critical_equipment_not_in_service: number };
  tickets: Ticket[];
  critical_equipment: CriticalEquipment[];
  /** Reasons why the picture may be incomplete (never silently truncated). */
  partial: string[];
};

const NONE: TicketDeadline = { basis: "none", state: "none", due_at: null, due_kind: null, rule: null, case_reference: null, opened_at: null, responded_at: null, resolved_at: null, response: null, resolution: null, paused_now: false, reasons: [] };
const isOpen = (status: string) => (OPEN_TICKET_STATUSES as readonly string[]).includes(status);
const CRITICAL_LEVELS: Criticality[] = ["critical", "high"];
const rank = (c: Criticality) => (c === "critical" ? 0 : c === "high" ? 1 : c === "medium" ? 2 : 3);

/** The site rule that applies to a ticket urgency: exact urgency first, then « every urgency », newest first. */
export function ruleFor(policies: SlaPolicy[], urgency: string): SlaPolicy | null {
  const active = policies.filter((p) => p.status === "active" && (p.urgency === null || p.urgency === urgency));
  active.sort((a, b) => Number(b.urgency !== null) - Number(a.urgency !== null) || b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
  return active[0] ?? null;
}

function fromTracks(basis: DeadlineBasis, policy: SlaPolicy, calendar: SlaCalendar | null, caseRef: string | null, facts: { opened_at: string; responded_at: string | null; resolved_at: string | null; pauses: { started_at: string; ended_at: string | null }[]; pauses_total?: number }, now: string): TicketDeadline {
  const e = evaluateSlaCase(
    { case_id: "ticket", policy_id: policy.id },
    calendar ? { timezone: calendar.timezone, windows: calendar.windows, closed_dates: calendar.closed_dates } : null,
    { response_target_minutes: policy.response_target_minutes, resolution_target_minutes: policy.resolution_target_minutes },
    facts,
    now,
  );
  const tracks = [e.response, e.resolution];
  const measurable = tracks.filter((t) => t.status !== "not_measurable");
  const pendingResponse = e.response.status === "pending" || (e.response.status === "breached" && facts.responded_at === null);
  const dueTrack = facts.resolved_at === null && pendingResponse ? e.response : e.resolution.status !== "not_measurable" ? e.resolution : e.response.status !== "not_measurable" ? e.response : null;
  const closed = facts.resolved_at !== null;
  const breached = measurable.some((t) => t.status === "breached");
  const state: DeadlineState = !measurable.length
    ? "not_measurable"
    : closed
      ? breached ? "missed" : "met"
      : breached
        ? "overdue"
        : e.paused_now
          ? "paused"
          : "pending";
  return {
    basis,
    state,
    due_at: dueTrack?.deadline_at ?? null,
    due_kind: dueTrack ? (dueTrack === e.response ? "response" : "resolution") : null,
    rule: { id: policy.id, name: policy.name, urgency: policy.urgency, calendar_name: calendar?.name ?? null, response_target_minutes: policy.response_target_minutes, resolution_target_minutes: policy.resolution_target_minutes },
    case_reference: caseRef,
    opened_at: facts.opened_at,
    responded_at: facts.responded_at,
    resolved_at: facts.resolved_at,
    response: e.response,
    resolution: e.resolution,
    paused_now: e.paused_now,
    reasons: e.reasons,
  };
}

export function ticketDeadline(ticket: TicketRow, input: { policies: SlaPolicy[]; calendars: SlaCalendar[]; cases: SlaCase[]; respondedAt: string | null }, now: string): TicketDeadline {
  if (ticket.status === "cancelled") return { ...NONE, basis: "cancelled", state: "cancelled" };
  const calendarOf = (p: SlaPolicy) => (p.calendar_id ? input.calendars.find((c) => c.id === p.calendar_id) ?? null : null);
  // 1. Explicitly linked case (most recently opened one when several).
  const linked = input.cases.filter((c) => c.intervention_id === ticket.id).sort((a, b) => b.opened_at.localeCompare(a.opened_at))[0];
  if (linked) {
    const policy = input.policies.find((p) => p.id === linked.policy_id);
    if (policy)
      return fromTracks("linked_case", policy, calendarOf(policy), linked.reference || null, { opened_at: linked.opened_at, responded_at: linked.responded_at, resolved_at: linked.resolved_at, pauses: linked.pauses, pauses_total: linked.pauses_total }, now);
  }
  // 2. Active rule of the site for this urgency.
  const policy = ruleFor(input.policies, ticket.urgency);
  if (!policy) return NONE;
  const resolved = ticket.completed_at ?? null;
  // A response recorded after the resolution (or before the opening) is not a usable fact.
  const responded = input.respondedAt && input.respondedAt >= ticket.created_at && (!resolved || input.respondedAt <= resolved) ? input.respondedAt : resolved;
  return fromTracks("site_rule", policy, calendarOf(policy), null, { opened_at: ticket.created_at, responded_at: responded, resolved_at: resolved, pauses: [] }, now);
}

const STATE_ORDER: Record<DeadlineState, number> = { overdue: 0, pending: 1, paused: 2, not_measurable: 3, none: 4, missed: 5, met: 6, cancelled: 7 };

export function buildTicketDeadlines(input: {
  site: TicketDeadlinesReport["site"];
  tickets: TicketRow[];
  equipment: Equipment[];
  policies: SlaPolicy[];
  calendars: SlaCalendar[];
  cases: SlaCase[];
  /** Active links only: intervention id → equipment ids. */
  links: Map<string, string[]>;
  /** First taking in charge recorded in the dossier journal, per intervention. */
  responded: Map<string, string>;
  partial: string[];
  now: string;
}): TicketDeadlinesReport {
  const equipmentById = new Map(input.equipment.map((e) => [e.id, e]));
  const tickets: Ticket[] = input.tickets.map((t) => {
    const equipment = (input.links.get(t.id) ?? [])
      .map((id) => equipmentById.get(id))
      .filter((e): e is Equipment => Boolean(e))
      .sort((a, b) => rank(a.criticality) - rank(b.criticality) || a.name.localeCompare(b.name))
      .map((e) => ({ id: e.id, name: e.name, criticality: e.criticality, status: e.status, location: e.location }));
    return {
      ...t,
      open: isOpen(t.status),
      equipment,
      critical: equipment.some((e) => e.criticality === "critical"),
      deadline: ticketDeadline(t, { policies: input.policies, calendars: input.calendars, cases: input.cases, respondedAt: input.responded.get(t.id) ?? null }, input.now),
    };
  });
  const level = (t: Ticket) => (t.equipment.length ? rank(t.equipment[0].criticality) : 4);
  tickets.sort(
    (a, b) =>
      Number(b.open) - Number(a.open) ||
      (a.open ? level(a) - level(b) || STATE_ORDER[a.deadline.state] - STATE_ORDER[b.deadline.state] || (a.deadline.due_at ?? "9").localeCompare(b.deadline.due_at ?? "9") : 0) ||
      b.created_at.localeCompare(a.created_at),
  );
  const critical_equipment: CriticalEquipment[] = input.equipment
    .filter((e) => CRITICAL_LEVELS.includes(e.criticality) && e.status !== "retired")
    .sort((a, b) => rank(a.criticality) - rank(b.criticality) || a.name.localeCompare(b.name))
    .map((e) => {
      const linked = tickets.filter((t) => t.equipment.some((x) => x.id === e.id));
      return { id: e.id, name: e.name, criticality: e.criticality, status: e.status, location: e.location, category: e.category, open_tickets: linked.filter((t) => t.open).length, tickets: linked.length };
    });
  const open = tickets.filter((t) => t.open);
  return {
    site: input.site,
    computed_at: input.now,
    rules: { active: input.policies.filter((p) => p.status === "active").length, calendars: input.calendars.length },
    summary: {
      open: open.length,
      open_critical: open.filter((t) => t.critical).length,
      overdue: open.filter((t) => t.deadline.state === "overdue").length,
      without_commitment: open.filter((t) => t.deadline.basis === "none").length,
      critical_equipment: critical_equipment.filter((e) => e.criticality === "critical").length,
      critical_equipment_not_in_service: critical_equipment.filter((e) => e.criticality === "critical" && e.status !== "in_service").length,
    },
    tickets,
    critical_equipment,
    partial: input.partial,
  };
}
