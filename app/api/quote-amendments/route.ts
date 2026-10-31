// ADV-DOCUMENTS-001 — versioned amendments on an accepted quote. Amounts are recomputed by the
// SQL command; the decider sends only the exact amendment id displayed (like accept_quote).
import { z } from "zod";
import { calculateQuote } from "@/lib/domain";
import { authenticatedClient, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { quoteLine, uuid, validated } from "@/lib/supabase/validation";
import { checkedObject, failed, privateHeaders } from "@/lib/features/quote-documents/server";
import { validateValidUntil } from "@/lib/features/quote-documents/validity";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000]*$/);
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose"),
      base_quote_id: uuid,
      lines: z.array(quoteLine).min(1).max(30),
      tax_rate: z.union([z.literal(0), z.literal(5.5), z.literal(10), z.literal(20)]),
      reason: text(2000).min(1),
      valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    })
    .strict(),
  z.object({ action: z.literal("withdraw"), amendment_id: uuid }).strict(),
  z.object({ action: z.literal("accept"), amendment_id: uuid }).strict(),
  z.object({ action: z.literal("reject"), amendment_id: uuid, note: text(2000) }).strict(),
]);
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Cette action n’accepte pas de paramètre supplémentaire.");
    const data = await validated(request, schema);
    let result;
    if (data.action === "propose") {
      try {
        calculateQuote(data.lines, data.tax_rate);
      } catch {
        throw new ApiError(422, "Vérifiez les montants de l’avenant.");
      }
      const check = validateValidUntil(data.valid_until ?? "");
      if (!check.ok) throw new ApiError(422, check.message);
      result = await db.rpc("propose_quote_amendment", { p_base_quote_id: data.base_quote_id, p_lines: data.lines, p_tax_rate: data.tax_rate, p_reason: data.reason, p_valid_until: check.value });
    } else if (data.action === "withdraw") {
      result = await db.rpc("withdraw_quote_amendment", { p_id: data.amendment_id });
    } else {
      result = await db.rpc("decide_quote_amendment", { p_id: data.amendment_id, p_decision: data.action === "accept" ? "accepted" : "rejected", p_note: data.action === "reject" ? data.note : "" });
    }
    dbError(result.error);
    const amendment = checkedObject(result.data, "L’avenant n’a pas été confirmé.");
    return Response.json({ action: data.action, amendment }, { status: data.action === "propose" ? 201 : 200, headers: privateHeaders });
  } catch (error) {
    return failed(error);
  }
}
