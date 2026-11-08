import { z } from "zod";
import { comparePostgresTime } from "@/lib/shared/postgres-time-order";
import { ApiError, authenticatedClient, dbError } from "@/lib/supabase/server";

const pageSize = 50;
const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true }).regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
);
const cursorSchema = z.object({
  version: z.literal(1),
  actor: uuid,
  organization: uuid,
  id: uuid,
  created_at: timestamp,
}).strict();
const summary = z.object({
  id: uuid,
  organization_id: uuid,
  title: z.string().min(1).max(160),
  reference: z.string().max(160),
  starts_on: z.iso.date(),
  ends_on: z.iso.date().nullable(),
  status: z.enum(["draft", "active", "archived"]),
  created_at: timestamp,
});
const detail = summary.extend({ terms: z.string().max(8000) });
const projection = "id,organization_id,title,reference,starts_on,ends_on,status,created_at";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function decodeCursor(raw: string, actor: string, organization: string) {
  try {
    if (!/^[A-Za-z0-9_-]{1,700}$/.test(raw)) throw new Error();
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (cursor.actor !== actor || cursor.organization !== organization) throw new Error();
    return cursor;
  } catch {
    throw new ApiError(422, "Curseur invalide. Rechargez cette liste.");
  }
}

type Context = { params: Promise<{ id: string }> };

async function read(request: Request, context?: Context) {
  try {
    const { db, user } = await authenticatedClient();
    const actor = uuid.parse(user.id);
    const params = new URL(request.url).searchParams;
    const allowed = context ? ["organization_id"] : ["organization_id", "cursor"];
    const organization = uuid.safeParse(params.get("organization_id"));
    const id = uuid.nullable().safeParse(context ? (await context.params).id : null);
    if (
      request.url.length > 2048 || !organization.success || !id.success ||
      [...params.keys()].some((key) => !allowed.includes(key) || params.getAll(key).length !== 1)
    ) {
      throw new ApiError(422, "Paramètres invalides.");
    }

    const org = organization.data;
    const rawCursor = params.get("cursor");
    const cursor = rawCursor === null ? null : decodeCursor(rawCursor, actor, org);
    async function verifyAccess() {
      const profile = await db.from("profiles").select("role").eq("id", actor).maybeSingle();
      dbError(profile.error);
      if (profile.data?.role !== "manager") throw new ApiError(403, "Accès entreprise requis.");
      const access = await db.rpc("can_access_organization_wide", {
        p_organization_id: org,
        p_write: false,
      });
      dbError(access.error);
      if (access.data === false) throw new ApiError(404, "Périmètre introuvable.");
      if (access.data !== true) throw new Error("Invalid organization access result");
    }

    await verifyAccess();
    if (id.data) {
      const result = await db.from("contracts").select(projection + ",terms")
        .eq("organization_id", org).eq("id", id.data).limit(2);
      dbError(result.error);
      const [contract] = z.array(detail).max(1).parse(result.data);
      if (!contract) throw new ApiError(404, "Contrat introuvable.");
      if (contract.id !== id.data || contract.organization_id !== org) {
        throw new Error("Inconsistent contract scope");
      }
      await verifyAccess();
      return Response.json({ contract }, { headers });
    }

    let query = db.from("contracts").select(projection).eq("organization_id", org);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const result = await query.order("created_at", { ascending: false })
      .order("id", { ascending: false }).limit(pageSize + 1);
    dbError(result.error);
    const rows = z.array(summary).max(pageSize + 1).parse(result.data);
    let previous: Pick<z.infer<typeof summary>, "created_at" | "id"> | null = cursor;
    for (const row of rows) {
      if (row.organization_id !== org) throw new Error("Inconsistent contract scope");
      if (previous) {
        const order = comparePostgresTime(row.created_at, previous.created_at);
        if (order > 0 || (order === 0 && row.id >= previous.id)) {
          throw new Error("Inconsistent contract order");
        }
      }
      previous = row;
    }
    await verifyAccess();
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    const nextCursor = rows.length > pageSize && last ? Buffer.from(JSON.stringify({
      version: 1, actor, organization: org, id: last.id, created_at: last.created_at,
    })).toString("base64url") : null;
    return Response.json({
      items,
      page: { limit: pageSize, has_more: nextCursor !== null, next_cursor: nextCursor },
    }, { headers });
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 503;
    return Response.json({
      error: error instanceof ApiError ? error.message : "Les contrats n’ont pas pu être vérifiés. Réessayez.",
    }, { status, headers: { ...headers, ...(status === 503 ? { "Retry-After": "2" } : {}) } });
  }
}

export const GET = (request: Request) => read(request);
export const GET_DETAIL = (request: Request, context: Context) => read(request, context);
