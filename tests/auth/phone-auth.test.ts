import test from "node:test";
import assert from "node:assert/strict";
import { createServerClient as realServerClient } from "@supabase/ssr";
import { loadModule, ApiError } from "../documents/harness";

const ID = "10000000-0000-4000-8000-000000000001", OTHER = "20000000-0000-4000-8000-000000000002";
const ORIGIN = "https://preview.example.test", PHONE = "+596696123456";
const user = (over: Record<string, unknown> = {}) => ({ id: ID, phone: "596696123456", phone_confirmed_at: "2026-11-01T00:00:00Z", email: "", ...over });
const native = (u = user()) => ({ error: null, data: { user: u, session: { user: u, access_token: "OPAQUE_ACCESS", refresh_token: "OPAQUE_REFRESH", token_type: "bearer", expires_in: 3600 } } });
const anonymous = { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } };
const started = { error: null, data: { user: null, session: null } };
const startBody = { phone: "0696 12 34 56", first_name: "QA", last_name: "Essai", purpose: "booking" };
const verifyBody = { phone: PHONE, token: "123456", kind: "sms" };
type Operation = "start" | "verify" | "session" | "upgrade" | "history";
function fixture(op: Operation, options: { users?: unknown[]; profileRole?: string; profileId?: string; profileError?: boolean; cookie?: boolean; otp?: unknown; verify?: unknown; update?: unknown; transport?: boolean; historyRows?: unknown; historyError?: boolean; historyCount?: unknown; historyCap?: number } = {}) {
  let sdkOptions: any, index = 0, created = 0;
  const calls: { op: string; value?: any; extra?: any }[] = [], written: unknown[] = [];
  const nextUser = () => (options.users ?? [anonymous])[Math.min(index++, (options.users ?? [anonymous]).length - 1)];
  const queue = () => sdkOptions.cookies.setAll([{ name: "sb-fake-auth-token", value: "NEVER_RETURN_SESSION", options: { httpOnly: true } }]);
  const db = { auth: {
    getUser: async () => { calls.push({ op: "getUser" }); return nextUser(); },
    signInWithOtp: async (value: unknown) => { calls.push({ op: "otp", value }); if (options.transport) throw Error("PRIVATE_PHONE_OR_TOKEN"); return options.otp ?? started; },
    verifyOtp: async (value: unknown) => { calls.push({ op: "verify", value }); queue(); if (options.transport) throw Error("PRIVATE_PHONE_OR_TOKEN"); return options.verify ?? native(); },
    updateUser: async (value: unknown, extra: unknown) => { calls.push({ op: "update", value, extra }); queue(); if (options.transport) throw Error("PRIVATE_PHONE_OR_TOKEN"); return options.update ?? { error: null, data: { user: user() } }; },
  }, from: (table: string) => {
    if (table === "interventions") {
      const state: any = { table, orders: [] };
      const query: any = { select: (columns: string, settings: unknown) => { state.columns = columns; state.settings = settings; return query; }, eq: (key: string, value: string) => { state.eq = { key, value }; return query; }, or: (value: string) => { state.or = value; return query; }, order: (key: string, value: unknown) => { state.orders.push({ key, value }); return query; }, limit: async (n: number) => {
        state.limit = n; calls.push({ op: "history", value: state });
        let rows: any = options.historyRows ?? []; let exactCount: number | null = null;
        if (Array.isArray(rows)) {
          rows = [...rows].sort((a, b) => a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1);
          if (state.or) { const m = /created_at.lt."([^"]+)",and\(created_at.eq."[^"]+",id.lt.([a-f0-9-]+)\)/.exec(state.or)!; rows = rows.filter((r: any) => r.created_at < m[1] || (r.created_at === m[1] && r.id < m[2])); }
          exactCount = rows.length; rows = rows.slice(0, Math.min(n, options.historyCap ?? n));
        }
        return { data: rows, count: Object.hasOwn(options, "historyCount") ? options.historyCount : exactCount, error: options.historyError ? { code: "unavailable" } : null };
      } }; return query;
    }
    return { select: (columns: string) => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => { calls.push({ op: "profile", value: { table, columns, id } }); return { error: options.profileError ? { code: "broken" } : null, data: { id: options.profileId ?? id, role: options.profileRole ?? "client" } }; } }) }) };
  } };
  const module = loadModule(`app/api/auth/phone/${op}/route.ts`, {
    "node:process": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "FAKE_PUBLIC_KEY" } },
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, config: unknown) => { created++; sdkOptions = config; return db; } },
    "next/headers": { cookies: async () => ({ getAll: () => options.cookie ? [{ name: "sb-fake-auth-token", value: "OLD_COOKIE" }] : [], set: (...value: unknown[]) => written.push(value) }) },
    "@/lib/supabase/server": { ApiError, assertOrigin: (request: Request) => { const o = request.headers.get("origin"); if (o && o !== new URL(request.url).origin) throw new ApiError(403, "ORIGIN"); } },
  });
  const request = (body?: unknown, headers: Record<string, string> = {}, suffix = "") => (module[(op === "session" || op === "history") ? "GET" : "POST"] as (r: Request) => Promise<Response>)(new Request(`${ORIGIN}/api/auth/phone/${op}${suffix}`, { method: (op === "session" || op === "history") ? "GET" : "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, ...((op === "session" || op === "history") ? {} : { body: JSON.stringify(body) }) }));
  return { request, calls, written, created: () => created, raw: (r: Request) => (module[op === "session" || op === "history" ? "GET" : "POST"] as (request: Request) => Promise<Response>)(r) };
}
async function result(response: Response, status: number) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const raw = await response.text(); assert.doesNotMatch(raw, /OPAQUE_|NEVER_RETURN|OLD_COOKIE|PRIVATE_PHONE_OR_TOKEN/); return JSON.parse(raw);
}

test("phone normalization: Martinique before metropolitan prefix, E164 and invalid inputs", () => {
  const m = loadModule("lib/features/guest/phone-auth.ts", { "node:process": { env: {} } });
  const normalize = m.normalizePhone as (s: string) => string | null;
  for (const [raw, expected] of [["0696 12 34 56", PHONE], ["0697123456", "+596697123456"], ["0612345678", "+33612345678"], ["0712345678", "+33712345678"], ["+1 (202) 555-0100", "+12025550100"]]) assert.equal(normalize(raw), expected);
  for (const raw of ["", "foo", "+0001234567", "06961234", "1234567890", "+1234567890123456", "+33/612345678"]) assert.equal(normalize(raw), null);
});

test("start: anonymous booking creates only OTP client identity metadata, never session/job", async () => {
  const f = fixture("start"); const b = await result(await f.request(startBody), 200);
  assert.deepEqual(b, { status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" });
  const otp = f.calls.find(c => c.op === "otp")!;
  assert.equal(otp.value.phone, PHONE); assert.equal(otp.value.options.shouldCreateUser, true); assert.equal(otp.value.options.data.role, "client"); assert.equal(otp.value.options.data.full_name, "QA Essai"); assert.equal(f.written.length, 0);
});

test("lookup unknown is uniform, never creates user and makes no SMS delivery claim", async () => {
  const known = fixture("start"), missing = fixture("start", { otp: { error: { status: 400, code: "otp_disabled", message: "PRIVATE_PHONE_OR_TOKEN" }, data: { user: null, session: null } } });
  const a = await result(await known.request({ ...startBody, purpose: "lookup" }), 200), b = await result(await missing.request({ ...startBody, first_name: "Autre", purpose: "lookup" }), 200);
  assert.deepEqual(a, b); assert.doesNotMatch(JSON.stringify(a), /envoy|sent|delivered/);
  for (const f of [known, missing]) { const otp = f.calls.find(c => c.op === "otp")!; assert.equal(otp.value.options.shouldCreateUser, false); assert.equal(otp.value.options.data, undefined); }
});

test("existing client phone_change retains UID; already verified same phone skips provider", async () => {
  const same = fixture("start", { users: [{ data: { user: user() }, error: null }], cookie: true });
  assert.deepEqual(await result(await same.request(startBody), 200), { status: "verified" }); assert.equal(same.calls.some(c => c.op === "update" || c.op === "otp"), false);
  const change = fixture("start", { users: [{ data: { user: user({ phone: "33612345678" }) }, error: null }], cookie: true });
  assert.equal((await result(await change.request(startBody), 200)).kind, "phone_change"); assert.equal(JSON.stringify(change.calls.find(c => c.op === "update")!.value), JSON.stringify({ phone: PHONE }));
  for (const role of ["artisan", "manager", "admin"]) { const f = fixture("start", { users: [{ data: { user: user() }, error: null }], profileRole: role }); await result(await f.request(startBody), 409); assert.equal(f.calls.some(c => ["update", "otp"].includes(c.op)), false); assert.equal(f.written.length, 0); }
});

test("verify SMS: cookies commit only after getUser + exact confirmed phone + client profile", async () => {
  const f = fixture("verify", { users: [anonymous, { data: { user: user() }, error: null }] });
  assert.deepEqual(await result(await f.request(verifyBody), 200), { verified: true }); assert.equal(f.written.length, 1); assert.equal(f.calls.filter(c => c.op === "getUser").length, 2);
  const call = f.calls.find(c => c.op === "verify")!; assert.equal(JSON.stringify(call.value), JSON.stringify({ phone: PHONE, token: "123456", type: "sms" }));
  for (const options of [
    { users: [anonymous, { data: { user: user({ phone: "33612345678" }) }, error: null }] },
    { users: [anonymous, { data: { user: user({ phone_confirmed_at: null }) }, error: null }] },
    { users: [anonymous, { data: { user: user({ id: OTHER }) }, error: null }] },
    { users: [anonymous, { data: { user: user() }, error: null }], profileId: OTHER },
    { users: [anonymous, { data: { user: user() }, error: null }], profileError: true },
  ]) { const bad = fixture("verify", options); await result(await bad.request(verifyBody), 503); assert.equal(bad.written.length, 0); }
  const professional = fixture("verify", { users: [anonymous, { data: { user: user() }, error: null }], profileRole: "artisan" }); await result(await professional.request(verifyBody), 409); assert.equal(professional.written.length, 0);
});

test("verify kind/session binding: no silent replacement; phone_change UID stays identical", async () => {
  const active = { data: { user: user({ phone: "33612345678" }) }, error: null }, after = { data: { user: user() }, error: null };
  const good = fixture("verify", { users: [active, after], cookie: true, verify: { error: null, data: { user: user(), session: null } } }); await result(await good.request({ ...verifyBody, kind: "phone_change" }), 200); assert.equal(good.written.length, 1);
  const foreign = fixture("verify", { users: [active], verify: native(user({ id: OTHER })) }); await result(await foreign.request({ ...verifyBody, kind: "phone_change" }), 409); assert.equal(foreign.written.length, 0);
  const smsActive = fixture("verify", { users: [active] }); await result(await smsActive.request(verifyBody), 409); assert.equal(smsActive.calls.some(c => c.op === "verify"), false);
  const changeNoSession = fixture("verify"); await result(await changeNoSession.request({ ...verifyBody, kind: "phone_change" }), 401); assert.equal(changeNoSession.calls.some(c => c.op === "verify"), false);
});

test("wrong OTP422, provider503, rate429 and transport are neutral and never commit cookies", async () => {
  for (const [error, expected] of [[{ status: 403, code: "otp_expired" }, 422], [{ status: 429, code: "over_sms_send_rate_limit" }, 429], [{ status: 503, code: "unexpected_failure" }, 503], [{ status: 400, code: "untrusted_private_code" }, 503]] as const) {
    const f = fixture("verify", { verify: { data: { user: null, session: null }, error: { ...error, message: "PRIVATE_PHONE_OR_TOKEN" } } }); const r = await f.request(verifyBody); await result(r, expected); if (expected === 503 || expected === 429) assert.equal(r.headers.get("retry-after"), expected === 503 ? "2" : "60"); assert.equal(f.written.length, 0);
  }
  const unavailable = fixture("start", { otp: { data: { user: null, session: null }, error: { status: 400, code: "phone_provider_disabled" } } }); await result(await unavailable.request({ ...startBody, purpose: "lookup" }), 503);
  const transport = fixture("verify", { transport: true }); await result(await transport.request(verifyBody), 503); assert.equal(transport.written.length, 0);
  const limited = fixture("start"); await result(await limited.request(startBody), 200); const retry = await limited.request(startBody); await result(retry, 429); assert.ok(Number(retry.headers.get("retry-after")) > 0);
});

test("session returns only caller status; GET with stale/unknown authority stays unavailable", async () => {
  const no = fixture("session"); assert.deepEqual(await result(await no.request(), 200), { authenticated: false, verified_phone: false, phone_suffix: null, role: null, email_account: false });
  const yes = fixture("session", { users: [{ data: { user: user({ email: "private@example.test" }) }, error: null }] }); const b = await result(await yes.request(), 200); assert.deepEqual(b, { authenticated: true, verified_phone: true, phone_suffix: "3456", role: "client", email_account: true }); assert.doesNotMatch(JSON.stringify(b), /private@example|596696|10000000/);
  const stale = fixture("session", { cookie: true }); await result(await stale.request(), 503);
});

test("upgrade attaches email/password to same verified phone UID only, requires email confirmation", async () => {
  const u = user(), upgraded = user({ new_email: "qa@example.test" }), active = { data: { user: u }, error: null };
  const f = fixture("upgrade", { users: [active, { data: { user: upgraded }, error: null }], update: { error: null, data: { user: upgraded } } });
  assert.deepEqual(await result(await f.request({ email: "QA@example.test", password: "FictitiousPassword42!" }), 200), { confirmation_required: true });
  const update = f.calls.find(c => c.op === "update")!; assert.equal(JSON.stringify(update.value), JSON.stringify({ email: "qa@example.test", password: "FictitiousPassword42!" })); assert.equal(update.extra.emailRedirectTo, ORIGIN + "/auth/confirm"); assert.equal(f.written.length, 1);
  for (const existing of [user({ email: "existing@example.test" }), user({ new_email: "pending@example.test" })]) { const x = fixture("upgrade", { users: [{ data: { user: existing }, error: null }] }); await result(await x.request({ email: "qa@example.test", password: "FictitiousPassword42!" }), 409); assert.equal(x.calls.some(c => c.op === "update"), false); }
  const conflict = fixture("upgrade", { users: [active], update: { data: { user: null }, error: { status: 422, code: "email_exists" } } }); await result(await conflict.request({ email: "qa@example.test", password: "FictitiousPassword42!" }), 409); assert.equal(conflict.written.length, 0);
  const wrongIdentity = fixture("upgrade", { users: [active], update: { data: { user: user({ id: OTHER, new_email: "qa@example.test" }) }, error: null } }); await result(await wrongIdentity.request({ email: "qa@example.test", password: "FictitiousPassword42!" }), 409); assert.equal(wrongIdentity.written.length, 0);
});

test("strict bodies/origin/limits reject before constructing SDK; malformed provider results503", async () => {
  for (const body of [{ ...startBody, phone: "n/a" }, { ...startBody, role: "admin" }, { ...startBody, first_name: "a".repeat(60), last_name: "b".repeat(60) }, { ...startBody, phone: null }]) { const f = fixture("start"); await result(await f.request(body), 422); assert.equal(f.created(), 0); }
  const origin = fixture("start"); await result(await origin.request(startBody, { Origin: "https://foreign.example.test" }), 403); assert.equal(origin.created(), 0);
  const huge = fixture("start"); await result(await huge.request({ ...startBody, last_name: "x".repeat(5000) }), 413); assert.equal(huge.created(), 0);
  for (const response of [{}, { error: null, data: {} }, { error: null, data: { user: user(), session: null } }]) { const f = fixture("start", { otp: response }); await result(await f.request(startBody), 503); assert.equal(f.written.length, 0); }
});

const historyRows = Array.from({ length: 101 }, (_, i) => ({ id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, category: "socket", status: "requested", city: "Commune QA", created_at: `2026-11-01T00:00:00.${String(123000 + Math.floor(i / 4)).padStart(6, "0")}Z`, estimate_min_cents: 8000, estimate_max_cents: 18000 }));
const active = (over: Record<string, unknown> = {}) => [{ data: { user: user(over) }, error: null }];

test("phone history: all101 through five25-row pages, tied microseconds/id order, private minimal projection", async () => {
  const f = fixture("history", { users: active(), historyRows }); let cursor: string | null = null; const ids: string[] = []; let pages = 0;
  do {
    const b = await result(await f.request(undefined, {}, cursor ? "?cursor=" + cursor : ""), 200);
    ids.push(...b.interventions.map((r: any) => r.id)); pages++; cursor = b.page.next_cursor;
    assert.equal(b.page.limit, 25); assert.equal(b.page.has_more, cursor !== null);
    for (const row of b.interventions) assert.deepEqual(Object.keys(row).sort(), ["category", "city", "created_at", "estimate_max_cents", "estimate_min_cents", "id", "status"]);
    assert.ok(pages <= 5);
  } while (cursor);
  assert.equal(ids.length, 101); assert.equal(new Set(ids).size, 101); assert.equal(pages, 5); assert.equal(ids[0], historyRows[100].id);
  for (const call of f.calls.filter(c => c.op === "history")) {
    assert.equal(call.value.columns, "id,category,status,city,created_at,estimate_min_cents,estimate_max_cents"); assert.equal(call.value.eq.key, "client_id"); assert.equal(call.value.eq.value, ID); assert.equal(call.value.limit, 26);
    assert.equal(JSON.stringify(call.value.orders), JSON.stringify([{ key: "created_at", value: { ascending: false } }, { key: "id", value: { ascending: false } }]));
  }
  const maximum = fixture("history", { users: active(), historyRows }); const b = await result(await maximum.request(undefined, {}, "?limit=100"), 200); assert.equal(b.interventions.length, 100); assert.equal(b.page.has_more, true); assert.equal(maximum.calls.find(c => c.op === "history")!.value.limit, 101);
});

test("history cursor is bound to current verified UID/phone, malformed/unknown query422", async () => {
  const f = fixture("history", { users: active(), historyRows }); const b = await result(await f.request(undefined, {}, "?limit=1"), 200); const cursor = b.page.next_cursor;
  assert.ok(typeof cursor === "string"); assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /596696123456|OPAQUE|NEVER_RETURN/);
  for (const over of [{ id: OTHER }, { phone: "33612345678" }]) { const foreign = fixture("history", { users: active(over), historyRows }); await result(await foreign.request(undefined, {}, "?cursor=" + cursor), 422); assert.equal(foreign.calls.some(c => c.op === "history"), false); }
  for (const query of ["?limit=0", "?limit=101", "?limit=01", "?limit=1e2", "?limit=25&limit=25", "?phone=0696123456", "?first_name=QA", "?cursor=", "?cursor=!!!", "?cursor=" + cursor + "&cursor=" + cursor]) { const invalid = fixture("history", { users: active() }); await result(await invalid.request(undefined, {}, query), 422); assert.equal(invalid.calls.some(c => c.op === "history"), false); }
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); decoded.created_at = "2026-11-01T00:00:00.1234567Z";
  const precision = fixture("history", { users: active() }); await result(await precision.request(undefined, {}, "?cursor=" + Buffer.from(JSON.stringify(decoded)).toString("base64url")), 422);
});

test("history: no session401, professional409, phone unverified403; empty and provider errors honest", async () => {
  const no = fixture("history"); await result(await no.request(), 401); assert.equal(no.calls.some(c => c.op === "history"), false);
  for (const role of ["artisan", "manager", "admin"]) { const f = fixture("history", { users: active(), profileRole: role }); await result(await f.request(), 409); assert.equal(f.calls.some(c => c.op === "history"), false); }
  const unverified = fixture("history", { users: active({ phone_confirmed_at: null }) }); await result(await unverified.request(), 403); assert.equal(unverified.calls.some(c => c.op === "history"), false);
  const empty = fixture("history", { users: active() }); assert.deepEqual(await result(await empty.request(), 200), { interventions: [], page: { limit: 25, has_more: false, next_cursor: null } });
  for (const options of [{ historyError: true }, { historyRows: {} }, { historyRows: [{ ...historyRows[0], created_at: "invalid" }] }, { historyRows: [historyRows[0], historyRows[0]] }]) { const f = fixture("history", { users: active(), ...options }); const r = await f.request(); await result(r, 503); assert.equal(r.headers.get("retry-after"), "2"); }
});

test("chunked request without Content-Length is cancelled at4096 bytes before SDK construction", async () => {
  const f = fixture("start"); let cancelled = false, chunksRead = 0;
  const chunks = [new Uint8Array(2500).fill(32), new Uint8Array(2500).fill(32), new Uint8Array(2500).fill(32)];
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (chunksRead < chunks.length) controller.enqueue(chunks[chunksRead++]); else controller.close(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const request = new Request(ORIGIN + "/api/auth/phone/start", { method: "POST", headers: { Origin: ORIGIN }, body: stream, duplex: "half" } as RequestInit);
  assert.equal(request.headers.get("content-length"), null); await result(await f.raw(request), 413);
  assert.equal(cancelled, true); assert.equal(chunksRead, 2); assert.equal(f.created(), 0);
  // Byte bound, not JS UTF16 character count.
  const multi = fixture("start"); await result(await multi.request({ ...startBody, first_name: "é".repeat(2100) }), 413); assert.equal(multi.created(), 0);
});

test("actual Supabase SSR with LOCAL fake fetch: verified pending cookies feed getUser before any cookie commit", async () => {
  for (const role of ["client", "artisan"]) {
    const now = Math.floor(Date.now() / 1000);
    const fakeToken = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: ID, role: "authenticated", exp: now + 3600 })).toString("base64url"), "fake-not-a-real-signature"].join(".");
    const u = { ...user(), aud: "authenticated", role: "authenticated", created_at: "2026-11-01T00:00:00Z", app_metadata: { provider: "phone", providers: ["phone"] }, user_metadata: {}, identities: [] };
    const writes: unknown[] = [], wire: { path: string; method: string }[] = []; let originalCookieReads = 0, freshTokenSeen = false;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input)); assert.equal(url.origin, "https://local-fake.supabase.co");
      const method = init?.method ?? "GET"; wire.push({ path: url.pathname, method }); assert.equal(writes.length, 0, "cookies must remain deferred until role/phone verification finishes");
      if (url.pathname === "/auth/v1/verify" && method === "POST") {
        const body = JSON.parse(String(init?.body)); assert.equal(body.type, "sms"); assert.equal(body.phone, PHONE);
        return Response.json({ access_token: fakeToken, refresh_token: "FAKE_LOCAL_REFRESH", expires_in: 3600, token_type: "bearer", user: u });
      }
      const authorization = new Headers(init?.headers).get("authorization");
      if (url.pathname === "/auth/v1/user") { freshTokenSeen = authorization === "Bearer " + fakeToken; assert.ok(freshTokenSeen, "getUser must use the newly verified local session"); return Response.json(u); }
      if (url.pathname === "/rest/v1/profiles") { assert.ok(authorization === "Bearer " + fakeToken); assert.equal(url.searchParams.get("id"), "eq." + ID); return Response.json([{ id: ID, role }]); }
      throw new Error("Unexpected local transport path");
    };
    const mod = loadModule("app/api/auth/phone/verify/route.ts", {
      "node:process": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://local-fake.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "FAKE_LOCAL_PUBLISHABLE" } },
      "@supabase/ssr": { createServerClient: (url: string, key: string, config: any) => realServerClient(url, key, { ...config, global: { fetch: fakeFetch } }) },
      "next/headers": { cookies: async () => ({ getAll: () => { originalCookieReads++; return []; }, set: (...args: unknown[]) => writes.push(args) }) },
      "@/lib/supabase/server": { ApiError, assertOrigin: () => {} },
    });
    const response = await (mod.POST as (r: Request) => Promise<Response>)(new Request(ORIGIN + "/api/auth/phone/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verifyBody) }));
    await result(response, role === "client" ? 200 : 409); assert.ok(freshTokenSeen); assert.ok(originalCookieReads > 0);
    assert.equal(writes.length > 0, role === "client"); assert.deepEqual(wire.map(x => x.path), ["/auth/v1/verify", "/auth/v1/user", "/rest/v1/profiles"]);
  }
});

test("history same-response exact count refuses silent provider cap and absent/invalid totals", async () => {
  for (const options of [{ historyRows, historyCap: 5 }, ...[undefined, null, -1, 1.5, 4, NaN].map(historyCount => ({ historyRows: historyRows.slice(0, 5), historyCount }))]) {
    const f = fixture("history", { users: active(), ...options }); const response = await f.request(); await result(response, 503); assert.equal(response.headers.get("retry-after"), "2");
    assert.equal(f.calls.filter(c => c.op === "history").length, 1);
    assert.equal(JSON.stringify(f.calls.find(c => c.op === "history")!.value.settings), JSON.stringify({ count: "exact" }));
  }
});

test("history boundaries N=limit and N=limit+1 have an exact terminal/continuing page", async () => {
  for (const length of [25, 26]) {
    const f = fixture("history", { users: active(), historyRows: historyRows.slice(0, length) }); const b = await result(await f.request(), 200);
    assert.equal(b.interventions.length, 25); assert.equal(b.page.has_more, length === 26); assert.equal(typeof b.page.next_cursor === "string", length === 26);
  }
});
