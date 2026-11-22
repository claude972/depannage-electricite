import { z } from 'zod';
/** Representable rates only. The issuer must explicitly select the applicable
 * rate; this list does not determine a tax regime from location or identity.
 * Source context: https://www.impots.gouv.fr/professionnel/questions/quels-sont-les-differents-taux-de-tva-applicables-dans-les-dom
 */
export const TAX_RATES = [0, 2.1, 5.5, 8.5, 10, 20] as const;
export type TaxRate = typeof TAX_RATES[number];
export const taxRateSchema = z.literal(TAX_RATES);
export function isTaxRate(value: unknown): value is TaxRate {
  return typeof value === 'number' && TAX_RATES.some(rate => rate === value);
}
