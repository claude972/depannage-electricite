// SLA calendar arithmetic on synthetic QA data only (fictitious calendar, targets and facts).
import test from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessMinutes,
  businessMillisBetween,
  calendarProblem,
  evaluateSlaCase,
  pauseIntervals,
  workingIntervalsOnDay,
  zonedToUtc,
  type CalendarInput,
} from "../../lib/features/site-operations/sla";

const QA_CALENDAR: CalendarInput = {
  timezone: "Europe/Paris",
  windows: [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, start: "08:00", end: "12:00" },
    { weekday, start: "13:00", end: "17:00" },
  ]),
  closed_dates: ["2026-12-25"],
};
const ids = { case_id: "qa-case", policy_id: "qa-policy" };
const policy = (response: number | null, resolution: number | null = null) => ({ response_target_minutes: response, resolution_target_minutes: resolution });
const facts = (opened_at: string, responded_at: string | null = null, resolved_at: string | null = null, pauses: { started_at: string; ended_at: string | null }[] = []) => ({ opened_at, responded_at, resolved_at, pauses });
const paris = (y: number, m: number, d: number, h: number, min: number) => new Date(zonedToUtc("Europe/Paris", y, m, d, h, min)).toISOString();

test("unconfigured calendar or target is not measurable, with an explicit reason (nothing invented)", () => {
  const noCalendar = evaluateSlaCase(ids, null, policy(60), facts("2026-10-05T07:00:00Z"), "2026-10-05T09:00:00Z");
  assert.equal(noCalendar.measurable, false);
  assert.deepEqual(noCalendar.reasons, ["no_calendar"]);
  assert.equal(noCalendar.response.status, "not_measurable");
  assert.equal(noCalendar.response.deadline_at, null);
  const noTarget = evaluateSlaCase(ids, QA_CALENDAR, policy(null, null), facts("2026-10-05T07:00:00Z"), "2026-10-05T09:00:00Z");
  assert.deepEqual(noTarget.reasons, ["no_target"]);
  assert.equal(noTarget.measurable, false);
  assert.equal(calendarProblem({ ...QA_CALENDAR, windows: [] }), "calendar_without_windows");
  assert.equal(calendarProblem({ ...QA_CALENDAR, timezone: "Mars/Olympus" }), "invalid_timezone");
  const mixed = evaluateSlaCase(ids, QA_CALENDAR, policy(120, null), facts("2026-10-05T07:00:00Z"), "2026-10-05T09:00:00Z");
  assert.equal(mixed.measurable, true, "one configured track makes the case measurable");
  assert.equal(mixed.resolution.status, "not_measurable");
  assert.equal(mixed.resolution.reason, "no_target");
});
test("working windows are interpreted in the calendar zone and merged", () => {
  const monday = workingIntervalsOnDay(QA_CALENDAR, 2026, 10, 5);
  assert.equal(monday.length, 2);
  assert.equal(new Date(monday[0].start).toISOString(), "2026-10-05T06:00:00.000Z", "08:00 Paris in October is 06:00Z");
  assert.equal(new Date(monday[1].end).toISOString(), "2026-10-05T15:00:00.000Z");
  assert.deepEqual(workingIntervalsOnDay(QA_CALENDAR, 2026, 10, 4), [], "Sunday has no window");
  assert.deepEqual(workingIntervalsOnDay(QA_CALENDAR, 2026, 12, 25), [], "closed date");
  const overlapping = workingIntervalsOnDay({ timezone: "UTC", windows: [{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "10:00", end: "14:00" }], closed_dates: [] }, 2026, 10, 5);
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].end - overlapping[0].start, 6 * 3600_000);
});
test("a deadline crosses lunch breaks, nights and week-ends only through working time", () => {
  const opened = Date.parse(paris(2026, 10, 2, 16, 0)); // Friday 16:00
  const deadline = addBusinessMinutes(QA_CALENDAR, opened, 120, []);
  assert.equal(new Date(deadline!).toISOString(), paris(2026, 10, 5, 9, 0), "1h Friday + 1h Monday morning");
  const lunch = addBusinessMinutes(QA_CALENDAR, Date.parse(paris(2026, 10, 5, 11, 30)), 60, []);
  assert.equal(new Date(lunch!).toISOString(), paris(2026, 10, 5, 13, 30));
  const beforeOpening = addBusinessMinutes(QA_CALENDAR, Date.parse(paris(2026, 10, 5, 6, 0)), 30, []);
  assert.equal(new Date(beforeOpening!).toISOString(), paris(2026, 10, 5, 8, 30), "time before the first window does not count");
});
test("closed dates are skipped and the DST change keeps wall-clock windows", () => {
  const christmas = addBusinessMinutes(QA_CALENDAR, Date.parse(paris(2026, 12, 24, 16, 30)), 60, []);
  assert.equal(new Date(christmas!).toISOString(), paris(2026, 12, 28, 8, 30), "30 min Thursday, 25th closed, week-end, Monday 08:30");
  assert.equal(paris(2026, 12, 28, 8, 30), "2026-12-28T07:30:00.000Z", "winter offset +1");
  const dst = addBusinessMinutes(QA_CALENDAR, Date.parse(paris(2026, 10, 23, 16, 0)), 120, []);
  assert.equal(new Date(dst!).toISOString(), "2026-10-26T08:00:00.000Z", "Monday 09:00 Paris after the October change is 08:00Z");
});
test("pauses remove working time and an open pause freezes the counter until now", () => {
  const opened = Date.parse(paris(2026, 10, 2, 16, 0));
  const holes = pauseIntervals([{ started_at: paris(2026, 10, 5, 8, 0), ended_at: paris(2026, 10, 5, 8, 30) }], Date.parse(paris(2026, 10, 6, 10, 0)));
  assert.equal(new Date(addBusinessMinutes(QA_CALENDAR, opened, 120, holes)!).toISOString(), paris(2026, 10, 5, 9, 30));
  const nightPause = pauseIntervals([{ started_at: paris(2026, 10, 2, 18, 0), ended_at: paris(2026, 10, 3, 9, 0) }], 0);
  assert.equal(new Date(addBusinessMinutes(QA_CALENDAR, opened, 120, nightPause)!).toISOString(), paris(2026, 10, 5, 9, 0), "a pause outside working time changes nothing");
  const evaluation = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(paris(2026, 10, 2, 16, 0), null, null, [{ started_at: paris(2026, 10, 2, 16, 30), ended_at: null }]), paris(2026, 10, 6, 10, 0));
  assert.equal(evaluation.paused_now, true);
  assert.equal(evaluation.response.status, "pending");
  assert.equal(evaluation.response.elapsed_minutes, 30);
  assert.equal(evaluation.response.remaining_minutes, 90);
});
test("met, breached and pending follow working time versus the configured target", () => {
  const opened = paris(2026, 10, 2, 16, 0);
  const met = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(opened, paris(2026, 10, 5, 8, 30)), paris(2026, 10, 7, 10, 0));
  assert.equal(met.response.status, "met");
  assert.equal(met.response.elapsed_minutes, 90);
  assert.equal(met.response.remaining_minutes, null);
  const breached = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(opened, paris(2026, 10, 5, 10, 0)), paris(2026, 10, 7, 10, 0));
  assert.equal(breached.response.status, "breached");
  assert.equal(breached.response.elapsed_minutes, 180);
  const pending = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(opened), paris(2026, 10, 5, 8, 15));
  assert.equal(pending.response.status, "pending");
  assert.equal(pending.response.elapsed_minutes, 75);
  assert.equal(pending.response.remaining_minutes, 45);
  assert.equal(pending.response.deadline_at, paris(2026, 10, 5, 9, 0));
  const late = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(opened), paris(2026, 10, 5, 9, 1));
  assert.equal(late.response.status, "breached");
  assert.equal(late.response.remaining_minutes, 0);
  const sameInstant = evaluateSlaCase(ids, QA_CALENDAR, policy(120), facts(opened, opened), paris(2026, 10, 5, 9, 1));
  assert.equal(sameInstant.response.status, "met");
  assert.equal(sameInstant.response.elapsed_minutes, 0);
});
test("resolution tracks independently of response and a calendar too sparse is unreachable", () => {
  const opened = paris(2026, 10, 5, 8, 0);
  const both = evaluateSlaCase(ids, QA_CALENDAR, policy(60, 480), facts(opened, paris(2026, 10, 5, 8, 30), paris(2026, 10, 6, 8, 30)), paris(2026, 10, 7, 10, 0));
  assert.equal(both.response.status, "met");
  assert.equal(both.resolution.status, "breached", "8h target, 8h30 working elapsed (4+4+0.5)");
  assert.equal(both.resolution.elapsed_minutes, 510);
  const sparse: CalendarInput = { timezone: "UTC", windows: [{ weekday: 1, start: "08:00", end: "08:01" }], closed_dates: [] };
  assert.equal(addBusinessMinutes(sparse, Date.parse("2026-10-05T00:00:00Z"), 100, []), null);
  const unreachable = evaluateSlaCase(ids, sparse, policy(100), facts("2026-10-05T00:00:00Z"), "2026-10-06T00:00:00Z");
  assert.equal(unreachable.response.status, "not_measurable");
  assert.equal(unreachable.response.reason, "calendar_unreachable");
  assert.equal(businessMillisBetween(QA_CALENDAR, 10, 5, []), 0);
});
