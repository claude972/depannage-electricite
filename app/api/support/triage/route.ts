import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const uuid = z.uuid().transform(id => id.toLowerCase());
const revision = z.number().int().min(0).max(2147483647);
const versionQuery = z.string().regex(/^(?:0|[1-9][0-9]{0,9})$/)
  .transform(Number).pipe(revision);
const kinds = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ticket"), ticket_id: uuid, after_version: versionQuery.optional() }).strict(),
  z.object({ kind: z.literal("operators"), after: uuid.optional() }).strict(),
  z.object({ kind: z.literal("queue"), queue: z.enum(["mine", "escalated"]), after: uuid.optional() }).strict(),
]);
const commandFields = {
  ticket_id: uuid, command_id: uuid, expected_version: revision,
  reason: z.string().trim().min(1).max(500).regex(/^[^\u0000]*$/),
};
const commandSchema = z.discriminatedUnion("action", [
  z.object({ ...commandFields, action: z.literal("assign"), assigned_to: uuid.nullable() }).strict(),
  z.object({ ...commandFields, action: z.literal("set_escalated"), escalated: z.boolean() }).strict(),
]);
const triage = z.object({
  ticket_id: uuid,
  assigned_to: uuid.nullable(),
  assignee_name: z.string().nullable(),
  assignee_active: z.boolean(),
  escalated: z.boolean(),
  version: revision,
}).strict().refine(row =>
  (row.assigned_to === null ? row.assignee_name === null && !row.assignee_active : row.assignee_name !== null)
  && (row.version > 0 || (row.assigned_to === null && !row.escalated)),
);
const event = z.object({
  id: uuid, actor_id: uuid, version: revision.min(1),
  action: z.enum(["assign", "set_escalated"]), reason: z.string().min(1).max(500),
  assigned_to: uuid.nullable(), escalated: z.boolean(),
  created_at: z.iso.datetime({ offset: true }),
}).strict();
const detail = z.object({
  triage, events: z.array(event).max(50), next_after_version: revision.nullable(), can_manage: z.boolean(),
}).strict();
const operator = z.object({ id: uuid, name: z.string() }).strict();
const ticket = z.object({
  id: uuid, subject: z.string().min(4).max(160),
  status: z.enum(["open", "in_progress", "awaiting_user"]),
  assigned_to: uuid.nullable(), escalated: z.boolean(),
}).strict();
const operatorsPage = z.object({ rows: z.array(operator).max(50), next_cursor: uuid.nullable() }).strict();
const queuePage = z.object({ rows: z.array(ticket).max(50), next_cursor: uuid.nullable() }).strict();
const receipt = z.object({ triage, replayed: z.boolean() }).strict();

function failure(error: unknown) {
  const status = error instanceof ApiError ? error.status : error instanceof SyntaxError ? 400 : 503;
  return Response.json(
    { error: error instanceof ApiError ? error.message : "Le suivi interne de la demande est momentanément indisponible." },
    { status, headers: { ...headers, ...(status === 503 || status === 429 ? { "Retry-After": "2" } : {}) } },
  );
}

function pageMatches(page: { rows: { id: string }[]; next_cursor: string | null }, after?: string) {
  let previous = after ?? "";
  for (const row of page.rows) {
    if (row.id <= previous) return false;
    previous = row.id;
  }
  return page.next_cursor === null || (page.rows.length === 50 && page.next_cursor === previous);
}

export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    const params = new URL(request.url).searchParams;
    if (new Set(params.keys()).size !== params.size) throw new ApiError(422, "Filtres de suivi invalides.");
    const parsed = kinds.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new ApiError(422, "Filtres de suivi invalides.");
    const query = parsed.data;
    if (query.kind === "ticket") {
      const after = query.after_version ?? 0;
      const result = await db.rpc("read_support_ticket_triage", { p_ticket: query.ticket_id, p_after: after });
      dbError(result.error);
      const page = detail.parse(result.data);
      const last = page.events.at(-1)?.version ?? after;
      if (page.triage.ticket_id !== query.ticket_id || last > page.triage.version
        || page.events.some((item, index) => item.version !== after + index + 1)
        || (page.next_after_version === null
          ? last !== page.triage.version
          : page.events.length !== 50 || page.next_after_version !== last || last === page.triage.version)) {
        throw new Error("Support triage history scope mismatch");
      }
      return Response.json(page, { headers });
    }
    const result = await db.rpc("list_support_triage", {
      p_kind: query.kind === "operators" ? "operators" : query.queue,
      p_after: query.after ?? null,
    });
    dbError(result.error);
    if (query.kind === "operators") {
      const page = operatorsPage.parse(result.data);
      if (!pageMatches(page, query.after)) throw new Error("Support operator scope mismatch");
      return Response.json(page, { headers });
    }
    const page = queuePage.parse(result.data);
    if (!pageMatches(page, query.after) || page.rows.some(row =>
      query.queue === "mine" ? row.assigned_to !== user.id : !row.escalated,
    )) throw new Error("Support queue scope mismatch");
    return Response.json(page, { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    if (new URL(request.url).search) throw new ApiError(422, "Paramètres inattendus.");
    const { db } = await authenticatedClient();
    const command = await validated(request, commandSchema);
    const result = await db.rpc("mutate_support_triage", {
      p_ticket: command.ticket_id, p_command: command.command_id,
      p_expected: command.expected_version, p_action: command.action, p_reason: command.reason,
      p_assignee: command.action === "assign" ? command.assigned_to : null,
      p_escalated: command.action === "set_escalated" ? command.escalated : null,
    });
    dbError(result.error);
    const response = receipt.parse(result.data);
    if (response.triage.ticket_id !== command.ticket_id || response.triage.version <= command.expected_version
      || (!response.replayed && (response.triage.version !== command.expected_version + 1
        || (command.action === "assign" ? response.triage.assigned_to !== command.assigned_to
          : response.triage.escalated !== command.escalated)))) {
      throw new Error("Support triage receipt mismatch");
    }
    return Response.json(response, { headers });
  } catch (error) {
    return failure(error);
  }
}
