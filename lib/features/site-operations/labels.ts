// French user-facing labels for the site operations lot. No internal name (table, RPC, route)
// ever appears here; every status is also conveyed by text, never by colour alone.
import type {
  BudgetCategory,
  ChecklistStatus,
  Criticality,
  EquipmentCategory,
  EquipmentStatus,
  FrequencyKind,
  GridStatus,
  GridUnit,
  ItemState,
  NotMeasurableReason,
  PlanStatus,
  TrackStatus,
} from "./types";

export const EQUIPMENT_CATEGORY: Record<EquipmentCategory, string> = {
  panel: "Tableau électrique",
  lighting: "Éclairage",
  emergency_lighting: "Éclairage de sécurité",
  fire_safety: "Sécurité incendie (partie électrique)",
  hvac: "Chauffage / ventilation (partie électrique)",
  generator: "Groupe électrogène",
  ups: "Onduleur",
  other: "Autre équipement",
};
export const CRITICALITY: Record<Criticality, string> = { low: "Faible", medium: "Moyenne", high: "Élevée", critical: "Critique" };
export const EQUIPMENT_STATUS: Record<EquipmentStatus, string> = {
  in_service: "En service",
  degraded: "Dégradé",
  out_of_service: "Hors service",
  retired: "Retiré",
};
export const FREQUENCY_KIND: Record<FrequencyKind, string> = { none: "Sans périodicité", days: "Tous les N jours", weeks: "Toutes les N semaines", months: "Tous les N mois" };
export const PLAN_STATUS: Record<PlanStatus, string> = { active: "Actif", paused: "Suspendu", archived: "Archivé" };
export const BUDGET_CATEGORY: Record<BudgetCategory, string> = {
  maintenance: "Maintenance",
  repairs: "Dépannages",
  compliance: "Contrôles et vérifications",
  equipment: "Équipements",
  other: "Autre",
};
export const GRID_STATUS: Record<GridStatus, string> = { draft: "Brouillon", published: "Publiée", superseded: "Remplacée" };
export const GRID_UNIT: Record<GridUnit, string> = { hour: "par heure", visit: "par déplacement", flat: "forfait", km: "par kilomètre", unit: "à l’unité" };
export const CHECKLIST_STATUS: Record<ChecklistStatus, string> = { draft: "En préparation", completed: "Réalisé", archived: "Archivé" };
export const ITEM_STATE: Record<ItemState, string> = { not_checked: "Non vérifié", ok: "Conforme à la déclaration", reserve: "Réserve", not_applicable: "Sans objet" };
export const TRACK_STATUS: Record<TrackStatus, string> = {
  met: "Respecté",
  breached: "Dépassé",
  pending: "En cours",
  not_measurable: "Non mesurable",
};
export const NOT_MEASURABLE: Record<NotMeasurableReason, string> = {
  no_calendar: "aucun calendrier ouvré n’est associé à la règle",
  no_target: "aucune cible de délai n’est configurée",
  calendar_without_windows: "le calendrier n’a aucune plage ouvrée",
  calendar_unreachable: "le calendrier est trop restreint pour atteindre la cible",
  invalid_timezone: "le fuseau horaire du calendrier est inconnu",
  future_fact: "une date de fait constaté est dans le futur",
  pauses_incomplete: "pauses incomplètes : la liste des pauses reçue ne correspond pas au total enregistré",
};
export const WEEKDAY: Record<number, string> = { 1: "Lundi", 2: "Mardi", 3: "Mercredi", 4: "Jeudi", 5: "Vendredi", 6: "Samedi", 7: "Dimanche" };
export const ENTITY: Record<string, string> = {
  equipment: "Équipement",
  maintenance_plan: "Plan de maintenance",
  maintenance_visit: "Visite de maintenance",
  fiscal_year: "Exercice budgétaire",
  budget_line: "Ligne budgétaire",
  contract_grid: "Grille contractuelle",
  sla_calendar: "Calendrier ouvré",
  sla_policy: "Règle de délai",
  sla_case: "Dossier de délai",
  sla_pause: "Pause de délai",
  erp_checklist: "Contrôle déclaratif",
};
export const EVENT_ACTION: Record<string, string> = {
  created: "créé",
  updated: "modifié",
  published: "publié",
  recorded: "enregistré",
  paused: "mis en pause",
  resumed: "repris",
};
/** Fixed wording: a declarative checklist is never a regulatory certification. */
export const DECLARATIVE_NOTICE =
  "Déclaratif — cette liste reflète les vérifications déclarées par votre organisation ; elle ne vaut pas certification réglementaire et ne cite aucune obligation comme validée.";
export const NO_GLOBAL_ALERT_NOTICE =
  "Les indicateurs ne couvrent que les données configurées : un délai sans calendrier ou sans cible reste non mesurable, un plan sans échéance n’est pas compté.";

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
export const money = (cents: number) => euro.format(cents / 100);
export const date = (value: string | null) => (value ? dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`)) : "—");
export const dateTime = (value: string | null) => (value ? dateTimeFormat.format(new Date(value)) : "—");
export const minutes = (value: number | null) => {
  if (value === null) return "—";
  const h = Math.floor(value / 60), m = value % 60;
  return h ? (m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`) : `${m} min`;
};
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
