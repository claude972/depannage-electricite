import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { z } from 'zod';
import { requestFields } from './contracts';
import { phoneContact } from './phone-client';
import { bookingLocation } from './booking-location';
import { pendingPhoto } from './intervention-drafts';

const bookingFields = requestFields.extend({ service_slug: z.string().min(1).max(80), location: bookingLocation.optional() });
export const bookingInput = bookingFields;
export const stagedPhoneBooking = z.object({
  id: z.uuid(),
  input: bookingInput,
  contact: phoneContact,
  photo: pendingPhoto.optional(),
});
export type StagedPhoneBooking = z.infer<typeof stagedPhoneBooking>;

export const bookingIntent = stagedPhoneBooking.extend({
  version: z.number().int().positive().max(2147483647),
  range: z.object({ min_cents: z.number().int().nonnegative(), max_cents: z.number().int().nonnegative() }),
  reviewRequired: z.boolean(),
});
export const phoneBookingDraft = z.object({
  intent: bookingIntent.nullable(),
  receipt: z.object({ requestId: z.uuid(), interventionId: z.uuid(), photo: pendingPhoto.optional() }).nullable(),
});
export const emptyPhoneBooking = { intent: null, receipt: null };

export const bookingReceipt = z.object({
  status: z.literal('confirmed'),
  intervention: z.object({ id: z.uuid() }),
  payment: z.object({ method: z.literal('on_site'), status: z.literal('due_on_site') }),
});

export async function stagePhoneBookingKey(phone: string) {
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, phone);
  return 'draft.v1.phone-booking.staged.' + hash;
}

export function phoneBookingKey(actor: string, stagingKey: string) {
  return 'draft.v1.phone-booking.sent.' + actor + '.' + stagingKey.split('.').at(-1);
}
