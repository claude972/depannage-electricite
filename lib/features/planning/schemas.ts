import { z } from "zod";
import { uuid } from "@/lib/supabase/validation";
// Strict request schemas shared by the planning routes and their tests. Instants must carry an
// explicit offset (or Z) so that no server-local interpretation can occur.
export const isoInstant = z.iso
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
export const isoDate = z.iso.date();
export const weekday = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
]);
export const minuteOfDay = z.number().int().min(0).max(1440);
export const revision = z.number().int().min(1).max(2147483647);
export const timeZone = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_+\-]*(?:\/[A-Za-z0-9_+\-]+){0,3}$/);
const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000]*$/);
export const planningCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save_rule"),
      request_id: uuid,
      id: uuid.optional(),
      weekday,
      start_minute: minuteOfDay.max(1439),
      end_minute: minuteOfDay.min(1),
      time_zone: timeZone.optional(),
      valid_from: isoDate.nullable().optional(),
      valid_until: isoDate.nullable().optional(),
      expected_version: revision.optional(),
    })
    .strict()
    .refine((v) => v.end_minute > v.start_minute, {
      message: "L’heure de fin doit être postérieure à l’heure de début.",
    })
    .refine((v) => !v.valid_from || !v.valid_until || v.valid_until >= v.valid_from, {
      message: "La date de fin doit être postérieure à la date de début.",
    })
    .refine((v) => (v.id ? v.expected_version !== undefined : v.expected_version === undefined), {
      message: "La version attendue accompagne uniquement une modification.",
    }),
  z.object({ action: z.literal("delete_rule"), id: uuid, expected_version: revision }).strict(),
  z
    .object({
      action: z.literal("save_entry"),
      request_id: uuid,
      id: uuid.optional(),
      kind: z.enum(["busy", "unavailable", "available"]),
      starts_at: isoInstant,
      ends_at: isoInstant,
      title: text(160),
      note: text(2000),
      expected_version: revision.optional(),
    })
    .strict()
    .refine((v) => Date.parse(v.ends_at) > Date.parse(v.starts_at), {
      message: "La fin du créneau doit être postérieure à son début.",
    })
    .refine((v) => Date.parse(v.ends_at) - Date.parse(v.starts_at) <= 31 * 86400000, {
      message: "Un créneau ne peut pas dépasser 31 jours.",
    })
    .refine((v) => (v.id ? v.expected_version !== undefined : v.expected_version === undefined), {
      message: "La version attendue accompagne uniquement une modification.",
    }),
  z.object({ action: z.literal("delete_entry"), id: uuid, expected_version: revision }).strict(),
]);
export type PlanningCommandInput = z.infer<typeof planningCommandSchema>;
