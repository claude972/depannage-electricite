import {z} from 'zod';

/** Immutable reserved estimate; optional only for mixed-version deployment compatibility. */
export const estimateSnapshot=z.object({
  version:z.number().int().min(1).max(2147483647),
  min_cents:z.number().int().positive().max(2147483647),
  max_cents:z.number().int().positive().max(2147483647),
  currency:z.literal('eur'),
}).strict().refine(value=>value.max_cents>=value.min_cents);

export function estimateMatchesCap(estimate:z.infer<typeof estimateSnapshot>,cap:unknown):boolean {
  return estimate.max_cents===cap;
}
