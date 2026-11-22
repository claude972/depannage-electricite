// Compatibility with the native builds already delivered (builds ≤ 12), and nothing else.
// The website has no SMS code any more: its account is an e-mail address and a password, confirmed
// by a link. These three operations stay because a delivered binary cannot be changed:
//   POST /api/auth/phone/start          asks the provider to send the code (anonymous)
//   POST /api/auth/phone/native/verify  returns the session to the application (no cookie)
//   GET  /api/auth/phone/history        bearer token only (builds ≤ 11)
// A browser is refused on all three (see `fromBrowser`). SMS *notifications* are another subject
// (lib/features/notifications) and do not go through this file.
import { createHash } from "node:crypto";
import { env } from "node:process";
import { TextDecoder } from "node:util";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { ApiError, assertOrigin, authenticatedClient } from "@/lib/supabase/server";
import { normalizePhone } from "./phone-number";
import { testSmsRecipients } from "./test-sms-recipients";

const HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
class PhoneError extends Error {
  constructor(readonly status: number, readonly retryAfter?: number) { super("PHONE_AUTH"); }
}
function fail(status = 503, retryAfter?: number): never { throw new PhoneError(status, retryAfter); }
const authPhone = (phone: unknown) => typeof phone === "string" ? normalizePhone(phone.startsWith("+") ? phone : "+" + phone) : null;
const phone = z.string().max(40).transform((v, ctx) => {
  const n = normalizePhone(v); if (!n) { ctx.addIssue({ code: "custom", message: "phone" }); return z.NEVER; } return n;
});
const startSchema = z.object({ phone, first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), purpose: z.enum(["booking", "lookup"]) }).strict().refine(v => `${v.first_name} ${v.last_name}`.length <= 120);
const verifySchema = z.object({ phone, token: z.string().regex(/^\d{6}$/), kind: z.literal("sms") }).strict();

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
function limit(request: Request, op: "start" | "verify", subject: string) {
  const hash = (v: string) => createHash("sha256").update(v).digest("hex");
  warmLimit(hash(`${op}:${subject}`), op === "start" ? 1 : 8, op === "start" ? 60000 : 600000);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip && ip.length <= 64 && /^[0-9a-f:.]+$/i.test(ip)) warmLimit(hash(`${op}:ip:${ip}`), op === "verify" ? 60 : 20, 60000);
}

function context() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) fail();
  // No cookie is read and none is written: the session lives in this request only.
  return { db: createServerClient(url!, key!, { cookies: { getAll: () => [], setAll: () => {} } }) };
}
type Context = ReturnType<typeof context>;
function checkedUser(v: unknown): User {
  if (!object(v) || typeof v.id !== "string" || !ID.test(v.id) || (v.phone != null && typeof v.phone !== "string") || (v.email != null && typeof v.email !== "string")) fail();
  return v as unknown as User;
}
async function current(ctx: Context): Promise<User> {
  const r = await ctx.db.auth.getUser();
  if (!object(r) || !object(r.data) || r.error !== null) fail();
  return checkedUser(r.data.user);
}
async function role(ctx: Pick<Context, "db">, user: User): Promise<string> {
  const r = await ctx.db.from("profiles").select("id,role").eq("id", user.id).maybeSingle();
  if (r.error || !object(r.data) || r.data.id !== user.id || typeof r.data.role !== "string" || !["client", "artisan", "manager", "admin"].includes(r.data.role)) fail();
  return r.data.role;
}
async function clientRole(ctx: Pick<Context, "db">, user: User) { if (await role(ctx, user) !== "client") fail(409); }
const confirmed = (user: User, expected?: string) => {
  const n = authPhone(user.phone);
  return n !== null && (!expected || n === expected) && typeof user.phone_confirmed_at === "string" && Number.isFinite(Date.parse(user.phone_confirmed_at));
};
function providerError(error: unknown, operation: "start" | "verify", lookup = false): "unknown_lookup" | never {
  const e = object(error) ? error : {}, status = e.status, code = typeof e.code === "string" ? e.code : "";
  if (typeof status !== "number" || !Number.isInteger(status) || status < 400 || status >= 500) fail();
  if (status === 429 || ["over_request_rate_limit", "over_sms_send_rate_limit", "over_email_send_rate_limit"].includes(code)) fail(429, 60);
  if (operation === "start" && lookup && ["user_not_found", "otp_disabled", "signup_disabled"].includes(code)) return "unknown_lookup";
  if (operation === "verify" && ["otp_expired", "invalid_credentials", "validation_failed"].includes(code)) fail(422);
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
  limit(request, "start", data.phone);
  const r = await ctx.db.auth.signInWithOtp({ phone: data.phone, options: { channel: "sms", shouldCreateUser: data.purpose === "booking", ...(data.purpose === "booking" ? { data: { role: "client", full_name: `${data.first_name} ${data.last_name}`, first_name: data.first_name, last_name: data.last_name } } : {}) } });
  if (r.error) { if (!r.data || r.data.user !== null || r.data.session !== null) fail(); providerError(r.error, "start", data.purpose === "lookup"); }
  else if (r.error !== null || !r.data || r.data.user !== null || r.data.session !== null) fail();
  return { status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: data.phone.slice(-4) };
}
async function verify(request: Request, ctx: Context, data: z.output<typeof verifySchema>) {
  limit(request, "verify", data.phone);
  const r = await ctx.db.auth.verifyOtp({ phone: data.phone, token: data.token, type: "sms" });
  if (r.error) providerError(r.error, "verify");
  if (r.error !== null || !r.data) fail();
  const returned = checkedUser(r.data.user);
  const session = r.data.session;
  if (!session || session.user?.id !== returned.id || typeof session.access_token !== "string" || !session.access_token || typeof session.refresh_token !== "string" || !session.refresh_token || session.token_type !== "bearer" || !Number.isSafeInteger(session.expires_in) || session.expires_in <= 0) fail();
  const after = await current(ctx);
  if (after.id !== returned.id || !confirmed(after, data.phone)) fail();
  await clientRole(ctx, after);
  // The session goes back to the application in the body. No cookie is ever written by this file.
  return { verified: true, session: { access_token: session!.access_token, refresh_token: session!.refresh_token } };
}
/** A browser names itself on these requests (Origin on a POST, Sec-Fetch-Site, its cookies); the
 *  native HTTP client sends none of them. The website therefore cannot reach the SMS code. */
const fromBrowser = (request: Request) => ["origin", "cookie", "sec-fetch-site"].some(name => request.headers.has(name));
export async function nativePhoneRoute(operation: "start" | "verify" | "history", request: Request): Promise<Response> {
  try {
    assertOrigin(request);
    if (fromBrowser(request)) fail(410);
    if (operation === "history") {
      if (!request.headers.has("authorization")) fail(401);
      const { db, user } = await authenticatedClient(request);
      return Response.json(await history({ db }, request, user), { headers: HEADERS });
    }
    if (new URL(request.url).searchParams.size) fail(422);
    if (request.headers.has("authorization")) fail(409);
    // Validate before the SDK is even constructed.
    const parsed = operation === "start" ? await input(request, startSchema) : await input(request, verifySchema);
    const recipients = testSmsRecipients(env);
    if (recipients?.length === 0) fail();
    if (recipients && !recipients.includes(parsed.phone)) fail(403);
    const ctx = context();
    const body = operation === "start" ? await start(request, ctx, parsed as z.output<typeof startSchema>)
      : await verify(request, ctx, parsed as z.output<typeof verifySchema>);
    return Response.json(body, { headers: HEADERS });
  } catch (error) {
    const status = error instanceof PhoneError || error instanceof ApiError ? error.status : 503;
    const messages: Record<number, string> = { 400: "Le contenu envoyé est invalide.", 401: "Vérifiez votre accès téléphone pour continuer.", 403: "Cette action n’est pas autorisée.", 409: "Utilisez votre espace compte pour poursuivre cette action.", 410: "La vérification par SMS n’existe plus sur le site. Connectez-vous avec votre adresse e-mail et votre mot de passe.", 413: "Le contenu envoyé est trop volumineux.", 422: "Vérifiez les informations ou le code saisi.", 429: "Trop de tentatives. Patientez avant de réessayer.", 503: "Le service de vérification est momentanément indisponible. Réessayez." };
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
async function history(ctx: Pick<Context, "db">, request: Request, user: User) {
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
