import { z } from "zod";
import { clientInterventionInput, clientInterventionRow } from "./client-interventions";

export const ENTERPRISE_PAGE_SIZE = 10;
export const ENTERPRISE_EXPORT_LIMIT = 5000;
const uuid = z.uuid();
const page = z.number().int().min(1).max(1_000_000);
export const enterpriseInterventionRow = clientInterventionRow.safeExtend({
  site_id: uuid, site_name: z.string().min(1).max(160), artisan_assigned: z.boolean(),
});
const filters = z.object({
  organization_id: uuid,
  site_id: uuid.nullable(),
  category: clientInterventionRow.shape.category.nullable(),
  status: clientInterventionRow.shape.status.nullable(),
  search: clientInterventionInput.shape.search,
  sort: z.enum(["recent", "oldest"]),
}).strict();
export const enterpriseInterventionInput = z.discriminatedUnion("action", [
  filters.extend({ action: z.literal("list"), page }),
  filters.extend({ action: z.literal("export") }),
]);
const total = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const enterpriseInterventionSnapshot = z.object({ total, items: z.array(enterpriseInterventionRow).max(ENTERPRISE_EXPORT_LIMIT) }).strict();
export const enterpriseInterventionPage = z.object({
  items: z.array(enterpriseInterventionRow).max(ENTERPRISE_PAGE_SIZE), total,
  page: z.object({ number: page, limit: z.literal(ENTERPRISE_PAGE_SIZE), pages: z.number().int().min(1) }).strict(),
}).strict();
