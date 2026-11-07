import { z } from "zod";

export const energyDate = z.iso.date();
export const energyValues = z.object({
  meter_label: z.string().trim().min(1).max(160),
  period_start: energyDate,
  period_end: energyDate,
  consumption_wh: z.number().int().min(0).max(9_000_000_000_000),
  cost_cents: z.number().int().min(0).max(1_000_000_000).nullable(),
  source_kind: z.enum(["invoice", "meter", "manual"]),
  source_reference: z.string().trim().min(1).max(240),
  note: z.string().trim().max(2000),
}).strict().refine(v => v.period_end >= v.period_start, { path: ["period_end"], message: "La fin de période précède son début." });
export const energyCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.uuid(), expected_version: z.number().int().min(1).max(2_147_483_646).nullable(), values: energyValues }).strict(),
  z.object({ action: z.literal("archive"), id: z.uuid(), expected_version: z.number().int().min(1).max(2_147_483_646) }).strict(),
]);
export const energyRecord = z.object({
  id: z.uuid(), site_id: z.uuid(), meter_label: z.string().min(1).max(160),
  period_start: energyDate, period_end: energyDate,
  consumption_wh: z.number().int().min(0).max(9_000_000_000_000),
  cost_cents: z.number().int().min(0).max(1_000_000_000).nullable(),
  source_kind: z.enum(["invoice", "meter", "manual"]), source_reference: z.string().min(1).max(240),
  note: z.string().max(2000), version: z.number().int().positive(),
  created_by: z.uuid(), created_at: z.string().datetime({ offset: true }),
  updated_by: z.uuid(), updated_at: z.string().datetime({ offset: true }), archived_at: z.string().datetime({ offset: true }).nullable(),
}).strict().refine(v => v.period_end >= v.period_start);
export type EnergyValues = z.infer<typeof energyValues>;
export type EnergyRecord = z.infer<typeof energyRecord>;
export type EnergyCommand = z.infer<typeof energyCommand>;

/** Exact decimal kWh → integer Wh. No rounding or implicit zero on malformed input. */
export function kwhToWh(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,3})?$/.test(s)) return null;
  const [whole, decimals = ""] = s.split(".");
  const value = Number(whole) * 1000 + Number(decimals.padEnd(3, "0"));
  return Number.isSafeInteger(value) && value <= 9_000_000_000_000 ? value : null;
}

export type EnergyPage = {
  records: EnergyRecord[];
  page: { limit: 100; has_more: boolean; next_cursor: string | null };
  totals: { consumption_wh: number | null; cost_cents: number | null; complete: boolean; cost_complete: boolean };
  permissions: { can_write: boolean };
  basis: "recorded_periods_fully_inside_range";
};

/** Totals are never presented as exhaustive if another page exists or a cost is missing. */
export function energyPage(records: EnergyRecord[], hasMore: boolean, nextCursor: string | null, canWrite: boolean): EnergyPage {
  const consumption = records.reduce((n, r) => n + r.consumption_wh, 0);
  const costComplete = records.every(r => r.cost_cents !== null);
  const cost = records.reduce((n, r) => n + (r.cost_cents ?? 0), 0);
  return { records, page: { limit: 100, has_more: hasMore, next_cursor: nextCursor },
    totals: { consumption_wh: !hasMore && Number.isSafeInteger(consumption) ? consumption : null,
      cost_cents: !hasMore && costComplete && Number.isSafeInteger(cost) ? cost : null,
      complete: !hasMore, cost_complete: !hasMore && costComplete },
    permissions: { can_write: canWrite }, basis: "recorded_periods_fully_inside_range" };
}
