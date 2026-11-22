import { z } from "zod";

export type Channel = "email" | "push";
export type Outcome = { outcome: "accepted"; reference: string } | { outcome: "retryable" | "failed" | "uncertain" };
/** The provider must deduplicate the same recipient and payload across the entire eligible
 * retry window, even after a timeout or crash. Resolve verified delivery endpoints privately; never accept
 * an address/token from the caller. An endpoint change must not redirect a replay to a new target.
 * `accepted` means provider acceptance, NOT delivery/read. Retryable proves no acceptance.
 */
export interface IdempotentAdapter {
  channel: Channel;
  provider: string;
  durableIdempotency: true;
  send(input: { deliveryId: string; leaseToken: string; recipientId: string; idempotencyKey: string; title: string; body: string; signal: AbortSignal }): Promise<Outcome>;
}
export interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}
const claim = z.union([z.object({ id: z.uuid(), lease_token: z.uuid() }).strict(), z.object({ skipped: z.literal(true) }).strict()]).nullable();
const source = z.object({ id: z.uuid(), recipient_id: z.uuid(), channel: z.enum(["email", "push"]), provider: z.string(), idempotency_key: z.string() }).strict().nullable();
const outcome = z.union([z.object({ outcome: z.literal("accepted"), reference: z.string().min(1).max(200) }).strict(), z.object({ outcome: z.enum(["retryable", "failed", "uncertain"]) }).strict()]);
export const GENERIC_MESSAGE = Object.freeze({ title: "Une notification est disponible", body: "Connectez-vous à votre espace pour la consulter." });
async function call(db: RpcClient, name: string, args: Record<string, unknown>) {
  const r = await db.rpc(name, args);
  if (r.error) throw new Error("External notification persistence unavailable");
  return r.data;
}
async function emit(adapter: IdempotentAdapter, deliveryId: string, leaseToken: string, recipientId: string, idempotencyKey: string, timeoutMs: number): Promise<Outcome> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => adapter.send({ deliveryId, leaseToken, recipientId, idempotencyKey, ...GENERIC_MESSAGE, signal: controller.signal }))
        .then((r): Outcome => outcome.safeParse(r).success ? outcome.parse(r) : { outcome: "uncertain" })
        .catch((): Outcome => ({ outcome: "uncertain" })),
      new Promise<Outcome>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve({ outcome: "uncertain" }); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
/** Explicit invocation only. No cron. The SQL gate starts inactive.
 * Every iteration claims a fresh lease, then rechecks scope/preferences immediately before send.
 * Persistence failure stops the batch; a crashed in-flight send remains uncertain, never "sent".
 */
export async function processExternalNotifications(db: RpcClient, adapter: IdempotentAdapter, options: { limit?: number; timeoutMs?: number } = {}) {
  const limit = options.limit ?? 10, timeoutMs = options.timeoutMs ?? 10000;
  if (!adapter || adapter.durableIdempotency !== true || !["email", "push"].includes(adapter.channel) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(adapter.provider)) throw new Error("A durable idempotent email/push adapter is required");
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error("Invalid delivery bounds");
  const report = { processed: 0, accepted: 0, uncertain: 0, skipped: 0, unconfirmed: 0 };
  for (let i = 0; i < limit; i++) {
    const lease = claim.parse(await call(db, "claim_external_notification", { p_channel: adapter.channel, p_provider: adapter.provider, p_idempotent: true }));
    if (!lease) break;
    report.processed++;
    if ("skipped" in lease) { report.skipped++; continue; }
    const item = source.parse(await call(db, "begin_external_notification", { p_id: lease.id, p_lease: lease.lease_token }));
    if (!item) { report.skipped++; continue; }
    if (item.id !== lease.id || item.channel !== adapter.channel || item.provider !== adapter.provider || item.idempotency_key !== `notification:${item.id}`) throw new Error("External delivery identity mismatch");
    const result = await emit(adapter, item.id, lease.lease_token, item.recipient_id, item.idempotency_key, timeoutMs);
    const saved = await call(db, "finish_external_notification", { p_id: lease.id, p_lease: lease.lease_token, p_outcome: result.outcome, p_reference: result.outcome === "accepted" ? result.reference : null });
    if (saved !== true) { report.unconfirmed++; break; }
    if (result.outcome === "accepted") report.accepted++;
    if (result.outcome === "uncertain") report.uncertain++;
  }
  return report;
}
