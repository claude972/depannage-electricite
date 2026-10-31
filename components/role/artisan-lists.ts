// Logique pure de l’espace artisan (M35 tableau de bord, M36 profil, M34 devis).
// Sans React ni CSS : testée par tests/ui/artisan-lists.test.ts.
import type { Appointment } from "../app/types";

/** Lecture d’un rendez-vous : undefined = en cours, null = indisponible, sinon la valeur lue. */
export type AppointmentEntry = { appointment: Appointment | null } | null;

export type SlotState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "unscheduled" }
  | { kind: "scheduled"; today: boolean; startsAt: string; endsAt: string };

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * État de l’horaire d’une mission (colonne droite des lignes M35). Seul un rendez-vous réellement
 * enregistré donne un horaire ; sans rendez-vous il reste « à fixer », jamais déduit.
 */
export function appointmentSlotState(entry: AppointmentEntry | undefined, now: Date): SlotState {
  if (entry === undefined) return { kind: "loading" };
  if (entry === null) return { kind: "unavailable" };
  if (!entry.appointment) return { kind: "unscheduled" };
  const start = new Date(entry.appointment.starts_at);
  return {
    kind: "scheduled",
    today: sameLocalDay(start, now),
    startsAt: entry.appointment.starts_at,
    endsAt: entry.appointment.ends_at,
  };
}

export type MissionSegment = "available" | "active" | "done";

/** Segments de la liste Missions avec leurs compteurs réels (offres visibles, en cours, terminées). */
export function missionSegmentOptions(counts: {
  offers: number;
  active: number;
  done: number;
}): readonly (readonly [MissionSegment, string])[] {
  return [
    ["available", `Disponibles (${counts.offers})`],
    ["active", `En cours (${counts.active})`],
    ["done", `Terminées (${counts.done})`],
  ] as const;
}
