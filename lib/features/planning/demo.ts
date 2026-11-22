// Demonstration seeds for the planning leaf (explicit demo mode only, never mixed with real data).
// Instants are Martinique local (UTC−4) and clearly synthetic.
import type { PlanningView } from "./types";
const DEMO_ARTISAN = "demo-artisan";
export function demoPlanning(range: { from: string; to: string }): PlanningView {
  const monday = new Date(range.from);
  const day = (offset: number, hour: number, minute = 0) => {
    const d = new Date(monday.getTime() + offset * 86400000);
    d.setUTCHours(hour + 4, minute, 0, 0);
    return d.toISOString().replace(".000Z", "+00:00");
  };
  return {
    range: { from: range.from, to: range.to, time_zone: "America/Martinique" },
    rules: [1, 2, 3, 4, 5].map((weekday, i) => ({
      id: `demo-rule-${weekday}`, artisan_id: DEMO_ARTISAN, weekday: weekday as 1 | 2 | 3 | 4 | 5, start_minute: 480, end_minute: 720,
      time_zone: "America/Martinique", valid_from: "2026-01-05", valid_until: null, version: 1, created_at: day(-30 + i, 8), updated_at: day(-30 + i, 8),
    })),
    entries: [
      { id: "demo-entry-1", artisan_id: DEMO_ARTISAN, kind: "busy", starts_at: day(1, 9), ends_at: day(1, 10, 30), title: "Fournisseur (démonstration)", note: "", version: 1, created_at: day(0, 7), updated_at: day(0, 7) },
      { id: "demo-entry-2", artisan_id: DEMO_ARTISAN, kind: "unavailable", starts_at: day(4, 0), ends_at: day(5, 0), title: "Congé (démonstration)", note: "", version: 1, created_at: day(0, 7), updated_at: day(0, 7) },
    ],
    appointments: [
      { intervention_id: "demo-a1", reference: "INT-DEMOA1", status: "accepted", category: "panel", city: "Fort-de-France", starts_at: day(2, 8), ends_at: day(2, 10), note: "Interphone 12", updated_at: day(0, 7), outside_availability: false },
    ],
    free: [
      { starts_at: day(0, 8), ends_at: day(0, 12) },
      { starts_at: day(1, 8), ends_at: day(1, 9) }, { starts_at: day(1, 10, 30), ends_at: day(1, 12) },
      { starts_at: day(2, 10), ends_at: day(2, 12) }, { starts_at: day(3, 8), ends_at: day(3, 12) },
    ],
    limits: { rules: 50, entries: 200, appointments: 200, entries_limited: false, appointments_limited: false },
    permissions: { can_edit: true, reason: null },
  };
}
