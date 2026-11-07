import { taxRateSchema } from "@/lib/tax-rates";
import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { failed, invalidQuery, objectResult, ok, requireScope } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const issuer = z.object({ legal_name: z.string().trim().min(1).max(160), siret: z.string().regex(/^[0-9]{14}$/), address: z.string().trim().min(5).max(500), vat_number: z.string().regex(/^[A-Z]{2}[0-9A-Z]{2,13}$/).nullable(), commission_vat_rate: taxRateSchema.nullable() }).strict();
const schema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("invoice_issuer"), value: issuer, expected_version: z.number().int().min(1).nullable() }).strict(),
  z.object({ key: z.literal("commission_bps"), value: z.object({ bps: z.number().int().min(0).max(10000) }).strict(), expected_version: z.number().int().min(1).nullable() }).strict(),
]);
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const rows = await db.from("platform_settings").select("key,value,version,updated_by,updated_at").in("key", ["invoice_issuer", "commission_bps"]);
    dbError(rows.error);
    const find = (key: string) => rows.data?.find((r) => r.key === key) ?? null;
    return ok({ invoice_issuer: find("invoice_issuer"), commission_bps: find("commission_bps") });
  } catch (error) { return failed(error); }
}
export async function PUT(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "super_admin");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_set_setting", { p_key: data.key, p_value: data.value, p_expected_version: data.expected_version });
    dbError(result.error);
    return ok(objectResult(result.data, "Le paramètre n’a pas été confirmé."));
  } catch (error) { return failed(error); }
}
