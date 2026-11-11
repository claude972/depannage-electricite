// Website account: first name, last name, e-mail, phone (+596, +590 or +33) and password are required
// BY THE SERVER, the account is confirmed by the link sent by e-mail, and a client profile always
// keeps a reachable number. No SMS code anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadModule, fakeServerHelpers, ApiError } from "../documents/harness";

const ORIGIN = "https://preview.example.test", ID = "10000000-0000-4000-8000-000000000001";
const PHONE_MESSAGE = "Indiquez un numéro de téléphone en +596, +590 ou +33 (ex. 0696 12 34 56 ou +590 690 12 34 56).";
const account = { first_name: " Camille ", last_name: "Essai", email: " Camille.Essai@Example.test ", phone: "0696 12 34 56", password: "FictitiousPassword42!", role: "client" };
const created = (session: unknown = null) => ({ error: null, data: { user: { id: ID }, session } });

function signup(options: { answer?: unknown; transport?: boolean } = {}) {
  const calls: any[] = [];
  const db = { auth: { signUp: async (value: unknown) => { calls.push(value); if (options.transport) throw Error("PRIVATE_PROVIDER_DETAILS"); return options.answer ?? created(); } } };
  const route = loadModule("app/api/auth/signup/route.ts", { "@/lib/supabase/server": { ApiError, serverClient: async () => db } });
  const post = (body: unknown = account, headers: Record<string, string> = { Origin: ORIGIN }, suffix = "") =>
    (route.POST as (r: Request) => Promise<Response>)(new Request(`${ORIGIN}/api/auth/signup${suffix}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  return { calls, post };
}
async function answer(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const raw = await response.text();
  assert.doesNotMatch(raw, /PRIVATE_PROVIDER|access_token|refresh_token|FictitiousPassword/);
  return JSON.parse(raw);
}

test("signup: the server normalises the five fields and asks for an e-mail confirmation link", async () => {
  const f = signup();
  assert.deepEqual(await answer(await f.post(), 201), { status: "confirmation_required" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].email, "camille.essai@example.test");
  assert.equal(f.calls[0].password, account.password);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].options.data)), { full_name: "Camille Essai", first_name: "Camille", last_name: "Essai", role: "client", phone: "+596696123456" });
  assert.equal(f.calls[0].options.emailRedirectTo, `${ORIGIN}/auth/confirm`);
  // Nothing of the SMS world: no phone identity, no channel, no code.
  assert.equal(Object.hasOwn(f.calls[0], "phone"), false);
  assert.equal(Object.hasOwn(f.calls[0].options, "channel"), false);
});

test("signup: a session exists only where confirmation is off; the answer never carries a token", async () => {
  const f = signup({ answer: created({ access_token: "access_token_PRIVATE", refresh_token: "refresh_token_PRIVATE" }) });
  const response = await f.post();
  assert.equal(response.status, 201);
  const raw = await response.text();
  assert.doesNotMatch(raw, /PRIVATE/);
  assert.deepEqual(JSON.parse(raw), { status: "signed_in", user_id: ID });
});

test("signup: name, e-mail, phone and password are each required by the server, with a clear message", async () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ first_name: "" }, /prénom/], [{ first_name: "   " }, /prénom/], [{ first_name: undefined }, /prénom/], [{ first_name: "a".repeat(61) }, /prénom/],
    [{ last_name: "" }, /votre nom/], [{ last_name: undefined }, /votre nom/],
    [{ email: "" }, /adresse e-mail valide/], [{ email: undefined }, /adresse e-mail valide/], [{ email: "camille@" }, /adresse e-mail valide/], [{ email: `${"a".repeat(250)}@ex.fr` }, /adresse e-mail valide/],
    [{ phone: "" }, /\+596, \+590 ou \+33/], [{ phone: undefined }, /\+596, \+590 ou \+33/], [{ phone: "+447700900123" }, /\+596, \+590 ou \+33/], [{ phone: "+1 202 555 0100" }, /\+596, \+590 ou \+33/], [{ phone: "0692123456" }, /\+596, \+590 ou \+33/], [{ phone: "06961234" }, /\+596, \+590 ou \+33/], [{ phone: 696123456 }, /\+596, \+590 ou \+33/],
    [{ password: "" }, /mot de passe de 10 à 128/], [{ password: "court" }, /mot de passe de 10 à 128/], [{ password: undefined }, /mot de passe de 10 à 128/],
    [{ role: "admin" }, /particulier, artisan ou professionnel/], [{ role: undefined }, /particulier, artisan ou professionnel/],
    [{ first_name: "a".repeat(60), last_name: "b".repeat(60) }, /120 caractères/],
  ];
  for (const [change, message] of cases) {
    const f = signup();
    const body = await answer(await f.post({ ...account, ...change }), 422);
    assert.match(body.error, message, JSON.stringify(change));
    assert.equal(f.calls.length, 0, JSON.stringify(change));
  }
  const phone = signup();
  assert.deepEqual(await answer(await phone.post({ ...account, phone: "+44 7700 900123" }), 422), { error: PHONE_MESSAGE });
  for (const body of [{ ...account, admin: true }, { ...account, phone_confirmed: true }, [], null, '"texte"', "42"]) { const f = signup(); await answer(await f.post(body), 422); assert.equal(f.calls.length, 0); }
  const broken = signup(); await answer(await broken.post("{"), 400); assert.equal(broken.calls.length, 0);
});

test("signup: the three codes and their local forms are stored in international form", async () => {
  for (const [typed, stored] of [["0696 12 34 56", "+596696123456"], ["0697123456", "+596697123456"], ["0690 12 34 56", "+590690123456"], ["0691123456", "+590691123456"], ["06 12 34 56 78", "+33612345678"], ["+596 696 12 34 56", "+596696123456"], ["+590 (0)690 12 34 56", "+590690123456"], ["0033 6 12 34 56 78", "+33612345678"], ["+596 596 12 34 56", "+596596123456"]] as const) {
    const f = signup();
    await answer(await f.post({ ...account, phone: typed }), 201);
    assert.equal(f.calls[0].options.data.phone, stored, typed);
  }
  for (const role of ["client", "artisan", "manager"]) { const f = signup(); await answer(await f.post({ ...account, role }), 201); assert.equal(f.calls[0].options.data.role, role); }
});

test("signup: only this website's own page creates an account here (origin), no query", async () => {
  for (const headers of [{}, { Origin: "https://foreign.example.test" }, { Origin: "null" }] as Record<string, string>[]) { const f = signup(); await answer(await f.post(account, headers), 403); assert.equal(f.calls.length, 0); }
  const query = signup(); await answer(await query.post(account, { Origin: ORIGIN }, "?role=admin"), 422); assert.equal(query.calls.length, 0);
});

test("signup: provider refusals are translated, never leaked", async () => {
  const refusal = (error: Record<string, unknown>) => ({ error: { message: "PRIVATE_PROVIDER_DETAILS", ...error }, data: { user: null, session: null } });
  for (const [error, status, message] of [
    [{ status: 422, code: "user_already_exists" }, 409, /compte existe déjà.*Mot de passe oublié/],
    [{ status: 422, code: "email_exists" }, 409, /compte existe déjà/],
    [{ status: 429, code: "over_email_send_rate_limit" }, 429, /Trop de tentatives/],
    [{ status: 422, code: "weak_password" }, 422, /trop simple/],
    [{ status: 400, code: "email_address_invalid" }, 422, /adresse e-mail valide/],
    [{ status: 500, code: "unexpected_failure" }, 503, /momentanément indisponible/],
  ] as const) {
    const f = signup({ answer: refusal(error) });
    const response = await f.post();
    assert.match((await answer(response, status)).error, message);
    if (status === 503) assert.equal(response.headers.get("retry-after"), "2");
    if (status === 429) assert.equal(response.headers.get("retry-after"), "60");
  }
  for (const malformed of [{ error: null, data: {} }, { error: null, data: { user: {}, session: null } }, { error: null, data: null }]) await answer(await signup({ answer: malformed }).post(), 503);
  await answer(await signup({ transport: true }).post(), 503);
});

function profile(options: { role?: string } = {}) {
  const calls: { name: string; args: any }[] = [];
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: options.role ?? "client" }, error: null }) }) }) }),
    rpc: async (name: string, args: any) => { calls.push({ name, args }); return { error: null, data: { id: ID, full_name: args.p_full_name ?? `${args.p_first_name} ${args.p_last_name}`, first_name: args.p_first_name ?? null, last_name: args.p_last_name ?? null, phone: args.p_phone, role: options.role ?? "client", artisan_approved: false, private_column: "PRIVATE" } }; },
  };
  const helpers = fakeServerHelpers({ db });
  const route = loadModule("app/api/profile/route.ts", { "@/lib/supabase/server": { ...helpers, authenticatedClient: async () => ({ db, user: { id: ID } }) } });
  const patch = (body: unknown, headers: Record<string, string> = {}) =>
    (route.PATCH as (r: Request) => Promise<Response>)(new Request(`${ORIGIN}/api/profile`, { method: "PATCH", headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
  return { calls, patch };
}

test("profile (website, client): the phone stays required and is stored as +596, +590 or +33", async () => {
  for (const phone of ["", "   ", "+447700900123", "0596123456", "12345"]) {
    const f = profile();
    const response = await f.patch({ full_name: "Camille Essai", phone });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: PHONE_MESSAGE });
    assert.equal(f.calls.length, 0);
  }
  const plain = profile();
  const saved = await plain.patch({ full_name: "Camille Essai", phone: "0690 12 34 56" });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(plain.calls)), [{ name: "update_profile", args: { p_full_name: "Camille Essai", p_phone: "+590690123456" } }]);
  const body = await saved.json();
  assert.equal(body.profile.phone, "+590690123456");
  assert.equal(Object.hasOwn(body.profile, "private_column"), false);
  const named = profile();
  assert.equal((await named.patch({ full_name: "Camille Essai", first_name: "Camille", last_name: "Essai", phone: "06 12 34 56 78" })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(named.calls)), [{ name: "update_profile_name", args: { p_first_name: "Camille", p_last_name: "Essai", p_phone: "+33612345678" } }]);
});

test("profile: professionals, administrators and delivered native builds keep their former phone rule", async () => {
  for (const role of ["artisan", "manager", "admin"]) {
    const f = profile({ role });
    assert.equal((await f.patch({ full_name: "Atelier QA", phone: "" })).status, 200);
    assert.equal(f.calls[0].args.p_phone, "");
  }
  const native = profile();
  assert.equal((await native.patch({ full_name: "Camille Essai", phone: "" }, { authorization: "Bearer qa.native.session" })).status, 200);
  assert.equal(native.calls[0].args.p_phone, "");
});

test("migration: the profile receives the validated phone at account creation, and refuses nothing", () => {
  const sql = readFileSync("supabase/migrations/20261111120000_signup_profile_phone.sql", "utf8");
  assert.match(sql, /create or replace function public\.create_profile\(\)/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /raw_user_meta_data->>'phone' ~ '\^\\\+\(596\|590\|33\)\[1-9\]\[0-9\]\{8\}\$'/);
  assert.match(sql, /insert into public\.profiles \(id, role, full_name, first_name, last_name, phone\)/);
  // The role rule of the previous definition is unchanged: nobody becomes an administrator by signing up.
  assert.match(sql, /in \('artisan','manager'\) then new\.raw_user_meta_data->>'role' else 'client' end/);
  assert.doesNotMatch(sql, /raise exception|drop |alter table|delete from|update public\./i);
});
