import { z } from "zod";
import { taxRateSchema } from "@/lib/tax-rates";
import { uuid } from "@/lib/supabase/validation";

const version = z.number().int().min(1).max(2147483647);
const line = z.object({
  index: z.number().int().min(0).max(99),
  label: z.string().min(1).max(160),
  unit: z.enum(["hour", "visit", "flat", "km", "unit"]),
  unit_price_cents: z.number().int().min(0).max(10_000_000),
}).strict();
export const source = z.object({
  grid_id: uuid, grid_version: version, grid_label: z.string().min(1).max(160),
}).strict();
export const gridOptions = z.object({
  current: source.nullable(),
  grids: z.array(z.object({
    id: uuid, label: z.string().min(1).max(160), version,
    lines: z.array(line).min(1).max(100),
  }).strict()).max(20),
  next_cursor: uuid.nullable(),
}).strict();
export const applyGrid = z.object({
  grid_id: uuid,
  grid_version: version,
  selection: z.array(z.object({
    index: line.shape.index, quantity: z.number().int().min(1).max(1000),
  }).strict()).min(1).max(30).refine((rows) => new Set(rows.map((x) => x.index)).size === rows.length),
  expected_version: z.number().int().min(0).max(2147483646),
  assignment_token: z.string().regex(/^[a-f0-9]{64}$/),
  base_quote_id: uuid.nullable(),
  tax_rate: taxRateSchema.nullable(),
}).strict();
export const appliedGrid = z.object({
  version,
  assignment_token: applyGrid.shape.assignment_token,
  current_quote_id: uuid.nullable(),
  draft: z.object({
    intervention_id: uuid, artisan_id: uuid, version,
    assignment_token: applyGrid.shape.assignment_token, base_quote_id: uuid.nullable(),
    lines: z.array(z.object({
      label: line.shape.label, quantity: z.number().int().min(1).max(1000),
      unit_price_cents: line.shape.unit_price_cents,
    }).strict()).min(1).max(30),
    tax_rate: taxRateSchema.nullable(),
    updated_at: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();
