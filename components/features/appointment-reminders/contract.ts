// STRICT COPY of lib/features/appointment-reminders/contract.ts from ae10ee6 (Astra backend; the commit
// also edits shared notification files, so it is not cherry-picked into this UI branch). Replace by an
// import of the lib file once ae10ee6 is assembled. Rules unchanged.
import { z } from "zod";
const id = z.uuid().transform((v) => v.toLowerCase());
const version = z.number().int().min(1).max(2147483647);
const instant = z.iso
  .datetime({ offset: true })
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/,
  );
export const record = z
  .object({
    id,
    intervention_id: id,
    appointment_version: version,
    starts_at: instant,
    ends_at: instant,
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
    notification_id: id.nullable(),
    processed_at: instant.nullable(),
    updated_at: instant,
  })
  .strict()
  .refine(
    (r) =>
      Date.parse(r.remind_at) < Date.parse(r.starts_at) &&
      Date.parse(r.ends_at) > Date.parse(r.starts_at) &&
      (r.status === "scheduled") === (r.processed_at === null) &&
      (r.status === "sent" || r.notification_id === null),
  );
export const state = z
  .object({
    intervention_id: id,
    appointment: z
      .object({ version, starts_at: instant, ends_at: instant })
      .strict()
      .nullable(),
    record: record.nullable(),
    can_schedule: z.boolean(),
    eligibility: z.enum(["no_appointment", "closed", "elapsed", "available"]),
    scheduled_for_current_slot: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.can_schedule === (v.eligibility === "available") &&
      (!v.can_schedule || v.appointment !== null) &&
      (!v.scheduled_for_current_slot ||
        (v.can_schedule &&
          v.record?.status === "scheduled" &&
          v.record.appointment_version === v.appointment?.version &&
          Date.parse(v.record.starts_at) ===
            Date.parse(v.appointment.starts_at) &&
          Date.parse(v.record.ends_at) === Date.parse(v.appointment.ends_at))),
  );
const common = {
  command_id: id,
  expected_version: version.max(2147483646).nullable(),
};
export const command = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("schedule"),
      appointment_version: version,
      remind_at: instant,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("cancel"),
      expected_version: version.max(2147483646),
    })
    .strict(),
]);
export const receipt = z.object({ record, replayed: z.boolean() }).strict();
export const interventionId = id;
