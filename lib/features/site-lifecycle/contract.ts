import { z } from "zod";
import { uuid } from "@/lib/supabase/validation";

const hour = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
const openingHours = z.array(z.object({
  day: z.number().int().min(1).max(7),
  opens: hour,
  closes: hour,
}).strict()).max(28).refine((slots) => slots.every((slot, i) =>
  slot.opens < slot.closes && slots.slice(i + 1).every(other =>
    other.day !== slot.day || other.closes <= slot.opens || slot.closes <= other.opens
  )
), "Les créneaux d’ouverture ne doivent pas se chevaucher.");

export const siteValues = z.object({
  name: z.string().trim().min(1).max(160),
  address: z.string().trim().min(5).max(500),
  access_notes: z.string().trim().max(2000),
  opening_hours: openingHours,
}).strict();

export const siteRecord = siteValues.extend({
  id: uuid,
  organization_id: uuid,
  type: z.enum(["syndic", "restaurant", "office", "erp"]),
  budget_cents: z.number().int().nonnegative(),
  settings_version: z.number().int().positive(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
  created_at: z.iso.datetime({ offset: true }),
}).strict();

const key = {
  command_id: uuid,
  expected_version: z.number().int().min(1).max(2147483646),
};
export const siteCommand = z.discriminatedUnion("action", [
  z.object({ ...key, action: z.literal("save"), values: siteValues }).strict(),
  z.object({ ...key, action: z.literal("archive") }).strict(),
]);

export const siteColumns = "id,organization_id,name,address,type,budget_cents,settings_version,access_notes,opening_hours,archived_at,created_at";
