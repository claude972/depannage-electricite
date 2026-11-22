// Contract ADV-PLANNING-NOTIFICATIONS-001 (docs/CLAUDE_ADV_PLANNING_CONTRACT.md).
// Shapes returned by /api/planning and /api/planning/slots. Every instant is ISO 8601 with offset.
export const PLANNING_TIME_ZONE = "America/Martinique";
export const PLANNING_MAX_RANGE_DAYS = 62;
export const SLOTS_MAX_RANGE_DAYS = 31;
export type PlanningEntryKind = "busy" | "unavailable" | "available";
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type AvailabilityRule = {
  id: string;
  artisan_id: string;
  weekday: Weekday;
  start_minute: number;
  end_minute: number;
  time_zone: string;
  valid_from: string;
  valid_until: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
export type PlanningEntry = {
  id: string;
  artisan_id: string;
  kind: PlanningEntryKind;
  starts_at: string;
  ends_at: string;
  title: string;
  note: string;
  version: number;
  created_at: string;
  updated_at: string;
};
export type PlanningAppointment = {
  intervention_id: string;
  reference: string;
  status: string;
  category: string;
  city: string;
  starts_at: string;
  ends_at: string;
  note: string;
  updated_at: string;
  outside_availability: boolean;
};
export type Interval = { starts_at: string; ends_at: string };
export type PlanningView = {
  range: { from: string; to: string; time_zone: string };
  rules: AvailabilityRule[];
  entries: PlanningEntry[];
  appointments: PlanningAppointment[];
  free: Interval[];
  limits: {
    rules: number;
    entries: number;
    appointments: number;
    entries_limited: boolean;
    appointments_limited: boolean;
  };
  permissions: { can_edit: boolean; reason: string | null };
};
export type FreeSlots = {
  intervention_id: string;
  from: string;
  to: string;
  availability_declared: boolean;
  slots: Interval[];
  computed_at: string;
};
export type PlanningCommand =
  | {
      action: "save_rule";
      request_id: string;
      id?: string;
      weekday: Weekday;
      start_minute: number;
      end_minute: number;
      time_zone?: string;
      valid_from?: string | null;
      valid_until?: string | null;
      expected_version?: number;
    }
  | { action: "delete_rule"; id: string; expected_version: number }
  | {
      action: "save_entry";
      request_id: string;
      id?: string;
      kind: PlanningEntryKind;
      starts_at: string;
      ends_at: string;
      title: string;
      note: string;
      expected_version?: number;
    }
  | { action: "delete_entry"; id: string; expected_version: number };
export type PlanningCommandResponse =
  | { rule: AvailabilityRule; replayed: boolean }
  | { entry: PlanningEntry; replayed: boolean }
  | { deleted: true; id: string };
/** Result shape the leaf component expects from the integrator's client. */
export type PlanningCommandResult =
  | { ok: true; data: PlanningCommandResponse }
  | { ok: false; conflict: boolean; message: string };
