import { z } from 'zod';
const uuid = z.uuid().transform(value => value.toLowerCase());
export const enterpriseOverviewInput = z.object({organization_id:uuid,site_id:uuid.nullable()}).strict();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const enterpriseOverviewSnapshot = enterpriseOverviewInput.extend({
  counts:z.object({open:count,urgent:count}).strict().refine(value => value.urgent <= value.open),
  captured_at:z.iso.datetime({offset:true}),
}).strict();
