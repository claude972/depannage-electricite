import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const uuid = z.uuid().transform(id => id.toLowerCase());
const input = z.object({
  action: z.enum(["state", "mark_read"]),
  intervention_id: uuid,
  message_ids: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
}).strict();
const output = z.object({
  rows: z.array(z.object({ message_id: uuid, read: z.boolean() }).strict()).max(100),
}).strict();

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (new URL(request.url).search) throw new ApiError(422, "Paramètres inattendus.");
    const { db } = await authenticatedClient();
    const command = await validated(request, input);
    const mark = command.action === "mark_read";
    const result = await db.rpc("message_read_state", {
      p_intervention_id: command.intervention_id,
      p_message_ids: command.message_ids,
      p_mark: mark,
    });
    dbError(result.error);
    const page = output.parse(result.data);
    if (page.rows.length !== command.message_ids.length || page.rows.some(
      (row, index) => row.message_id !== command.message_ids[index] || (mark && !row.read),
    )) {
      throw new Error("Conversation read receipt mismatch");
    }
    return Response.json(page, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
    return Response.json(
      { error: error instanceof ApiError ? error.message : "L’état de lecture est momentanément indisponible. Réessayez." },
      { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } },
    );
  }
}
