// Pure form helpers of the leaf components (testable without a DOM).
import type { ZodType } from "zod";

/** Field errors keyed by full paths, with an aggregate for the first path segment of each validation issue ("_" for form-level). */
export function fieldErrors(schema: ZodType, value: unknown): Record<string, string> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "_";
    const field = String(issue.path.at(-1) ?? "");
    const names: Record<string, string> = { name: "la désignation", title: "l’intitulé", label: issue.path[0] === "lines" ? "le libellé de la ligne" : issue.path[0] === "items" ? "l’intitulé du point" : "le libellé", starts_on: "la date de début", ends_on: "la date de fin" };
    let message = issue.message;
    if (issue.code === "too_small" && issue.origin === "string") message = `Indiquez ${names[field] ?? "ce champ"}.`;
    else if (issue.code === "too_big") message = "La valeur saisie est trop longue ou trop élevée.";
    else if (issue.code === "invalid_type") message = field === "amount_cents" ? "Indiquez un montant valide en euros." : "Indiquez une valeur valide.";
    else if (message === "Date attendue au format AAAA-MM-JJ.") message = names[field] ? `Indiquez ${names[field]}.` : "Choisissez une date valide.";
    if (!errors[key]) errors[key] = message;
    const group = String(issue.path[0] ?? "_");
    if (!errors[group]) errors[group] = message;
  }
  return errors;
}
/** "" → null ; digits → integer ; anything else → NaN (rejected by the schema). */
export const toInt = (value: string): number | null => (value.trim() === "" ? null : /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
/** Euro text ("1 234,50") → cents ; invalid → NaN (rejected by the schema). */
export const toCents = (value: string): number => {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
};
export const fromCents = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
export const orNull = (value: string): string | null => (value.trim() === "" ? null : value.trim());
/** datetime-local value (browser zone) → ISO instant ; "" → null ; unparsable → "invalid". */
export const toInstant = (local: string): string | null => {
  if (!local) return null;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? "invalid" : new Date(ms).toISOString();
};
export const fromInstant = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
