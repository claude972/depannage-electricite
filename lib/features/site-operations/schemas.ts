// Strict command schemas shared by the API route (authoritative) and the leaf forms (early
// feedback). The SQL layer re-validates every payload; these schemas never relax a SQL rule.
import { z } from "zod";
import { martiniqueDate } from "./fact-dates";

export const uuid = z.string().uuid();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.");
export const isoInstant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/, "Horodatage ISO attendu.")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Horodatage invalide.");
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Heure attendue au format HH:MM.");
const text = (max: number, min = 0) => z.string().trim().min(min).max(max);
const cents = (max: number) => z.number().int().min(0).max(max);
const version = z.number().int().min(1).max(2147483647);

export function isValidTimeZone(value: string): boolean {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const equipmentPayload = z
  .object({
    name: text(160, 1),
    category: z.enum(["panel", "lighting", "emergency_lighting", "fire_safety", "hvac", "generator", "ups", "other"]),
    criticality: z.enum(["low", "medium", "high", "critical"]),
    location: text(160),
    reference: text(160),
    installed_on: isoDate.nullable(),
    status: z.enum(["in_service", "degraded", "out_of_service", "retired"]),
    notes: text(4000),
  })
  .strict();
export const maintenancePlanPayload = z
  .object({
    equipment_id: uuid.nullable(),
    title: text(160, 1),
    frequency_kind: z.enum(["none", "days", "weeks", "months"]),
    frequency_value: z.number().int().min(1).max(3650).nullable(),
    next_due_on: isoDate.nullable(),
    last_done_on: isoDate.nullable(),
    status: z.enum(["active", "paused", "archived"]),
    notes: text(4000),
  })
  .strict()
  .refine((p) => (p.frequency_kind === "none") === (p.frequency_value === null), {
    message: "Indiquez une fréquence avec sa valeur, ou choisissez « sans périodicité ».",
    path: ["frequency_value"],
  });
export const fiscalYearPayload = z
  .object({ label: text(80, 1), starts_on: isoDate, ends_on: isoDate, status: z.enum(["open", "closed"]) })
  .strict()
  .refine((p) => p.ends_on >= p.starts_on, { message: "La fin de l’exercice précède son début.", path: ["ends_on"] });
export const gridLine = z
  .object({ label: text(160, 1), unit: z.enum(["hour", "visit", "flat", "km", "unit"]), amount_cents: cents(10000000), note: text(400) })
  .strict();
export const contractGridPayload = z
  .object({
    label: text(160, 1),
    contract_id: uuid.nullable(),
    effective_from: isoDate.nullable(),
    lines: z.array(gridLine).max(100),
    from_grid_id: uuid.nullable().optional(),
  })
  .strict();
export const calendarWindow = z
  .object({ weekday: z.number().int().min(1).max(7), start: clock, end: clock })
  .strict()
  .refine((w) => w.end > w.start, { message: "La fin de plage doit suivre son début.", path: ["end"] });
export const slaCalendarPayload = z
  .object({
    name: text(160, 1),
    timezone: z.string().trim().min(1).max(64).refine(isValidTimeZone, "Fuseau horaire inconnu."),
    windows: z.array(calendarWindow).max(21),
    closed_dates: z.array(isoDate).max(366),
  })
  .strict();
export const slaPolicyPayload = z
  .object({
    name: text(160, 1),
    calendar_id: uuid.nullable(),
    urgency: z.enum(["urgent", "scheduled"]).nullable(),
    response_target_minutes: z.number().int().min(1).max(525600).nullable(),
    resolution_target_minutes: z.number().int().min(1).max(525600).nullable(),
    status: z.enum(["active", "archived"]),
  })
  .strict();
const observedInstant = isoInstant.refine(
  value => Date.parse(value) <= Date.now(), "La date d’un fait constaté ne peut pas être dans le futur.",
);
const observedDate = isoDate.refine(
  value => value <= martiniqueDate(), "La date d’un fait constaté ne peut pas être dans le futur.",
);
export const slaCasePayload = z
  .object({
    policy_id: uuid,
    intervention_id: uuid.nullable(),
    reference: text(160),
    opened_at: observedInstant,
    responded_at: observedInstant.nullable(),
    resolved_at: observedInstant.nullable(),
    notes: text(4000),
  })
  .strict()
  .refine((p) => !p.responded_at || Date.parse(p.responded_at) >= Date.parse(p.opened_at), {
    message: "La réponse ne peut pas précéder l’ouverture.",
    path: ["responded_at"],
  })
  .refine(
    (p) =>
      !p.resolved_at ||
      (Date.parse(p.resolved_at) >= Date.parse(p.opened_at) &&
        (!p.responded_at || Date.parse(p.resolved_at) >= Date.parse(p.responded_at))),
    { message: "La résolution ne peut pas précéder l’ouverture ni la réponse.", path: ["resolved_at"] },
  );
export const checklistItem = z
  .object({
    key: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Clé d’élément invalide."),
    label: text(240, 1),
    state: z.enum(["not_checked", "ok", "reserve", "not_applicable"]),
    note: text(1000),
    reserve_resolved_on: observedDate.nullable(),
  })
  .strict();
export const erpChecklistPayload = z
  .object({
    title: text(160, 1),
    description: text(4000),
    performed_on: observedDate.nullable(),
    performed_by_label: text(160),
    status: z.enum(["draft", "completed", "archived"]),
    items: z
      .array(checklistItem)
      .max(200)
      .refine((items) => new Set(items.map((i) => i.key)).size === items.length, "Chaque élément doit avoir une clé unique."),
  })
  .strict()
  .refine(
    payload => payload.items.every(item => item.reserve_resolved_on === null ||
      (payload.performed_on !== null && item.reserve_resolved_on >= payload.performed_on)),
    { message: "Une levée de réserve exige une date de contrôle et ne peut pas la précéder.", path: ["items"] },
  );

const versioned = { id: uuid.optional(), expected_version: version.optional() };
const versionRule = {
  check: (c: { id?: string; expected_version?: number }) => (c.id === undefined) === (c.expected_version === undefined),
  message: "Une modification doit indiquer l’identifiant et la version attendue.",
  path: ["expected_version"],
};
// Zod 4 keeps the object type through refine, so the union stays discriminable.
const withVersionRule = <S extends z.ZodObject<z.ZodRawShape>>(schema: S): S =>
  schema.refine(versionRule.check, { message: versionRule.message, path: versionRule.path }) as S;
export const commandSchema = z.discriminatedUnion("action", [
  withVersionRule(z.object({ action: z.literal("save_equipment"), site_id: uuid, payload: equipmentPayload, ...versioned }).strict()),
  withVersionRule(z.object({ action: z.literal("save_maintenance_plan"), site_id: uuid, payload: maintenancePlanPayload, ...versioned }).strict()),
  z
    .object({ action: z.literal("record_maintenance_visit"), plan_id: uuid, done_on: isoDate, summary: text(4000), intervention_id: uuid.nullable() })
    .strict(),
  withVersionRule(z.object({ action: z.literal("save_fiscal_year"), organization_id: uuid, payload: fiscalYearPayload, ...versioned }).strict()),
  z
    .object({
      action: z.literal("save_budget_line"),
      site_id: uuid,
      fiscal_year_id: uuid,
      category: z.enum(["maintenance", "repairs", "compliance", "equipment", "other"]),
      amount_cents: cents(100000000),
      note: text(1000),
      expected_version: version.optional(),
    })
    .strict(),
  withVersionRule(z.object({ action: z.literal("save_contract_grid"), organization_id: uuid, payload: contractGridPayload, ...versioned }).strict()),
  z.object({ action: z.literal("publish_contract_grid"), id: uuid, expected_version: version }).strict(),
  withVersionRule(z.object({ action: z.literal("save_sla_calendar"), organization_id: uuid, payload: slaCalendarPayload, ...versioned }).strict()),
  withVersionRule(z.object({ action: z.literal("save_sla_policy"), site_id: uuid, payload: slaPolicyPayload, ...versioned }).strict()),
  withVersionRule(z.object({ action: z.literal("save_sla_case"), site_id: uuid, payload: slaCasePayload, ...versioned }).strict()),
  z.object({ action: z.literal("pause_sla_case"), id: uuid, started_at: isoInstant, reason: text(400), expected_version: version }).strict(),
  z.object({ action: z.literal("resume_sla_case"), id: uuid, ended_at: isoInstant, expected_version: version }).strict(),
  withVersionRule(z.object({ action: z.literal("save_erp_checklist"), site_id: uuid, payload: erpChecklistPayload, ...versioned }).strict()),
]);
export type ParsedCommand = z.infer<typeof commandSchema>;

/** Maps a validated command to its SQL entry point and arguments. */
export function toRpc(command: ParsedCommand): { fn: string; args: Record<string, unknown> } {
  switch (command.action) {
    case "save_equipment":
      return { fn: "save_site_equipment", args: { p_site_id: command.site_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "save_maintenance_plan":
      return { fn: "save_maintenance_plan", args: { p_site_id: command.site_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "record_maintenance_visit":
      return { fn: "record_maintenance_visit", args: { p_plan_id: command.plan_id, p_done_on: command.done_on, p_summary: command.summary, p_intervention_id: command.intervention_id } };
    case "save_fiscal_year":
      return { fn: "save_fiscal_year", args: { p_organization_id: command.organization_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "save_budget_line":
      return { fn: "save_budget_line", args: { p_site_id: command.site_id, p_fiscal_year_id: command.fiscal_year_id, p_category: command.category, p_amount_cents: command.amount_cents, p_note: command.note, p_expected_version: command.expected_version ?? null } };
    case "save_contract_grid":
      return { fn: "save_contract_grid", args: { p_organization_id: command.organization_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "publish_contract_grid":
      return { fn: "publish_contract_grid", args: { p_id: command.id, p_expected_version: command.expected_version } };
    case "save_sla_calendar":
      return { fn: "save_sla_calendar", args: { p_organization_id: command.organization_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "save_sla_policy":
      return { fn: "save_sla_policy", args: { p_site_id: command.site_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "save_sla_case":
      return { fn: "save_sla_case", args: { p_site_id: command.site_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
    case "pause_sla_case":
      return { fn: "pause_sla_case", args: { p_case_id: command.id, p_started_at: command.started_at, p_reason: command.reason, p_expected_version: command.expected_version } };
    case "resume_sla_case":
      return { fn: "resume_sla_case", args: { p_case_id: command.id, p_ended_at: command.ended_at, p_expected_version: command.expected_version } };
    case "save_erp_checklist":
      return { fn: "save_erp_checklist", args: { p_site_id: command.site_id, p_payload: command.payload, p_id: command.id ?? null, p_expected_version: command.expected_version ?? null } };
  }
}
