import { z } from 'zod';
import { requestFields } from './contracts';

export const requestIntent = z.object({
  id: z.uuid(),
  payload: requestFields.extend({ reviewed_estimate_version: z.number().int().positive().max(2147483647) }),
  estimate: z.object({ min_cents: z.number().int().nonnegative(), max_cents: z.number().int().nonnegative() }),
  reviewRequired: z.boolean(),
});
export type RequestIntent = z.infer<typeof requestIntent>;
export const requestDraft = z.object({ intent: requestIntent.nullable() });
