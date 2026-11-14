import { z } from "zod";
export const uuid = z.uuid().transform((v) => v.toLowerCase());
export const version = z.number().int().min(1).max(2147483647);
export const step = z.union([
  z.object({ role: z.enum(["owner", "manager"]) }).strict(),
  z.object({ user_id: uuid }).strict(),
]);
export const policy = z
  .object({
    version,
    enabled: z.boolean(),
    threshold_cents: z.number().int().min(0).max(100000000),
    steps: z.array(step).min(1).max(10),
  })
  .strict();
export const policyCommand = z
  .object({
    command_id: uuid,
    expected_version: version.max(2147483646).nullable(),
    enabled: z.boolean(),
    threshold_cents: policy.shape.threshold_cents,
    steps: policy.shape.steps,
  })
  .strict();
export const action = z.enum([
  "submit",
  "approve",
  "reject",
  "request_information",
  "respond",
]);
export const workflowCommand = z
  .object({
    command_id: uuid,
    expected_version: version.max(2147483646).nullable(),
    action,
    note: z.string().trim().max(2000),
  })
  .strict()
  .refine(
    (v) =>
      !["reject", "request_information", "respond"].includes(v.action) ||
      v.note.length > 0,
  );
export const state = z.enum([
  "pending",
  "changes_requested",
  "approved",
  "rejected",
]);
export const policyStatus = z
  .object({ site_id: uuid, policy: policy.nullable(), can_manage: z.boolean() })
  .strict();
export const policyReceipt = z
  .object({ site_id: uuid, version, replayed: z.boolean() })
  .strict();
export const workflowReceipt = z
  .object({
    quote_id: uuid,
    version,
    state,
    current_step: z.number().int().min(1).max(10),
    replayed: z.boolean(),
  })
  .strict();
export const workflowStatus = z
  .object({
    quote_id: uuid,
    site_id: uuid,
    required: z.boolean(),
    approved_current: z.boolean(),
    policy: policy.nullable(),
    workflow: z
      .object({
        version,
        policy_version: version,
        state,
        current_step: z.number().int().min(1).max(10),
        steps: policy.shape.steps,
        snapshot_matches: z.boolean(),
      })
      .strict()
      .nullable(),
    permissions: z
      .object({
        can_submit: z.boolean(),
        can_decide: z.boolean(),
        can_respond: z.boolean(),
      })
      .strict(),
    events: z
      .array(
        z
          .object({
            version,
            actor_id: uuid,
            action,
            note: z.string().max(2000),
            created_at: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .max(50),
    next_after: version.nullable(),
  })
  .strict();
export type ApprovalPolicy = z.infer<typeof policy>;
export type ApprovalWorkflow = z.infer<typeof workflowStatus>;
