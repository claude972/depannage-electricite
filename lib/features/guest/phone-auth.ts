import { createHash } from "node:crypto";
import { env } from "node:process";
import { TextDecoder } from "node:util";
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
function normalizedPhone(raw: string, martiniqueLandline: boolean): string | null {
  if (raw.length > 40 || !/^[+\d\s().-]+$/.test(raw)) return null;
  let n = raw.trim().replace(/[\s().-]/g, "");
  if (/^069[67]\d{6}$/.test(n) || (martiniqueLandline && /^059[67]\d{6}$/.test(n))) n = "+596" + n.slice(1);
  else if (/^0[67]\d{8}$/.test(n)) n = "+33" + n.slice(1);
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}
export const normalizePhone = (raw: string) => normalizedPhone(raw, false);
export const normalizeCallbackPhone = (raw: string) => normalizedPhone(raw, true);
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
  const reader = request.body?.getReader(); if (!reader) fail(400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { void reader.cancel().catch(() => {}); fail(413); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let raw; try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail(400); }
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
export async function phoneRoute(operation: "start" | "verify" | "session" | "upgrade" | "history", request: Request): Promise<Response> {
  try {
    assertOrigin(request);
    if (operation !== "history" && new URL(request.url).searchParams.size) fail(422);
    // Validate before the SDK is even constructed (including a possible session refresh).
    const parsed = operation === "start" ? await input(request, startSchema) : operation === "verify" ? await input(request, verifySchema) : operation === "upgrade" ? await input(request, upgradeSchema) : null;
    const ctx = await context();
    const body = operation === "start" ? await start(request, ctx, parsed as z.output<typeof startSchema>) : operation === "verify" ? await verify(request, ctx, parsed as z.output<typeof verifySchema>) : operation === "upgrade" ? await upgrade(request, ctx, parsed as z.output<typeof upgradeSchema>) : operation === "history" ? await history(ctx, request) : await session(ctx);
    ctx.commit();
    return Response.json(body, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof PhoneError || error instanceof ApiError ? error.status : 503;
    const messages: Record<number, string> = { 400: "Le contenu envoyé est invalide.", 401: "Vérifiez votre accès téléphone pour continuer.", 403: "Cette action n’est pas autorisée.", 409: "Utilisez votre espace compte pour poursuivre cette action.", 413: "Le contenu envoyé est trop volumineux.", 422: "Vérifiez les informations ou le code saisi.", 429: "Trop de tentatives. Patientez avant de réessayer.", 503: "Le service de vérification est momentanément indisponible. Réessayez." };
    return Response.json({ error: messages[status] ?? messages[503] }, { status: messages[status] ? status : 503, headers: { ...HEADERS, ...(status === 503 ? { "Retry-After": "2" } : status === 429 ? { "Retry-After": String(error instanceof PhoneError ? error.retryAfter ?? 60 : 60) } : {}) } });
  }
}

const HISTORY_FIELDS = "id,category,status,city,created_at,estimate_min_cents,estimate_max_cents";
const historyTimestamp = z.iso.datetime({ offset: true }).max(40).refine(v => !/\.\d{7}/.test(v) && Number.isFinite(Date.parse(v)));
const historyCursor = z.object({ v: z.literal(1), user_id: z.uuid(), phone_scope: z.string().regex(/^[a-f0-9]{64}$/), created_at: historyTimestamp, id: z.uuid() }).strict();
const historyRow = z.object({ id: z.uuid(), category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]), status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]), city: z.string().min(2).max(120), created_at: historyTimestamp, estimate_min_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), estimate_max_cents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict();
export function phoneHistoryQuery(url: string, userId: string, verifiedPhone: string) {
  const params = new URL(url).searchParams;
  if (url.length > 4096) fail(422);
  for (const key of params.keys()) if (!["limit", "cursor"].includes(key) || params.getAll(key).length !== 1) fail(422);
  const text = params.get("limit") ?? "25";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(text)) fail(422);
  const scope = createHash("sha256").update(userId.toLowerCase() + "\0" + verifiedPhone).digest("hex");
  let cursor: z.output<typeof historyCursor> | null = null;
  if (params.has("cursor")) {
    const raw = params.get("cursor")!;
    if (!raw || raw.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(raw)) fail(422);
    try {
      const bytes = Buffer.from(raw, "base64url");
      if (bytes.toString("base64url") !== raw) fail(422);
      const parsed = historyCursor.safeParse(JSON.parse(bytes.toString("utf8")));
      if (!parsed.success || parsed.data.user_id !== userId.toLowerCase() || parsed.data.phone_scope !== scope) fail(422);
      cursor = parsed.data;
    } catch { fail(422); }
  }
  return { userId, scope, limit: Number(text), cursor };
}
// Preserve PostgreSQL's fractional microseconds: Date alone rounds keyset boundaries to ms.
const historyMicros = (s: string) => BigInt(Date.parse(s)) * 1000n + BigInt((/\.(\d{1,6})(?:Z|[+-]\d\d:\d\d)$/.exec(s)?.[1] ?? "").slice(3).padEnd(3, "0") || "0");
const historyBefore = (a: { created_at: string; id: string }, b: { created_at: string; id: string }) => historyMicros(a.created_at) < historyMicros(b.created_at) || (historyMicros(a.created_at) === historyMicros(b.created_at) && a.id.toLowerCase() < b.id.toLowerCase());
async function history(ctx: Context, request: Request) {
  const user = await current(ctx); if (!user) fail(401);
  await clientRole(ctx, user); const phone = authPhone(user.phone);
  if (!phone || !confirmed(user)) fail(403);
  const q = phoneHistoryQuery(request.url, user.id, phone);
  let query = ctx.db.from("interventions").select(HISTORY_FIELDS, { count: "exact" }).eq("client_id", user.id);
  if (q.cursor) query = query.or(`created_at.lt."${q.cursor.created_at}",and(created_at.eq."${q.cursor.created_at}",id.lt.${q.cursor.id})`);
  const r = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(q.limit + 1);
  if (r.error) fail();
  const count = r.count;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || !Array.isArray(r.data) || r.data.length !== Math.min(count, q.limit + 1)) fail();
  const parsed = z.array(historyRow).max(q.limit + 1).safeParse(r.data);
  if (!parsed.success || new Set(parsed.data.map(row => row.id)).size !== parsed.data.length || parsed.data.some((row, i) => row.estimate_max_cents < row.estimate_min_cents || (i > 0 && !historyBefore(row, parsed.data[i - 1])) || (q.cursor !== null && !historyBefore(row, q.cursor)))) fail();
  const interventions = parsed.data.slice(0, q.limit), hasMore = parsed.data.length > q.limit, last = interventions.at(-1);
  const next = hasMore && last ? Buffer.from(JSON.stringify({ v: 1, user_id: user.id.toLowerCase(), phone_scope: q.scope, created_at: last.created_at, id: last.id })).toString("base64url") : null;
  return { interventions, page: { limit: q.limit, has_more: hasMore, next_cursor: next } };
}
