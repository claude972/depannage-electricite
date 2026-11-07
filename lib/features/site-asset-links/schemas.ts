import { z } from "zod";
const id = z.uuid().transform((v) => v.toLowerCase());
const version = z.number().int().min(1).max(2147483647);
export const linkCommand = z
  .object({
    command_id: id,
    intervention_id: id,
    kind: z.enum(["equipment", "area"]),
    asset_id: id,
    action: z.enum(["link", "unlink"]),
    expected_version: version.max(2147483646).nullable(),
  })
  .strict()
  .refine((v) => v.action !== "unlink" || v.expected_version !== null);
export const linkRecord = z
  .object({
    id,
    site_id: id,
    intervention_id: id,
    kind: z.enum(["equipment", "area"]),
    asset_id: id,
    active: z.boolean(),
    version,
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
    detached_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict()
  .refine((r) => r.active === (r.detached_at === null));
export const historyRecord = linkRecord.safeExtend({
  intervention: z
    .object({
      id,
      category: z.string().min(1).max(80),
      status: z.string().min(1).max(80),
      created_at: z.iso.datetime({ offset: true }),
    })
    .strict(),
  asset_archived: z.boolean(),
});
export type SiteAssetLink = z.infer<typeof linkRecord>;
