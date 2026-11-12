import { BOOKING_TTL_MS } from './booking-draft';

let staged: { requestId: string; photo: File; expires: number } | null = null;

export function stagePublicBookingPhoto(requestId: string, photo: File | null) {
  staged = photo ? { requestId, photo, expires: Date.now() + BOOKING_TTL_MS } : null;
}

export function publicBookingPhoto(requestId: string | undefined, consume = false): File | undefined {
  if (staged && staged.expires <= Date.now()) staged = null;
  if (!staged || !requestId || staged.requestId !== requestId) return undefined;
  const photo = staged.photo;
  if (consume) staged = null;
  return photo;
}
