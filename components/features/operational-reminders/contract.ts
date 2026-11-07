// STRICT COPY of lib/features/operational-reminders/contract.ts from Astra eb138d6 (the commit also edits
// shared notification kinds/types and migrations, so it is not cherry-picked into this UI branch).
// Replace by an import of the lib file once eb138d6 is assembled. Rules unchanged.
import { z } from "zod";
export const uuid = z.uuid().transform((v) => v.toLowerCase());
const version = z.number().int().min(1).max(2147483647),
  expected = version.max(2147483646),
  instant = z.iso.datetime({ offset: true }),
  date = z.iso.date();
export const kind = z.enum(["credential", "compliance"]);
export const command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("schedule"),
      command_id: uuid,
      expected_version: expected.nullable(),
      source_version: version,
      due_on: date,
      remind_at: instant,
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      command_id: uuid,
      expected_version: expected,
    })
    .strict(),
]);
export const record = z
  .object({
    id: uuid,
    kind,
    record_id: uuid,
    source_version: version,
    due_on: date,
    remind_at: instant,
    version,
    status: z.enum([
      "scheduled",
      "cancelled",
      "sent",
      "invalidated",
      "expired",
      "muted",
    ]),
    notification_id: uuid.nullable(),
    processed_at: instant.nullable(),
    updated_at: instant,
  })
  .strict()
  .refine((r) => (r.status === "scheduled") === (r.processed_at === null));
export const state = z
  .object({
    kind,
    record_id: uuid,
    source: z.object({ version, due_on: date.nullable() }).strict(),
    record: record.nullable(),
    eligibility: z.enum(["no_date", "closed", "elapsed", "available"]),
    can_schedule: z.boolean(),
    scheduled_for_current_source: z.boolean(),
  })
  .strict()
  .refine((s) => s.can_schedule === (s.eligibility === "available"));
export const receipt = z.object({ record, replayed: z.boolean() }).strict();
export type ReminderState = z.infer<typeof state>;
export type ReminderCommand = z.infer<typeof command>;
