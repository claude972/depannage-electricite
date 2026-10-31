// ADV-B2B-OPERATIONS-001 — types of the site operations lot. No import from components/app/**.
// Every value comes from the server as entered by the organisation; nothing here is a default
// rate, delay, calendar or regulatory statement.

export type EquipmentCategory =
  | "panel"
  | "lighting"
  | "emergency_lighting"
  | "fire_safety"
  | "hvac"
  | "generator"
  | "ups"
  | "other";
export type Criticality = "low" | "medium" | "high" | "critical";
export type EquipmentStatus = "in_service" | "degraded" | "out_of_service" | "retired";
export type FrequencyKind = "none" | "days" | "weeks" | "months";
export type PlanStatus = "active" | "paused" | "archived";
export type FiscalYearStatus = "open" | "closed";
export type BudgetCategory = "maintenance" | "repairs" | "compliance" | "equipment" | "other";
export type GridStatus = "draft" | "published" | "superseded";
export type GridUnit = "hour" | "visit" | "flat" | "km" | "unit";
export type PolicyStatus = "active" | "archived";
export type Urgency = "urgent" | "scheduled";
export type ChecklistStatus = "draft" | "completed" | "archived";
export type ItemState = "not_checked" | "ok" | "reserve" | "not_applicable";

type Audited = { id: string; version: number; created_by: string; created_at: string; updated_at: string };
export type Equipment = Audited & {
  site_id: string;
  name: string;
  category: EquipmentCategory;
  criticality: Criticality;
  location: string;
  reference: string;
  installed_on: string | null;
  status: EquipmentStatus;
  notes: string;
};
export type MaintenanceVisit = {
  id: string;
  plan_id: string;
  site_id: string;
  done_on: string;
  intervention_id: string | null;
  summary: string;
  created_by: string;
  created_at: string;
};
export type MaintenancePlan = Audited & {
  site_id: string;
  equipment_id: string | null;
  title: string;
  frequency_kind: FrequencyKind;
  frequency_value: number | null;
  next_due_on: string | null;
  last_done_on: string | null;
  status: PlanStatus;
  notes: string;
  visits: MaintenanceVisit[];
};
export type FiscalYear = Audited & {
  organization_id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  status: FiscalYearStatus;
};
export type BudgetLine = Audited & {
  site_id: string;
  fiscal_year_id: string;
  category: BudgetCategory;
  amount_cents: number;
  note: string;
};
export type BudgetConsumption = {
  fiscal_year_id: string;
  accepted_cents: number;
  paid_cents: number;
  interventions: number;
};
export type GridLine = { label: string; unit: GridUnit; amount_cents: number; note: string };
export type ContractGrid = Audited & {
  organization_id: string;
  lineage_id: string;
  version_number: number;
  label: string;
  contract_id: string | null;
  effective_from: string | null;
  currency: "EUR";
  status: GridStatus;
  published_at: string | null;
  lines: GridLine[];
};
export type CalendarWindow = { weekday: number; start: string; end: string };
export type SlaCalendar = Audited & {
  organization_id: string;
  name: string;
  timezone: string;
  windows: CalendarWindow[];
  closed_dates: string[];
};
export type SlaPolicy = Audited & {
  site_id: string;
  name: string;
  calendar_id: string | null;
  urgency: Urgency | null;
  response_target_minutes: number | null;
  resolution_target_minutes: number | null;
  status: PolicyStatus;
};
export type SlaPause = {
  id: string;
  case_id: string;
  site_id: string;
  started_at: string;
  ended_at: string | null;
  reason: string;
  created_by: string;
  created_at: string;
};
export type SlaCase = Audited & {
  site_id: string;
  policy_id: string;
  intervention_id: string | null;
  reference: string;
  opened_at: string;
  responded_at: string | null;
  resolved_at: string | null;
  notes: string;
  pauses: SlaPause[];
};
export type ChecklistItem = {
  key: string;
  label: string;
  state: ItemState;
  note: string;
  reserve_resolved_on: string | null;
};
export type ErpChecklist = Audited & {
  site_id: string;
  title: string;
  nature: "declarative";
  description: string;
  performed_on: string | null;
  performed_by_label: string;
  status: ChecklistStatus;
  items: ChecklistItem[];
};
export type OperationsEvent = {
  id: number;
  site_id: string | null;
  actor_id: string;
  entity: string;
  entity_id: string;
  action: "created" | "updated" | "published" | "recorded" | "paused" | "resumed";
  version: number;
  created_at: string;
};
export type SnapshotLimits = {
  equipment_limited: boolean;
  maintenance_plans_limited: boolean;
  fiscal_years_limited: boolean;
  budget_lines_limited: boolean;
  contract_grids_limited: boolean;
  contract_grids_readable: boolean;
  sla_calendars_limited: boolean;
  sla_policies_limited: boolean;
  sla_cases_limited: boolean;
  erp_checklists_limited: boolean;
  events_limited: boolean;
  can_write_site: boolean;
  can_write_organization: boolean;
};
/** Raw facts returned by the server in one RLS-scoped read. */
export type SiteOperationsSnapshot = {
  site: { id: string; organization_id: string; name: string; type: string; budget_cents: number };
  equipment: Equipment[];
  maintenance_plans: MaintenancePlan[];
  fiscal_years: FiscalYear[];
  budget_lines: BudgetLine[];
  budget_consumption: BudgetConsumption[];
  contract_grids: ContractGrid[] | null;
  sla_calendars: SlaCalendar[];
  sla_policies: SlaPolicy[];
  sla_cases: SlaCase[];
  erp_checklists: ErpChecklist[];
  events: OperationsEvent[];
  limits: SnapshotLimits;
};

// ---------------------------------------------------------------- SLA evaluation (server computed)
export type TrackStatus = "met" | "breached" | "pending" | "not_measurable";
export type NotMeasurableReason =
  | "no_calendar"
  | "no_target"
  | "calendar_without_windows"
  | "calendar_unreachable"
  | "invalid_timezone";
export type SlaTrack = {
  target_minutes: number | null;
  deadline_at: string | null;
  elapsed_minutes: number | null;
  remaining_minutes: number | null;
  status: TrackStatus;
  reason: NotMeasurableReason | null;
};
export type SlaEvaluation = {
  case_id: string;
  policy_id: string;
  measurable: boolean;
  reasons: NotMeasurableReason[];
  paused_now: boolean;
  response: SlaTrack;
  resolution: SlaTrack;
};
export type SlaSummary = {
  cases: number;
  measurable: number;
  not_measurable: number;
  breached: number;
  pending: number;
  met: number;
};
export type Completeness = {
  budget: { fiscal_years: number; current_fiscal_year_id: string | null; lines: number; configured: boolean };
  sla: { calendars: number; policies: number; cases: number; measurable: number; not_measurable: number };
  maintenance: { plans: number; without_schedule: number; overdue: number | null };
  erp: { checklists: number; open_reserves: number };
  contract_grids: { readable: boolean; published: number | null };
  truncated: string[];
};
/** Response of GET /api/site-operations?site_id= */
export type SiteOperationsReport = {
  site_id: string;
  snapshot: SiteOperationsSnapshot;
  sla: { cases: SlaEvaluation[]; summary: SlaSummary };
  completeness: Completeness;
  computed_at: string;
};

// ---------------------------------------------------------------- commands (POST /api/site-operations)
export type EquipmentPayload = Omit<Equipment, keyof Audited | "site_id">;
export type MaintenancePlanPayload = Omit<MaintenancePlan, keyof Audited | "site_id" | "visits">;
export type FiscalYearPayload = Omit<FiscalYear, keyof Audited | "organization_id">;
export type ContractGridPayload = {
  label: string;
  contract_id: string | null;
  effective_from: string | null;
  lines: GridLine[];
  from_grid_id?: string | null;
};
export type SlaCalendarPayload = Omit<SlaCalendar, keyof Audited | "organization_id">;
export type SlaPolicyPayload = Omit<SlaPolicy, keyof Audited | "site_id">;
export type SlaCasePayload = Omit<SlaCase, keyof Audited | "site_id" | "pauses">;
export type ErpChecklistPayload = Omit<ErpChecklist, keyof Audited | "site_id" | "nature">;
type Versioned = { id?: string; expected_version?: number };
export type SiteOperationsCommand =
  | ({ action: "save_equipment"; site_id: string; payload: EquipmentPayload } & Versioned)
  | ({ action: "save_maintenance_plan"; site_id: string; payload: MaintenancePlanPayload } & Versioned)
  | { action: "record_maintenance_visit"; plan_id: string; done_on: string; summary: string; intervention_id: string | null }
  | ({ action: "save_fiscal_year"; organization_id: string; payload: FiscalYearPayload } & Versioned)
  | { action: "save_budget_line"; site_id: string; fiscal_year_id: string; category: BudgetCategory; amount_cents: number; note: string; expected_version?: number }
  | ({ action: "save_contract_grid"; organization_id: string; payload: ContractGridPayload } & Versioned)
  | { action: "publish_contract_grid"; id: string; expected_version: number }
  | ({ action: "save_sla_calendar"; organization_id: string; payload: SlaCalendarPayload } & Versioned)
  | ({ action: "save_sla_policy"; site_id: string; payload: SlaPolicyPayload } & Versioned)
  | ({ action: "save_sla_case"; site_id: string; payload: SlaCasePayload } & Versioned)
  | { action: "pause_sla_case"; id: string; started_at: string; reason: string; expected_version: number }
  | { action: "resume_sla_case"; id: string; ended_at: string; expected_version: number }
  | ({ action: "save_erp_checklist"; site_id: string; payload: ErpChecklistPayload } & Versioned);
export type SiteOperationsCommandResult = { action: SiteOperationsCommand["action"]; result: unknown };

// ---------------------------------------------------------------- normalized leaf props (WEB-SHARED-001)
export type SiteOperationsState = "unknown" | "available" | "missing" | "unavailable";
export type SiteOperationsScope = {
  userId: string;
  role: string;
  organizationId?: string;
  siteId?: string;
  authority: { canWrite: boolean; reason?: string };
};
export type SiteOperationsClient = {
  /** Resolves to null when the identity chain is stale: nothing must be shown or updated. */
  load(siteId: string): Promise<SiteOperationsReport | null>;
  /** Resolves to null when the identity chain is stale: no success message, no state update. */
  command(command: SiteOperationsCommand): Promise<SiteOperationsCommandResult | null>;
};
export type SiteOperationsViewProps = {
  state: SiteOperationsState;
  scope: SiteOperationsScope;
  client: SiteOperationsClient;
  unavailableMessage: string;
  demo?: SiteOperationsReport;
  onNavigate?(view: string, param?: string): void;
};
