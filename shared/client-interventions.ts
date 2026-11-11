import { z } from "zod";

export const clientInterventionFilter = z.enum(["active", "all", "past"]);
export const clientInterventionRow = z.object({
  id: z.uuid(),
  category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
  address: z.string().min(5).max(500),
  postal_code: z.string().regex(/^\d{5}$/),
  city: z.string().min(2).max(120),
  urgency: z.enum(["urgent", "scheduled"]),
  status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]),
  estimate_min_cents: z.number().int().positive().max(2147483647),
  estimate_max_cents: z.number().int().positive().max(2147483647),
  created_at: z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value))),
}).strict().refine(value => value.estimate_max_cents >= value.estimate_min_cents);

const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,500}$/);
const total = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const clientWorkspaceCounters = z.object({ active_interventions: total, received_messages: total }).strict();
export type ClientWorkspaceCounters = z.infer<typeof clientWorkspaceCounters>;
export const clientInterventionInput = z.object({
  filter: clientInterventionFilter,
  search: z.string().trim().max(120).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  cursor: cursor.nullable(),
}).strict();
export const clientInterventionPage = z.object({
  items: z.array(clientInterventionRow).max(50), total,
  page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: cursor.nullable() }).strict(),
}).strict().refine(value => value.total >= value.items.length && value.page.has_more === (value.page.next_cursor !== null));
export const clientInterventionSnapshot = z.object({ items: z.array(clientInterventionRow).max(51), total }).strict();
