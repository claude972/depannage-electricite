import { z } from "zod";

export const postalCode = z.string().regex(/^[0-9]{5}$/);
const postalCodes = z.array(postalCode).max(250).refine(
  (codes) => new Set(codes).size === codes.length,
);
const common = {
  command_id: z.string().uuid(),
  expected_version: z.number().int().min(0).max(2147483646),
};
export const coverageCommand = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("publish"), postal_codes: postalCodes.refine((codes) => codes.length > 0) }).strict(),
  z.object({ ...common, action: z.literal("withdraw") }).strict(),
]);
export const coverageEditor = z.object({
  version: z.number().int().nonnegative(), postal_codes: postalCodes,
}).strict();
export const coverageReceipt = coverageEditor.extend({ replayed: z.boolean() });
export const publicCoverage = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unknown"), version: z.null() }).strict(),
  z.object({ status: z.enum(["covered", "not_covered"]), version: z.number().int().positive() }).strict(),
]);
