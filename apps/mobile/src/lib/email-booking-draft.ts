import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { z } from 'zod';
import { apiOrigin } from './config';
import { deviceDrafts } from './device-drafts';
import { accountEmail } from './email-account';
import { phoneBookingDraft, stagedPhoneBooking, type StagedPhoneBooking } from './phone-booking-draft';

const stagedEmailBooking = z.object({
  email: accountEmail,
  actor: z.uuid().nullable(),
  request: stagedPhoneBooking,
}).strict();

type StagedEmailBooking = z.infer<typeof stagedEmailBooking>;

export class PendingEmailBooking extends Error {}

export async function stageEmailBookingKey(email: string) {
  const address = accountEmail.parse(email);
  const digest = await digestStringAsync(CryptoDigestAlgorithm.SHA256, `${apiOrigin ?? ''}\n${address}`);
  return 'draft.v1.email-booking.staged.' + digest;
}

export const emailBookingKey = (actor: string, stageKey: string) =>
  'draft.v1.email-booking.sent.' + actor + '.' + stageKey.split('.').at(-1);

function isAvailable(value: StagedEmailBooking | null, email: string, actor: string) {
  return value?.email === email && (!value.actor || value.actor === actor);
}

export async function saveEmailBooking(stageKey: string, email: string, request: StagedPhoneBooking, actor: string | null, editExisting = false) {
  await deviceDrafts.update(stageKey, stagedEmailBooking, current => {
    const matches = current?.email === email && current.actor === actor && current.request.id === request.id;
    if ((current || editExisting) && !matches) throw new PendingEmailBooking();
    return { email, actor, request };
  });
}

export async function discardUnclaimedEmailBooking(stageKey: string, email: string, requestId: string) {
  let discarded = false;
  await deviceDrafts.update(stageKey, stagedEmailBooking, current => {
    if (current?.email !== email || current.actor !== null || current.request.id !== requestId) return current;
    discarded = true;
    return null;
  });
  return discarded;
}

export async function claimEmailBooking(stageKey: string, email: string, actor: string) {
  const claimed = await deviceDrafts.update(stageKey, stagedEmailBooking, current => {
    if (!current || !isAvailable(current, email, actor) || current.actor === actor) return current;
    return { ...current, actor };
  });
  return claimed?.email === email && claimed.actor === actor ? claimed.request : null;
}

export async function clearEmailBooking(stageKey: string, email: string, actor: string, requestId: string) {
  await deviceDrafts.update(stageKey, stagedEmailBooking, current =>
    current?.email === email && current.actor === actor && current.request.id === requestId ? null : current);
}

export async function hasEmailBooking(email: string, actor: string) {
  const key = await stageEmailBookingKey(email);
  const [stage, sent] = await Promise.all([
    deviceDrafts.read(key, stagedEmailBooking),
    deviceDrafts.read(emailBookingKey(actor, key), phoneBookingDraft),
  ]);
  return isAvailable(stage, email, actor) || Boolean(sent?.intent || sent?.receipt?.photo);
}
