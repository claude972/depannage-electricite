/** Private booking metadata, never included in the fault description or public offers. */
export type BookingLocation = { latitude: number | null; longitude: number | null; access_details: string };
export function parseBookingLocation(value: unknown): BookingLocation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(k => !['latitude', 'longitude', 'access_details'].includes(k))) return null;
  const coordinate = (n: unknown, bound: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= bound;
  if (!((v.latitude === null && v.longitude === null) || (coordinate(v.latitude, 90) && coordinate(v.longitude, 180)))) return null;
  if (typeof v.access_details !== 'string' || v.access_details.length > 1000) return null;
  return { latitude: v.latitude as number | null, longitude: v.longitude as number | null, access_details: v.access_details };
}
