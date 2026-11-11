// Compatibility of the three SMS-code operations kept for the native builds already delivered, and
// proof that the website cannot reach them: no web route, no cookie, a browser is answered 410.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadModule, ApiError } from "../documents/harness";

const ID = "10000000-0000-4000-8000-000000000001", OTHER = "20000000-0000-4000-8000-000000000002";
const ORIGIN = "https://preview.example.test", PHONE = "+596696123456", BEARER = "Bearer qa.native.session";
const user = (over: Record<string, unknown> = {}) => ({ id: ID, phone: "596696123456", phone_confirmed_at: "2026-11-01T00:00:00Z", email: "", ...over });
const native = (u = user()) => ({ error: null, data: { user: u, session: { user: u, access_token: "OPAQUE_ACCESS", refresh_token: "OPAQUE_REFRESH", token_type: "bearer", expires_in: 3600 } } });
const signed = (over: Record<string, unknown> = {}) => ({ data: { user: user(over) }, error: null });
const started = { error: null, data: { user: null, session: null } };
const startBody = { phone: "0696 12 34 56", first_name: "QA", last_name: "Essai", purpose: "booking" };
const verifyBody = { phone: PHONE, token: "123456", kind: "sms" };
type Operation = "start" | "nativeVerify" | "history";
function fixture(op: Operation, options: { current?: unknown; profileRole?: string; profileId?: string; profileError?: boolean; otp?: unknown; verify?: unknown; transport?: boolean; historyRows?: unknown; historyError?: boolean; historyCount?: unknown; historyCap?: number; nativeUser?: ReturnType<typeof user>; environment?: Record<string, string> } = {}) {
  let sdkOptions: any, created = 0, cookieStore = 0, bearerChecks = 0;
  const calls: { op: string; value?: any; extra?: any }[] = [];
  // The SDK tries to persist the session: the route must have given it a store that keeps nothing.
  const queue = () => sdkOptions.cookies.setAll([{ name: "sb-fake-auth-token", value: "NEVER_RETURN_SESSION", options: { httpOnly: true } }]);
  const db = { auth: {
    getUser: async () => { calls.push({ op: "getUser" }); return options.current ?? signed(); },
    signInWithOtp: async (value: unknown) => { calls.push({ op: "otp", value }); if (options.transport) throw Error("PRIVATE_PHONE_OR_TOKEN"); return options.otp ?? started; },
    verifyOtp: async (value: unknown) => { calls.push({ op: "verify", value }); queue(); if (options.transport) throw Error("PRIVATE_PHONE_OR_TOKEN"); return options.verify ?? native(); },
    updateUser: async () => { throw Error("The native compatibility layer never updates a user"); },
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
  const route = op === "nativeVerify" ? "native/verify" : op, method = op === "history" ? "GET" : "POST";
  const module = loadModule(`app/api/auth/phone/${route}/route.ts`, {
    "node:process": { env: { NEXT_PUBLIC_SUPABASE_URL: "https://fake.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "FAKE_PUBLIC_KEY", ...options.environment } },
    "@supabase/ssr": { createServerClient: (_url: string, _key: string, config: unknown) => { created++; sdkOptions = config; return db; } },
    // The website cookie store is never opened by these routes.
    "next/headers": { cookies: async () => { cookieStore++; throw Error("The cookie store must stay closed"); } },
    "@/lib/supabase/server": { ApiError, authenticatedClient: async (request: Request) => {
      bearerChecks++;
      assert.equal(request.headers.get("authorization"), BEARER);
      if (!options.nativeUser) throw new ApiError(401, "Unauthorized");
      return { db, user: options.nativeUser };
    }, assertOrigin: (request: Request) => { const o = request.headers.get("origin"); if (o && o !== new URL(request.url).origin) throw new ApiError(403, "ORIGIN"); } },
  });
  const raw = (r: Request) => (module[method] as (request: Request) => Promise<Response>)(r);
  // A native HTTP client: no Origin, no Cookie, no Sec-Fetch-*; the history call carries its bearer token.
  const request = (body?: unknown, headers: Record<string, string> = {}, suffix = "") => raw(new Request(`${ORIGIN}/api/auth/phone/${route}${suffix}`, { method, headers: { ...(method === "POST" ? { "Content-Type": "application/json" } : { authorization: BEARER }), ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
  return { request, raw, calls, created: () => created, cookieStore: () => cookieStore, bearerChecks: () => bearerChecks, storedCookies: () => sdkOptions?.cookies.getAll() ?? [] };
}
async function result(response: Response, status: number) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.has("set-cookie"), false);
  const raw = await response.text(); assert.doesNotMatch(raw, /NEVER_RETURN|OLD_COOKIE|PRIVATE_PHONE_OR_TOKEN/); if (status !== 200) assert.doesNotMatch(raw, /OPAQUE_/); return JSON.parse(raw);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? (["node_modules", ".next"].includes(name) ? [] : files(path)) : [path]; });
}

test("website: no SMS-code route, screen or call remains; only the three native-compatibility routes exist", () => {
  assert.deepEqual(files("app/api/auth/phone").sort(), ["app/api/auth/phone/history/route.ts", "app/api/auth/phone/native/verify/route.ts", "app/api/auth/phone/start/route.ts"]);
  for (const gone of ["app/api/auth/phone/verify", "app/api/auth/phone/session", "app/api/auth/phone/upgrade", "components/role/phone-access.tsx", "components/role/phone-access.module.css", "components/role/account-upgrade.tsx", "components/role/account-upgrade.module.css", "lib/features/guest/phone-auth.ts"]) assert.equal(existsSync(gone), false, gone);
  // Nothing the browser runs (pages, components, shared code) names these routes or asks for an SMS code.
  const web = [...files("components"), ...files("shared"), ...files("app").filter(path => !path.startsWith(join("app", "api", "auth", "phone")))].filter(path => /\.(tsx?|css)$/.test(path));
  assert.ok(web.length > 100);
  for (const path of web) assert.doesNotMatch(readFileSync(path, "utf8"), /api\/auth\/phone|signInWithOtp|phone_change|phone-access|account-upgrade|PhoneAccess|AccountUpgrade|code_requested/, path);
  // The only server code that talks to the SMS-code provider is the native compatibility module.
  for (const path of files("lib").filter(path => /\.tsx?$/.test(path) && path !== join("lib", "features", "guest", "native-phone-auth.ts"))) assert.doesNotMatch(readFileSync(path, "utf8"), /signInWithOtp|type: ?"sms"/, path);
  // The e-mail confirmation link is the single remaining use of verifyOtp on the website, by token hash.
  assert.match(readFileSync("lib/features/auth/email-confirm.ts", "utf8"), /token_hash/);
});

test("a browser is refused on the three kept routes (410) before any SDK, limiter, bearer check or cookie", async () => {
  const browsers: Record<string, string>[] = [{ Origin: ORIGIN }, { Cookie: "sb-qa-auth-token=session" }, { "Sec-Fetch-Site": "same-origin" }, { Origin: ORIGIN, Cookie: "sb-qa-auth-token=session", authorization: BEARER }];
  for (const op of ["start", "nativeVerify", "history"] as const) for (const headers of browsers) {
    const f = fixture(op, { nativeUser: user() });
    const body = await result(await f.request(op === "start" ? startBody : verifyBody, headers), 410);
    assert.match(body.error, /n’existe plus sur le site.*adresse e-mail.*mot de passe/);
    assert.equal(f.created(), 0); assert.equal(f.calls.length, 0); assert.equal(f.bearerChecks(), 0); assert.equal(f.cookieStore(), 0);
  }
  const foreign = fixture("start"); await result(await foreign.request(startBody, { Origin: "https://foreign.example.test" }), 403); assert.equal(foreign.created(), 0);
});

test("phone rules: local Martinique and Guadeloupe mobiles, metropolitan, E.164; website accepts +596, +590 and +33 only", () => {
  const m = loadModule("lib/features/guest/phone-number.ts", {});
  const normalize = m.normalizePhone as (s: string) => string | null, web = m.normalizeWebPhone as (s: string) => string | null;
  for (const [raw, expected] of [["0696 12 34 56", PHONE], ["0697123456", "+596697123456"], ["0690123456", "+590690123456"], ["0691 12 34 56", "+590691123456"], ["0612345678", "+33612345678"], ["0712345678", "+33712345678"], ["+1 (202) 555-0100", "+12025550100"]]) assert.equal(normalize(raw), expected);
  for (const raw of ["", "foo", "+0001234567", "06961234", "1234567890", "+1234567890123456", "+33/612345678"]) { assert.equal(normalize(raw), null); assert.equal(web(raw), null); }
  for (const [raw, expected] of [["0696 12 34 56", PHONE], ["0690123456", "+590690123456"], ["0612345678", "+33612345678"], ["+596 596 12 34 56", "+596596123456"], ["+590 590 12 34 56", "+590590123456"], ["+33 1 23 45 67 89", "+33123456789"]]) assert.equal(web(raw), expected, raw);
  for (const raw of ["+1 (202) 555-0100", "+447700900123", "+262692123456", "+594694123456", "0596123456", "+596 12", "+33612"]) assert.equal(web(raw), null, raw);
  assert.match(m.WEB_PHONE_MESSAGE as string, /\+596, \+590 ou \+33/);
  assert.equal((m.nativeTransport as (r: Request) => boolean)(new Request(ORIGIN, { headers: { authorization: BEARER } })), true);
  assert.equal((m.nativeTransport as (r: Request) => boolean)(new Request(ORIGIN, { headers: { cookie: "a=b" } })), false);
});

test("native start: asks the provider for the code with client identity metadata only, no session, no cookie", async () => {
  const f = fixture("start"); const b = await result(await f.request(startBody), 200);
  assert.deepEqual(b, { status: "code_requested", kind: "sms", retry_after: 60, phone_suffix: "3456" });
  const otp = f.calls.find(c => c.op === "otp")!;
  assert.equal(otp.value.phone, PHONE); assert.equal(otp.value.options.shouldCreateUser, true); assert.equal(otp.value.options.data.role, "client"); assert.equal(otp.value.options.data.full_name, "QA Essai");
  assert.deepEqual(f.calls.map(c => c.op), ["otp"]); assert.equal(f.cookieStore(), 0); assert.equal(f.storedCookies().length, 0);
});

test("native start and verification take no signed-in caller and no query", async () => {
  for (const op of ["start", "nativeVerify"] as const) {
    const bearer = fixture(op); await result(await bearer.request(op === "start" ? startBody : verifyBody, { authorization: "Bearer another.session.token" }), 409); assert.equal(bearer.created(), 0);
    const query = fixture(op); await result(await query.request(op === "start" ? startBody : verifyBody, {}, "?phone=0696123456"), 422); assert.equal(query.created(), 0);
  }
});

test("preview SMS rejects missing, malformed and unlisted numbers before Auth", async () => {
  for (const [list, status] of [["", 503], [`${PHONE},bad-number`, 503], ["+590690000101", 403]] as const) {
    for (const operation of ["start", "nativeVerify"] as const) {
      const f = fixture(operation, { environment: { VERCEL_ENV: "preview", TEST_PHONE_NUMBERS: list } });
      const body = await result(await f.request(operation === "start" ? startBody : verifyBody), status);
      assert.doesNotMatch(JSON.stringify(body), /596|590|bad-number/);
      assert.equal(f.created(), 0);
    }
  }
  const missing = fixture("start", { environment: { VERCEL_ENV: "preview" } });
  await result(await missing.request(startBody), 503);
  assert.equal(missing.created(), 0);
  const isolated = fixture("start", { environment: { TEST_PHONE_NUMBERS: "+590690000101" } });
  await result(await isolated.request(startBody), 403);
  assert.equal(isolated.created(), 0);
});

test("preview SMS allows only the configured normalized Martinique and Guadeloupe numbers", async () => {
  const guadeloupe = "+590690000101";
  const environment = { VERCEL_ENV: "preview", TEST_PHONE_NUMBERS: `${PHONE}, ${guadeloupe}` };
  for (const [input, expected] of [["0696 12 34 56", PHONE], ["+590 (690) 000 101", guadeloupe]]) {
    const f = fixture("start", { environment });
    await result(await f.request({ ...startBody, phone: input }), 200);
    assert.equal(f.calls.find(c => c.op === "otp")?.value.phone, expected);
  }
  const check = fixture("nativeVerify", { environment });
  assert.equal((await check.request(verifyBody)).status, 200);
  assert.equal(check.calls.filter(call => call.op === "verify").length, 1);
});

test("lookup unknown is uniform, never creates user and makes no SMS delivery claim", async () => {
  const known = fixture("start"), missing = fixture("start", { otp: { error: { status: 400, code: "otp_disabled", message: "PRIVATE_PHONE_OR_TOKEN" }, data: { user: null, session: null } } });
  const a = await result(await known.request({ ...startBody, purpose: "lookup" }), 200), b = await result(await missing.request({ ...startBody, first_name: "Autre", purpose: "lookup" }), 200);
  assert.deepEqual(a, b); assert.doesNotMatch(JSON.stringify(a), /envoy|sent|delivered/);
  for (const f of [known, missing]) { const otp = f.calls.find(c => c.op === "otp")!; assert.equal(otp.value.options.shouldCreateUser, false); assert.equal(otp.value.options.data, undefined); }
});

test("native verification returns only the verified client’s session in the body and never a cookie", async () => {
  const valid = fixture("nativeVerify");
  const response = await valid.request(verifyBody);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(valid.cookieStore(), 0); assert.equal(valid.storedCookies().length, 0);
  assert.deepEqual(await response.json(), { verified: true, session: { access_token: "OPAQUE_ACCESS", refresh_token: "OPAQUE_REFRESH" } });
  assert.equal(JSON.stringify(valid.calls.find(c => c.op === "verify")!.value), JSON.stringify({ phone: PHONE, token: "123456", type: "sms" }));
  assert.deepEqual(valid.calls.map(c => c.op), ["verify", "getUser", "profile"]);
  for (const options of [
    { current: signed({ phone: "33612345678" }) },
    { current: signed({ phone_confirmed_at: null }) },
    { current: signed({ id: OTHER }) },
    { current: { data: { user: null }, error: { name: "AuthSessionMissingError", status: 400 } } },
    { profileId: OTHER },
    { profileError: true },
    { verify: { error: null, data: { user: user(), session: null } } },
  ]) { const bad = fixture("nativeVerify", options); await result(await bad.request(verifyBody), 503); assert.equal(bad.cookieStore(), 0); }
  const role = fixture("nativeVerify", { profileRole: "artisan" });
  await result(await role.request(verifyBody), 409);
  const update = fixture("nativeVerify");
  await result(await update.request({ ...verifyBody, kind: "phone_change" }), 422);
  assert.equal(update.created(), 0);
});

test("wrong code 422, provider 503, rate 429 and transport stay neutral", async () => {
  for (const [error, expected] of [[{ status: 403, code: "otp_expired" }, 422], [{ status: 429, code: "over_sms_send_rate_limit" }, 429], [{ status: 503, code: "unexpected_failure" }, 503], [{ status: 400, code: "untrusted_private_code" }, 503]] as const) {
    const f = fixture("nativeVerify", { verify: { data: { user: null, session: null }, error: { ...error, message: "PRIVATE_PHONE_OR_TOKEN" } } }); const r = await f.request(verifyBody); await result(r, expected); if (expected === 503 || expected === 429) assert.equal(r.headers.get("retry-after"), expected === 503 ? "2" : "60");
  }
  const unavailable = fixture("start", { otp: { data: { user: null, session: null }, error: { status: 400, code: "phone_provider_disabled" } } }); await result(await unavailable.request({ ...startBody, purpose: "lookup" }), 503);
  const transport = fixture("nativeVerify", { transport: true }); await result(await transport.request(verifyBody), 503);
  const limited = fixture("start"); await result(await limited.request(startBody), 200); const retry = await limited.request(startBody); await result(retry, 429); assert.ok(Number(retry.headers.get("retry-after")) > 0);
});

test("strict bodies and limits reject before constructing the SDK; malformed provider results 503", async () => {
  for (const body of [{ ...startBody, phone: "n/a" }, { ...startBody, role: "admin" }, { ...startBody, first_name: "a".repeat(60), last_name: "b".repeat(60) }, { ...startBody, phone: null }]) { const f = fixture("start"); await result(await f.request(body), 422); assert.equal(f.created(), 0); }
  const huge = fixture("start"); await result(await huge.request({ ...startBody, last_name: "x".repeat(5000) }), 413); assert.equal(huge.created(), 0);
  for (const response of [{}, { error: null, data: {} }, { error: null, data: { user: user(), session: null } }]) { const f = fixture("start", { otp: response }); await result(await f.request(startBody), 503); }
});

test("chunked request without Content-Length is cancelled at 4096 bytes before SDK construction", async () => {
  const f = fixture("start"); let cancelled = false, chunksRead = 0;
  const chunks = [new Uint8Array(2500).fill(32), new Uint8Array(2500).fill(32), new Uint8Array(2500).fill(32)];
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (chunksRead < chunks.length) controller.enqueue(chunks[chunksRead++]); else controller.close(); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const request = new Request(ORIGIN + "/api/auth/phone/start", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.equal(request.headers.get("content-length"), null); await result(await f.raw(request), 413);
  assert.equal(cancelled, true); assert.equal(chunksRead, 2); assert.equal(f.created(), 0);
  // Byte bound, not JS UTF16 character count.
  const multi = fixture("start"); await result(await multi.request({ ...startBody, first_name: "é".repeat(2100) }), 413); assert.equal(multi.created(), 0);
});

const historyRows = Array.from({ length: 101 }, (_, i) => ({ id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, category: "socket", status: "requested", city: "Commune QA", created_at: `2026-11-01T00:00:00.${String(123000 + Math.floor(i / 4)).padStart(6, "0")}Z`, estimate_min_cents: 8000, estimate_max_cents: 18000 }));
const active = (over: Record<string, unknown> = {}) => user(over);

test("native history (builds ≤ 11): bearer token only, never a cookie session", async () => {
  const none = fixture("history", { nativeUser: user() });
  await result(await none.raw(new Request(ORIGIN + "/api/auth/phone/history")), 401);
  assert.equal(none.bearerChecks(), 0); assert.equal(none.created(), 0); assert.equal(none.calls.length, 0);
  const valid = fixture("history", { nativeUser: user() });
  await result(await valid.request(), 200);
  assert.equal(valid.created(), 0); assert.equal(valid.bearerChecks(), 1); assert.equal(valid.cookieStore(), 0);
  assert.equal(valid.calls.find(call => call.op === "history")?.value.eq.value, ID);
  const invalid = fixture("history");
  await result(await invalid.request(), 401);
  assert.equal(invalid.calls.some(call => call.op === "history"), false);
});

test("phone history: all 101 through five 25-row pages, tied microseconds/id order, private minimal projection", async () => {
  const f = fixture("history", { nativeUser: active(), historyRows }); let cursor: string | null = null; const ids: string[] = []; let pages = 0;
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
  const maximum = fixture("history", { nativeUser: active(), historyRows }); const b = await result(await maximum.request(undefined, {}, "?limit=100"), 200); assert.equal(b.interventions.length, 100); assert.equal(b.page.has_more, true); assert.equal(maximum.calls.find(c => c.op === "history")!.value.limit, 101);
});

test("history cursor is bound to current verified UID/phone, malformed/unknown query 422", async () => {
  const f = fixture("history", { nativeUser: active(), historyRows }); const b = await result(await f.request(undefined, {}, "?limit=1"), 200); const cursor = b.page.next_cursor;
  assert.ok(typeof cursor === "string"); assert.doesNotMatch(Buffer.from(cursor, "base64url").toString("utf8"), /596696123456|OPAQUE|NEVER_RETURN/);
  for (const over of [{ id: OTHER }, { phone: "33612345678" }]) { const foreign = fixture("history", { nativeUser: active(over), historyRows }); await result(await foreign.request(undefined, {}, "?cursor=" + cursor), 422); assert.equal(foreign.calls.some(c => c.op === "history"), false); }
  for (const query of ["?limit=0", "?limit=101", "?limit=01", "?limit=1e2", "?limit=25&limit=25", "?phone=0696123456", "?first_name=QA", "?cursor=", "?cursor=!!!", "?cursor=" + cursor + "&cursor=" + cursor]) { const invalid = fixture("history", { nativeUser: active() }); await result(await invalid.request(undefined, {}, query), 422); assert.equal(invalid.calls.some(c => c.op === "history"), false); }
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); decoded.created_at = "2026-11-01T00:00:00.1234567Z";
  const precision = fixture("history", { nativeUser: active() }); await result(await precision.request(undefined, {}, "?cursor=" + Buffer.from(JSON.stringify(decoded)).toString("base64url")), 422);
});

test("history: professional 409, phone unverified 403; empty and provider errors honest", async () => {
  for (const role of ["artisan", "manager", "admin"]) { const f = fixture("history", { nativeUser: active(), profileRole: role }); await result(await f.request(), 409); assert.equal(f.calls.some(c => c.op === "history"), false); }
  const unverified = fixture("history", { nativeUser: active({ phone_confirmed_at: null }) }); await result(await unverified.request(), 403); assert.equal(unverified.calls.some(c => c.op === "history"), false);
  const empty = fixture("history", { nativeUser: active() }); assert.deepEqual(await result(await empty.request(), 200), { interventions: [], page: { limit: 25, has_more: false, next_cursor: null } });
  for (const options of [{ historyError: true }, { historyRows: {} }, { historyRows: [{ ...historyRows[0], created_at: "invalid" }] }, { historyRows: [historyRows[0], historyRows[0]] }]) { const f = fixture("history", { nativeUser: active(), ...options }); const r = await f.request(); await result(r, 503); assert.equal(r.headers.get("retry-after"), "2"); }
});

test("history same-response exact count refuses silent provider cap and absent/invalid totals", async () => {
  for (const options of [{ historyRows, historyCap: 5 }, ...[undefined, null, -1, 1.5, 4, NaN].map(historyCount => ({ historyRows: historyRows.slice(0, 5), historyCount }))]) {
    const f = fixture("history", { nativeUser: active(), ...options }); const response = await f.request(); await result(response, 503); assert.equal(response.headers.get("retry-after"), "2");
    assert.equal(f.calls.filter(c => c.op === "history").length, 1);
    assert.equal(JSON.stringify(f.calls.find(c => c.op === "history")!.value.settings), JSON.stringify({ count: "exact" }));
  }
});

test("history boundaries N=limit and N=limit+1 have an exact terminal/continuing page", async () => {
  for (const length of [25, 26]) {
    const f = fixture("history", { nativeUser: active(), historyRows: historyRows.slice(0, length) }); const b = await result(await f.request(), 200);
    assert.equal(b.interventions.length, 25); assert.equal(b.page.has_more, length === 26); assert.equal(typeof b.page.next_cursor === "string", length === 26);
  }
});
