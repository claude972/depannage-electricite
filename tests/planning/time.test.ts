import test from "node:test";
import assert from "node:assert/strict";
import { clipToDay, dateKey, instantFromKey, isKnownTimeZone, isoWeekday, localMinutes, minutesLabel, offsetMinutes, parseMinutes, toIsoWithOffset, weekRange, zonedTimeToInstant } from "../../lib/features/planning/time";
import { PLANNING_TIME_ZONE } from "../../lib/features/planning/types";

test("Martinique is UTC−4 all year (no DST) while a DST zone changes offset", () => {
  for (const instant of ["2026-01-15T12:00:00Z", "2026-03-29T12:00:00Z", "2026-07-15T12:00:00Z", "2026-11-02T12:00:00Z", "2026-12-31T23:59:59Z"])
    assert.equal(offsetMinutes(instant, PLANNING_TIME_ZONE), -240, instant);
  assert.equal(offsetMinutes("2026-01-15T12:00:00Z", "Europe/Paris"), 60);
  assert.equal(offsetMinutes("2026-07-15T12:00:00Z", "Europe/Paris"), 120);
  assert.equal(isKnownTimeZone("America/Martinique"), true);
  assert.equal(isKnownTimeZone("Mars/Olympus"), false);
});
test("ISO output always carries the numeric offset of the planning zone", () => {
  assert.equal(toIsoWithOffset("2026-11-02T12:00:00Z"), "2026-11-02T08:00:00-04:00");
  assert.equal(toIsoWithOffset("2026-11-02T03:30:00Z"), "2026-11-01T23:30:00-04:00");
  assert.equal(toIsoWithOffset("2026-07-06T06:00:00Z", "Europe/Paris"), "2026-07-06T08:00:00+02:00");
  assert.throws(() => toIsoWithOffset("not-a-date"), RangeError);
});
test("wall-clock conversions round-trip in Martinique and in a DST zone", () => {
  assert.equal(zonedTimeToInstant({ year: 2026, month: 11, day: 2, hour: 8 }).toISOString(), "2026-11-02T12:00:00.000Z");
  assert.equal(zonedTimeToInstant({ year: 2026, month: 3, day: 16, hour: 8 }).toISOString(), "2026-03-16T12:00:00.000Z");
  assert.equal(zonedTimeToInstant({ year: 2026, month: 11, day: 2, hour: 8 }, "Europe/Paris").toISOString(), "2026-11-02T07:00:00.000Z");
  assert.equal(zonedTimeToInstant({ year: 2026, month: 7, day: 6, hour: 8 }, "Europe/Paris").toISOString(), "2026-07-06T06:00:00.000Z");
  assert.equal(dateKey("2026-11-02T03:30:00Z"), "2026-11-01");
  assert.equal(localMinutes("2026-11-02T12:30:00Z"), 510);
  assert.equal(minutesLabel(510), "08:30");
  assert.equal(parseMinutes("08:30"), 510);
  assert.equal(parseMinutes("24:00"), 1440);
  assert.equal(parseMinutes("24:01"), null);
  assert.equal(parseMinutes("8h"), null);
});
test("ISO week starts Monday 00:00 local and covers seven local days", () => {
  const week = weekRange("2026-11-04T15:00:00Z");
  assert.equal(week.from.toISOString(), "2026-11-02T04:00:00.000Z");
  assert.equal(week.to.toISOString(), "2026-11-09T04:00:00.000Z");
  assert.deepEqual(week.days, ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  assert.equal(weekRange("2026-11-04T15:00:00Z", PLANNING_TIME_ZONE, 1).from.toISOString(), "2026-11-09T04:00:00.000Z");
  assert.equal(weekRange("2026-11-04T15:00:00Z", PLANNING_TIME_ZONE, -1).from.toISOString(), "2026-10-26T04:00:00.000Z");
  // Sunday 23:30 Martinique is still Sunday locally (Monday 03:30 UTC).
  assert.equal(isoWeekday("2026-11-09T03:30:00Z"), 7);
  assert.equal(weekRange("2026-11-09T03:30:00Z").from.toISOString(), "2026-11-02T04:00:00.000Z");
  assert.equal(isoWeekday("2026-11-02T12:00:00Z"), 1);
});
test("day clipping and key/minute instants follow the planning zone", () => {
  const instant = instantFromKey("2026-11-02", 510);
  assert.equal(instant?.toISOString(), "2026-11-02T12:30:00.000Z");
  assert.equal(instantFromKey("2026-13-02", 0), null);
  assert.equal(instantFromKey("2026-11-02", 1441), null);
  assert.deepEqual(clipToDay({ starts_at: "2026-11-02T12:00:00Z", ends_at: "2026-11-02T16:00:00Z" }, "2026-11-02"), { start: 480, end: 720 });
  assert.deepEqual(clipToDay({ starts_at: "2026-11-01T20:00:00Z", ends_at: "2026-11-03T20:00:00Z" }, "2026-11-02"), { start: 0, end: 1440 });
  assert.equal(clipToDay({ starts_at: "2026-11-03T12:00:00Z", ends_at: "2026-11-03T16:00:00Z" }, "2026-11-02"), null);
});
