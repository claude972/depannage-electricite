import { z } from 'zod';
import { category } from './contracts';

const cents = z.number().int().min(0).max(2147483647);
const range = z.object({ min_cents: cents, max_cents: cents }).refine(value => value.min_cents <= value.max_cents);
const offer = z.object({
  id: z.uuid(), category, city: z.string().min(1).max(160),
  postal_code: z.string().regex(/^\d{3}\*\*$/), urgency: z.enum(['urgent', 'scheduled']),
  status: z.literal('requested'), estimate_min_cents: cents, estimate_max_cents: cents,
  created_at: z.iso.datetime({ offset: true }),
}).strict().refine(value => value.estimate_min_cents <= value.estimate_max_cents);
export const offers = z.object({
  items: z.array(offer).max(50), eligible: z.boolean(), projection: z.literal('anonymized'),
  page: z.object({ next_cursor: z.string().max(300).nullable() }),
});
export const selectedOffer = offers.extend({ items: z.tuple([offer]), net_estimate: range.nullable() });
