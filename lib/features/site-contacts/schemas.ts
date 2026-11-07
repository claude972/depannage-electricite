import { z } from "zod";
const text = (max: number) => z.string().trim().min(1).max(max).refine(v => !/[\u0000-\u001f\u007f]/.test(v));
export const contactValues = z.object({
 first_name: text(100), last_name: text(100), role_label: text(160),
 phone: z.string().trim().regex(/^\+?[0-9][0-9 ().-]{5,30}$/).nullable(),
 email: z.email().max(254).nullable(), note: z.string().trim().max(2000), is_primary: z.boolean(),
}).strict().refine(v => v.phone !== null || v.email !== null, { message: "Renseignez un téléphone ou un email." });
export const contactCommand = z.discriminatedUnion("action", [
 z.object({ action: z.literal("save"), id: z.uuid(), command_id: z.uuid(), expected_version: z.number().int().min(1).max(2147483646).nullable(), values: contactValues }).strict(),
 z.object({ action: z.literal("archive"), id: z.uuid(), command_id: z.uuid(), expected_version: z.number().int().min(1).max(2147483646) }).strict(),
]);
export const contactRecord = z.object({
 id: z.uuid(), site_id: z.uuid(), first_name: text(100), last_name: text(100), role_label: text(160),
 phone: z.string().nullable(), email: z.string().nullable(), note: z.string().max(2000), is_primary: z.boolean(),
 version: z.number().int().min(1).max(2147483647), created_by: z.uuid(), updated_by: z.uuid(),
 created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }), archived_at: z.iso.datetime({ offset: true }).nullable(),
}).strict().superRefine((v, c) => {
 const values = { first_name:v.first_name,last_name:v.last_name,role_label:v.role_label,phone:v.phone,email:v.email,note:v.note,is_primary:v.is_primary };
 if (!contactValues.safeParse(values).success) c.addIssue({ code:"custom", message:"Contact invalide." });
 if (v.archived_at !== null && v.is_primary) c.addIssue({ code:"custom", message:"Contact archivé principal invalide." });
});
export type SiteContact = z.infer<typeof contactRecord>;
