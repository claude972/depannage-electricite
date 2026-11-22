import { CATEGORIES as DOMAIN_CATEGORIES } from "../../lib/domain";
import { orderReference, quoteReference } from "../../shared/order-reference";
import type { Category, Role, Status, TravelStage } from "./types";

export const CATEGORIES: {
  id: Category;
  label: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "outage",
    label: "Coupure de courant",
    description: "Tout ou partie du logement",
    icon: "power",
  },
  {
    id: "panel",
    label: "Tableau électrique",
    description: "Disjoncteur, fusible ou tableau",
    icon: "panel",
  },
  {
    id: "socket",
    label: "Prise ou interrupteur",
    description: "Une prise ou un point de commande",
    icon: "plug",
  },
  {
    id: "lighting",
    label: "Éclairage",
    description: "Luminaire ou circuit d’éclairage",
    icon: "bulb",
  },
  {
    id: "diagnostic",
    label: "Recherche de panne",
    description: "L’origine du problème est inconnue",
    icon: "search",
  },
];
export const STATUS: Record<Status, string> = {
  requested: "Recherche d’un artisan",
  assigned: "Artisan affecté",
  quoted: "Devis à valider",
  accepted: "Devis accepté",
  in_progress: "Intervention en cours",
  completed: "À régler",
  paid: "Terminée et réglée",
  cancelled: "Annulée",
};
// Wording from the artisan's side of the same states.
export const ARTISAN_STATUS: Record<Status, string> = {
  requested: "Mission disponible",
  assigned: "Devis à établir",
  quoted: "Devis envoyé",
  accepted: "À réaliser",
  in_progress: "En cours",
  completed: "Terminée, règlement attendu",
  paid: "Réglée",
  cancelled: "Annulée",
};
export const TRAVEL_STAGE: Record<TravelStage, string> = {
  planned: "Déplacement prévu",
  en_route: "En route",
  on_site: "Sur place",
};
export const ROLE_NAMES: Record<Role, string> = {
  client: "Particulier",
  artisan: "Artisan",
  manager: "Entreprise cliente",
  admin: "Super Admin plateforme",
};
export const SITE_TYPES: Record<string, string> = {
  syndic: "Copropriété",
  restaurant: "Restauration",
  office: "Bureaux",
  erp: "ERP",
};
export const money = (cents: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
const parseDate = (value: string) =>
  new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
export const date = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parseDate(value));
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDate(value));
export const time = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parseDate(value));
export const category = (id: string) => {
  const visual = CATEGORIES.find((c) => c.id === id) || CATEGORIES[4];
  const domain = DOMAIN_CATEGORIES.find((c) => c.id === visual.id)!;
  return { ...visual, min: domain.min, max: domain.max };
};
export const shortId = orderReference;
export const quoteRef = quoteReference;
export const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function download(
  name: string,
  content: string,
  type = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Same guard as lib/domain csvCell, kept client-side so exports do not depend on the server bundle.
export const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const guarded = /^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
};
export const csv = (rows: unknown[][]) =>
  "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");

/** CLI-04: who last saved the slot, said plainly. The service has NO separate confirmation step for
 *  a slot (either party overwrites it), so nothing here reads as « confirmé ». null = author not
 *  known or neither the viewer nor the assigned artisan: nothing is claimed. */
export function appointmentOrigin(input: { updatedBy?: string | null; viewerId?: string | null; artisanId?: string | null; editable: boolean }): string | null {
  const { updatedBy, viewerId, artisanId, editable } = input;
  if (!updatedBy) return null;
  if (viewerId && updatedBy === viewerId) return editable ? "Créneau enregistré par vous — l’artisan peut encore le modifier." : "Créneau enregistré par vous.";
  if (artisanId && updatedBy === artisanId) return editable ? "Créneau proposé par l’artisan — modifiez-le s’il ne vous convient pas." : "Créneau proposé par l’artisan.";
  return null;
}
