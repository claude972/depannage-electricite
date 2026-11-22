import test from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError, parseApiBody } from "../../components/app/api";
import { createWorkspaceReader, INVALID_WORKSPACE_MESSAGE, loadInitialWorkspace, validateWorkspace } from "../../components/app/workspace-reader";
import { createRefreshCoordinator } from "../../components/app/workspace-refresh";
import { decideDetail } from "../../components/app/detail-resolution";
import type { Workspace } from "../../components/app/types";

const USER = "11111111-1111-4111-8111-111111111111";
const valid = (over: Record<string, unknown> = {}) => ({
  profile: { id: USER, role: "client", full_name: "QA", phone: null, artisan_approved: null, created_at: "2026-10-31T00:00:00Z" },
  interventions: [{ id: "i1", status: "accepted", client_id: USER }],
  quotes: [{ id: "q1", intervention_id: "i1" }],
  sites: [],
  organizations: [],
  messages: [{ id: "m1", intervention_id: "i1" }],
  documents: [],
  reviews: [],
  payments: [],
  organization_members: [],
  artisan_profile: null,
  appointments: [],
  appointments_limit: 200,
  appointments_limited: false,
  ...over,
});

/** The REAL reader the shell uses, with an injected api and every side effect observed. */
function reader(reply: () => Promise<unknown>, expected: string | null = USER) {
  let seq = 0;
  const log = { applied: [] as Workspace[], signOuts: [] as (string | undefined)[], errors: [] as string[], paths: [] as string[] };
  const read = createWorkspaceReader({
    api: (path) => {
      log.paths.push(path);
      return reply();
    },
    nextSeq: () => ++seq,
    currentSeq: () => seq,
    expectedUser: () => expected,
    apply: (ws) => log.applied.push(ws),
    signOut: (m) => log.signOuts.push(m),
    setError: (m) => {
      if (m) log.errors.push(m);
    },
  });
  return { read, log, bump: () => ++seq };
}
const http = (status: number, body: string) => () => {
  try {
    return Promise.resolve(parseApiBody(status, status >= 200 && status < 300, body).data);
  } catch (e) {
    return Promise.reject(e);
  }
};

test("200 valid workspace ⇒ applied ⇒ loaded", async () => {
  const r = reader(http(200, JSON.stringify(valid())));
  assert.deepEqual(await r.read(), { kind: "loaded" });
  assert.equal(r.log.applied.length, 1);
  assert.equal(r.log.signOuts.length, 0);
});

test("200 {} ⇒ failed invalid_response: nothing applied, NO sign-out", async () => {
  const r = reader(http(200, "{}"));
  assert.deepEqual(await r.read(), { kind: "failed", status: 200, reason: "invalid_response" });
  assert.equal(r.log.applied.length, 0);
  assert.equal(r.log.signOuts.length, 0);
  assert.deepEqual(r.log.errors, [INVALID_WORKSPACE_MESSAGE]);
});

test("200 with a profile only (no collections) ⇒ failed, defaults never stand in for collections", async () => {
  const r = reader(http(200, JSON.stringify({ profile: valid().profile })));
  assert.equal((await r.read()).kind, "failed");
  assert.equal(r.log.applied.length, 0);
  assert.equal(r.log.signOuts.length, 0);
});

test("non-JSON 200 (parseApiBody 502) ⇒ failed 502, no sign-out", async () => {
  const r = reader(http(200, "<html>proxy</html>"));
  assert.deepEqual(await r.read(), { kind: "failed", status: 502 });
  assert.equal(r.log.applied.length + r.log.signOuts.length, 0);
});

test("invalid profile (missing id, unknown role) ⇒ failed", async () => {
  for (const profile of [{ role: "client" }, { id: USER, role: "superuser" }, null, "x"]) {
    const r = reader(http(200, JSON.stringify(valid({ profile }))));
    assert.equal((await r.read()).kind, "failed", JSON.stringify(profile));
    assert.equal(r.log.applied.length + r.log.signOuts.length, 0);
  }
});

test("invalid collection or essential record ⇒ failed", async () => {
  const cases: Record<string, unknown>[] = [
    { interventions: null },
    { quotes: {} },
    { interventions: [{ id: "i1" }] }, // no status
    { interventions: [{ status: "accepted" }] }, // no id
    { quotes: [{ id: "q1" }] }, // no intervention_id
    { messages: [{}] },
    { appointments: undefined },
    { artisan_profile: "x" },
  ];
  for (const over of cases) {
    const r = reader(http(200, JSON.stringify(valid(over))));
    assert.equal((await r.read()).kind, "failed", JSON.stringify(over));
    assert.equal(r.log.applied.length, 0);
  }
});

test("optional fields absent are legitimate (appointments_limit/limited, artisan_profile object)", () => {
  const w = valid({ artisan_profile: { user_id: USER } }) as Record<string, unknown>;
  delete w.appointments_limit;
  delete w.appointments_limited;
  assert.equal(validateWorkspace(w).ok, true);
});

test("401 ⇒ signed_out and the session is reset (the only HTTP status that does so)", async () => {
  const r = reader(http(401, JSON.stringify({ error: "Connectez-vous" })));
  assert.deepEqual(await r.read(), { kind: "signed_out" });
  assert.equal(r.log.signOuts.length, 1);
  assert.equal(r.log.applied.length, 0);
});

test("403, 503 and transport ⇒ failed, session kept", async () => {
  for (const [status, body] of [
    [403, JSON.stringify({ error: "Refusé" })],
    [503, JSON.stringify({ error: "Indisponible" })],
  ] as const) {
    const r = reader(http(status, body));
    assert.deepEqual(await r.read(), { kind: "failed", status });
    assert.equal(r.log.signOuts.length, 0);
  }
  const t = reader(() => Promise.reject(new ApiRequestError(0, "Connexion indisponible.")));
  assert.deepEqual(await t.read(), { kind: "failed", status: 0 });
  assert.equal(t.log.signOuts.length, 0);
});

test("workspace bootstrap retries one 503 and applies the next valid response", async () => {
  let first = true;
  const r = reader(() => {
    if (!first) return Promise.resolve(valid());
    first = false;
    return http(503, '{"error":"Indisponible"}')();
  });
  const c = createRefreshCoordinator({ read: r.read, contextKey: () => "g1|client||" });
  let waits = 0;
  const result = await loadInitialWorkspace(c.request, () => true, async () => { waits++; });
  assert.equal(result.kind, "loaded");
  assert.equal(waits, 1);
  assert.deepEqual(r.log.paths, ["/api/workspace", "/api/workspace"]);
  assert.equal(r.log.applied.length, 1);
  assert.equal(r.log.signOuts.length, 0);
});

test("workspace bootstrap never retries 401/403 and stops after a second 503", async () => {
  for (const [status, reads, outcome] of [[401, 1, "signed_out"], [403, 1, "failed"], [503, 2, "failed"]] as const) {
    const r = reader(http(status, '{"error":"Indisponible"}'));
    const c = createRefreshCoordinator({ read: r.read, contextKey: () => "g1|client||" });
    assert.equal((await loadInitialWorkspace(c.request, () => true, async () => {})).kind, outcome);
    assert.equal(r.log.paths.length, reads);
    assert.equal(r.log.applied.length, 0);
    assert.equal(r.log.signOuts.length, status === 401 ? 1 : 0);
  }
});

test("workspace bootstrap drops its retry after a different identity or generation is installed", async () => {
  for (const next of [{ userId: "other", generation: 2 }, { userId: USER, generation: 2 }]) {
    let session = { userId: USER, generation: 1 };
    const initial = session;
    const r = reader(http(503, '{"error":"Indisponible"}'));
    const c = createRefreshCoordinator({ read: r.read, contextKey: () => String(session.generation) });
    const result = await loadInitialWorkspace(
      c.request,
      () => session.userId === initial.userId && session.generation === initial.generation,
      async () => { session = next; },
    );
    assert.equal(result.kind, "superseded");
    assert.deepEqual(r.log.paths, ["/api/workspace"]);
  }
});

test("foreign identity ⇒ signed_out + reset, nothing applied", async () => {
  const other = valid({ profile: { ...valid().profile, id: "22222222-2222-4222-8222-222222222222" } });
  const r = reader(http(200, JSON.stringify(other)));
  assert.deepEqual(await r.read(), { kind: "signed_out" });
  assert.equal(r.log.signOuts.length, 1);
  assert.equal(r.log.applied.length, 0);
});

test("a superseded read (sequence moved on) applies nothing", async () => {
  let release: (v: unknown) => void = () => {};
  const r = reader(() => new Promise((res) => (release = res)));
  const p = r.read();
  r.bump();
  release(valid());
  assert.deepEqual(await p, { kind: "superseded" });
  assert.equal(r.log.applied.length, 0);
});

test("coordinator + real reader: a deep link after a 200 {profile only} reply is failed ⇒ error, never not_found", async () => {
  const r = reader(http(200, JSON.stringify({ profile: valid().profile })));
  const c = createRefreshCoordinator({ read: r.read, contextKey: () => "g1|client||" });
  const outcome = await c.request();
  assert.equal(outcome.kind, "failed");
  const attempt = outcome.kind === "failed" ? ({ state: "failed", status: outcome.status } as const) : ({ state: "loaded" } as const);
  assert.equal(decideDetail({ present: false, live: true, attempt }), "error");
});

test("artisan workspace with REDACTED offers (available_missions: no client, address, description) is valid", () => {
  const offer = { id: "o1", category: "outage", city: "Ville", postal_code: "972**", urgency: "urgent", status: "requested", estimate_min_cents: 1, estimate_max_cents: 2, created_at: "2026-10-31T00:00:00Z" };
  const w = valid({ profile: { ...valid().profile, role: "artisan" }, interventions: [offer] });
  assert.equal(validateWorkspace(w).ok, true);
});

test("an intervention with an unknown status is rejected (status set = DB check constraint)", () => {
  assert.equal(validateWorkspace(valid({ interventions: [{ id: "i1", status: "teleported" }] })).ok, false);
});
