import { z } from 'zod';
import { parseBookingLocation, type BookingLocation } from '../../../../shared/booking-location';

export const bookingLocation = z.custom<BookingLocation>(value => parseBookingLocation(value) !== null);

export const locationCapability = z.object({ accepts_location: z.boolean().optional() });

export const hasPrivateLocation = (value: BookingLocation | undefined) =>
  Boolean(value && (value.latitude !== null || value.access_details.trim()));
