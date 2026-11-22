import { z } from "zod";

export const callbackReason = z.enum(["new_request", "existing_request", "other"]);
export const callbackPageSize = 25;
export const callbackPageNumber = z.number().int().min(1).max(1_000_000);
export const callbackPhone = z.string().regex(/^\+[1-9]\d{7,14}$/);
export const callbackReceipt = z.object({ received: z.literal(true) }).strict();
export const callbackClosure = z.object({ closed: z.literal(true) }).strict();
const timestamp = z.iso.datetime({ offset: true });
const callbackItem = z.object({
  id: z.uuid(), phone: callbackPhone, reason: callbackReason, version: z.union([z.literal(1), z.literal(2)]),
  created_at: timestamp, closed_at: timestamp.nullable(),
}).strict().refine(row => (row.version === 2) === (row.closed_at !== null));
export const callbackQueue = z.object({
  total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  items: z.array(callbackItem).max(callbackPageSize),
  can_close: z.boolean(),
}).strict();
