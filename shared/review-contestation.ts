import { z } from "zod";
export const reviewContestation = z.object({
  id: z.uuid(), review_id: z.uuid(), request_id: z.uuid(), reason: z.string(),
  status: z.enum(["open", "upheld", "dismissed"]), created_at: z.string(),
  decided_at: z.string().nullable(), decision_note: z.string(),
});
export const reviewContestationHistory = z.object({
  review: z.object({ id: z.uuid(), intervention_id: z.uuid(), rating: z.number().int().min(1).max(5), body: z.string() }),
  contestations: z.array(reviewContestation).max(50), limited: z.boolean(),
});
export type ReviewContestationHistory = z.infer<typeof reviewContestationHistory>;
