import { z } from "zod";
export const missionOfferSchema = z.object({
  id: z.uuid(), category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
  city: z.string().min(1).max(160), postal_code: z.string().regex(/^[0-9]{3}\*\*$/),
  urgency: z.enum(["scheduled", "urgent"]), status: z.literal("requested"),
  estimate_min_cents: z.number().int().nonnegative().max(2147483647),
  estimate_max_cents: z.number().int().nonnegative().max(2147483647),
  created_at: z.iso.datetime({ offset: true }),
}).strict().refine(v => v.estimate_min_cents <= v.estimate_max_cents);
export const missionCursorSchema = z.object({ actor_id: z.uuid(), created_at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
export const missionSnapshotSchema = z.object({ eligible: z.boolean(), captured_at: z.iso.datetime({ offset: true }), items: z.array(missionOfferSchema).max(51) }).strict();
export type MissionOffer = z.infer<typeof missionOfferSchema>;
