// Pure form helpers of the leaf components (testable without a DOM).
import type { ZodType } from "zod";

/** Field errors keyed by the first path segment of each validation issue ("_" for form-level). */
export function fieldErrors(schema: ZodType, value: unknown): Record<string, string> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!errors[key]) errors[key] = issue.message;
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
