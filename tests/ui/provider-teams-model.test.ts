// ART-12 provider teams UI — real model functions (contract aade14a copied exactly).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/provider-teams/model";

const m = loadModule("components/features/provider-teams/model.ts") as unknown as typeof Model;
const ui = loadModule("components/features/provider-teams/provider-teams-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const U = (p: string, n: number) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = U("1", 1), TEAM = U("7", 1), JOB = U("2", 1), TECH = U("1", 5), INV = U("9", 1);
const AT = "2026-11-07T10:00:00.000Z";
const team = (role: string, over: Record<string, unknown> = {}) => ({ id: TEAM, name: "Équipe Nord", owner_id: USER, version: 4, role, active: true, ...over });
const res = (status: number, body: unknown = null) => ({ status, body });
function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
const assign = (cid = U("c", 1), expected: number | null = null): Model.AnyCommand => ({ kind: "team", teamId: TEAM, body: { action: "assign", command_id: cid, expected_version: expected, intervention_id: JOB, technician_id: TECH } });
const receiptFor = (cmd: Model.AnyCommand, over: Record<string, unknown> = {}) => {
  const c = cmd.body as Record<string, unknown>;
  const st: Record<string, string> = { create: "created", rename: "renamed", invite: "pending", revoke_invitation: "revoked", remove_member: "inactive", accept_invitation: "accepted", decline_invitation: "declined", assign: "assigned", unassign: "unassigned" };
  const teamVersioned = !["assign", "unassign", "progress"].includes(String(c.action));
  const ev = typeof c.expected_version === "number" ? c.expected_version : null;
  return { team_id: cmd.kind === "team" ? cmd.teamId : c.team_id, action: c.action, team_version: teamVersioned && ev !== null ? ev + 1 : 4, entity_id: c.invitation_id ?? c.user_id ?? c.intervention_id ?? (cmd.kind === "team" ? cmd.teamId : c.team_id), entity_version: teamVersioned ? null : ev === null ? 1 : ev + 1, state: c.action === "set_role" ? c.role : c.action === "progress" ? c.state : st[String(c.action)], replayed: false, ...over };
};
function runnerHarness({ posts = [] as ((c: Model.AnyCommand) => Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ctx = { uid: USER as string | null, gen: 0 }, scope = `team:${TEAM}` } = {}) {
  const calls: { cmd: Model.AnyCommand; stored: string | null }[] = [];
  let s: Model.RunnerState = { ...m.RUNNER_INITIAL };
  let afters = 0, forbidden = 0;
  const api = { teams: async () => res(200), team: async () => res(200), mission: async () => res(200), invitations: async () => res(200), send: async (cmd: Model.AnyCommand) => (calls.push({ cmd, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen, scope)) ?? null }), (posts.shift() ?? (() => res(503)))(cmd)) };
  const r = m.createRunner({ api: () => api, store: () => store, context: { generation: () => ctx.gen, userId: () => ctx.uid }, scope, get: () => s, set: (n) => (s = n), after: async () => void afters++, onForbidden: () => void forbidden++ });
  return { r, calls, ctx, get: () => s, afters: () => afters, forbidden: () => forbidden };
}

test("lecture stricte : pages (ordre, next_after), section d’équipe, suivi de mission sans prix ni document", () => {
  assert.ok(m.parseTeams({ records: [team("owner")], next_after: null }, null));
  for (const bad of [{ records: [team("owner")], next_after: TEAM }, { records: [team("boss")], next_after: null }, { records: [team("owner", { id: U("7", 3) }), team("owner", { id: U("7", 2) })], next_after: null }, { records: [{ ...team("owner"), price: 1 }], next_after: null }])
    assert.equal(m.parseTeams(bad, null), null, JSON.stringify(bad).slice(0, 60));
  const members = { team: team("owner"), section: "members", records: [{ id: USER, full_name: "Alex", role: "owner", active: true, version: 1 }], next_after: null };
  assert.ok(m.parseTeamPage(members, TEAM, "members", null));
  assert.equal(m.parseTeamPage({ ...members, section: "missions" }, TEAM, "members", null), null);
  assert.equal(m.parseTeamPage({ ...members, team: team("owner", { id: U("7", 9) }) }, TEAM, "members", null), null);
  const mission = { team_id: TEAM, intervention: { id: JOB, category: "panel", status: "in_progress", description: "Tableau qui disjoncte", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France" }, appointment: null, assignment: { version: 2, technician_id: TECH, state: "assigned", updated_at: AT, note: "" }, permissions: { can_assign: false, can_acknowledge: true, can_complete: false } };
  assert.ok(m.parseMission(mission, TEAM, JOB));
  for (const extra of [{ total_cents: 100 }, { documents: [] }, { client_phone: "0696" }]) assert.equal(m.parseMission({ ...mission, intervention: { ...mission.intervention, ...extra } }, TEAM, JOB), null, JSON.stringify(extra));
  assert.equal(m.parseMission({ ...mission, quote: {} }, TEAM, JOB), null);
  assert.equal(m.parseMission(mission, TEAM, U("2", 9)), null);
  assert.ok(m.parseMyInvitations({ records: [{ id: INV, team_id: TEAM, team_name: "Équipe Nord", role: "technician", expires_at: AT, team_active: true }], next_after: null }, null));
});

test("reçu : action, entité, état attendu et version exacts (comme la route)", () => {
  const a = assign(U("c", 1), 2);
  assert.ok(m.parseReceipt(receiptFor(a), a));
  for (const over of [{ state: "done" }, { entity_id: U("2", 9) }, { entity_version: 5 }, { action: "unassign" }, { team_id: U("7", 9) }]) assert.equal(m.parseReceipt(receiptFor(a, over), a), null, JSON.stringify(over));
  const roleCmd: Model.AnyCommand = { kind: "team", teamId: TEAM, body: { action: "set_role", command_id: U("c", 2), expected_version: 4, user_id: TECH, role: "coordinator" } };
  assert.ok(m.parseReceipt(receiptFor(roleCmd), roleCmd));
  assert.equal(m.parseReceipt(receiptFor(roleCmd, { team_version: 4 }), roleCmd), null);
  const acc: Model.AnyCommand = { kind: "invitation", body: { action: "accept_invitation", team_id: TEAM, invitation_id: INV, command_id: U("c", 3) } };
  assert.ok(m.parseReceipt(receiptFor(acc), acc));
});

test("matrice des droits (rôle serveur) : propriétaire / coordinateur / technicien / équipe inactive", () => {
  same([m.teamActions(team("owner") as Model.Team), m.teamActions(team("coordinator") as Model.Team), m.teamActions(team("technician") as Model.Team), m.teamActions(team("owner", { active: false }) as Model.Team)], [
    { admin: true, assign: true, invitationsVisible: true },
    { admin: false, assign: true, invitationsVisible: false },
    { admin: false, assign: false, invitationsVisible: false },
    { admin: false, assign: false, invitationsVisible: true },
  ]);
  same(m.activeTechnicians([{ id: TECH, full_name: "T", role: "technician", active: true, version: 1 }, { id: U("1", 6), full_name: "R", role: "technician", active: false, version: 1 }, { id: U("1", 7), full_name: "C", role: "coordinator", active: true, version: 1 }]).map((x) => x.id), [TECH]);
  // ART-12: same statuses as the server's permissions.can_assign (no assignment offered on a closed dossier).
  same(["assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled", "requested"].map(m.canAssignStatus), [true, true, true, true, false, false, false, false]);
  const now = Date.parse(AT);
  same([m.futureInstant("", now), m.futureInstant("2026-01-01T09:00", now) === null, typeof m.futureInstant("2027-01-01T10:00", now)], [null, true, "string"]);
});

test("barrière d’identité : écrite et relue AVANT le POST ; stockage KO ⇒ 0 POST ; 503 ⇒ même commande ; identité changée ⇒ ni appliqué ni rejoué", async () => {
  const mem = memStore();
  const h = runnerHarness({ store: mem.store, posts: [(c) => res(200, receiptFor(c))] });
  same(await h.r.run(assign()), "ok");
  same([JSON.parse(h.calls[0].stored!).command, mem.map.size, h.afters(), h.get().notice], [assign(), 0, 1, m.ACTION_NOTICE.assign]);
  for (const store of [null, { get: () => null, set: () => { throw new Error("q"); }, remove: () => {} }, { get: () => "x", set: () => {}, remove: () => {} }] as (Model.Store | null)[]) {
    const x = runnerHarness({ store });
    same([await x.r.run(assign()), x.calls.length, x.get().error], ["storage", 0, m.COPY.storage]);
  }
  const anon = runnerHarness({ ctx: { uid: null, gen: 0 } });
  same([await anon.r.run(assign()), anon.calls.length], ["storage", 0]);
  const wrongScope = runnerHarness({ scope: "invitation" });
  same([await wrongScope.r.run(assign()), wrongScope.calls.length], ["storage", 0]);
  const keep = memStore();
  const a = runnerHarness({ store: keep.store, posts: [() => res(m.PT_TIMEOUT), () => res(503), (c) => res(200, receiptFor(c, { state: "done" }))] });
  same(await a.r.run(assign()), "pending");
  same(await a.r.run(assign(U("c", 9))), "ignored", "no new command while one waits");
  same(await a.r.retry(), "pending");
  same(await a.r.retry(), "pending", "unverifiable 200 keeps the same command");
  same(a.calls.map((c) => JSON.stringify(c.cmd)), Array(3).fill(JSON.stringify(assign())));
  const b = runnerHarness({ store: keep.store, posts: [(c) => res(200, receiptFor(c))] });
  b.r.restore();
  same([JSON.stringify(b.get().pending), b.calls.length], [JSON.stringify(assign()), 0], "restored, never sent by itself");
  same(await b.r.retry(), "ok");
  keep.map.set(m.pendingKey(USER, 1, `team:${TEAM}`), JSON.stringify({ uid: USER, gen: 0, scope: `team:${TEAM}`, command: assign() }));
  const other = runnerHarness({ store: keep.store, ctx: { uid: USER, gen: 1 } });
  other.r.restore();
  same([other.get().pending, keep.map.size], [null, 0]);
  keep.map.set(m.pendingKey(USER, 0, `team:${TEAM}`), JSON.stringify({ uid: USER, gen: 0, scope: `team:${TEAM}`, command: { kind: "team", teamId: TEAM, body: { action: "assign" } } }));
  const malformed = runnerHarness({ store: keep.store });
  malformed.r.restore();
  same([malformed.get().pending, keep.map.size], [null, 0]);
  let release!: (r: Model.Result) => void;
  const g = runnerHarness({ posts: [() => new Promise((r) => (release = r))] });
  const p = g.r.run(assign());
  g.ctx.gen = 1;
  release(res(200, receiptFor(assign())));
  same([await p, g.afters(), g.get().notice], ["ignored", 0, ""]);
  const r2 = runnerHarness({ posts: [() => res(503)] });
  await r2.r.run(assign());
  r2.ctx.uid = U("1", 2);
  same([await r2.r.retry(), r2.get().pending, r2.calls.length], ["ignored", null, 1]);
});

test("401/403 ⇒ tout effacé ; 409 ⇒ relecture sans rejeu ; 422 / 404 / 429 refus honnête", async () => {
  for (const status of [401, 403]) {
    const mem = memStore();
    const h = runnerHarness({ store: mem.store, posts: [() => res(status)] });
    same([await h.r.run(assign()), mem.map.size, h.forbidden(), h.get().pending], ["forbidden", 0, 1, null]);
  }
  const mem = memStore();
  const c = runnerHarness({ store: mem.store, posts: [() => res(409)] });
  same([await c.r.run(assign()), c.get().error, mem.map.size, c.afters()], ["conflict", m.COPY.conflict, 0, 1]);
  same(await c.r.retry(), "ignored");
  for (const [status, copy] of [[422, m.COPY.invalid], [404, m.COPY.notFound], [429, m.COPY.limited]] as const) {
    const x = runnerHarness({ posts: [() => res(status)] });
    same([await x.r.run(assign()), x.get().error, x.get().pending], ["refused", copy, null], String(status));
  }
});

test("démo : note honnête, aucun appel ; suivi technicien sans prix, paiement ni document", () => {
  let calls = 0;
  const api = { teams: async () => (calls++, res(200)), team: async () => (calls++, res(200)), mission: async () => (calls++, res(200)), invitations: async () => (calls++, res(200)), send: async () => (calls++, res(200)) };
  const html = renderToString(createElement(ui.ProviderTeamsPanel, { demo: true, context: { generation: () => 0, userId: () => USER }, api }));
  assert.match(html, /aucune équipe n’est lue ni modifiée/);
  same(calls, 0);
  const mission = { team_id: TEAM, intervention: { id: JOB, category: "panel", status: "in_progress", description: "Tableau qui disjoncte", address: "12 rue des Alizés", postal_code: "97200", city: "Fort-de-France" }, appointment: { starts_at: AT, ends_at: AT }, assignment: { version: 2, technician_id: TECH, state: "assigned", updated_at: AT, note: "Clé chez le gardien" }, permissions: { can_assign: false, can_acknowledge: true, can_complete: false } };
  const deps = { api: () => api, store: () => null, context: { generation: () => 0, userId: () => USER }, newId: () => null, now: () => 0 };
  const follow = renderToString(createElement(ui.MissionFollowUp, { deps, teamId: TEAM, jobId: JOB, run: async () => "ok", locked: false, initial: m.parseMission(mission, TEAM, JOB) }));
  assert.match(follow, /data-pt-ack=""/);
  assert.doesNotMatch(follow, /data-pt-done/);
  assert.doesNotMatch(follow, /€|Payer|payé|Devis|Facture|Document|PDF|téléphone/i);
});
