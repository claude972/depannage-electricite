// Formatting shared by the PDF renderer and the leaf components. Deterministic, no Intl:
// the PDF must encode in WinAnsi (no narrow no-break space) and tests must not depend on ICU.
import type { AmendmentStatus, ValidityState } from "./types";

const NBSP = " ";

/** 123456 → "1 234,56 €" (no-break spaces). Negative amounts are not expected but kept readable. */
export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const units = Math.floor(abs / 100).toString();
  const decimals = (abs % 100).toString().padStart(2, "0");
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${sign}${grouped},${decimals}${NBSP}€`;
}
/** 20 → "20 %", 5.5 → "5,5 %". */
export function formatTaxRate(rate: number): string {
  return `${String(rate).replace(".", ",")}${NBSP}%`;
}
/** "2026-10-31" → "31/10/2026". Anything else is returned unchanged (never reinterpreted). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}
/** ISO timestamp → "31/10/2026 14:05 UTC". The zone is printed so the reader is never misled. */
export function formatDateTimeUtc(value: string | null | undefined): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${NBSP}UTC`;
}
/** ISO timestamp → "31/10/2026 19:59 (heure de Martinique)". The service area is Martinique only
 * (America/Martinique: UTC−4 all year, no daylight saving), so the offset is applied without Intl
 * and the printed time matches the one shown in the application. The zone is printed. */
export function formatDateTimeMartinique(value: string | null | undefined): string {
  if (!value) return "";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const d = new Date(time - 4 * 3600000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} (heure de Martinique)`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  outage: "Coupure de courant",
  panel: "Tableau électrique",
  socket: "Prise ou interrupteur",
  lighting: "Éclairage",
  diagnostic: "Recherche de panne",
};
export const URGENCY_LABELS: Record<string, string> = { urgent: "Urgent", scheduled: "Planifié" };
export const QUOTE_STATUS_LABELS: Record<string, string> = {
  sent: "En attente de décision",
  accepted: "Accepté",
  rejected: "Non retenu",
};
export const AMENDMENT_STATUS_LABELS: Record<AmendmentStatus, string> = {
  proposed: "Proposé, en attente de décision",
  accepted: "Accepté",
  rejected: "Refusé",
  withdrawn: "Retiré par l’artisan",
};
export const ISSUER_FIELD_LABELS: Record<string, string> = {
  company_name: "raison sociale",
  siret: "SIRET",
  address: "adresse",
  contact_name: "nom du contact",
  legal_status: "forme juridique",
  phone: "téléphone",
  vat_number: "numéro de TVA intracommunautaire",
  insurance: "assurance professionnelle",
};
export function issuerFieldLabels(fields: string[]): string {
  return fields.map((f) => ISSUER_FIELD_LABELS[f] ?? f).join(", ");
}

/** Validity sentence. An unset validity is stated as such, never shown as expired. */
export function validityLabel(terms: { valid_until: string | null; validity: ValidityState } | null | undefined): string {
  if (!terms || terms.validity === "unspecified" || !terms.valid_until) return "Validité non renseignée par l’émetteur";
  if (terms.validity === "expired") return `Validité dépassée depuis le ${formatDate(terms.valid_until)}`;
  return `Valable jusqu’au ${formatDate(terms.valid_until)} inclus`;
}

const SAFE_FILE = /[^A-Za-z0-9_-]+/g;
/** Attachment name: ASCII only, no path separators, stable per reference and revision. */
export function documentFileName(doc: { kind: string; reference: string; revision: number }): string {
  const prefix = doc.kind === "amendment" ? "avenant" : "devis";
  const ref = doc.reference.replace(SAFE_FILE, "-").replace(/^-+|-+$/g, "") || "document";
  return `${prefix}-${ref}-r${Math.max(1, Math.trunc(doc.revision))}.pdf`;
}
