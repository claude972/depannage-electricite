import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../documents/harness";

const ORIGIN = "https://preview.example.test";
const USER = "10000000-0000-4000-8000-000000000001";
function session() {
  return { error: null, data: { user: { id: USER }, session: {
    user: { id: USER }, access_token: "opaque-access", refresh_token: "opaque-refresh",
    token_type: "bearer", expires_in: 3600,
  } } };
}
function route(result: unknown = session(), fault?: "factory" | "exchange") {
  const calls: { op: string; value?: unknown }[] = [];
  const auth = {
    exchangeCodeForSession: async (code: string) => {
      calls.push({ op: "pkce", value: code });
      if (fault === "exchange") throw new Error("PRIVATE provider diagnostic");
      return result;
    },
    verifyOtp: async (values: unknown) => { calls.push({ op: "otp", value: values }); return result; },
  };
  const mod = loadModule("app/auth/confirm/route.ts", {
    "@/lib/supabase/server": { serverClient: async () => {
      calls.push({ op: "factory" });
      if (fault === "factory") throw new Error("PRIVATE config");
      return { auth };
    } },
  });
  return { calls, GET: mod.GET as (request: Request) => Promise<Response> };
}
async function check(response: Response, path: string) {
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), ORIGIN + path);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(await response.text(), "");
}

test("PKCE: real GET exchanges one opaque code and accepts an actual matching SDK session", async () => {
  const r = route();
  await check(await r.GET(new Request(ORIGIN + "/auth/confirm?code=opaque-code")), "/?auth=confirmed");
  assert.deepEqual(r.calls.map(c => c.op), ["factory", "pkce"]);
  assert.equal(r.calls[1].value, "opaque-code");
});

test("OTP signup/email/recovery: existing verifier and fixed destinations preserved", async () => {
  for (const type of ["signup", "email", "recovery"]) {
    const r = route();
    await check(await r.GET(new Request(`${ORIGIN}/auth/confirm?token_hash=opaque-hash&type=${type}`)),
      type === "recovery" ? "/auth/reset-password?verified=1" : "/?auth=confirmed");
    assert.deepEqual(r.calls.map(c => c.op), ["factory", "otp"]);
    assert.equal(JSON.stringify(r.calls[1].value), JSON.stringify({ token_hash: "opaque-hash", type }));
  }
});

test("ambiguous, duplicate, empty, oversized, unknown queries refuse BEFORE auth client", async () => {
  const invalid = ["", "code=", "code=%20", "code=x%0A", "code=x&code=y", "code=x&%63ode=y",
    "code=x&token_hash=y&type=signup", "code=x&type=signup", "token_hash=x", "type=signup",
    "token_hash=&type=signup", "token_hash=x&type=", "token_hash=x&type=magiclink",
    "token_hash=x&type=signup&type=email", "token_hash=x&token_hash=y&type=email",
    "code=x&next=https%3A%2F%2Fevil.example", "code=" + "x".repeat(2049),
    "token_hash=" + "x".repeat(2049) + "&type=email", "code=" + "x".repeat(8193)];
  for (const query of invalid) {
    const r = route();
    await check(await r.GET(new Request(`${ORIGIN}/auth/confirm?${query}`)), "/?auth=expired");
    assert.equal(r.calls.length, 0);
  }
});

test("Auth refusals, 5xx, transport and malformed SDK payloads never claim confirmation", async () => {
  const valid = session();
  const bad: unknown[] = [null, [], "provider JSON", {}, { error: null }, { data: valid.data },
    { error: { status: 400, code: "otp_expired", message: "PRIVATE" }, data: valid.data },
    { error: { status: 503, message: "PRIVATE" }, data: valid.data },
    { error: null, data: { user: null, session: null } },
    { error: null, data: { user: { id: USER }, session: {} } },
    { error: null, data: { user: { id: USER }, session: { ...valid.data.session, user: { id: "20000000-0000-4000-8000-000000000002" } } } },
    { error: null, data: { user: { id: "not-an-id" }, session: valid.data.session } },
    ...["access_token", "refresh_token", "token_type", "expires_in"].map(key => ({ error: null,
      data: { ...valid.data, session: { ...valid.data.session, [key]: key === "expires_in" ? 0 : "" } } })),
  ];
  for (const result of bad) for (const query of ["code=x", "token_hash=x&type=signup"]) {
    const r = route(result);
    await check(await r.GET(new Request(`${ORIGIN}/auth/confirm?${query}`)), "/?auth=expired");
  }
  for (const fault of ["factory", "exchange"] as const) {
    const r = route(valid, fault);
    await check(await r.GET(new Request(ORIGIN + "/auth/confirm?code=x")), "/?auth=expired");
  }
});
