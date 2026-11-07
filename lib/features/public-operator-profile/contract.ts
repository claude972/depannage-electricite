import { z } from "zod";
import { uuid } from "@/lib/supabase/validation";

const text = (max: number) => z.string().trim().min(1).max(max);
const email = text(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);
export const operatorProfile = z.object({
  legal_name: text(160), legal_form: text(80), siren: z.string().regex(/^[0-9]{9}$/),
  hq_address: text(500), publication_director: text(160),
  public_email: email, privacy_email: email,
  host_name: text(160), host_address: text(500), host_contact: text(254), rights_holder: text(160),
  display_name: text(120), about_text: text(2000), service_area: text(500),
  public_phone: z.string().regex(/^\+[1-9][0-9]{6,14}$/),
  vat_number: z.string().regex(/^[A-Z]{2}[0-9A-Z]{2,14}$/),
}).partial().strict();

export const publication = z.object({
  version: z.number().int().positive(),
  profile: operatorProfile,
  published_at: z.iso.datetime({ offset: true }),
}).strict().refine(({ profile }) => [
  profile.legal_name, profile.legal_form, profile.siren, profile.hq_address, profile.publication_director,
  profile.public_email, profile.privacy_email, profile.host_name, profile.host_address, profile.host_contact, profile.rights_holder,
].every(Boolean));

export const editor = z.object({
  version: z.number().int().nonnegative(),
  draft: operatorProfile,
  published: publication.nullable(),
}).strict().refine(value => value.published === null || value.published.version <= value.version);

export const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), command_id: uuid, expected_version: z.number().int().min(0).max(2147483646), profile: operatorProfile }).strict(),
  z.object({ action: z.literal("publish"), command_id: uuid, expected_version: z.number().int().min(1).max(2147483646) }).strict(),
  z.object({ action: z.literal("withdraw"), command_id: uuid, expected_version: z.number().int().min(1).max(2147483646) }).strict(),
]);
