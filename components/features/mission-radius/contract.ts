// Artisan mission radius — UI-side strict schemas of the contract given by ROOT for the parallel
// backend (no lib file exists on the frozen base 42845d3). Replace by an import of the backend
// contract once it is assembled; keep the rules identical.
//   GET  /api/artisan/mission-radius → view
//   POST /api/artisan/mission-radius { expected_version, reference_code, radius_km } → view
//   radius 1–200 km with a reference commune, or BOTH null to clear.
import { z } from "zod";

export const RADIUS_MIN = 1;
export const RADIUS_MAX = 200;
const code = z.string().min(1).max(32);
const radius = z.number().int().min(RADIUS_MIN).max(RADIUS_MAX);
const version = z.number().int().min(0).max(2147483647);
const when = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);
export const preference = z
  .object({ version, reference_code: code.nullable(), radius_km: radius.nullable() })
  .strict()
  .refine((p) => (p.reference_code === null) === (p.radius_km === null));
export const view = z
  .object({
    preference,
    options: z.array(z.object({ code, name: z.string().min(1).max(200) }).strict()).max(1000),
    source: z.object({ url: z.url({ protocol: /^https?$/ }), retrieved_at: when }).strict(),
    basis: z.literal("commune_centres"),
    unknown_postal_policy: z.literal("postal_only"),
  })
  .strict()
  .refine((v) => new Set(v.options.map((o) => o.code)).size === v.options.length)
  .refine((v) => v.preference.reference_code === null || v.options.some((o) => o.code === v.preference.reference_code));
export const command = z
  .object({ expected_version: version, reference_code: code.nullable(), radius_km: radius.nullable() })
  .strict()
  .refine((c) => (c.reference_code === null) === (c.radius_km === null));
export type RadiusView = z.infer<typeof view>;
export type RadiusCommand = z.infer<typeof command>;
