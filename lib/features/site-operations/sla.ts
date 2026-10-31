// Pure business-calendar arithmetic for SLA tracking. Server-side only input: a calendar
// configured by the organisation (IANA timezone, weekly working windows, closed dates), targets
// configured by the organisation, and facts entered by the organisation (opened/responded/
// resolved instants, pauses). Anything not configured yields "not_measurable" with a reason:
// no default calendar, no default target, no assumed working hours.
import type { CalendarWindow, NotMeasurableReason, SlaEvaluation, SlaTrack } from "./types";

export type CalendarInput = { timezone: string; windows: CalendarWindow[]; closed_dates: string[] };
export type PolicyInput = { response_target_minutes: number | null; resolution_target_minutes: number | null };
export type PauseInput = { started_at: string; ended_at: string | null };
export type CaseFacts = { opened_at: string; responded_at: string | null; resolved_at: string | null; pauses: PauseInput[] };
type Interval = { start: number; end: number };

const MINUTE = 60_000;
const DAY = 86_400_000;
/** Search horizon for a deadline; beyond it the calendar is declared unreachable. */
export const MAX_SEARCH_DAYS = 400;
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  try {
    const built = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, built);
    return built;
  } catch {
    return null;
  }
}
type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };
function localParts(timeZone: string, ms: number): LocalParts {
  const parts = formatter(timeZone)!.formatToParts(new Date(ms));
  const read = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
    second: Number(read("second")),
    weekday: WEEKDAYS[read("weekday")] ?? 0,
  };
}
function offsetAt(timeZone: string, ms: number): number {
  const p = localParts(timeZone, ms);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
/** Converts a wall-clock time of the calendar zone into a UTC instant (DST-aware). */
export function zonedToUtc(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(timeZone, guess);
  const second = guess - offsetAt(timeZone, first);
  return second;
}
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const isoWeekday = (year: number, month: number, day: number) => {
  const d = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return d === 0 ? 7 : d;
};
const parseClock = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return { h, m };
};
function merge(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}
function subtract(interval: Interval, holes: Interval[]): Interval[] {
  let pieces: Interval[] = [interval];
  for (const hole of holes) {
    const next: Interval[] = [];
    for (const piece of pieces) {
      if (hole.end <= piece.start || hole.start >= piece.end) next.push(piece);
      else {
        if (hole.start > piece.start) next.push({ start: piece.start, end: hole.start });
        if (hole.end < piece.end) next.push({ start: hole.end, end: piece.end });
      }
    }
    pieces = next;
  }
  return pieces;
}
/** Working intervals (UTC ms) of one calendar day of the zone, merged, excluding closed dates. */
export function workingIntervalsOnDay(calendar: CalendarInput, year: number, month: number, day: number): Interval[] {
  if (calendar.closed_dates.includes(isoDay(year, month, day))) return [];
  const weekday = isoWeekday(year, month, day);
  return merge(
    calendar.windows
      .filter((w) => w.weekday === weekday)
      .map((w) => {
        const s = parseClock(w.start), e = parseClock(w.end);
        return { start: zonedToUtc(calendar.timezone, year, month, day, s.h, s.m), end: zonedToUtc(calendar.timezone, year, month, day, e.h, e.m) };
      }),
  );
}
export function calendarProblem(calendar: CalendarInput | null): NotMeasurableReason | null {
  if (!calendar) return "no_calendar";
  if (!formatter(calendar.timezone)) return "invalid_timezone";
  if (!calendar.windows.length) return "calendar_without_windows";
  return null;
}
/** Pauses as closed intervals; an open pause runs until `now`. */
export function pauseIntervals(pauses: PauseInput[], now: number): Interval[] {
  return merge(
    pauses
      .map((p) => ({ start: Date.parse(p.started_at), end: p.ended_at ? Date.parse(p.ended_at) : now }))
      .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end)),
  );
}
/** Iterates calendar days from the local date of `fromMs`, yielding working pieces net of pauses. */
function* workingPieces(calendar: CalendarInput, fromMs: number, holes: Interval[]): Generator<Interval> {
  const start = localParts(calendar.timezone, fromMs);
  let cursor = Date.UTC(start.year, start.month - 1, start.day);
  for (let i = 0; i <= MAX_SEARCH_DAYS; i++) {
    const d = new Date(cursor);
    for (const interval of workingIntervalsOnDay(calendar, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())) {
      const clipped = { start: Math.max(interval.start, fromMs), end: interval.end };
      if (clipped.end <= clipped.start) continue;
      for (const piece of subtract(clipped, holes)) yield piece;
    }
    cursor += DAY;
  }
}
/** Working milliseconds between two instants, net of pauses (bounded by MAX_SEARCH_DAYS). */
export function businessMillisBetween(calendar: CalendarInput, fromMs: number, toMs: number, holes: Interval[]): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  for (const piece of workingPieces(calendar, fromMs, holes)) {
    if (piece.start >= toMs) break;
    total += Math.min(piece.end, toMs) - piece.start;
  }
  return total;
}
/** Instant at which `minutes` of working time have elapsed since `fromMs`; null when unreachable. */
export function addBusinessMinutes(calendar: CalendarInput, fromMs: number, minutes: number, holes: Interval[]): number | null {
  let remaining = minutes * MINUTE;
  if (remaining <= 0) return fromMs;
  for (const piece of workingPieces(calendar, fromMs, holes)) {
    const length = piece.end - piece.start;
    if (length >= remaining) return piece.start + remaining;
    remaining -= length;
  }
  return null;
}
const unmeasurable = (target: number | null, reason: NotMeasurableReason): SlaTrack => ({
  target_minutes: target,
  deadline_at: null,
  elapsed_minutes: null,
  remaining_minutes: null,
  status: "not_measurable",
  reason,
});
function track(calendar: CalendarInput | null, target: number | null, openedMs: number, eventAt: string | null, nowMs: number, holes: Interval[]): SlaTrack {
  const problem = calendarProblem(calendar);
  if (problem) return unmeasurable(target, problem);
  if (target === null) return unmeasurable(null, "no_target");
  const deadline = addBusinessMinutes(calendar!, openedMs, target, holes);
  if (deadline === null) return unmeasurable(target, "calendar_unreachable");
  const eventMs = eventAt ? Date.parse(eventAt) : null;
  const until = eventMs ?? nowMs;
  const elapsedMs = businessMillisBetween(calendar!, openedMs, until, holes);
  const targetMs = target * MINUTE;
  const status = eventMs !== null ? (elapsedMs <= targetMs ? "met" : "breached") : elapsedMs >= targetMs ? "breached" : "pending";
  return {
    target_minutes: target,
    deadline_at: new Date(deadline).toISOString(),
    elapsed_minutes: Math.floor(elapsedMs / MINUTE),
    remaining_minutes: eventMs !== null ? null : Math.max(0, Math.ceil((targetMs - elapsedMs) / MINUTE)),
    status,
    reason: null,
  };
}
/** Evaluates one case against its policy and calendar at instant `now` (ISO). */
export function evaluateSlaCase(
  ids: { case_id: string; policy_id: string },
  calendar: CalendarInput | null,
  policy: PolicyInput,
  facts: CaseFacts,
  now: string,
): SlaEvaluation {
  const nowMs = Date.parse(now);
  const openedMs = Date.parse(facts.opened_at);
  const holes = pauseIntervals(facts.pauses, nowMs);
  const pausedNow = facts.resolved_at === null && facts.pauses.some((p) => p.ended_at === null && Date.parse(p.started_at) <= nowMs);
  const response = track(calendar, policy.response_target_minutes, openedMs, facts.responded_at, nowMs, holes);
  const resolution = track(calendar, policy.resolution_target_minutes, openedMs, facts.resolved_at, nowMs, holes);
  const reasons = [...new Set([response.reason, resolution.reason].filter((r): r is NotMeasurableReason => r !== null))];
  return {
    case_id: ids.case_id,
    policy_id: ids.policy_id,
    measurable: response.status !== "not_measurable" || resolution.status !== "not_measurable",
    reasons,
    paused_now: pausedNow,
    response,
    resolution,
  };
}
