import { z } from "zod";
import {
  authenticatedClient,
  ApiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  linkCommand,
  linkRecord,
  historyRecord,
} from "@/lib/features/site-asset-links/schemas";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEADERS = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
type Context = { params: Promise<{ id: string }> };
const id = z.uuid().transform((v) => v.toLowerCase());
const filters = z
  .object({
    kind: z.enum(["equipment", "area"]).nullable(),
    asset_id: id.nullable(),
    intervention_id: id.nullable(),
  })
  .strict()
  .refine(
    (v) =>
      (v.intervention_id !== null && v.kind === null && v.asset_id === null) ||
      (v.intervention_id === null && v.kind !== null && v.asset_id !== null),
  );
const cursorSchema = z
  .object({ site_id: id, actor_id: id, filter: filters, after_id: id })
  .strict();
function failed(e: unknown) {
  const status =
    e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : status === 400
            ? "Le contenu envoyé est invalide."
            : "Les liens du site n’ont pas pu être vérifiés. Réessayez.",
    },
    {
      status,
      headers: {
        ...HEADERS,
        ...(status === 503 ? { "Retry-After": "2" } : {}),
      },
    },
  );
}
async function siteId(context: Context) {
  const p = id.safeParse((await context.params).id);
  if (!p.success) throw new ApiError(422, "Référence de site invalide.");
  return p.data;
}
export async function GET(request: Request, context: Context) {
  try {
    const { db, user } = await authenticatedClient(request);
    const site = await siteId(context),
      q = new URL(request.url).searchParams;
    if (
      request.url.length > 2048 ||
      [...q.keys()].some(
        (k) =>
          !["kind", "asset_id", "intervention_id", "cursor"].includes(k) ||
          q.getAll(k).length !== 1,
      )
    )
      throw new ApiError(422, "Filtres invalides.");
    const parsed = filters.safeParse({
      kind: q.get("kind"),
      asset_id: q.get("asset_id"),
      intervention_id: q.get("intervention_id"),
    });
    if (!parsed.success)
      throw new ApiError(422, "Choisissez un actif ou un dossier du site.");
    const filter = parsed.data;
    let after: string | null = null;
    const raw = q.get("cursor");
    if (raw !== null) {
      try {
        if (raw.length > 750 || !/^[-A-Za-z0-9_]+$/.test(raw)) throw Error();
        const b = Buffer.from(raw, "base64url");
        if (b.toString("base64url") !== raw) throw Error();
        const c = cursorSchema.parse(JSON.parse(b.toString("utf8")));
        if (
          c.site_id !== site ||
          c.actor_id !== user.id.toLowerCase() ||
          JSON.stringify(c.filter) !== JSON.stringify(filter)
        )
          throw Error();
        after = c.after_id;
      } catch {
        throw new ApiError(422, "Curseur invalide. Rechargez l’historique.");
      }
    }
    const result = await db.rpc("site_asset_link_page", {
      p_site_id: site,
      p_kind: filter.kind,
      p_asset_id: filter.asset_id,
      p_intervention_id: filter.intervention_id,
      p_after_id: after,
    });
    dbError(result.error);
    const data = z
      .object({
        records: z.array(historyRecord).max(51),
        can_write: z.boolean(),
        site_archived: z.boolean(),
      })
      .strict()
      .parse(result.data);
    if (
      (data.site_archived && data.can_write) ||
      data.records.some(
        (r, i) =>
          r.site_id !== site ||
          r.intervention.id !== r.intervention_id ||
          (filter.intervention_id
            ? r.intervention_id !== filter.intervention_id
            : r.kind !== filter.kind || r.asset_id !== filter.asset_id) ||
          (after && r.id <= after) ||
          (i > 0 && r.id <= data.records[i - 1].id),
      )
    )
      throw Error("Invalid links page");
    const more = data.records.length > 50,
      records = data.records.slice(0, 50),
      last = records.at(-1);
    return Response.json(
      {
        records,
        page: {
          limit: 50,
          has_more: more,
          next_cursor:
            more && last
              ? Buffer.from(
                  JSON.stringify({
                    site_id: site,
                    actor_id: user.id.toLowerCase(),
                    filter,
                    after_id: last.id,
                  }),
                ).toString("base64url")
              : null,
          complete: !after && !more,
        },
        permissions: { can_write: data.can_write },
        site_archived: data.site_archived,
        limits: { active_per_intervention: 50, history_per_intervention: 100 },
      },
      { headers: HEADERS },
    );
  } catch (e) {
    return failed(e);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient(request);
    const site = await siteId(context);
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const c = await validated(request, linkCommand);
    const result = await db.rpc("write_site_asset_link", {
      p_site_id: site,
      p_intervention_id: c.intervention_id,
      p_kind: c.kind,
      p_asset_id: c.asset_id,
      p_action: c.action,
      p_command_id: c.command_id,
      p_expected_version: c.expected_version,
    });
    dbError(result.error);
    const data = z
        .object({ record: linkRecord, replayed: z.boolean() })
        .strict()
        .parse(result.data),
      r = data.record;
    if (
      r.site_id !== site ||
      r.intervention_id !== c.intervention_id ||
      r.kind !== c.kind ||
      r.asset_id !== c.asset_id ||
      r.active !== (c.action === "link") ||
      r.version !== (c.expected_version === null ? 1 : c.expected_version + 1)
    )
      throw Error("Unconfirmed link command");
    return Response.json(data, { headers: HEADERS });
  } catch (e) {
    return failed(e);
  }
}
