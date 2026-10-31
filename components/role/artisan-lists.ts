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

// ---- Performance (M36 / M35) : descripteurs de tuiles, jamais de valeur inventée -----------
import type { Performance } from "../app/session";
import { money } from "../app/format";

/** Note moyenne au dixième, virgule française (« 4,7 »). */
export const fmtRating = (value: number) =>
  value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

export type PerfTileSpec =
  | { id: string; kind: "value"; icon: string; tone: "amber" | "green" | "blue"; label: string; value: string; note: string }
  | { id: string; kind: "unavailable"; label: string; reason: string; blocker: string };

/**
 * Six tuiles de la grille M36. Les indicateurs sans source (satisfaction, ponctualité) restent
 * « indisponibles » avec leur raison ; les autres sont calculés sur les dossiers chargés.
 */
export function perfTiles(perf: Performance, since: string | null): PerfTileSpec[] {
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;
  return [
    {
      id: "satisfaction",
      kind: "unavailable",
      label: "Taux de satisfaction",
      reason: "Aucun questionnaire de satisfaction n’est collecté.",
      blocker: "enquête de satisfaction non prévue",
    },
    {
      id: "rating",
      kind: "value",
      icon: "star",
      tone: "amber",
      label: "Note moyenne",
      value: perf.rating ? `${fmtRating(perf.rating.average)} / 5` : "—",
      note: perf.rating ? `${plural(perf.rating.count, "avis client")}` : "Aucun avis encore",
    },
    {
      id: "completed",
      kind: "value",
      icon: "check",
      tone: "green",
      label: "Interventions réalisées",
      value: String(perf.completedCount),
      note: "Dossiers réglés",
    },
    {
      id: "seniority",
      kind: "value",
      icon: "calendar",
      tone: "blue",
      label: "Ancienneté",
      value: since ?? "—",
      note: since ? "Depuis l’inscription" : "Date d’inscription non transmise",
    },
    {
      id: "punctuality",
      kind: "unavailable",
      label: "Ponctualité",
      reason: "Les rendez-vous ne sont pas comparés aux arrivées.",
      blocker: "mesure de ponctualité non prévue",
    },
    {
      id: "revenue",
      kind: "value",
      icon: "euro",
      tone: "green",
      label: "CA du mois",
      value: money(perf.monthRevenueCents),
      note: `${plural(perf.monthPaidCount, "règlement")} — ${perf.period}`,
    },
  ];
}

// ---- Devis (M34) : totaux d’affichage, même formule que la plateforme ------------------------
/** Total HT d’une ligne en centimes (quantité × prix unitaire HT), arrondi au centime. */
export const quoteLineTotalCents = (quantity: number, unitPriceCents: number) =>
  Math.round(quantity * unitPriceCents);

/**
 * Sous-total HT, TVA et TTC d’un brouillon. `tax` et `total` sont null tant qu’aucun taux de
 * TVA n’est choisi : rien n’est supposé à la place de l’artisan.
 */
export function quoteTotals(
  lines: readonly { quantity: number; unit_price_cents: number }[],
  taxRate: number | null,
): { subtotal: number; tax: number | null; total: number | null } {
  const subtotal = lines.reduce((n, l) => n + quoteLineTotalCents(l.quantity, l.unit_price_cents), 0);
  if (taxRate === null) return { subtotal, tax: null, total: null };
  const tax = Math.round((subtotal * taxRate) / 100);
  return { subtotal, tax, total: subtotal + tax };
}
