import { z } from "zod";
import {
  ApiError,
  authenticatedClient,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import {
  uuid,
  team,
  sections,
  invitation,
  mission,
  receipt,
  teamCommand,
  createCommand,
  invitationCommand,
} from "./contract";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
export type Context = {
  params: Promise<{ id: string; interventionId?: string }>;
};
function failed(e: unknown) {
  const status =
    e instanceof ApiError ? e.status : e instanceof SyntaxError ? 400 : 503;
  return Response.json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : status === 400
            ? "Contenu invalide."
            : "Les données de l’équipe doivent être vérifiées. Réessayez.",
    },
    {
      status,
      headers: {
        ...headers,
        ...(status === 503 ? { "Retry-After": "2" } : {}),
      },
    },
  );
}
function id(value: unknown) {
  const p = uuid.safeParse(value);
  if (!p.success) throw new ApiError(422, "Identifiant invalide.");
  return p.data;
}
function query(request: Request, sectionAllowed = false) {
  const q = new URL(request.url).searchParams;
  if (
    request.url.length > 2048 ||
    [...q.keys()].some(
      (k) =>
        !(sectionAllowed ? ["section", "after"] : ["after"]).includes(k) ||
        q.getAll(k).length !== 1,
    )
  )
    throw new ApiError(422, "Filtres invalides.");
  const after = q.has("after") ? id(q.get("after")) : null;
  const section = q.get("section") ?? "members";
  if (sectionAllowed && !Object.hasOwn(sections, section))
    throw new ApiError(422, "Section invalide.");
  return { after, section: section as keyof typeof sections };
}
function page<T extends z.ZodType>(
  schema: T,
  value: unknown,
  after: string | null,
) {
  const data = z
    .object({ records: z.array(schema).max(50), next_after: uuid.nullable() })
    .strict()
    .parse(value);
  const records = data.records as Array<{ id: string }>;
  if (
    records.some(
      (r, i) =>
        (after && r.id <= after) || (i > 0 && r.id <= records[i - 1].id),
    ) ||
    (data.next_after !== null &&
      (records.length !== 50 || data.next_after !== records.at(-1)?.id))
  )
    throw Error("Invalid page");
  return data;
}
export async function read(
  request: Request,
  mode: "teams" | "invitations" | "team" | "mission",
  context?: Context,
) {
  try {
    const { db } = await authenticatedClient();
    const params = context ? await context.params : null;
    if (mode === "mission") {
      if (new URL(request.url).searchParams.size)
        throw new ApiError(422, "Paramètres inattendus.");
      const teamId = id(params?.id),
        jobId = id(params?.interventionId);
      const result = await db.rpc("provider_team_mission", {
        p_team_id: teamId,
        p_intervention_id: jobId,
      });
      dbError(result.error);
      const data = mission.parse(result.data);
      if (data.team_id !== teamId || data.intervention.id !== jobId)
        throw Error("Wrong scope");
      return Response.json(data, { headers });
    }
    const filters = query(request, mode === "team");
    if (mode === "team") {
      const teamId = id(params?.id);
      const result = await db.rpc("provider_team_page", {
        p_team_id: teamId,
        p_section: filters.section,
        p_after: filters.after,
      });
      dbError(result.error);
      const base = z
        .object({
          team,
          section: z.literal(filters.section),
          records: z.array(z.unknown()),
          next_after: uuid.nullable(),
        })
        .strict()
        .parse(result.data);
      if (base.team.id !== teamId) throw Error("Wrong team");
      const data = page(
        sections[filters.section],
        { records: base.records, next_after: base.next_after },
        filters.after,
      );
      return Response.json({ ...base, ...data }, { headers });
    }
    const result = await db.rpc(
      mode === "teams" ? "provider_team_list" : "provider_team_invitation_page",
      { p_after: filters.after },
    );
    dbError(result.error);
    return Response.json(
      page(mode === "teams" ? team : invitation, result.data, filters.after),
      { headers },
    );
  } catch (e) {
    return failed(e);
  }
}
export async function write(
  request: Request,
  mode: "create" | "invitation" | "team",
  context?: Context,
) {
  try {
    assertOrigin(request);
    const { db } = await authenticatedClient();
    if (new URL(request.url).searchParams.size)
      throw new ApiError(422, "Paramètres inattendus.");
    const c =
      mode === "create"
        ? await validated(request, createCommand)
        : mode === "invitation"
          ? await validated(request, invitationCommand)
          : await validated(request, teamCommand);
    const teamId = "team_id" in c ? c.team_id : id((await context!.params).id);
    const { action, command_id, ...values } = c;
    const payload = { ...values } as Record<string, unknown>;
    delete payload.team_id;
    const result = await db.rpc("write_provider_team", {
      p_team_id: teamId,
      p_command_id: command_id,
      p_action: action,
      p_values: payload,
    });
    dbError(result.error);
    const data = receipt.parse(result.data);
    const entity =
      "invitation_id" in c
        ? c.invitation_id
        : "user_id" in c
          ? c.user_id
          : "intervention_id" in c
            ? c.intervention_id
            : teamId;
    const expectedState =
      action === "create"
        ? "created"
        : action === "rename"
          ? "renamed"
          : action === "invite"
            ? "pending"
            : action === "revoke_invitation"
              ? "revoked"
              : action === "remove_member"
                ? "inactive"
                : action === "set_role" && "role" in c
                  ? c.role
                  : action === "accept_invitation"
                    ? "accepted"
                    : action === "decline_invitation"
                      ? "declined"
                      : action === "assign"
                        ? "assigned"
                        : action === "unassign"
                          ? "unassigned"
                          : "state" in c
                            ? c.state
                            : null;
    if (
      data.team_id !== teamId ||
      data.action !== action ||
      data.entity_id !== entity ||
      data.state !== expectedState
    )
      throw Error("Unconfirmed command");
    if ("expected_version" in c && c.expected_version !== null) {
      if (["assign", "unassign", "progress"].includes(action)) {
        if (data.entity_version !== c.expected_version + 1)
          throw Error("Unconfirmed version");
      } else if (data.team_version !== c.expected_version + 1)
        throw Error("Unconfirmed team version");
    }
    return Response.json(data, { headers });
  } catch (e) {
    return failed(e);
  }
}
