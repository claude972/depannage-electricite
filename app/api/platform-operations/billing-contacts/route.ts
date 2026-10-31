import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { uuid, validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const kind = z.enum(["profile", "organization"]);
const schema = z.object({ subject_kind: kind, subject_id: uuid, legal_name: z.string().trim().min(1).max(160), address: z.string().trim().min(5).max(500), siret: z.string().regex(/^[0-9]{14}$/).nullable(), vat_number: z.string().regex(/^[A-Z]{2}[0-9A-Z]{2,13}$/).nullable(), expected_version: z.number().int().min(1).nullable() }).strict();
export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys()) if (!["subject_kind", "subject_id"].includes(key) || params.getAll(key).length !== 1) invalidQuery();
    const subject = z.object({ subject_kind: kind, subject_id: uuid }).safeParse({ subject_kind: params.get("subject_kind"), subject_id: params.get("subject_id") });
    if (!subject.success) invalidQuery();
    const row = await db.from("platform_billing_contacts").select("subject_kind,subject_id,legal_name,address,siret,vat_number,version,updated_by,updated_at").eq("subject_kind", subject.data.subject_kind).eq("subject_id", subject.data.subject_id).maybeSingle();
    dbError(row.error);
    return ok({ billing_contact: row.data });
  } catch (error) { return failed(error); }
}
export async function PUT(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "finance_write");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_set_billing_contact", { p_subject_kind: data.subject_kind, p_subject_id: data.subject_id, p_legal_name: data.legal_name, p_address: data.address, p_siret: data.siret, p_vat_number: data.vat_number, p_expected_version: data.expected_version });
    dbError(result.error);
    return ok(objectResult(result.data, "Les coordonnées de facturation n’ont pas été confirmées."));
  } catch (error) { return failed(error); }
}
