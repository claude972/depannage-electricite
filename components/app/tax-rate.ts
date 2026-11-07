// Explicit VAT rate selection (EXPLICIT-TAX, UI side). Options come ONLY from the canonical
// lib/tax-rates list; nothing here picks a rate, derives one from a location or infers an
// exemption. Stored historical rates are displayed as stored (taxRateLabel), never recomputed.
import { TAX_RATES, isTaxRate, type TaxRate } from "../../lib/tax-rates";

export { TAX_RATES, isTaxRate, type TaxRate };
export const TAX_RATE_PLACEHOLDER = "Choisir un taux";
export const TAX_RATE_HINT = "Choisissez le taux applicable à votre opération.";
export const TAX_RATE_REQUIRED = "Choisissez un taux de TVA pour pouvoir envoyer.";

/** « 8,5 % », « 2,1 % », « 20 % » (fr-FR), for any stored number. */
export function taxRateLabel(rate: number): string {
  return `${rate.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
}
/** Select options: value is the canonical number as a string, label fr-FR. */
export const TAX_RATE_OPTIONS: readonly { value: string; label: string }[] = TAX_RATES.map((r) => ({ value: String(r), label: taxRateLabel(r) }));
/** Select value → supported rate, or null (empty / anything not in TAX_RATES). */
export function parseTaxRateInput(raw: string): TaxRate | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return isTaxRate(n) ? n : null;
}
