import { z } from "zod";
import { authenticatedClient, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { describeAccess, failed, invalidQuery, objectResult, ok, requireScope, supersededEstimates } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const schema = z.object({ action: z.literal("reconcile"), limit: z.number().int().min(1).max(500).optional() }).strict();
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    await requireScope(db, "finance_read");
    const [report, access, superseded] = await Promise.all([db.rpc("platform_finance_report"), describeAccess(db), supersededEstimates(db).catch(() => null)]);
    dbError(report.error);
    // FIN-06: a commission already withheld is not also shown as « estimated, not withheld ».
    return ok({ report: { ...objectResult(report.data, "Le rapport financier est indisponible."), commission_estimated_superseded: superseded }, config: access.config });
  } catch (error) { return failed(error); }
}
/** The commission rate is never accepted from the browser: the database reads its audited setting. */
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) invalidQuery();
    await requireScope(db, "finance_write");
    const data = await validated(request, schema);
    const result = await db.rpc("platform_reconcile", { p_limit: data.limit ?? 200 });
    dbError(result.error);
    return ok(objectResult(result.data, "Le rapprochement n’a pas été confirmé."));
  } catch (error) { return failed(error); }
}
