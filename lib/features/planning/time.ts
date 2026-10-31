// Pure date/time helpers for the planning feature. No Date.prototype local-zone arithmetic: every
// conversion goes through Intl with an explicit IANA zone, so the server and the browser agree.
import { PLANNING_TIME_ZONE, type Weekday } from "./types";

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
  7: "Dimanche",
};
export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const MINUTE = 60000;
const DAY = 86400000;

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
const partCache = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let cached = partCache.get(zone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partCache.set(zone, cached);
  }
  return cached;
}
/** True when the zone is known to this runtime (Intl throws on unknown zones). */
export function isKnownTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}
/** Wall-clock parts of an instant in a zone. */
export function partsInZone(instant: Date | number | string, zone = PLANNING_TIME_ZONE): Parts {
  const date = instant instanceof Date ? instant : new Date(instant);
  const out: Partial<Parts> = {};
  for (const part of formatter(zone).formatToParts(date)) {
    if (part.type === "year" || part.type === "month" || part.type === "day" || part.type === "hour" || part.type === "minute" || part.type === "second")
      out[part.type] = Number(part.value);
  }
  return out as Parts;
}
/** Offset (minutes east of UTC) of a zone at a given instant. Martinique is −240 all year. */
export function offsetMinutes(instant: Date | number | string, zone = PLANNING_TIME_ZONE): number {
  const date = instant instanceof Date ? instant : new Date(instant);
  const p = partsInZone(date, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE);
}
const two = (n: number) => String(n).padStart(2, "0");
function offsetText(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`;
}
/** ISO 8601 with the zone's numeric offset, e.g. 2026-11-02T08:00:00-04:00 (never a bare Z). */
export function toIsoWithOffset(instant: Date | number | string, zone = PLANNING_TIME_ZONE): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new RangeError("Instant invalide.");
  const p = partsInZone(date, zone);
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}:${two(p.second)}${offsetText(offsetMinutes(date, zone))}`;
}
/** Instant of a wall-clock time in a zone (handles any offset, including DST zones). */
export function zonedTimeToInstant(
  { year, month, day, hour = 0, minute = 0, second = 0 }: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number },
  zone = PLANNING_TIME_ZONE,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  // Two passes converge for every real-world offset transition.
  let guess = naive - offsetMinutes(naive, zone) * MINUTE;
  guess = naive - offsetMinutes(guess, zone) * MINUTE;
  return new Date(guess);
}
/** Local calendar date key (YYYY-MM-DD) of an instant in a zone. */
export function dateKey(instant: Date | number | string, zone = PLANNING_TIME_ZONE): string {
  const p = partsInZone(instant, zone);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
}
/** Minutes since local midnight of an instant in a zone. */
export function localMinutes(instant: Date | number | string, zone = PLANNING_TIME_ZONE): number {
  const p = partsInZone(instant, zone);
  return p.hour * 60 + p.minute;
}
/** "08:30" for 510 minutes. */
export function minutesLabel(minutes: number): string {
  return `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}`;
}
/** Parse "HH:MM" (24 h) into minutes; null when invalid. */
export function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}
/** ISO weekday (1 = Monday … 7 = Sunday) of an instant in a zone. */
export function isoWeekday(instant: Date | number | string, zone = PLANNING_TIME_ZONE): Weekday {
  const p = partsInZone(instant, zone);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}
/** Monday 00:00 → next Monday 00:00 (local to the zone) around an instant; offset in weeks. */
export function weekRange(instant: Date | number | string, zone = PLANNING_TIME_ZONE, offsetWeeks = 0): { from: Date; to: Date; days: string[] } {
  const p = partsInZone(instant, zone);
  const weekday = isoWeekday(instant, zone);
  const mondayUtc = Date.UTC(p.year, p.month - 1, p.day) - (weekday - 1) * DAY + offsetWeeks * 7 * DAY;
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayUtc + i * DAY);
    days.push(`${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`);
  }
  const first = new Date(mondayUtc);
  const last = new Date(mondayUtc + 7 * DAY);
  return {
    from: zonedTimeToInstant({ year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: first.getUTCDate() }, zone),
    to: zonedTimeToInstant({ year: last.getUTCFullYear(), month: last.getUTCMonth() + 1, day: last.getUTCDate() }, zone),
    days,
  };
}
/** Builds the instant of a date key + minutes in a zone (used by the entry form). */
export function instantFromKey(key: string, minutes: number, zone = PLANNING_TIME_ZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match || minutes < 0 || minutes > 1440) return null;
  const instant = zonedTimeToInstant(
    { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Math.floor(minutes / 60), minute: minutes % 60 },
    zone,
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}
/** Clips an interval to a local day; returns local minutes or null when outside the day. */
export function clipToDay(
  interval: { starts_at: string; ends_at: string },
  key: string,
  zone = PLANNING_TIME_ZONE,
): { start: number; end: number } | null {
  const dayStart = instantFromKey(key, 0, zone);
  const dayEnd = instantFromKey(key, 1440, zone);
  if (!dayStart || !dayEnd) return null;
  const start = Math.max(Date.parse(interval.starts_at), dayStart.getTime());
  const end = Math.min(Date.parse(interval.ends_at), dayEnd.getTime());
  if (!(end > start)) return null;
  return { start: Math.round((start - dayStart.getTime()) / MINUTE), end: Math.round((end - dayStart.getTime()) / MINUTE) };
}
/** French date and time labels in the planning zone, with no reliance on the browser zone. */
export function labelDate(instant: string | Date, zone = PLANNING_TIME_ZONE): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: zone, weekday: "short", day: "numeric", month: "short" }).format(
    instant instanceof Date ? instant : new Date(instant),
  );
}
export function labelTime(instant: string | Date, zone = PLANNING_TIME_ZONE): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    instant instanceof Date ? instant : new Date(instant),
  );
}
