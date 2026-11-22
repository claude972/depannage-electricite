import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { hasEmptyDispatchBody } from "./dispatch-request";
import { processExternalNotifications, type IdempotentAdapter, type Outcome, type RpcClient } from "./worker";

const headers = { "Cache-Control": "private, no-store" };
const email = z.email().max(254);
const accepted = z.object({ id: z.uuid() });
const secretPattern = /^[A-Za-z0-9_-]{32,256}$/;
type Environment = Readonly<Record<string, string | undefined>>;
type Config = { key: string; from: string };

export function resendConfiguration(env: Environment): Config | null {
  const key = env.NOTIFICATION_RESEND_API_KEY;
  const from = env.NOTIFICATION_EMAIL_FROM;
  const workerSecret = env.NOTIFICATION_DELIVERY_SECRET;
  if (env.NOTIFICATIONS_EMAIL_PROVIDER !== "resend" || !key || !/^re_[A-Za-z0-9_-]{12,200}$/.test(key) ||
      !from || !email.safeParse(from).success || !workerSecret || !secretPattern.test(workerSecret)) return null;
  return { key, from };
}

export function resendAdapter(db: RpcClient, config: Config, send: typeof fetch): IdempotentAdapter {
  return {
    channel: "email",
    provider: "resend",
    durableIdempotency: true,
    async send({ deliveryId, leaseToken, idempotencyKey, title, body, signal }): Promise<Outcome> {
      // Rotation or a change to the sender/content must not reuse a prior key with a different body.
      const tag = createHmac("sha256", config.key).update(JSON.stringify(["notification-email-v1", config.from, title, body])).digest("hex");
      const { data, error } = await db.rpc("authorize_external_email", {
        p_id: deliveryId, p_lease: leaseToken, p_payload_tag: tag,
      });
      if (error) return { outcome: "retryable" }; // No provider request has been made.
      const recipient = email.safeParse(data);
      if (!recipient.success || signal.aborted) return { outcome: "failed" };

      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.key}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ from: config.from, to: [recipient.data], subject: title, text: body }),
        cache: "no-store",
        redirect: "error",
        signal,
      });
      if (response.ok) {
        const result = accepted.safeParse(await response.json().catch(() => null));
        return result.success ? { outcome: "accepted", reference: result.data.id } : { outcome: "uncertain" };
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        // The outbox retries after 60 seconds. An unverified or longer cooldown stops this item.
        return { outcome: retryAfter === null || (/^\d+$/.test(retryAfter) && Number(retryAfter) <= 60) ? "retryable" : "failed" };
      }
      return { outcome: [400, 401, 403, 404, 422].includes(response.status) ? "failed" : "uncertain" };
    },
  };
}

export async function handleEmailDispatch(request: Request, env: Environment, createDb: () => RpcClient, fetcher: typeof fetch) {
  const secret = env.NOTIFICATION_DELIVERY_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || !secretPattern.test(secret) || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return Response.json({ error: "Accès refusé." }, { status: 403, headers });
  const config = resendConfiguration(env);
  if (!config) return Response.json({ error: "Envoi e-mail indisponible." }, { status: 503, headers });
  if (new URL(request.url).searchParams.size || !(await hasEmptyDispatchBody(request)))
    return Response.json({ error: "Aucun paramètre attendu." }, { status: 422, headers });

  try {
    const db = createDb();
    const report = await processExternalNotifications(db, resendAdapter(db, config, fetcher), { limit: 4, timeoutMs: 8000 });
    return Response.json(report, { status: report.unconfirmed ? 503 : 200, headers });
  } catch {
    return Response.json({ error: "Le traitement n’a pas pu être vérifié." }, { status: 503, headers });
  }
}
