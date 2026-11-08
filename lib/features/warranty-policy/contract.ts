import { z } from "zod";
const version = z.number().int().min(1).max(2147483647);
const editorVersion = z.number().int().min(0).max(2147483647);
export const published = z
  .object({
    version,
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(20000),
    published_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export const editor = z
  .object({
    version: editorVersion,
    draft: z
      .object({ title: z.string().max(160), body: z.string().max(20000) })
      .strict(),
    published: published.nullable(),
    operator_enabled: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      (!v.operator_enabled || v.published !== null) &&
      (v.published === null || v.published.version <= v.version),
  );
const base = {
  command_id: z.uuid(),
  expected_version: editorVersion.max(2147483646),
};
export const command = z.discriminatedUnion("action", [
  z
    .object({
      ...base,
      action: z.literal("save"),
      title: z.string().trim().max(160),
      body: z.string().trim().max(20000),
    })
    .strict(),
  z
    .object({
      ...base,
      action: z.literal("enable"),
      published_version: version,
    })
    .strict(),
  z
    .object({ ...base, action: z.enum(["publish", "withdraw", "disable"]) })
    .strict(),
]);
export const receipt = z
  .object({
    version,
    action: z.enum(["save", "publish", "withdraw", "enable", "disable"]),
    replayed: z.boolean(),
  })
  .strict();
