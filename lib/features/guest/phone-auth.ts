import { createHash } from "node:crypto";
import { env } from "node:process";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";
import { ApiError, assertOrigin } from "@/lib/supabase/server";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
class PhoneError extends Error {
  constructor(readonly status: number, readonly retryAfter?: number) { super("PHONE_AUTH"); }
}
function fail(status = 503, retryAfter?: number): never { throw new PhoneError(status, retryAfter); }
export function normalizePhone(raw: string): string | null {
  if (raw.length > 40 || !/^[+\d\s().-]+$/.test(raw)) return null;
  let n = raw.trim().replace(/[\s().-]/g, "");
  if (/^069[67]\d{6}$/.test(n)) n = "+596" + n.slice(1);
  else if (/^0[67]\d{8}$/.test(n)) n = "+33" + n.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}
const authPhone = (phone: unknown) => typeof phone === "string" ? normalizePhone(phone.startsWith("+") ? phone : "+" + phone) : null;
const phone = z.string().max(40).transform((v, ctx) => {
  const n = normalizePhone(v); if (!n) { ctx.addIssue({ code: "custom", message: "phone" }); return z.NEVER; } return n;
});
const startSchema = z.object({ phone, first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), purpose: z.enum(["booking", "lookup"]) }).strict().refine(v => `${v.first_name} ${v.last_name}`.length <= 120);
const verifySchema = z.object({ phone, token: z.string().regex(/^\d{6}$/), kind: z.enum(["sms", "phone_change"]) }).strict();
const upgradeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(10).max(128) }).strict();

/** Warm-process only; provider limits remain authoritative across workers. No plaintext phone/IP is retained. */
export function createWarmLimiter(now = Date.now) {
  const entries = new Map<string, { count: number; until: number }>();
  return (key: string, limit: number, windowMs: number) => {
    const time = now(); for (const [k, e] of entries) if (e.until <= time) entries.delete(k);
    const current = entries.get(key);
    if (current && current.count >= limit) fail(429, Math.max(1, Math.ceil((current.until - time) / 1000)));
    if (!current && entries.size >= 2048) entries.delete(entries.keys().next().value!);
    entries.set(key, current ? { ...current, count: current.count + 1 } : { count: 1, until: time + windowMs });
  };
}
const warmLimit = createWarmLimiter();
function limit(request: Request, op: "start" | "verify" | "upgrade", subject: string) {
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  warmLimit(hash(`${op}:${subject}`), op === "start" ? 1 : op === "verify" ? 8 : 3, op === "start" ? 60000 : op === "verify" ? 600000 : 3600000);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip && ip.length <= 64 && /^[0-9a-f:.]+$/i.test(ip)) warmLimit(hash(`${op}:ip:${ip}`), op === "verify" ? 60 : 20, 60000);
}

async function context() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) fail();
  const store = await cookies();
  const writes = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const hadCookie = store.getAll().some(c => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  const db = createServerClient(url!, key!, { cookies: { getAll: () => store.getAll(), setAll: values => { for (const c of values) writes.set(c.name, c); } } });
  return { db, hadCookie, commit: () => { for (const c of writes.values()) store.set(c.name, c.value, c.options); } };
}
type Context = Awaited<ReturnType<typeof context>>;
function checkedUser(v: unknown): User {
  if (!object(v) || typeof v.id !== "string" || !ID.test(v.id) || (v.phone != null && typeof v.phone !== "string") || (v.email != null && typeof v.email !== "string")) fail();
  return v as unknown as User;
}
async function current(ctx: Context): Promise<User | null> {
  const r = await ctx.db.auth.getUser();
  if (!object(r) || !object(r.data)) fail();
  if (r.error) {
    if (!ctx.hadCookie && r.data.user === null && r.error.name === "AuthSessionMissingError") return null;
    fail();
  }
  if (r.error !== null) fail();
  if (r.data.user === null && !ctx.hadCookie) return null;
  return checkedUser(r.data.user);
}
async function role(ctx: Context, user: User): Promise<string> {
  const r = await ctx.db.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
  if (r.error || !object(r.data) || r.data.id !== user.id || typeof r.data.role !== "string" || !["client", "artisan", "manager", "admin"].includes(r.data.role)) fail();
  return r.data.role;
}
async function clientRole(ctx: Context, user: User) { if (await role(ctx, user) !== "client") fail(409); }
const confirmed = (user: User, expected?: string) => {
  const n = authPhone(user.phone);
  return n !== null && (!expected || n === expected) && typeof user.phone_confirmed_at === "string" && Number.isFinite(Date.parse(user.phone_confirmed_at));
};
const emailAccount = (user: User) => !!(user.email?.trim() || (object(user) && typeof user.new_email === "string" && user.new_email.trim()));
function providerError(error: unknown, operation: "start" | "verify" | "upgrade", lookup = false): "unknown_lookup" | never {
  const e = object(error) ? error : {}, status = e.status, code = typeof e.code === "string" ? e.code : "";
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status >= 500) fail();
  if (status === 429 || ["over_request_rate_limit", "over_sms_send_rate_limit", "over_email_send_rate_limit"].includes(code)) fail(429, 60);
  if (operation === "start" && lookup && ["user_not_found", "otp_disabled", "signup_disabled"].includes(code)) return "unknown_lookup";
  if (operation === "verify" && ["otp_expired", "invalid_credentials", "validation_failed"].includes(code)) fail(422);
  if (operation === "upgrade" && ["email_exists", "user_already_exists", "identity_already_exists"].includes(code)) fail(409);
  if (operation === "upgrade" && ["weak_password", "email_address_invalid", "validation_failed"].includes(code)) fail(422);
  fail();
}
async function input<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (Number(request.headers.get("content-length") || 0) > 4096) fail(413);
  const text = await request.text(); if (text.length > 4096) fail(413);
  let raw; try { raw = JSON.parse(text); } catch { fail(400); }
  const r = schema.safeParse(raw); if (!r.success) fail(422); return r.data;
}
async function start(request: Request, ctx: Context, data: z.output<typeof startSchema>) {
  const user = await current(ctx);
  let kind: "sms" | "phone_change" = "sms";
  if (user) {
    await clientRole(ctx, user);
    if (confirmed(user, data.phone)) return { status: "verified" };
    kind = "phone_change";
  }
  limit(request, "start", data.phone);
  if (user) {
    const r = await ctx.db.auth.updateUser({ phone: data.phone });
    if (r.error) providerError(r.error, "start");
    if (r.error !== null || !r.data || checkedUser(r.data.user).id !== user.id) fail();
  } else {
    const r = await ctx.db.auth.signInWithOtp({ phone: data.phone, options: { channel: "sms", shouldCreateUser: data.purpose === "booking", ...(data.purpose === "booking" ? { data: { role: "client", full_name: `${data.first_name} ${data.last_name}`, first_name: data.first_name, last_name: data.last_name } } : {}) } });
    if (r.error) { if (!r.data || r.data.user !== null || r.data.session !== null) fail(); providerError(r.error, "start", data.purpose === "lookup"); }
    else if (r.error !== null || !r.data || r.data.user !== null || r.data.session !== null) fail();
  }
  return { status: "code_requested", kind, retry_after: 60, phone_suffix: data.phone.slice(-4) };
}
async function verify(request: Request, ctx: Context, data: z.output<typeof verifySchema>) {
  const before = await current(ctx);
  if (data.kind === "sms" && before) fail(409);
  if (data.kind === "phone_change" && !before) fail(401);
  if (before) await clientRole(ctx, before);
  limit(request, "verify", data.phone);
  const r = await ctx.db.auth.verifyOtp({ phone: data.phone, token: data.token, type: data.kind });
  if (r.error) providerError(r.error, "verify");
  if (r.error !== null || !r.data) fail();
  const returned = checkedUser(r.data.user);
  if (before && returned.id !== before.id) fail(409);
  if (data.kind === "sms" && !r.data.session) fail();
  const session = r.data.session;
  if (session && (session.user?.id !== returned.id || typeof session.access_token !== "string" || !session.access_token || typeof session.refresh_token !== "string" || !session.refresh_token || session.token_type !== "bearer" || !Number.isSafeInteger(session.expires_in) || session.expires_in <= 0)) fail();
  const after = await current(ctx);
  if (!after || after.id !== returned.id || (before && after.id !== before.id) || !confirmed(after, data.phone)) fail();
  await clientRole(ctx, after);
  return { verified: true };
}
async function session(ctx: Context) {
  const user = await current(ctx);
  if (!user) return { authenticated: false, verified_phone: false, phone_suffix: null, role: null, email_account: false };
  const r = await role(ctx, user), phone = authPhone(user.phone);
  return { authenticated: true, verified_phone: confirmed(user), phone_suffix: phone?.slice(-4) ?? null, role: r, email_account: emailAccount(user) };
}
async function upgrade(request: Request, ctx: Context, data: z.output<typeof upgradeSchema>) {
  const user = await current(ctx);
  if (!user) fail(401); await clientRole(ctx, user!);
  if (!confirmed(user!)) fail(403);
  if (emailAccount(user!)) fail(409);
  limit(request, "upgrade", user!.id);
  const r = await ctx.db.auth.updateUser({ email: data.email, password: data.password }, { emailRedirectTo: new URL("/auth/confirm", request.url).href });
  if (r.error) providerError(r.error, "upgrade");
  if (r.error !== null || !r.data) fail();
  const returned = checkedUser(r.data.user);
  if (returned.id !== user!.id) fail(409);
  const after = await current(ctx);
  if (!after || after.id !== user!.id || !confirmed(after, authPhone(user!.phone) ?? undefined)) fail(); await clientRole(ctx, after);
  // A provider-obfuscated success is not evidence that this email upgrade was requested.
  const target = (returned.email || (object(returned) && typeof returned.new_email === "string" ? returned.new_email : "")).toLowerCase();
  if (target !== data.email) fail();
  return { confirmation_required: true };
}
export async function phoneRoute(operation: "start" | "verify" | "session" | "upgrade", request: Request): Promise<Response> {
  try {
    assertOrigin(request);
    if (new URL(request.url).searchParams.size) fail(422);
    // Validate before the SDK is even constructed (including a possible session refresh).
    const parsed = operation === "start" ? await input(request, startSchema) : operation === "verify" ? await input(request, verifySchema) : operation === "upgrade" ? await input(request, upgradeSchema) : null;
    const ctx = await context();
    const body = operation === "start" ? await start(request, ctx, parsed as z.output<typeof startSchema>) : operation === "verify" ? await verify(request, ctx, parsed as z.output<typeof verifySchema>) : operation === "upgrade" ? await upgrade(request, ctx, parsed as z.output<typeof upgradeSchema>) : await session(ctx);
    ctx.commit();
    return Response.json(body, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof PhoneError || error instanceof ApiError ? error.status : 503;
    const messages: Record<number, string> = { 400: "Le contenu envoyé est invalide.", 401: "Vérifiez votre accès téléphone pour continuer.", 403: "Cette action n’est pas autorisée.", 409: "Utilisez votre espace compte pour poursuivre cette action.", 413: "Le contenu envoyé est trop volumineux.", 422: "Vérifiez les informations ou le code saisi.", 429: "Trop de tentatives. Patientez avant de réessayer.", 503: "Le service de vérification est momentanément indisponible. Réessayez." };
    return Response.json({ error: messages[status] ?? messages[503] }, { status: messages[status] ? status : 503, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : status === 429 ? { "Retry-After": String(error instanceof PhoneError ? error.retryAfter ?? 60 : 60) } : {}) } });
  }
}
