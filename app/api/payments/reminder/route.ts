import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = z.uuid().transform(id => id.toLowerCase());
const instant = z.iso.datetime({ offset: true });
const expectedVersion = z.number().int().min(1).max(2147483645);
const commandFields = { quote_id: uuid, command_id: uuid };
const command = z.discriminatedUnion("action", [
  z.object({ ...commandFields, action: z.literal("schedule"), expected_version: expectedVersion.nullable(), remind_at: instant }).strict(),
  z.object({ ...commandFields, action: z.literal("cancel"), expected_version: expectedVersion }).strict(),
]);
const record = z.object({
  id: uuid,
  quote_id: uuid,
  version: z.number().int().min(1).max(2147483647),
  remind_at: instant,
  status: z.enum(["scheduled", "cancelled", "sent", "invalidated", "muted"]),
  notification_id: uuid.nullable(),
  processed_at: instant.nullable(),
}).strict().refine(item => (item.status === "scheduled") === (item.processed_at === null));
const overview = z.object({ quote_id: uuid, can_schedule: z.boolean(), reminder: record.nullable() }).strict();
const receipt = z.object({ reminder: record, replayed: z.boolean() }).strict();

function failed(error: unknown) {
  const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
  return Response.json(
    { error: error instanceof ApiError ? error.message : "Le rappel doit être vérifié. Réessayez." },
    { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } },
  );
}

export async function GET(request: Request) {
  try {
    const { db } = await authenticatedClient();
    const query = new URL(request.url).searchParams;
    const id = uuid.safeParse(query.get("quote_id"));
    if (query.size !== 1 || !id.success) throw new ApiError(422, "Devis invalide.");
    const result = await db.rpc("read_payment_reminder", { p_quote: id.data });
    dbError(result.error);
    const value = overview.parse(result.data);
    if (value.quote_id !== id.data || (value.reminder && value.reminder.quote_id !== id.data)) {
      throw new Error("Payment reminder scope mismatch");
    }
    return Response.json(value, { headers });
  } catch (error) {
    return failed(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Paramètres inattendus.");
    const input = await validated(request, command);
    const result = await db.rpc("write_payment_reminder", {
      p_quote: input.quote_id,
      p_command: input.command_id,
      p_action: input.action,
      p_expected: input.expected_version,
      p_remind_at: input.action === "schedule" ? input.remind_at : null,
    });
    dbError(result.error);
    const value = receipt.parse(result.data);
    const item = value.reminder;
    if (item.quote_id !== input.quote_id || item.version !== (input.expected_version ?? 0) + 1
      || item.status !== (input.action === "schedule" ? "scheduled" : "cancelled")
      || (input.action === "schedule" && Date.parse(item.remind_at) !== Date.parse(input.remind_at))) {
      throw new Error("Payment reminder receipt mismatch");
    }
    return Response.json(value, { headers });
  } catch (error) {
    return failed(error);
  }
}
