import { z } from "zod";
import { energyDate } from "@/lib/features/energy/schemas";
const date = energyDate.refine((v) => v >= "0001-01-01");
const id = z.uuid().transform((v) => v.toLowerCase());
const days = (from: string, to: string) =>
  (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
export const selection = z
  .object({
    organization_id: id,
    site_ids: z.array(id).min(1).max(50),
    from: date,
    to: date,
    previous_from: date.nullable(),
    previous_to: date.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.site_ids).size === v.site_ids.length &&
      days(v.from, v.to) >= 1 &&
      days(v.from, v.to) <= 366 &&
      ((v.previous_from === null && v.previous_to === null) ||
        (v.previous_from !== null &&
          v.previous_to !== null &&
          days(v.previous_from, v.previous_to) >= 1 &&
          days(v.previous_from, v.previous_to) <= 366)),
  );
export type Selection = z.infer<typeof selection>;
const integer = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(40);
const period = z
  .object({
    record_count: z.number().int().nonnegative(),
    crossing_count: z.number().int().nonnegative(),
    missing_cost_count: z.number().int().nonnegative(),
    consumption_wh: integer.nullable(),
    cost_cents: integer.nullable(),
    coverage_complete: z.boolean(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.missing_cost_count > v.record_count ||
      (v.record_count === 0) !== (v.consumption_wh === null) ||
      (v.record_count === 0 || v.missing_cost_count > 0) !==
        (v.cost_cents === null) ||
      (v.coverage_complete && (v.record_count === 0 || v.crossing_count > 0))
    )
      c.addIssue({ code: "custom", message: "Inconsistent period" });
  });
const projection = z
  .object({
    organization_id: id,
    site_ids: z.array(id).max(50),
    meters: z
      .array(
        z
          .object({
            site_id: id,
            meter_label: z.string().min(1).max(160),
            current: period,
            previous: period.nullable(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
type Period = z.infer<typeof period>;
function total(rows: Period[], expectedSites: boolean) {
  const coverage =
    expectedSites && rows.length > 0 && rows.every((r) => r.coverage_complete);
  const sum = (key: "consumption_wh" | "cost_cents") =>
    rows.some((r) => r[key] !== null)
      ? rows.reduce((n, r) => n + BigInt(r[key] ?? "0"), 0n).toString()
      : null;
  return {
    recorded_consumption_wh: sum("consumption_wh"),
    recorded_cost_cents: rows.some((r) => r.missing_cost_count > 0)
      ? null
      : sum("cost_cents"),
    recorded_coverage_complete: coverage,
    cost_complete: coverage && rows.every((r) => r.missing_cost_count === 0),
    actual_site_consumption_wh: null,
    physical_scope_complete: false as const,
  };
}
export function energyReport(input: unknown, scope: Selection) {
  const data = projection.parse(input);
  if (
    data.organization_id !== scope.organization_id ||
    [...data.site_ids].sort().join() !== [...scope.site_ids].sort().join() ||
    new Set(data.meters.map((m) => m.site_id + "|" + m.meter_label)).size !==
      data.meters.length ||
    data.meters.some(
      (m) =>
        !scope.site_ids.includes(m.site_id) ||
        (m.previous !== null) !== (scope.previous_from !== null),
    )
  )
    throw Error("Energy scope mismatch");
  const sites = scope.site_ids.map((site_id) => {
    const meters = data.meters.filter((m) => m.site_id === site_id);
    return {
      site_id,
      known_meters: meters.length,
      current: total(
        meters.map((m) => m.current),
        meters.length > 0,
      ),
      previous: scope.previous_from
        ? total(
            meters.map((m) => m.previous!),
            meters.length > 0,
          )
        : null,
    };
  });
  const current = total(
    data.meters.map((m) => m.current),
    sites.every((s) => s.known_meters > 0),
  );
  const previous = scope.previous_from
    ? total(
        data.meters.map((m) => m.previous!),
        sites.every((s) => s.known_meters > 0),
      )
    : null;
  const reason =
    !previous || !scope.previous_from || !scope.previous_to
      ? "not_requested"
      : days(scope.from, scope.to) !==
          days(scope.previous_from, scope.previous_to)
        ? "different_duration"
        : !(scope.to < scope.previous_from || scope.previous_to < scope.from)
          ? "overlapping_ranges"
          : !current.recorded_coverage_complete ||
              !previous.recorded_coverage_complete
            ? "incomplete_recorded_coverage"
            : "comparable_declared_readings";
  const comparable = reason === "comparable_declared_readings";
  return {
    basis: "declared_meter_periods_fully_inside_range" as const,
    scope,
    meters: data.meters,
    sites,
    current,
    previous,
    comparison: {
      comparable,
      reason,
      consumption_delta_wh: comparable
        ? (
            BigInt(current.recorded_consumption_wh!) -
            BigInt(previous!.recorded_consumption_wh!)
          ).toString()
        : null,
      cost_delta_cents:
        comparable && current.cost_complete && previous!.cost_complete
          ? (
              BigInt(current.recorded_cost_cents!) -
              BigInt(previous!.recorded_cost_cents!)
            ).toString()
          : null,
    },
    limits: { sites: 50, known_meters: 500, days_per_range: 366 },
    physical_scope_complete: false,
  };
}
