// QA-GW-EXPIRED-REVOKE-003 §2 (contract v4 ac4eadf) — revocation during a real upload, with fakes only:
// batch-result / observation parsing and every rejection of the contract, template rendering, the
// interleaving verdict matrix, unknown outcomes (no deletion by the live phase), other-writer refusal,
// and the prepare/live orchestration over injected deps with a fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  REVOKE_DISCOVERY_MS,
  REVOKE_RESULT_WAIT_MS,
  UsageError,
  emptyCreated,
  manifestJson,
  otherWriters,
  parseArgs,
  parseBatchResult,
  parseManifest,
  parseObservation,
  parseRevokeState,
  renderSqlTemplate,
  revokeEmail,
  revokeLive,
  revokePrepare,
  revokeVerdict,
  sha256Hex,
  type BatchResult,
  type Manifest,
  type Observation,
  type RevokeDeps,
  type RevokeIds,
  type RevokeInput,
  type RevokeState,
  type StepStatus,
} from "../scripts/qa-gateway/lib.ts";

const REF = "abcdefghijklmnopqrst";
const URL_ = `https://${REF}.supabase.co`;
const FN = `${URL_}/functions/v1/native-document-upload`;
const RUN = "20261031t1200abcdef";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const MANAGER = "00000000-0000-4000-8000-0000000000a2";
const ORG = "00000000-0000-4000-8000-0000000000b1";
const SITE = "00000000-0000-4000-8000-0000000000c1";
const DOSSIER = "00000000-0000-4000-8000-0000000000d1";
const OBJ = "00000000-0000-4000-8000-0000000000e1";
const base = ["--function-url", FN, "--project", REF, "--credentials", "/p/creds.json", "--out", "/p/out"];
const ids: RevokeIds = { RUN, PROJECT: REF, ORG, SITE, DOSSIER, OWNER, MANAGER };
const expected = { runId: RUN, project: REF, ownerId: OWNER, managerId: MANAGER, orgId: ORG, siteId: SITE, dossierId: DOSSIER };
const iso = (s: number) => new Date(s * 1000).toISOString();
const T0 = 1_800_000_000;
const goodBatch = (over: Record<string, unknown> = {}) => ({
  run: RUN, project: REF, org_id: ORG, site_id: SITE, dossier_id: DOSSIER, owner_id: OWNER, manager_id: MANAGER, batch_pid: 4242,
  t_begin: iso(T0), t_lock: iso(T0 + 0.1), t_before_revoke: iso(T0 + 3.1), t_revoked: iso(T0 + 3.2), t_after_commit: iso(T0 + 3.3),
  rpc_ok: true, actor_role: "authenticated", actor_uid: OWNER, readback: { scope: "selected", grants: 0 }, ...over,
});
const goodObservation = (over: Record<string, unknown> = {}) => ({ t_observed: iso(T0 + 1.5), finalize_pid: 5151, wait_event_type: "Lock", wait_event: "transactionid", blocked_by: [4242], object_count: 1, object_name: `${MANAGER}/${OBJ}`, ...over });

test("arguments: revoke suites require --no-other-writer; live requires --lease, --batch-result and --observation", () => {
  assert.equal(parseArgs([...base, "--suite", "revoke-prepare", "--no-other-writer"]).suite, "revoke-prepare");
  const live = parseArgs([...base, "--suite", "revoke-live", "--no-other-writer", "--lease", "/p/out/revoke.json", "--batch-result", "/p/r.json", "--observation", "/p/o.json"]);
  assert.equal(live.noOtherWriter, true);
  assert.equal(live.batchResult, "/p/r.json");
  assert.throws(() => parseArgs([...base, "--suite", "revoke-prepare"]), /--no-other-writer/);
  assert.throws(() => parseArgs([...base, "--suite", "revoke-live", "--no-other-writer", "--lease", "/l"]), /--batch-result/);
  assert.throws(() => parseArgs([...base, "--suite", "revoke-live", "--no-other-writer", "--batch-result", "/r", "--observation", "/o"]), /--lease/);
  assert.throws(() => parseArgs([...base, "--batch-result", "/r"]), UsageError);
  assert.throws(() => parseArgs([...base, "--suite", "revoke-live", "--no-other-writer", "--lease", "/l", "--batch-result", "/r", "--observation", "/o", "--dry-run"]), UsageError);
});

test("SQL templates render with validated ids only; the batch keeps the v4 structure (root measures, actor proof, single final row)", async () => {
  const batch = await readFile(new URL("../scripts/qa-gateway/sql/revoke-live-batch.sql", import.meta.url), "utf8");
  const observe = await readFile(new URL("../scripts/qa-gateway/sql/revoke-live-observe.sql", import.meta.url), "utf8");
  const rendered = renderSqlTemplate(batch, ids);
  assert.doesNotMatch(rendered, /\{\{/);
  assert.ok(rendered.includes(`'${ORG}'::uuid for update of o`));
  assert.equal((rendered.match(/set local role authenticated;/g) || []).length, 1);
  assert.equal((rendered.match(/reset role;/g) || []).length, 1);
  assert.equal((rendered.match(/\bcommit;/g) || []).length, 1);
  assert.match(rendered, /select pg_sleep\(3\);/);
  assert.match(rendered, /current_setting\('role', true\) is distinct from 'authenticated'/);
  assert.match(rendered, /auth\.uid\(\) is distinct from '00000000-0000-4000-8000-0000000000a1'::uuid/);
  assert.match(rendered, /set_config\('qa\.actor_role'/);
  assert.match(rendered, /select jsonb_object_agg\(k, v\) as result from qa_rv;\s*$/);
  assert.doesNotMatch(rendered, /^\s*(grant|revoke)\s/im, "no GRANT/REVOKE statement");
  assert.doesNotMatch(rendered, /update public\.|delete from public\.|create policy|alter table|session_replication_role|disable trigger/i);
  // The only statements between the role switch and reset are the actor-proof DO block and the RPC.
  const between = rendered.slice(rendered.indexOf("set local role authenticated;"), rendered.indexOf("reset role;"));
  assert.match(between, /do \$\$[^]*?end \$\$;\s*select public\.set_organization_member_site_access\(/);
  assert.doesNotMatch(between, /insert into qa_rv/);
  const observed = renderSqlTemplate(observe, ids);
  assert.ok(observed.includes(`o.name like '${MANAGER}/%'`) && observed.includes("bucket_id = 'intervention-documents'"));
  assert.match(observed, /as object_count/);
  assert.match(observed, /case when count\(\*\) = 1 then min\(o\.name\) end/);
  assert.doesNotMatch(observed, /jsonb_agg/);
  assert.match(observed, /pg_blocking_pids\(a\.pid\)/);
  assert.doesNotMatch(observed, /insert|update|delete|grant/i);
  assert.throws(() => renderSqlTemplate(batch, { ...ids, ORG: "not-a-uuid" }), /ORG invalide/);
  assert.throws(() => renderSqlTemplate(batch, { ...ids, RUN: "bad run!" }), /RUN invalide/);
  assert.throws(() => renderSqlTemplate("select '{{UNKNOWN}}'", ids), /placeholder inconnu/);
});

test("other-writer guard: any qa-gw account outside this run (including a pending expiry lease) refuses", () => {
  assert.deepEqual(otherWriters([revokeEmail(RUN, "owner"), revokeEmail(RUN, "manager"), "someone@example.com"], RUN), []);
  assert.deepEqual(otherWriters([`qa-gw-exp-otherrun@qa.invalid`], RUN), ["qa-gw-exp-otherrun@qa.invalid"]);
  assert.deepEqual(otherWriters([`qa-gw-20261031t0630010203-client@example.invalid`], RUN), ["qa-gw-20261031t0630010203-client@example.invalid"]);
  assert.deepEqual(otherWriters([`qa-gw-exp-${RUN}@qa.invalid`], RUN), [], "the expiry account of the SAME run is not a foreign writer");
});

test("batch result parser: accepted shapes, and every rejection of the contract", () => {
  for (const shape of [goodBatch(), [goodBatch()], { result: goodBatch() }, [{ result: goodBatch() }]]) {
    const b = parseBatchResult(shape, expected);
    assert.equal(b.batchPid, 4242);
    assert.equal(b.actorUid, OWNER);
    assert.deepEqual(b.readback, { scope: "selected", grants: 0 });
  }
  assert.equal(parseBatchResult(goodBatch({ readback: { scope: "selected", grants: "0" } }), expected).readback.grants, 0);
  const rejects: [string, unknown][] = [
    ["two rows", [goodBatch(), goodBatch()]],
    ["zero rows", []],
    ["not tabular", "nope"],
    ["other run", goodBatch({ run: "otherrun" })],
    ["other project", goodBatch({ project: "zzzzzzzzzzzzzzzzzzzz" })],
    ["other org", goodBatch({ org_id: SITE })],
    ["other manager", goodBatch({ manager_id: OWNER })],
    ["missing pid", goodBatch({ batch_pid: undefined })],
    ["pid not integer", goodBatch({ batch_pid: "4242" })],
    ["timestamps out of order", goodBatch({ t_revoked: iso(T0 + 5) })],
    ["commit not after revoke", goodBatch({ t_after_commit: iso(T0 + 3.2) })],
    ["pause too long", goodBatch({ t_before_revoke: iso(T0 + 9), t_revoked: iso(T0 + 9.1), t_after_commit: iso(T0 + 9.2) })],
    ["unreadable timestamp", goodBatch({ t_lock: "yesterday" })],
    ["rpc_ok false", goodBatch({ rpc_ok: false })],
    ["rpc_ok missing", goodBatch({ rpc_ok: undefined })],
    ["actor_role none", goodBatch({ actor_role: "none" })],
    ["actor_uid manager", goodBatch({ actor_uid: MANAGER })],
    ["actor_uid missing", goodBatch({ actor_uid: undefined })],
    ["readback not revoked", goodBatch({ readback: { scope: "selected", grants: 1 } })],
    ["readback scope all", goodBatch({ readback: { scope: "all", grants: 0 } })],
    ["readback missing", goodBatch({ readback: undefined })],
    ["sql error row", { code: "42501", message: "permission denied" }],
    ["error row", { error: "boom" }],
  ];
  for (const [label, raw] of rejects) assert.throws(() => parseBatchResult(raw, expected), UsageError, label);
});

test("observation parser: one row with Lock/blocked_by/object_count/object_name; zero or multiple rows and missing or inconsistent fields are rejected", () => {
  const o = parseObservation(goodObservation());
  assert.deepEqual(o.blockedBy, [4242]);
  assert.equal(o.objectCount, 1);
  assert.equal(o.objectName, `${MANAGER}/${OBJ}`);
  assert.equal(parseObservation(goodObservation({ object_count: 0, object_name: null })).objectCount, 0);
  assert.equal(parseObservation(goodObservation({ object_count: "2", object_name: null })).objectCount, 2);
  assert.deepEqual(parseObservation(goodObservation({ blocked_by: "{4242,77}" })).blockedBy, [4242, 77]);
  assert.equal(parseObservation([{ row: goodObservation() }]).objectName, `${MANAGER}/${OBJ}`);
  for (const [label, raw] of [
    ["zero rows", []],
    ["two rows", [goodObservation(), goodObservation()]],
    ["missing pid", goodObservation({ finalize_pid: undefined })],
    ["missing blocked_by", goodObservation({ blocked_by: undefined })],
    ["missing object_count", goodObservation({ object_count: undefined })],
    ["missing object_name", (() => { const o: Record<string, unknown> = goodObservation(); delete o.object_name; return o; })()],
    ["count 1 without name", goodObservation({ object_name: null })],
    ["name with count 2", goodObservation({ object_count: 2 })],
    ["negative count", goodObservation({ object_count: -1, object_name: null })],
    ["bad timestamp", goodObservation({ t_observed: "soon" })],
    ["sql error", { code: "42501", message: "permission denied for pg_stat_activity" }],
  ] as [string, unknown][]) assert.throws(() => parseObservation(raw), UsageError, label);
});

test("verdict matrix: PASS only on the full condition set (a)–(g); every deviation is FAIL; no response or 5xx is UNKNOWN", () => {
  const batch = parseBatchResult(goodBatch(), expected);
  const observation = parseObservation(goodObservation());
  const nominal: RevokeInput = {
    batch, observation, parseErrors: [], objectPath: `${MANAGER}/${OBJ}`, discoveredAtMs: 1000, responseAtMs: 3500,
    response: { status: 403, bodyText: '{"error":"Accès refusé."}' }, readbacks: { documentRows: 0, objectPresent: false }, forbidden: [], managerId: MANAGER,
    manifestObjectPaths: [`${MANAGER}/${OBJ}`],
  };
  const ok = revokeVerdict(nominal);
  assert.equal(ok.outcome, "pass", ok.reasons.join(" | "));
  assert.ok(Object.values(ok.conditions).every((v) => v === true));
  const fail = (patch: Partial<RevokeInput>, re: RegExp) => {
    const v = revokeVerdict({ ...nominal, ...patch });
    assert.equal(v.outcome, "fail", `${re}: ${v.reasons.join(" | ")}`);
    assert.match(v.reasons.join(" | "), re);
  };
  fail({ response: { status: 201, bodyText: '{"document":{"id":"x"}}' } }, /201 : la révocation a perdu la course/);
  fail({ response: { status: 403, bodyText: '{"message":"Forbidden"}' } }, /403 sans enveloppe gateway/);
  fail({ response: { status: 403, bodyText: `{"error":"x ${MANAGER}/${OBJ}"}` } }, /fuite/);
  fail({ readbacks: { documentRows: 0, objectPresent: true } }, /objet encore présent/);
  fail({ readbacks: { documentRows: 1, objectPresent: false } }, /ligne\(s\) documents après 403/);
  fail({ readbacks: { documentRows: null, objectPresent: null } }, /relecture .* inconnue/);
  fail({ objectPath: null, discoveredAtMs: null }, /objet jamais observé/);
  fail({ discoveredAtMs: 4000 }, /découvert après la réponse/);
  fail({ observation: parseObservation(goodObservation({ wait_event_type: "ClientRead", blocked_by: [] })) }, /non bloquée par le lot/);
  fail({ observation: parseObservation(goodObservation({ blocked_by: [9999] })) }, /non bloquée par le lot/);
  fail({ observation: parseObservation(goodObservation({ t_observed: iso(T0 + 3.15) })) }, /hors fenêtre/);
  fail({ observation: parseObservation(goodObservation({ t_observed: iso(T0 - 1) })) }, /hors fenêtre/);
  // Exact-object proof (root decision on 13b68c3): count 0, count 2, wrong name, mapping mismatch → non-proof.
  fail({ observation: parseObservation(goodObservation({ object_count: 0, object_name: null })) }, /0 objet\(s\) sous le préfixe de la cohorte au lieu d’exactement 1/);
  fail({ observation: parseObservation(goodObservation({ object_count: 2, object_name: null })) }, /2 objet\(s\) sous le préfixe/);
  fail({ observation: parseObservation(goodObservation({ object_name: `${MANAGER}/${DOSSIER}` })) }, /objet observé .* ≠ objet découvert/);
  fail({ manifestObjectPaths: [] }, /non rattaché au manifeste/);
  fail({ manifestObjectPaths: [`${MANAGER}/${DOSSIER}`] }, /non rattaché au manifeste/);
  fail({ objectPath: `${OWNER}/${OBJ}`, manifestObjectPaths: [`${OWNER}/${OBJ}`], observation: parseObservation(goodObservation({ object_name: `${OWNER}/${OBJ}` })) }, /non rattaché au manifeste/);
  fail({ batch: null, parseErrors: ["résultat du lot non fourni dans le délai"] }, /parseur : résultat du lot non fourni/);
  fail({ observation: null, parseErrors: ["observation non fournie dans le délai"] }, /parseur : observation/);
  const unproven: BatchResult = { ...batch, actorRole: "none" };
  const g = revokeVerdict({ ...nominal, batch: unproven });
  assert.equal(g.outcome, "fail");
  assert.equal(g.conditions["g) preuve de l’acteur (actor_role/actor_uid)"], false);
  const notCommitted: BatchResult = { ...batch, readback: { scope: "selected", grants: 1 } };
  assert.equal(revokeVerdict({ ...nominal, batch: notCommitted }).conditions["b) RPC réussi et révocation commitée (relecture post-commit)"], false);
  for (const response of [null, { status: 503, bodyText: '{"error":"Service indisponible"}' }, { status: 500, bodyText: "" }]) {
    const u = revokeVerdict({ ...nominal, response });
    assert.equal(u.outcome, "unknown");
    assert.match(u.reasons.join(), /issue inconnue/);
  }
});

// ---- Orchestration with fakes and a fake clock --------------------------------------------------
type Cloud = {
  clock: number;
  users: Map<string, { email: string }>;
  emails: string[];
  calls: string[];
  logs: { status: StepStatus; step: string; detail: string }[];
  manifest: Manifest | null;
  states: { state: RevokeState; target: string }[];
  sql: Record<string, string>;
  files: Record<string, unknown>;
  objects: string[];
  docs: { id: string; path: string; owner_id: string }[];
  upload: (token: string) => Promise<{ status: number; text: string }>;
  secrets: string[];
};
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const tokenFor = (sub: string, exp: number) => `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify({ iss: `${URL_}/auth/v1`, sub, aud: "authenticated", role: "authenticated", exp }))}.${b64url("sig")}`;
function cloud(): Cloud {
  const c: Cloud = { clock: T0, users: new Map(), emails: [], calls: [], logs: [], manifest: null, states: [], sql: {}, files: {}, objects: [], docs: [], upload: async () => ({ status: 403, text: '{"error":"Accès refusé."}' }), secrets: [] };
  return c;
}
async function templates() {
  return { batch: await readFile(new URL("../scripts/qa-gateway/sql/revoke-live-batch.sql", import.meta.url), "utf8"), observe: await readFile(new URL("../scripts/qa-gateway/sql/revoke-live-observe.sql", import.meta.url), "utf8") };
}
async function deps(c: Cloud, overrides: Partial<RevokeDeps> = {}): Promise<RevokeDeps> {
  const created = emptyCreated();
  let seq = 0;
  const d: RevokeDeps = {
    now: () => c.clock,
    nowMs: () => c.clock * 1000,
    sleep: async (ms) => { c.clock += ms / 1000; },
    runId: RUN, project: REF, projectUrl: URL_, manifestPath: "/p/out/manifest.json", statePath: "/p/out/revoke.json", batchSqlPath: "/p/out/revoke-live-batch.sql", observeSqlPath: "/p/out/revoke-live-observe.sql", liveCommand: "node scripts/qa-gateway/run.mjs --suite revoke-live …",
    templates: await templates(),
    randomPassword: () => "Pw-memory-only-0123456789!Qa9",
    listUserEmails: async () => { c.calls.push("listUsers"); return { ok: true, emails: [...c.emails, ...[...c.users.values()].map((u) => u.email)], detail: "" }; },
    createUser: async (email) => { c.calls.push(`createUser:${email}`); const id = email.endsWith("owner@qa.invalid") ? OWNER : MANAGER; c.users.set(id, { email }); return { status: 200, id, detail: "" }; },
    passwordGrant: async (email) => { c.calls.push("grant"); const id = [...c.users.entries()].find(([, u]) => u.email === email)?.[0]; return id ? { status: 200, json: { access_token: tokenFor(id, c.clock + 3600), refresh_token: "r", expires_in: 3600, expires_at: c.clock + 3600 }, detail: "" } : { status: 400, json: null, detail: "" }; },
    rpc: async (_token, fn, body) => {
      c.calls.push(`rpc:${fn}`);
      if (fn === "create_site") return { status: 200, json: { id: SITE, organization_id: ORG }, detail: "" };
      if (fn === "create_intervention") return { status: 200, json: { id: DOSSIER, site_id: body.p_site_id }, detail: "" };
      return { status: 204, json: null, detail: "" };
    },
    serviceInsert: async (table) => { c.calls.push(`insert:${table}`); return { status: 201, detail: "" }; },
    serviceRows: async (query) => {
      c.calls.push(`rows:${query.split("?")[0]}`);
      if (query.startsWith("organizations?")) return { ok: true, rows: [{ id: ORG, owner_id: OWNER }], detail: "" };
      if (query.startsWith("sites?")) return { ok: true, rows: [{ id: SITE, organization_id: ORG }], detail: "" };
      if (query.startsWith("interventions?")) return { ok: true, rows: [{ id: DOSSIER, site_id: SITE, client_id: OWNER, artisan_id: null }], detail: "" };
      if (query.startsWith("organization_members?")) return { ok: true, rows: [{ role: "manager" }], detail: "" };
      if (query.startsWith("organization_member_site_scopes?")) return { ok: true, rows: [{ scope: "selected" }], detail: "" };
      if (query.startsWith("organization_member_site_grants?")) return { ok: true, rows: [{ site_id: SITE, can_write: true }], detail: "" };
      if (query.startsWith("profiles?")) return { ok: true, rows: [{ id: OWNER, role: "manager" }, { id: MANAGER, role: "manager" }], detail: "" };
      if (query.startsWith("documents?")) return { ok: true, rows: c.docs, detail: "" };
      return { ok: false, rows: [], detail: "route inconnue" };
    },
    userRows: async () => ({ ok: true, rows: [{ id: DOSSIER }], detail: "HTTP 200" }),
    upload: async (token) => { c.calls.push("upload"); return c.upload(token); },
    getUser: async (uid) => { c.calls.push(`getUser:${uid === OWNER ? "owner" : uid === MANAGER ? "manager" : "other"}`); const u = c.users.get(uid); return u ? { status: 200, json: { id: uid, email: u.email } } : { status: 404, json: null }; },
    readManifest: async () => { c.calls.push("readManifest"); if (!c.manifest) throw new Error("manifeste absent"); return c.manifest; },
    record: async (kind, value, extra = {}) => {
      c.calls.push(`record:${kind}`);
      if (!created[kind].includes(value)) created[kind].push(value);
      const keep = c.manifest ? { suite: c.manifest.suite, revoke: c.manifest.revoke } : {};
      c.manifest = parseManifest(JSON.parse(manifestJson(RUN, REF, created, new Date(c.clock * 1000), [], { ...keep, ...extra })), REF);
    },
    recordValidated: async (kind, value) => { c.calls.push(`recordValidated:${kind}:${value === OWNER ? "owner" : value === MANAGER ? "manager" : "id"}`); },
    addSecret: (s) => c.secrets.push(s),
    forbidden: () => [...c.secrets],
    client: {
      listDocuments: async () => ({ ok: true, items: [], total: 0, detail: "" }),
      listObjects: async (prefix, o) => { c.calls.push(`listObjects:${o.search ? "search" : "scan"}`); seq++; return { ok: true, items: c.objects.filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1)).filter((n) => !o.search || n.includes(o.search)), total: null, detail: "" }; },
      deleteObjects: async () => { c.calls.push("DELETE-objects"); return { status: 200, detail: "" }; },
      deleteRows: async () => { c.calls.push("DELETE-rows"); return { status: 204, detail: "" }; },
      countRows: async () => 0,
      deleteUser: async () => { c.calls.push("DELETE-user"); return { status: 200 }; },
      userRemaining: async () => 0,
    },
    writeState: async (state, target) => { c.calls.push(`writeState:${target}`); c.states.push({ state, target }); },
    writeSql: async (path, text) => { c.sql[path] = text; },
    readResultFile: async (path) => { c.calls.push(`readResult:${path.split("/").pop()}`); return path in c.files ? c.files[path] : null; },
    log: async (status, step, detail) => { c.logs.push({ status, step, detail }); },
  };
  return { ...d, ...overrides };
}
async function prepared(c: Cloud) {
  const out = await revokePrepare(await deps(c));
  assert.equal(out.outcome, "prepared", c.logs.filter((l) => l.status === "fail").map((l) => l.step).join(" | "));
  return out.state!;
}

test("prepare: other-writer guard refuses before any creation; nominal prepare renders both SQL files, writes the state and the manifest fingerprint", async () => {
  const foreign = cloud();
  foreign.emails.push("qa-gw-exp-otherrun@qa.invalid");
  const refused = await revokePrepare(await deps(foreign));
  assert.equal(refused.outcome, "refused");
  assert.ok(!foreign.calls.some((x) => x.startsWith("createUser")), "nothing created");
  assert.ok(foreign.logs.some((l) => l.status === "fail" && /jamais effacés pour passer/.test(l.detail)));
  const c = cloud();
  const state = await prepared(c);
  assert.equal(state.ownerId, OWNER);
  assert.equal(state.managerId, MANAGER);
  assert.equal(state.dossierId, DOSSIER);
  assert.ok(state.managerToken.startsWith("eyJ"));
  assert.equal(state.managerTokenExp, T0 + 3600);
  assert.doesNotMatch(c.sql["/p/out/revoke-live-batch.sql"], /\{\{/);
  assert.ok(c.sql["/p/out/revoke-live-batch.sql"].includes(`qa-gw-rv-${RUN}-manager@qa.invalid`));
  assert.ok(c.sql["/p/out/revoke-live-observe.sql"].includes(`${MANAGER}/%`));
  assert.equal(c.manifest?.suite, "revoke");
  assert.equal(c.manifest?.revoke?.tokenSha256, await sha256Hex(state.managerToken));
  assert.doesNotMatch(JSON.stringify(c.manifest), /eyJ|Pw-memory/);
  assert.deepEqual(c.manifest?.created.userIds, [OWNER, MANAGER]);
  assert.ok(c.calls.indexOf(`createUser:${revokeEmail(RUN, "owner")}`) > c.calls.indexOf("listUsers"), "guard before creation");
  assert.ok(c.calls.includes("rpc:set_organization_member_site_access") && c.calls.includes("rpc:create_intervention"));
  assert.ok(c.logs.some((l) => /garde : un seul grant can_write/.test(l.step) && l.status === "pass"));
  assert.ok(c.logs.some((l) => l.status === "info" && /PREPARED — rien n’est prouvé/.test(l.step)));
  assert.doesNotThrow(() => parseRevokeState(JSON.parse(JSON.stringify(state)), REF));
  assert.throws(() => parseRevokeState({ ...state, managerId: OWNER }, REF), /gestionnaire = propriétaire/);
  assert.throws(() => parseRevokeState(JSON.parse(JSON.stringify(state)), "zzzzzzzzzzzzzzzzzzzz"), /Refus/);
});

// Emulates the gateway timeline: the object becomes visible right after the request is sent, the HTTP
// response arrives only after the harness has discovered it (finalize blocked by the batch), then the
// gateway's own compensation removes the object on 403.
async function gatewayUpload(c: Cloud, outcome: () => Promise<{ status: number; text: string }> | { status: number; text: string }, compensate = true) {
  c.objects.push(`${MANAGER}/${OBJ}`);
  while (!c.calls.includes("record:objectPaths")) await Promise.resolve();
  c.clock += 0.5;
  const r = await outcome();
  if (compensate && r.status === 403) c.objects = c.objects.filter((o) => o !== `${MANAGER}/${OBJ}`);
  return r;
}
async function liveWorld(mutate: (c: Cloud) => void = () => {}) {
  const c = cloud();
  const state = await prepared(c);
  c.calls.length = 0;
  c.clock += 60;
  c.upload = () => gatewayUpload(c, () => ({ status: 403, text: '{"error":"Accès refusé."}' }));
  const pid = 4242;
  const lock = c.clock + 0.2;
  c.files["/p/r.json"] = goodBatch({ t_begin: iso(c.clock), t_lock: iso(lock), t_before_revoke: iso(lock + 3), t_revoked: iso(lock + 3.1), t_after_commit: iso(lock + 3.2), batch_pid: pid });
  c.files["/p/o.json"] = goodObservation({ t_observed: iso(lock + 1), blocked_by: [pid] });
  mutate(c);
  return { c, state };
}
const files = { batchResultPath: "/p/r.json", observationPath: "/p/o.json" };

test("live nominal: proof → durable record → single upload → object discovered before the response → 403 → readbacks → files parsed → PASS; state consumed on the original file", async () => {
  const { c, state } = await liveWorld();
  const out = await revokeLive(state, await deps(c), files);
  assert.equal(out.outcome, "pass", out.verdict?.reasons.join(" | ") ?? "");
  assert.equal(out.cleanup, true);
  assert.equal(out.objectPath, `${MANAGER}/${OBJ}`);
  assert.equal(out.responseStatus, 403);
  const first = (x: string) => c.calls.findIndex((k) => k.startsWith(x));
  assert.ok(first("listUsers") < first("readManifest") && first("readManifest") < first("getUser:owner") && first("getUser:manager") < first("recordValidated:userIds:owner") && first("recordValidated:userIds:manager") < first("upload"), "guard → manifest → cohort proof → durable record → upload");
  assert.ok(c.calls.includes("recordValidated:interventionIds:id") && c.calls.includes("recordValidated:organizationIds:id"));
  assert.ok(c.calls.includes("record:objectPaths"), "discovered object recorded in the manifest");
  assert.ok(!c.calls.some((k) => k.startsWith("DELETE")), "the live phase never deletes");
  assert.deepEqual(c.states.at(-1)?.target, "original");
  assert.equal(c.states.at(-1)?.state.consumedAt, c.clock);
  assert.ok(c.logs.some((l) => l.status === "pass" && /verdict révocation pendant upload : pass/.test(l.step)));
});

test("live unknown outcomes: upload throws or 503 → UNKNOWN, cleanup permitted (reconcile path), no deletion by the live phase, no timer", async () => {
  for (const variant of ["throw", "503"] as const) {
    const { c, state } = await liveWorld((x) => { x.upload = () => gatewayUpload(x, () => { if (variant === "throw") throw new TypeError("fetch failed"); return { status: 503, text: '{"error":"Service indisponible"}' }; }, false); });
    const out = await revokeLive(state, await deps(c), files);
    assert.equal(out.outcome, "unknown", variant);
    assert.equal(out.cleanup, true);
    assert.ok(!c.calls.some((k) => k.startsWith("DELETE")), `${variant}: no deletion`);
    assert.ok(c.calls.includes("record:objectPaths"), `${variant}: the object seen is manifested for the discovery-first cleanup`);
    assert.ok(c.logs.some((l) => /issue inconnue/.test(l.step) || /issue inconnue/.test(l.detail)), variant);
  }
});

test("live refusals and documented failures: other writer, manifest/hash mismatch, token expired, lost race (201), object never observed, files never provided", async () => {
  const foreign = await liveWorld((x) => x.emails.push("qa-gw-exp-otherrun@qa.invalid"));
  const r1 = await revokeLive(foreign.state, await deps(foreign.c), files);
  assert.equal(r1.outcome, "refused");
  assert.equal(r1.cleanup, false);
  assert.ok(!foreign.c.calls.some((k) => k.startsWith("recordValidated") || k === "upload"));
  const tampered = await liveWorld();
  const r2 = await revokeLive({ ...tampered.state, managerToken: tokenFor(MANAGER, tampered.state.managerTokenExp) + "x" }, await deps(tampered.c), files);
  assert.equal(r2.outcome, "refused");
  assert.ok(!tampered.c.calls.some((k) => k.startsWith("getUser") || k.startsWith("recordValidated") || k === "upload"), "hash mismatch stops before any Auth read");
  const swapped = await liveWorld();
  const r3 = await revokeLive({ ...swapped.state, dossierId: SITE }, await deps(swapped.c), files);
  assert.equal(r3.outcome, "refused");
  const consumed = await liveWorld();
  assert.equal((await revokeLive({ ...consumed.state, consumedAt: T0 }, await deps(consumed.c), files)).outcome, "refused");
  const expired = await liveWorld((x) => { x.clock = T0 + 3600; });
  const r4 = await revokeLive(expired.state, await deps(expired.c), files);
  assert.equal(r4.outcome, "fail");
  assert.equal(r4.cleanup, true, "cohort proven: cleanup permitted");
  assert.ok(!expired.c.calls.includes("upload"), "no upload with an expired token");
  const won = await liveWorld((x) => { x.upload = () => gatewayUpload(x, () => { x.docs.push({ id: DOSSIER, path: `${MANAGER}/${OBJ}`, owner_id: MANAGER }); return { status: 201, text: '{"document":{"id":"x"}}' }; }, false); });
  const r5 = await revokeLive(won.state, await deps(won.c), files);
  assert.equal(r5.outcome, "fail");
  assert.match(r5.verdict?.reasons.join() ?? "", /perdu la course/);
  assert.ok(won.c.calls.includes("record:documentIds"), "the created row is manifested for cleanup");
  const silent = await liveWorld((x) => { x.upload = async () => ({ status: 403, text: '{"error":"Accès refusé."}' }); });
  const r6 = await revokeLive(silent.state, await deps(silent.c), files);
  assert.equal(r6.outcome, "fail");
  assert.match(r6.verdict?.reasons.join() ?? "", /objet jamais observé/);
  assert.ok(silent.c.clock >= T0 + 60 + REVOKE_DISCOVERY_MS / 1000, "the discovery window was fully waited");
  const noFiles = await liveWorld((x) => { delete x.files["/p/r.json"]; delete x.files["/p/o.json"]; });
  const before = noFiles.c.clock;
  const r7 = await revokeLive(noFiles.state, await deps(noFiles.c), files);
  assert.equal(r7.outcome, "fail");
  assert.match(r7.verdict?.reasons.join() ?? "", /non fourni/);
  assert.ok(noFiles.c.clock - before >= REVOKE_RESULT_WAIT_MS / 1000, "bounded wait fully observed");
  assert.ok(!noFiles.c.calls.some((k) => k.startsWith("DELETE")));
});

test("the orchestrator wires the revoke suites without replaying the nine scenarios; unknown outcome enters the reconcile path", async () => {
  const source = await readFile(new URL("../scripts/qa-gateway/run.mjs", import.meta.url), "utf8");
  assert.match(source, /\} else if \(mode === "revoke-prepare"\) \{[^]*?const prepared = await revokePrepare\(await revokeDeps\(\)\);/);
  assert.match(source, /\} else if \(mode === "revoke-live"\) \{[^]*?const live = await revokeLive\(state, await revokeDeps\(\), \{ batchResultPath: args\.batchResult, observationPath: args\.observation \}\);/);
  assert.match(source, /if \(live\.outcome === "unknown"\) interrupted = true;/);
  assert.match(source, /skipCleanup = !live\.cleanup;/);
  assert.match(source, /revoke-live-batch\.sql/);
  assert.match(source, /form\.set\("intervention_id", dossierId\)/);
  assert.doesNotMatch(source, /console\.log\([^)]*(managerToken|state\.)/);
});
