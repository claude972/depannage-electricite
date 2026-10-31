import { z } from "zod";
import { uuid } from "@/lib/supabase/validation";
import { NOTIFICATION_KINDS } from "./types";
export const isoInstant = z.iso
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
export const notificationKind = z.enum(NOTIFICATION_KINDS);
const ids = z.array(uuid).min(1).max(100);
export const markSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark_read"), ids }).strict(),
  z.object({ action: z.literal("mark_unread"), ids }).strict(),
  z.object({ action: z.literal("mark_all_read"), before: isoInstant.optional() }).strict(),
]);
export const preferencesSchema = z
  .object({
    muted_kinds: z.array(notificationKind).max(30),
    email_enabled: z.boolean(),
    sms_enabled: z.boolean(),
    push_enabled: z.boolean(),
    expected_version: z.number().int().min(0).max(2147483647),
  })
  .strict();
export const cursorSchema = z
  .object({ v: z.literal(1), created_at: isoInstant, id: uuid, filters: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
