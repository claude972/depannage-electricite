import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError, dbError, type adminClient } from "@/lib/supabase/server";
import { eventTypes, observationEvent, eventId, version } from "./contract";
export function financialEventType(type: string) {
  return Object.values(eventTypes).some((types) =>
    (types as readonly string[]).includes(type),
  );
}
const idOf = (v: unknown) =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && "id" in v
      ? v.id
      : null;
export function normalizeFinancialEvent(event: any, live: boolean) {
  if (
    !event ||
    event.object !== "event" ||
    event.livemode !== live ||
    !Number.isSafeInteger(event.created) ||
    event.created < 0 ||
    event.created > Date.now() / 1000 + 300
  )
    throw new ApiError(400, "Contexte financier invalide.");
  const family = (
    Object.keys(eventTypes) as Array<keyof typeof eventTypes>
  ).find((k) => (eventTypes[k] as readonly string[]).includes(event.type));
  if (!family) throw new ApiError(400, "Type financier invalide.");
  const o = event.data?.object;
  if (!o || typeof o !== "object")
    throw new ApiError(400, "Objet financier absent.");
  const expected =
    family === "fee"
      ? event.type === "application_fee.refund.updated"
        ? "fee_refund"
        : "application_fee"
      : family;
  if (
    o.object !== expected ||
    (o.livemode !== undefined && o.livemode !== live) ||
    (family === "transfer" && o.livemode !== live)
  )
    throw new ApiError(400, "Source financière invalide.");
  // Account context never defaults to platform when an organization/context envelope is present.
  const sourceAccount = event.account ?? event.context ?? null;
  const data = observationEvent.safeParse({
    id: event.id,
    type: event.type,
    family,
    livemode: event.livemode,
    source_account: sourceAccount,
    created: new Date(event.created * 1000).toISOString(),
    object: {
      id: o.id,
      amount: o.amount,
      currency: o.currency,
      source_charge:
        family === "transfer"
          ? idOf(o.source_transaction)
          : family === "fee" || family === "dispute"
            ? idOf(o.charge)
            : null,
      destination: family === "transfer" ? idOf(o.destination) : null,
      amount_reversed: family === "transfer" ? o.amount_reversed : null,
      reversed: family === "transfer" ? o.reversed : null,
      status: family === "payout" || family === "dispute" ? o.status : null,
    },
  });
  if (
    !data.success ||
    !(
      family === "transfer"
        ? /^tr_/
        : family === "payout"
          ? /^po_/
          : family === "dispute"
            ? /^du_/
            : event.type === "application_fee.refund.updated"
              ? /^fr_/
              : /^fee_/
    ).test(data.data.object.id) ||
    (family === "transfer" &&
      (data.data.object.amount_reversed === null ||
        data.data.object.reversed === null ||
        data.data.object.amount_reversed > data.data.object.amount))
  )
    throw new ApiError(400, "Références financières invalides.");
  return data.data;
}
export async function dispatchFinancialEvent(
  event: unknown,
  rawBody: string,
  db: ReturnType<typeof adminClient>,
  live: boolean,
) {
  const normalized = normalizeFinancialEvent(event, live);
  const r = await db.rpc("ingest_stripe_financial_observation", {
    p_event: normalized,
    p_fingerprint: createHash("sha256").update(rawBody).digest("hex"),
  });
  dbError(r.error);
  const ack = z
    .object({ event_id: eventId, version, replayed: z.boolean() })
    .strict()
    .safeParse(r.data);
  if (!ack.success || ack.data.event_id !== normalized.id)
    throw new ApiError(503, "L’événement financier doit être vérifié.");
}
