import { z } from 'zod';
import { requestFields } from './contracts';
import { bookingLocation } from './phone-booking-draft';

export const requestContact = z.object({
  first_name: z.string().trim().min(1, 'Renseignez votre prénom.').max(60),
  last_name: z.string().trim().min(1, 'Renseignez votre nom.').max(60),
  phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'Saisissez un numéro de téléphone valide (ex. +596 ou +590).'),
}).refine(value => value.first_name.length + value.last_name.length < 120, 'Le prénom et le nom sont trop longs.');

export const requestIntent = z.object({
  id: z.uuid(),
  payload: requestFields.extend({ location: bookingLocation.optional(), reviewed_estimate_version: z.number().int().positive().max(2147483647) }),
  booking: z.object({ service_slug: z.string().min(1).max(80), contact: requestContact }).optional(),
  estimate: z.object({ min_cents: z.number().int().nonnegative(), max_cents: z.number().int().nonnegative() }),
  reviewRequired: z.boolean(),
});
export type RequestIntent = z.infer<typeof requestIntent>;
export const requestDraft = z.object({
  intent: requestIntent.nullable(),
  confirmedId: z.uuid().nullable().default(null),
});
