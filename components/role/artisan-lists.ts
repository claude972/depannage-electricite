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
  /** null = offers are paged by the server (no exhaustive count is known): label without a number. */
  offers: number | null;
  active: number;
  done: number;
}): readonly (readonly [MissionSegment, string])[] {
  return [
    ["available", counts.offers === null ? "Disponibles" : `Disponibles (${counts.offers})`],
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

// ---- Planning (ADV-PLANNING-NOTIFICATIONS-001) : droit d’écriture et semaine de démonstration ----
import { dateKey, isoWeekday } from "../../lib/features/planning/time";
import type { ArtisanApplicationStatus, Mode } from "../app/types";

/**
 * Droit d’écriture du planning tel que la coque le connaît déjà : un artisan suspendu, ou non
 * approuvé en mode réel, voit son planning en lecture seule avec la raison. Le serveur reste
 * l’autorité (`permissions.can_edit`) ; l’interface n’élargit jamais.
 */
export function planningAuthority(
  mode: Mode,
  artisanApproved: boolean | undefined,
  status: ArtisanApplicationStatus | undefined,
): { canWrite: boolean; reason?: string } {
  if (status === "suspended")
    return { canWrite: false, reason: "Votre accès est suspendu par l’opérateur : le planning reste consultable, sans modification." };
  if (mode === "live" && artisanApproved === false)
    return { canWrite: false, reason: "Votre compte artisan n’est pas encore activé : le planning reste consultable, sans modification." };
  return { canWrite: true };
}

/** Semaine courante (lundi 00:00 → lundi suivant) dans le fuseau du planning, pour la démo. */
export function demoPlanningRange(now: Date, zone: string): { from: string; to: string } {
  const key = dateKey(now, zone); // AAAA-MM-JJ local
  const weekday = isoWeekday(now, zone); // 1 = lundi
  const localMidnight = new Date(`${key}T00:00:00Z`);
  const monday = new Date(localMidnight.getTime() - (weekday - 1) * 86400000);
  const next = new Date(monday.getTime() + 7 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: `${iso(monday)}T00:00:00`, to: `${iso(next)}T00:00:00` };
}

// ---- Documents obligatoires (M14) : compte réel de pièces, libellé de date sans invention -------
import { date as formatDate } from "../app/format";

export type CredentialLike = {
  key: "missing" | "pending" | "expired" | "valid";
  credential?: { expires_on?: string | null; created_at: string };
};

/** Compte des pièces transmises sur les trois obligatoires ; « complet » seulement à 3/3 (jamais un pourcentage de validation). */
export function credentialSummary(states: readonly CredentialLike[]) {
  const total = states.length;
  const transmitted = states.filter((s) => s.key !== "missing").length;
  return { transmitted, total, complete: total > 0 && transmitted === total, label: `${transmitted}/${total} pièces transmises` };
}

/** Colonne d’état M14 : la date vient uniquement de `expires_on` ; sans date, on le dit. */
export function credentialDateLabel(state: CredentialLike): string | null {
  if (!state.credential) return null;
  const until = state.credential.expires_on;
  if (!until) return "Sans date d’expiration renseignée";
  return state.key === "expired" ? `Expiré le ${formatDate(until)}` : `Valide jusqu’au ${formatDate(until)}`;
}

// ---- Candidature (M65) : état des cinq sections, déduit des valeurs et pièces réelles -----------
export type ApplicationStepInput = {
  personalDone: boolean;
  companyName: string;
  siret: string;
  legalStatus: string;
  address: string;
  postalCodes: readonly string[];
  categories: readonly string[];
  credentialsComplete: boolean;
  hasProfile: boolean;
};
export type ApplicationStep = { n: 1 | 2 | 3 | 4 | 5; label: string; done: boolean };

/** Cinq sections M65 ; « renseignée » vient uniquement des valeurs saisies et des pièces transmises. */
export function applicationSteps(i: ApplicationStepInput): ApplicationStep[] {
  return [
    { n: 1, label: "Informations personnelles", done: i.personalDone },
    {
      n: 2,
      label: "Société",
      done: i.companyName.trim().length >= 2 && /^\d{14}$/.test(i.siret) && Boolean(i.legalStatus) && i.address.trim().length >= 5,
    },
    { n: 3, label: "Pièces justificatives", done: i.credentialsComplete },
    { n: 4, label: "Zones et compétences", done: i.postalCodes.length > 0 && i.categories.length > 0 },
    { n: 5, label: "Disponibilité", done: i.hasProfile },
  ];
}

export const stepsSummary = (steps: readonly ApplicationStep[]) =>
  `${steps.filter((s) => s.done).length} section${steps.filter((s) => s.done).length > 1 ? "s" : ""} sur ${steps.length} renseignée${steps.filter((s) => s.done).length > 1 ? "s" : ""}`;

// ---- État d’une pièce justificative (ART-CREDENTIAL-001) ----------------------------------------
import type { ArtisanCredential, CredentialKind } from "../app/types";

export type CredentialState = {
  key: "missing" | "expired" | "pending";
  label: string;
  tone: "red" | "amber" | "blue";
  credential?: ArtisanCredential;
};

/**
 * État d’une pièce déduit de la pièce seule (dernière transmise pour ce type) : manquante,
 * expirée (date d’expiration dépassée) ou transmise. Le modèle n’enregistre aucune validation
 * par pièce : l’approbation de la candidature est un état du dossier, affiché à part, jamais
 * reporté comme « Validé » sur une pièce.
 */
export function credentialState(
  credentials: readonly ArtisanCredential[],
  kind: CredentialKind,
  today: string,
): CredentialState {
  const credential = [...credentials]
    .filter((c) => c.kind === kind)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!credential) return { key: "missing", label: "Manquant", tone: "red" };
  if (credential.expires_on && credential.expires_on < today)
    return { key: "expired", label: "À renouveler", tone: "amber", credential };
  return { key: "pending", label: "Transmis", tone: "blue", credential };
}
