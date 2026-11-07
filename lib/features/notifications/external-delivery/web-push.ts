import { createECDH, createHash, ECDH, timingSafeEqual } from "node:crypto";
import { generateRequestDetails } from "web-push";
import { z } from "zod";
import type { RpcClient } from "./worker";

const version = z.number().int().min(0).max(2147483647);
const state = z.object({
  version,
  opted_in: z.boolean(),
  dispatch_enabled: z.boolean(),
  browser: z.enum(["none", "current", "other"]),
}).strict();
const browserKeys = z.object({ p256dh: z.string().length(87), auth: z.string().length(22) }).strict();
const subscription = z.object({ endpoint: z.string().max(2048), keys: browserKeys }).strict();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), expected_version: version, consent: z.literal(true), subscription }).strict(),
  z.object({ action: z.literal("remove"), expected_version: version }).strict(),
]);
const lease = z.union([z.object({ skipped: z.literal(true) }).strict(), z.object({
  id: z.uuid(), lease_token: z.uuid(), enrollment_version: version.positive(),
  endpoint: z.string().max(2048), p256dh: z.string(), auth_key: z.string(),
}).strict()]).nullable();
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const secretPattern = /^[A-Za-z0-9_-]{32,256}$/;
type Env = Readonly<Record<string, string | undefined>>;
type PushConfig = { origin: string; scope: string; subject: string; publicKey: string; privateKey: string };

function canonicalBase64(value: string, bytes: number) {
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === bytes && decoded.toString("base64url") === value ? decoded : null;
}

function publicPoint(value: string) {
  const bytes = canonicalBase64(value, 65);
  if (!bytes || bytes[0] !== 4) return false;
  try {
    ECDH.convertKey(bytes, "prime256v1");
    return true;
  } catch {
    return false;
  }
}

export function pushEndpoint(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.href !== value || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    if (url.hostname === "fcm.googleapis.com") return /^\/fcm\/send\/[A-Za-z0-9_:-]+$/.test(url.pathname);
    if (url.hostname === "updates.push.services.mozilla.com") return /^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(url.pathname);
    return /^[a-z0-9-]+\.push\.apple\.com$/.test(url.hostname) && /^\/[A-Za-z0-9_=-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function webPushConfiguration(env: Env): PushConfig | null {
  if (env.NOTIFICATIONS_PUSH_PROVIDER !== "webpush" || !secretPattern.test(env.NOTIFICATION_DELIVERY_SECRET ?? "")) return null;
  const publicKey = env.NOTIFICATION_VAPID_PUBLIC_KEY ?? "";
  const privateKey = env.NOTIFICATION_VAPID_PRIVATE_KEY ?? "";
  const subject = env.NOTIFICATION_VAPID_SUBJECT ?? "";
  const secret = canonicalBase64(privateKey, 32);
  if (!secret || !publicPoint(publicKey) || !subject.startsWith("mailto:") || !z.email().max(254).safeParse(subject.slice(7)).success) return null;
  try {
    const site = new URL(env.NEXT_PUBLIC_APP_URL ?? "");
    if (site.protocol !== "https:" || site.href !== `${site.origin}/` || site.username || site.password) return null;
    const curve = createECDH("prime256v1");
    curve.setPrivateKey(secret);
    if (curve.getPublicKey().toString("base64url") !== publicKey) return null;
    const scope = createHash("sha256").update(JSON.stringify([site.origin, publicKey])).digest("hex");
    return { origin: site.origin, scope, subject, publicKey, privateKey };
  } catch {
    return null;
  }
}

type EnrollmentDependencies = {
  authenticate(): Promise<{ actor: string; session: string }>;
  admin(): RpcClient;
  env: Env;
};

function failure(status: number, error: string) {
  return Response.json({ error }, { status, headers });
}

export async function handlePushEnrollment(request: Request, deps: EnrollmentDependencies) {
  const write = request.method === "POST";
  const url = new URL(request.url);
  if (url.search) return failure(422, "Aucun paramètre attendu.");
  if (write && request.headers.get("origin") !== url.origin) return failure(403, "Origine de la requête non autorisée.");
  try {
    const identity = await deps.authenticate();
    const config = webPushConfiguration(deps.env);
    if (!config || config.origin !== url.origin) {
      return write ? failure(503, "Les notifications du navigateur sont indisponibles.") :
        Response.json({ available: false, public_key: null, enrollment: null }, { headers });
    }
    let input: z.infer<typeof command> | null = null;
    if (write) {
      const body = await request.text();
      if (body.length > 4096) return failure(422, "Inscription du navigateur invalide.");
      try { input = command.parse(JSON.parse(body)); }
      catch { return failure(422, "Vérifiez la demande et confirmez votre choix."); }
    }
    const candidate = input?.action === "register" ? input.subscription : null;
    if (candidate && (!pushEndpoint(candidate.endpoint) || !publicPoint(candidate.keys.p256dh) || !canonicalBase64(candidate.keys.auth, 16))) {
      return failure(422, "Ce service de notifications du navigateur n’est pas pris en charge.");
    }
    const result = await deps.admin().rpc("web_push_enrollment", {
      p_actor: identity.actor, p_session: identity.session, p_scope: config.scope,
      p_action: input?.action ?? "read", p_expected: input?.expected_version ?? null,
      p_endpoint: candidate?.endpoint ?? null, p_p256dh: candidate?.keys.p256dh ?? null, p_auth_key: candidate?.keys.auth ?? null,
    });
    if (result.error) {
      const { code } = result.error as { code?: string };
      if (code === "42501") return failure(403, "Vérifiez votre session et vos préférences de notifications.");
      if (code === "23505" || code === "P0001") return failure(409, "Le navigateur a changé. Actualisez son état.");
      return failure(503, "Le navigateur n’a pas pu être vérifié.");
    }
    const { dispatch_enabled, ...enrollment } = state.parse(result.data);
    return Response.json({ available: dispatch_enabled, public_key: dispatch_enabled ? config.publicKey : null, enrollment }, { headers });
  } catch (error) {
    if ((error as { status?: unknown })?.status === 401) return failure(401, "Connectez-vous pour gérer ce navigateur.");
    return failure(503, "Le navigateur n’a pas pu être vérifié.");
  }
}

type DispatchOutcome = "accepted" | "failed" | "expired" | "uncertain";
type Target = Exclude<z.infer<typeof lease>, { skipped: true } | null>;

async function dispatch(target: Target, config: PushConfig, fetcher: typeof fetch): Promise<DispatchOutcome> {
  if (!pushEndpoint(target.endpoint) || !publicPoint(target.p256dh) || !canonicalBase64(target.auth_key, 16)) return "failed";
  const details = generateRequestDetails({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth_key } },
    JSON.stringify({ type: "private-notice-v1" }), { vapidDetails: config, TTL: 60, urgency: "normal" });
  if (details.endpoint !== target.endpoint || details.method !== "POST" || !details.body) return "failed";
  const response = await fetcher(details.endpoint, {
    method: "POST", headers: Object.fromEntries(Object.entries(details.headers).map(([key, value]) => [key, String(value)])),
    body: new Uint8Array(details.body),
    redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  void response.body?.cancel().catch(() => {});
  if (response.status === 201) return "accepted";
  if (response.status === 404 || response.status === 410) return "expired";
  return [400, 401, 403, 413, 429].includes(response.status) ? "failed" : "uncertain";
}

export async function handleWebPushDispatch(request: Request, env: Env, admin: () => RpcClient, fetcher: typeof fetch) {
  const secret = env.NOTIFICATION_DELIVERY_SECRET ?? "";
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secretPattern.test(secret) || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return failure(403, "Accès refusé.");
  const config = webPushConfiguration(env);
  if (!config) return failure(503, "L’envoi des notifications du navigateur est indisponible.");
  if (new URL(request.url).searchParams.size || request.body !== null) return failure(422, "Aucun paramètre attendu.");
  try {
    const db = admin();
    const report = { processed: 0, accepted: 0, failed: 0, uncertain: 0, skipped: 0 };
    for (let count = 0; count < 4; count++) {
      const result = await db.rpc("claim_web_push", { p_scope: config.scope });
      if (result.error) throw new Error("Push claim unavailable");
      const target = lease.parse(result.data);
      if (!target) break;
      report.processed++;
      if ("skipped" in target) { report.skipped++; continue; }
      const outcome = await dispatch(target, config, fetcher).catch(() => "uncertain" as const);
      const saved = await db.rpc("finish_web_push", {
        p_id: target.id, p_lease: target.lease_token, p_outcome: outcome, p_enrollment_version: target.enrollment_version,
      });
      if (saved.error || saved.data !== true) throw new Error("Push outcome unavailable");
      report[outcome === "expired" ? "failed" : outcome]++;
    }
    return Response.json(report, { headers });
  } catch {
    return failure(503, "Le traitement n’a pas pu être vérifié.");
  }
}
