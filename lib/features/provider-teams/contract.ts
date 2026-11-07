import { z } from "zod";
export const uuid = z.uuid().transform((v) => v.toLowerCase());
const version = z.number().int().min(1).max(2147483647),
  expected = version.max(2147483646),
  instant = z.iso.datetime({ offset: true });
const role = z.enum(["coordinator", "technician"]);
const name = z.string().trim().min(1).max(160);
const common = { command_id: uuid };
export const createCommand = z
  .object({ ...common, action: z.literal("create"), team_id: uuid, name })
  .strict();
export const invitationCommand = z
  .object({
    ...common,
    action: z.enum(["accept_invitation", "decline_invitation"]),
    team_id: uuid,
    invitation_id: uuid,
  })
  .strict();
export const teamCommand = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("rename"),
      expected_version: expected,
      name,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("invite"),
      expected_version: expected,
      invitation_id: uuid,
      email: z.string().trim().toLowerCase().max(254).email(),
      role,
      expires_at: instant,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("revoke_invitation"),
      expected_version: expected,
      invitation_id: uuid,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("remove_member"),
      expected_version: expected,
      user_id: uuid,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("set_role"),
      expected_version: expected,
      user_id: uuid,
      role,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("assign"),
      expected_version: expected.nullable(),
      intervention_id: uuid,
      technician_id: uuid,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("unassign"),
      expected_version: expected,
      intervention_id: uuid,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("progress"),
      expected_version: expected,
      intervention_id: uuid,
      state: z.enum(["acknowledged", "done"]),
      note: z.string().trim().max(2000),
    })
    .strict(),
]);
export const receipt = z
  .object({
    team_id: uuid,
    action: z.enum([
      "create",
      "rename",
      "invite",
      "revoke_invitation",
      "remove_member",
      "set_role",
      "accept_invitation",
      "decline_invitation",
      "assign",
      "unassign",
      "progress",
    ]),
    team_version: version,
    entity_id: uuid,
    entity_version: version.nullable(),
    state: z.enum([
      "created",
      "renamed",
      "pending",
      "revoked",
      "inactive",
      "coordinator",
      "technician",
      "accepted",
      "declined",
      "assigned",
      "unassigned",
      "acknowledged",
      "done",
    ]),
    replayed: z.boolean(),
  })
  .strict();
export const team = z
  .object({
    id: uuid,
    name,
    owner_id: uuid,
    version,
    role: z.enum(["owner", "coordinator", "technician"]),
    active: z.boolean(),
  })
  .strict();
const assignment = z
  .object({
    version,
    technician_id: uuid.nullable(),
    state: z.enum(["assigned", "acknowledged", "done", "unassigned"]),
    updated_at: instant,
  })
  .strict()
  .refine((v) => (v.state === "unassigned") === (v.technician_id === null));
export const sections = {
  members: z
    .object({
      id: uuid,
      full_name: z.string().max(120),
      role: z.enum(["owner", "coordinator", "technician"]),
      active: z.boolean(),
      version,
    })
    .strict(),
  invitations: z
    .object({
      id: uuid,
      email: z.string().max(254).email(),
      role,
      status: z.enum(["pending", "accepted", "declined", "revoked"]),
      expires_at: instant,
      expired: z.boolean(),
    })
    .strict(),
  missions: z
    .object({
      id: uuid,
      category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
      status: z.enum([
        "assigned",
        "quoted",
        "accepted",
        "in_progress",
        "completed",
        "paid",
      ]),
      city: z.string().max(120),
      assignment: assignment.nullable(),
    })
    .strict(),
};
export const invitation = z
  .object({
    id: uuid,
    team_id: uuid,
    team_name: name,
    role,
    expires_at: instant,
    team_active: z.boolean(),
  })
  .strict();
export const mission = z
  .object({
    team_id: uuid,
    intervention: z
      .object({
        id: uuid,
        category: sections.missions.shape.category,
        status: sections.missions.shape.status,
        description: z.string().min(10).max(4000),
        address: z.string().min(5).max(500),
        postal_code: z.string().regex(/^\d{5}$/),
        city: z.string().min(2).max(120),
      })
      .strict(),
    appointment: z
      .object({ starts_at: instant, ends_at: instant })
      .strict()
      .nullable(),
    assignment: assignment
      .safeExtend({ note: z.string().max(2000) })
      .nullable(),
    permissions: z
      .object({
        can_assign: z.boolean(),
        can_acknowledge: z.boolean(),
        can_complete: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type TeamCommand = z.infer<typeof teamCommand>;
export type ProviderTeam = z.infer<typeof team>;
export type ProviderMission = z.infer<typeof mission>;
