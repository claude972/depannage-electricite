// WEB-TRACKING-QA-006 scenarios (contract §6 + A1–A5). Every browser position is EMULATED by
// Playwright (setGeolocation on fixed PUBLIC coordinates) and labelled POSITION_SOURCE; nothing
// here is a physical GPS proof. Every mutator goes through the stop gate and a durable intent.
// A UI deviation (missing/renamed control or text) is a FAIL (A5.5): assertions use AppDefect /
// node:assert, never an ANOMALY to pass a gate.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AppDefect } from "../qa/lib/report.mjs";
import { newPage, login, logout, openHash, goHash, capture, expectVisible, waitForWorkspace } from "../qa/lib/browser.mjs";
import { UI, VIEWS, PUBLIC_POINTS, NOMINAL_ACCURACY_M, REJECTED_ACCURACY_M, CONSENT_POLICY, POSITION_SOURCE, POSITION_DISCLAIMER, REASSIGNMENT_SOURCE, REASSIGNMENT_DISCLAIMER, LIMITS, trackingPath, routePath, geocodePath } from "./lib/constants.mjs";
import { snapshotEvidence } from "./lib/position-redact.mjs";
import { recordTrackingRequests, actions, queryViolations, restartViolations, publicView } from "./lib/requests.mjs";
import { classifyRoute, classifyGeocode } from "./lib/provider-proof.mjs";
import { act, gatedWait, createMutationGuard, trackBrowserMutations } from "./lib/guard.mjs";
import { assertUnknownIs404 } from "./lib/preflight.mjs";
import { observeTrackingNetwork, DIAG_LIMITS, KNOWN_REASONS } from "./lib/diagnostics.mjs";

const POSITION_KEYS = ["latitude", "longitude", "position", "geometry", "destination"];

/**
 * Fixtures wrapped with durable intents. Each service write is: gate check (no intent when already
 * stopping) → intent announced → emission inside `mutation()` (synchronous re-check, registered in
 * the drain). An unknown outcome keeps the intent OPEN with a readback able to prove the state.
 */
export class TrackingFixtures {
  constructor({ fixtures, intents, cohort, gate, auth = null }) {
    this.f = fixtures;
    this.intents = intents;
    this.cohort = cohort;
    this.gate = gate;
    this.auth = auth;
    this.guard = createMutationGuard(gate);
  }
  get db() {
    return this.f.db; // writes guarded by the shared stop gate; reads are plain
  }
  write(op, target, key, fn, reconcile) {
    this.gate.check();
    return this.guard.mutation(() => this.intents.wrap(op, target, key, fn, { reconcile, kind: "service" }));
  }
  createUser(label, role, options) {
    const email = this.cohort.email(label);
    return this.write("createAuthUser", "auth.users", email, () => this.f.createUser(label, role, options), async () => {
      if (!this.auth) return { proven: false };
      // Bounded exhaustive search (P2-d): only "found" proves the state; an absence — even after
      // every scan was exhaustive and the deadline passed — keeps the intent OPEN (exit 3).
      const found = await this.auth.searchByEmail(email, this.cohort.runId);
      if (found.state !== "found") return { proven: false, note: found.state };
      await this.f.track("auth_users", found.id);
      await this.f.track("profiles", found.id);
      return { proven: true, note: "account exists, recorded for deletion" };
    });
  }
  createOrganization(owner, label) {
    return this.write("insert", "organizations", label, () => this.f.createOrganization(owner, label), async () => {
      const rows = await this.f.db.select("organizations", { owner_id: `eq.${owner.id}`, name: `eq.${this.cohort.name(label)}` }, "id");
      if (!rows.length) return { proven: false, note: "absent at readback (absence alone never closes an intent)" };
      await this.f.track("organizations", ...rows.map((r) => r.id));
      return { proven: true, note: "organization exists, recorded" };
    });
  }
  addMember(org, user, role) {
    return this.write("insert", "organization_members", `${org.id}:${user.id}`, () => this.f.addMember(org, user, role), async () => ((await this.f.db.select("organization_members", { organization_id: `eq.${org.id}`, user_id: `eq.${user.id}` }, "user_id")).length ? { proven: true, note: "membership exists, removed with the organization" } : { proven: false, note: "absent at readback" }));
  }
  createSite(org, label) {
    return this.write("insert", "sites", label, () => this.f.createSite(org, label), async () => {
      const rows = await this.f.db.select("sites", { organization_id: `eq.${org.id}`, name: `eq.${this.cohort.name(label)}` }, "id");
      if (!rows.length) return { proven: false, note: "absent at readback (absence alone never closes an intent)" };
      await this.f.track("sites", ...rows.map((r) => r.id));
      return { proven: true, note: "site exists, recorded" };
    });
  }
  setSiteScope(org, user, scope, grants) {
    return this.write("upsert", "organization_member_site_scopes", `${org.id}:${user.id}`, () => this.f.setSiteScope(org, user, scope, grants), async () => ((await this.f.db.select("organization_member_site_scopes", { organization_id: `eq.${org.id}`, user_id: `eq.${user.id}`, scope: `eq.${scope}` }, "user_id")).length ? { proven: true, note: "scope observed, removed with the organization" } : { proven: false, note: "absent at readback" }));
  }
  createIntervention(spec) {
    // The id is generated and written to the manifest BEFORE the insert: deleting it by id is exact.
    // Proven only when the row is OBSERVED (its id is already in the manifest for deletion).
    const index = this.f.manifest.created.interventions.length; // this call's id lands at this index (tracked before the insert)
    return this.write("insert", "interventions", spec.description || "dossier", () => this.f.createIntervention(spec), async () => {
      const id = this.f.manifest.created.interventions[index];
      const rows = id ? await this.f.db.select("interventions", { id: `eq.${id}` }, "id") : [];
      return rows.length ? { proven: true, note: "row observed, id recorded before the insert" } : { proven: false, note: "absent at readback" };
    });
  }
  /** Update proven only when every patched field is observed on the row (by id). */
  update(table, filters, patch, key) {
    const id = String(filters.id || "").replace(/^eq\./, "");
    return this.write("update", table, key, () => this.f.db.update(table, filters, patch), async () => {
      if (!id) return { proven: false };
      const [row] = await this.f.db.select(table, { id: `eq.${id}` }, Object.keys(patch).join(","));
      return row && Object.entries(patch).every(([k, v]) => row[k] === v) ? { proven: true, note: "patch observed" } : { proven: false };
    });
  }
  remove(table, filters, key) {
    return this.write("delete", table, key, () => this.f.db.delete(table, filters), async () => ((await this.f.db.count(table, filters)) === 0 ? { proven: true, note: "rows absent" } : { proven: false }));
  }
  insert(table, rows, key, filters) {
    return this.write("insert", table, key, () => this.f.db.insert(table, rows), async () => (filters && (await this.f.db.count(table, filters)) > 0 ? { proven: true, note: "row observed" } : { proven: false }));
  }
}

// ---------------------------------------------------------------------------------------------
// Cohort: the first technical account is announced by a durable intent BEFORE its creation, then
// authenticated, then the unknown-UUID 404 preflight runs (A5.1). Everything else follows.
export const PREFLIGHT_SESSION = "preflight-client";
export async function setupCohort(ctx) {
  const { tf } = ctx;
  const u = {};
  u.client = await tf.createUser("client", "client");
  // A9: the authenticated unknown-UUID 404 runs in a DEDICATED context, closed in every path; the
  // scenario sessions (`client` included) only open AFTER the complete seed, as for a real client
  // who already has the intervention when opening the app. The stale-session case is a separate
  // PRODUCT finding (LIVE-WORKSPACE-001, lead), not closed by this precondition.
  try {
    const preflight = await ctx.freshSession(PREFLIGHT_SESSION, u.client);
    assertUnknownIs404(await ctx.api.get(preflight.page, trackingPath(randomUUID())));
  } finally {
    await ctx.closeSession(PREFLIGHT_SESSION);
  }
  ctx.log("preflight: authenticated GET on an unknown dossier → 404 (RLS), dedicated context closed");
  u.artisanA = await tf.createUser("artisan-a", "artisan");
  u.artisanB = await tf.createUser("artisan-b", "artisan");
  u.artisanC = await tf.createUser("artisan-c", "artisan", { approved: false });
  u.artisanD = await tf.createUser("artisan-d", "artisan");
  u.owner = await tf.createUser("owner", "manager");
  u.manager = await tf.createUser("manager", "manager");
  u.viewer = await tf.createUser("viewer", "manager");
  u.outsider = await tf.createUser("outsider", "client");
  u.otherOrg = await tf.createUser("other-org", "manager");
  const org = await tf.createOrganization(u.owner, "Org tracking");
  await tf.addMember(org, u.manager, "manager");
  await tf.addMember(org, u.viewer, "viewer");
  const site = await tf.createSite(org, "Site S1");
  await tf.setSiteScope(org, u.viewer, "selected", [{ site_id: site.id, can_write: false }]);
  const org2 = await tf.createOrganization(u.otherOrg, "Org tierce");
  await tf.createSite(org2, "Site S2");
  const job = (label, extra) => tf.createIntervention({ client: u.client, artisan: u.artisanA, status: "accepted", description: `tracking ${label}`, ...extra });
  const j = {
    main: await job("principal"),
    site: await tf.createIntervention({ client: u.manager, artisan: u.artisanA, site, status: "accepted", description: "tracking site S1" }),
    reassign: await job("réaffectation"),
    restartFail: await job("reprise refusée"),
    suspend: await tf.createIntervention({ client: u.client, artisan: u.artisanD, status: "accepted", description: "tracking suspension" }),
    complete: await job("fin"),
    isoA: await job("isolation A"),
    isoB: await job("isolation B"),
    refused: await job("refus"),
    reload: await job("rechargement"),
  };
  Object.assign(ctx, { users: u, jobs: j, org, site });
  return { users: Object.keys(u).length, interventions: Object.keys(j).length };
}

// ---------------------------------------------------------------------------------------------
// Helpers
const pointPayload = (sessionId, seq, where = PUBLIC_POINTS.savane, accuracy = NOMINAL_ACCURACY_M) => ({ session_id: sessionId, seq, latitude: where.latitude, longitude: where.longitude, accuracy_m: accuracy, sampled_at: new Date().toISOString() });
async function snap(ctx, page, id) {
  const a = await ctx.api.get(page, trackingPath(id));
  return a;
}
async function okSnap(ctx, page, id, what) {
  const a = await snap(ctx, page, id);
  assert.equal(a.status, 200, `${what}: GET snapshot ${a.status}`);
  assert.match(a.cache || "", /no-store/, `${what}: snapshot without no-store`);
  return a.body;
}
async function command(ctx, page, id, action, expected, payload) {
  return ctx.api.post(page, trackingPath(id), { action, expected_version: expected, payload }, `${action}:${id}`);
}
async function start(ctx, page, id, sessionId = randomUUID()) {
  const before = await okSnap(ctx, page, id, "start");
  const a = await command(ctx, page, id, "start", before.tracking.control_version, { session_id: sessionId, consent: true, consent_policy: CONSENT_POLICY });
  assert.equal(a.status, 200, `start answered ${a.status}`);
  return { sessionId, snapshot: a.body };
}
/**
 * A10: precondition « dossier not shared » before opening a panel. Not shared ⇒ nothing sent.
 * Shared ⇒ stop with CAS (current control_version + current session id, same identity, durable
 * intent through ctx.api), 200 required, then READ BACK shared=false. Otherwise BLOCKED.
 */
export function preconditionBlocked(message) {
  const error = new Error(`precondition: ${message}`);
  error.blocked = true;
  return error;
}
/** UNKNOWN (never PASS): a read or a write whose shape/outcome cannot be proven. */
export function preconditionUnknown(message) {
  const error = new Error(`UNKNOWN precondition: ${message}`);
  error.blocked = true;
  error.unknown = true;
  return error;
}
const shareShape = (body) => {
  const t = body?.tracking;
  if (!t || typeof t !== "object" || typeof t.shared !== "boolean" || !Number.isInteger(t.control_version)) return null;
  if (t.shared && (typeof t.session_id !== "string" || !t.session_id)) return null;
  return t;
};
export async function ensureUnshared(ctx, page, id, what) {
  const before = shareShape(await okSnap(ctx, page, id, `${what} precondition`));
  if (!before) throw preconditionUnknown(`${what}: snapshot without a recognised tracking shape`);
  if (!before.shared) return { stopped: false };
  const r = await command(ctx, page, id, "stop", before.control_version, { session_id: before.session_id });
  if (r.outcome === "unknown") throw preconditionUnknown(`${what}: stop outcome unknown (status ${r.status}); the intent stays open`);
  if (r.status !== 200) throw preconditionBlocked(`${what}: inherited share could not be stopped (status ${r.status}${KNOWN_REASONS.includes(r.body?.reason) ? `, ${r.body.reason}` : ""})`);
  const after = shareShape(await okSnap(ctx, page, id, `${what} precondition readback`));
  if (!after) throw preconditionUnknown(`${what}: readback without a recognised tracking shape`);
  if (after.shared !== false) throw preconditionBlocked(`${what}: still shared after the stop (readback)`);
  return { stopped: true };
}
/** A10: the MAIN dossier, same artisan A identity as the T14 page. */
export const ensureUnsharedMain = (ctx, page) => ensureUnshared(ctx, page, ctx.jobs.main.id, "T14 main");
function noPositionIn(body, what) {
  const text = JSON.stringify(body ?? null);
  for (const key of POSITION_KEYS) if (new RegExp(`"${key}"\\s*:\\s*[\\[{0-9-]`).test(text)) throw new AppDefect(`${what}: refusal body exposes "${key}"`);
}
function evidence(s, label, snapshot) {
  s.note(`${label}: ${JSON.stringify(snapshotEvidence(snapshot))}`);
}
const panel = (page) => page.locator("section").filter({ has: page.getByRole("heading", { name: UI.artisanPanelTitle, exact: true }) }).first();
const card = (page) => page.locator("section").filter({ has: page.getByRole("heading", { name: UI.clientCardTitle, exact: true }) }).first();
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * A8 §2: the sentence is rendered INSIDE a longer <p role="status"> (« … de la page. L’arrêt côté
 * service est tenté ; … 60 s. »), so an exact text match can never succeed. Equally strict: the
 * status element of the artisan panel containing the WHOLE sentence (case-sensitive), exactly one
 * (Playwright strict mode), AND the « Reprendre le partage » button of that panel visible.
 */
export const reloadInterruptedStatus = (page) => panel(page).getByRole("status").filter({ hasText: new RegExp(escapeRe(UI.reloadInterrupted)) });
export async function expectReloadInterrupted(page) {
  const status = reloadInterruptedStatus(page);
  await expectVisible(status, `status « ${UI.reloadInterrupted} »`);
  const count = await status.count();
  if (count !== 1) throw new AppDefect(`expected exactly one status « ${UI.reloadInterrupted} », found ${count}`);
  await expectVisible(panel(page).getByRole("button", { name: UI.resume, exact: true }), `« ${UI.resume} »`);
}
async function emulate(handle, base, where = PUBLIC_POINTS.savane, accuracy = NOMINAL_ACCURACY_M) {
  await handle.context.grantPermissions(["geolocation"], { origin: new URL(base).origin });
  await handle.context.setGeolocation({ latitude: where.latitude, longitude: where.longitude, accuracy });
}
async function openArtisanPanel(ctx, handle, jobId) {
  await openHash(handle.page, ctx.base, VIEWS.artisan(jobId));
  await expectVisible(panel(handle.page), `artisan tracking panel « ${UI.artisanPanelTitle} »`);
  return panel(handle.page);
}
async function uiStart(ctx, handle, jobId, s) {
  const p = await openArtisanPanel(ctx, handle, jobId);
  await act(ctx.gate, () => p.getByRole("button", { name: UI.share, exact: true }).click());
  await expectVisible(p.getByRole("button", { name: UI.consent, exact: true }), `« ${UI.consent} »`);
  await expectVisible(p.getByRole("button", { name: UI.cancel, exact: true }), `« ${UI.cancel} »`);
  await act(ctx.gate, () => p.getByRole("button", { name: UI.consent, exact: true }).click());
  await expectVisible(p.getByText(UI.declaredSource, { exact: true }), `« ${UI.declaredSource} »`);
  s.note(POSITION_DISCLAIMER);
  return p;
}
async function waitFor(ctx, predicate, what, timeoutMs = 30000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await predicate()) return;
    await gatedWait(ctx.gate, 300);
  }
  throw new AppDefect(`${what} not observed within ${timeoutMs} ms`);
}

// ---------------------------------------------------------------------------------------------
// Scenarios. Each receives (ctx, s) where s is the shared report scenario handle.
export const SCENARIO_RUNNERS = {
  async T1(ctx, s) {
    // Permission refused: no grant → the browser denies geolocation. Zero points, server untouched.
    const h = await ctx.freshSession("artisanA", ctx.users.artisanA);
    await h.context.clearPermissions();
    const reqs = recordTrackingRequests(h.page);
    const p = await openArtisanPanel(ctx, h, ctx.jobs.refused.id);
    await act(ctx.gate, () => p.getByRole("button", { name: UI.share, exact: true }).click());
    await act(ctx.gate, () => p.getByRole("button", { name: UI.consent, exact: true }).click());
    await expectVisible(h.page.getByText(UI.permissionRefused, { exact: true }), "permission refused message");
    await gatedWait(ctx.gate, 6000);
    assert.equal(actions(reqs, "point").length, 0, "a point was sent although the permission was refused");
    const body = await okSnap(ctx, h.page, ctx.jobs.refused.id, "T1");
    assert.equal(body.tracking.position, null, "position must be null");
    // A start may have been accepted before the browser refused; the UI must then stop it.
    if (body.tracking.shared) throw new AppDefect("sharing left active after a refused permission");
    evidence(s, "T1", body);
    await capture(h, ctx.out, "t1-permission-refused-1280", s);
    s.network(publicView(reqs));
    await ctx.closeSession("artisanA");
  },

  async T2(ctx, s) {
    const h = await ctx.session("artisanA", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const reqs = recordTrackingRequests(h.page);
    const p = await openArtisanPanel(ctx, h, ctx.jobs.main.id);
    await act(ctx.gate, () => p.getByRole("button", { name: UI.share, exact: true }).click());
    await act(ctx.gate, () => p.getByRole("button", { name: UI.cancel, exact: true }).click());
    await gatedWait(ctx.gate, 3000);
    assert.equal(reqs.filter((r) => r.method === "POST").length, 0, "Annuler must send nothing (browser permission alone is not consent)");
    const before = await okSnap(ctx, h.page, ctx.jobs.main.id, "T2");
    const refused = await command(ctx, h.page, ctx.jobs.main.id, "start", before.tracking.control_version, { session_id: randomUUID(), consent: false, consent_policy: CONSENT_POLICY });
    assert.equal(refused.status, 422, `consent:false answered ${refused.status}`);
    const after = await okSnap(ctx, h.page, ctx.jobs.main.id, "T2");
    assert.equal(after.tracking.control_version, before.tracking.control_version, "control_version changed on a refused start");
    assert.equal(after.tracking.shared, false);
  },

  async T3(ctx, s) {
    const h = await ctx.session("artisanA", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const reqs = recordTrackingRequests(h.page);
    const before = await okSnap(ctx, h.page, ctx.jobs.main.id, "T3");
    await uiStart(ctx, h, ctx.jobs.main.id, s);
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "first accepted point");
    const starts = actions(reqs, "start");
    assert.equal(starts.length, 1, "exactly one start expected");
    assert.equal(starts[0].status, 200, "start must be accepted");
    const firstPoint = reqs.findIndex((r) => r.action === "point");
    assert.ok(reqs.indexOf(starts[0]) < firstPoint, "the start response must precede the first point");
    const body = await okSnap(ctx, h.page, ctx.jobs.main.id, "T3");
    assert.equal(body.tracking.shared, true);
    assert.equal(body.tracking.travel_stage, "en_route");
    assert.equal(body.tracking.control_version, before.tracking.control_version + 1);
    // Replay with the same session id: same state; another id while sharing: 409.
    const replay = await command(ctx, h.page, ctx.jobs.main.id, "start", body.tracking.control_version, { session_id: body.tracking.session_id, consent: true, consent_policy: CONSENT_POLICY });
    assert.equal(replay.status, 200, `same-session start replay answered ${replay.status}`);
    assert.equal(replay.body.tracking.control_version, body.tracking.control_version, "replay must not restart");
    const other = await command(ctx, h.page, ctx.jobs.main.id, "start", body.tracking.control_version, { session_id: randomUUID(), consent: true, consent_policy: CONSENT_POLICY });
    assert.equal(other.status, 409, `start with another session while sharing answered ${other.status}`);
    ctx.state.mainSession = body.tracking.session_id;
    evidence(s, "T3", body);
    await capture(h, ctx.out, "t3-sharing-1280", s);
    s.network(publicView(reqs));
    assert.equal(queryViolations(reqs).length, 0, "a tracking URL carried a query string");
  },

  async T4(ctx, s) {
    // API ordering on a dedicated session (the UI watch of T3 is closed first).
    await ctx.closeSession("artisanA");
    const api = await ctx.session("artisanA-api", ctx.users.artisanA);
    let body = await okSnap(ctx, api.page, ctx.jobs.main.id, "T4");
    if (body.tracking.shared) {
      const stop = await command(ctx, api.page, ctx.jobs.main.id, "stop", body.tracking.control_version, { session_id: body.tracking.session_id });
      assert.equal(stop.status, 200);
    }
    const { sessionId } = await start(ctx, api.page, ctx.jobs.main.id);
    body = await okSnap(ctx, api.page, ctx.jobs.main.id, "T4");
    const v = body.tracking.control_version;
    const p1 = pointPayload(sessionId, 1);
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, p1)).status, 200, "seq 1");
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, p1)).status, 200, "identical duplicate must be accepted");
    const tooFast = await command(ctx, api.page, ctx.jobs.main.id, "point", v, pointPayload(sessionId, 2));
    assert.equal(tooFast.status, 429, `point within 5 s answered ${tooFast.status}`);
    await gatedWait(ctx.gate, LIMITS.pointIntervalMs + 300);
    const p2 = pointPayload(sessionId, 2, PUBLIC_POINTS.airport);
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, p2)).status, 200, "seq 2");
    await gatedWait(ctx.gate, LIMITS.pointIntervalMs + 300);
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, pointPayload(sessionId, 1))).status, 409, "lower seq must be 409");
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, { ...p2, accuracy_m: 30 })).status, 409, "same seq with another tuple must be 409");
    assert.equal((await command(ctx, api.page, ctx.jobs.main.id, "point", v, { ...pointPayload(sessionId, 3), sampled_at: new Date(Date.parse(p2.sampled_at) - 1000).toISOString() })).status, 409, "backward sampled_at must be 409");
    body = await okSnap(ctx, api.page, ctx.jobs.main.id, "T4");
    assert.equal(body.tracking.last_seq, 2);
    assert.equal(body.tracking.position_state, "fresh");
    ctx.state.mainSession = sessionId;
    evidence(s, "T4", body);
  },

  async T5(ctx, s) {
    const api = await ctx.session("artisanA-api", ctx.users.artisanA);
    const before = await okSnap(ctx, api.page, ctx.jobs.main.id, "T5");
    const sid = before.tracking.session_id;
    const v = before.tracking.control_version;
    const base = () => pointPayload(sid, before.tracking.last_seq + 1);
    const cases = [
      ["sampled_at too old", { ...base(), sampled_at: new Date(Date.now() - 70000).toISOString() }],
      ["sampled_at in the future", { ...base(), sampled_at: new Date(Date.now() + 30000).toISOString() }],
      ["accuracy 0", { ...base(), accuracy_m: 0 }],
      ["accuracy 300", { ...base(), accuracy_m: 300 }],
      ["latitude 91", { ...base(), latitude: 91 }],
      ["longitude 181", { ...base(), longitude: 181 }],
    ];
    for (const [label, payload] of cases) {
      const a = await command(ctx, api.page, ctx.jobs.main.id, "point", v, payload);
      assert.equal(a.status, 422, `${label} answered ${a.status}`);
    }
    const after = await okSnap(ctx, api.page, ctx.jobs.main.id, "T5");
    assert.equal(after.tracking.last_seq, before.tracking.last_seq, "a refused point replaced the last one");
    // Browser side: an emulated 300 m accuracy is shown as too imprecise and never sent.
    const h = await ctx.freshSession("artisanA-ui5", ctx.users.artisanA);
    await emulate(h, ctx.base, PUBLIC_POINTS.savane, REJECTED_ACCURACY_M);
    const reqs = recordTrackingRequests(h.page);
    const job = ctx.jobs.isoB.id; // idle dossier for a UI session
    await uiStart(ctx, h, job, s);
    await expectVisible(h.page.getByText(UI.inaccurate), "« Position trop imprécise (± N m) : non envoyée. »");
    await gatedWait(ctx.gate, 6000);
    assert.equal(actions(reqs, "point").length, 0, "an imprecise emulated position was sent");
    const idle = await okSnap(ctx, h.page, job, "T5-ui");
    if (idle.tracking.shared) await command(ctx, h.page, job, "stop", idle.tracking.control_version, { session_id: idle.tracking.session_id });
    await ctx.closeSession("artisanA-ui5");
  },

  async T6(ctx, s) {
    const api = await ctx.session("artisanA-api", ctx.users.artisanA);
    let before = await okSnap(ctx, api.page, ctx.jobs.main.id, "T6");
    if (!before.tracking.shared) await start(ctx, api.page, ctx.jobs.main.id);
    before = await okSnap(ctx, api.page, ctx.jobs.main.id, "T6");
    if (before.tracking.position_state !== "fresh") {
      await gatedWait(ctx.gate, LIMITS.pointIntervalMs + 300);
      const p = await command(ctx, api.page, ctx.jobs.main.id, "point", before.tracking.control_version, pointPayload(before.tracking.session_id, before.tracking.last_seq + 1));
      assert.equal(p.status, 200, `T6 setup point answered ${p.status}`);
    }
    await gatedWait(ctx.gate, LIMITS.freshnessMs + 3000);
    const after = await okSnap(ctx, api.page, ctx.jobs.main.id, "T6");
    assert.equal(after.tracking.position, null, "a position older than 60 s was still returned");
    assert.equal(after.tracking.position_state, "stale");
    const route = await ctx.api.post(api.page, routePath(ctx.jobs.main.id), {}, `route:${ctx.jobs.main.id}`);
    assert.equal(route.status, 503, `route without a fresh point answered ${route.status}`);
    assert.ok(["position_unavailable", "destination_required"].includes(route.body?.reason), `route reason ${route.body?.reason}`);
    assert.ok(!("duration_s" in (route.body || {})), "503 must not carry an ETA");
    const client = await ctx.session("client", ctx.users.client);
    await openHash(client.page, ctx.base, VIEWS.client(ctx.jobs.main.id));
    await expectVisible(card(client.page), `client card « ${UI.clientCardTitle} »`);
    await expectVisible(card(client.page).getByText(/Position périmée/), "« Position périmée … »");
    if (await card(client.page).getByText(/Arrivée estimée vers/).count()) throw new AppDefect("an ETA is shown for a stale position");
    evidence(s, "T6", after);
    await capture(client, ctx.out, "t6-client-stale-1280", s);
  },

  async T7(ctx, s) {
    const h = await ctx.freshSession("artisanA-ui7", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const reqs = recordTrackingRequests(h.page);
    const job = ctx.jobs.isoA.id;
    await uiStart(ctx, h, job, s);
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "first point before going offline");
    const startSession = actions(reqs, "start")[0]?.session_id;
    await h.context.setOffline(true);
    const sentBefore = reqs.length;
    await h.context.setGeolocation({ ...PUBLIC_POINTS.airport, accuracy: NOMINAL_ACCURACY_M });
    await gatedWait(ctx.gate, 12000);
    const duringOffline = reqs.slice(sentBefore).filter((r) => r.method === "POST" && r.status !== 0);
    assert.equal(duringOffline.length, 0, "a POST succeeded while offline");
    await capture(h, ctx.out, "t7-offline-1280", s);
    await h.context.setOffline(false);
    await h.context.setGeolocation({ ...PUBLIC_POINTS.savane, accuracy: NOMINAL_ACCURACY_M });
    await waitFor(ctx, async () => reqs.slice(sentBefore).some((r) => r.action === "point" && r.status === 200), "a point after resume", 45000);
    const after = reqs.slice(sentBefore);
    assert.equal(after.filter((r) => r.action === "start").length, 0, "a hidden restart (start) after resume");
    const resumed = after.filter((r) => r.action === "point" && r.status === 200);
    assert.ok(resumed.every((r) => r.session_id === startSession), "resume must keep the same session");
    const seqs = reqs.filter((r) => r.action === "point" && r.status === 200).map((r) => r.seq);
    assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, "seq must increase");
    s.network(publicView(reqs));
    await ctx.closeSession("artisanA-ui7");
    const end = await okSnap(ctx, (await ctx.session("artisanA-api", ctx.users.artisanA)).page, job, "T7 end");
    if (end.tracking.shared) await command(ctx, (await ctx.session("artisanA-api", ctx.users.artisanA)).page, job, "stop", end.tracking.control_version, { session_id: end.tracking.session_id });
  },

  async T8(ctx, s) {
    const h = await ctx.freshSession("artisanA-ui8", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const job = ctx.jobs.reload.id;
    let reqs = recordTrackingRequests(h.page);
    await uiStart(ctx, h, job, s);
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "a point before reload");
    const s1 = actions(reqs, "start")[0].session_id;
    await act(ctx.gate, () => h.page.reload({ waitUntil: "domcontentloaded" }));
    reqs = recordTrackingRequests(h.page);
    const p = panel(h.page);
    await expectVisible(p, "artisan panel after reload");
    await expectReloadInterrupted(h.page);
    await gatedWait(ctx.gate, 10000);
    assert.equal(reqs.filter((r) => r.method === "POST").length, 0, "a POST was sent after reload without a click");
    await capture(h, ctx.out, "t8-reload-interrupted-1280", s);
    await act(ctx.gate, () => p.getByRole("button", { name: UI.resume, exact: true }).click());
    await waitFor(ctx, async () => actions(reqs, "stop").some((r) => r.status !== null), "stop of the interrupted session");
    await expectVisible(p.getByRole("button", { name: UI.consent, exact: true }), "consent screen after the stop");
    assert.equal(actions(reqs, "start").length, 0, "start sent before the consent click");
    await act(ctx.gate, () => p.getByRole("button", { name: UI.consent, exact: true }).click());
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "a point of the new session");
    const v = restartViolations(reqs, s1);
    if (v.length) throw new AppDefect(`restart-after-reload: ${v.join("; ")}`);
    const firstNewPoint = actions(reqs, "point").find((r) => r.status === 200);
    assert.equal(firstNewPoint.seq, 1, "seq must restart at 1 on the new session");
    s.network(publicView(reqs));
    await ctx.closeSession("artisanA-ui8");
    const api = await ctx.session("artisanA-api", ctx.users.artisanA);
    const body = await okSnap(ctx, api.page, job, "T8");
    if (body.tracking.shared) await command(ctx, api.page, job, "stop", body.tracking.control_version, { session_id: body.tracking.session_id });
  },

  async "T8-fail"(ctx, s) {
    const h = await ctx.freshSession("artisanA-ui8f", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const job = ctx.jobs.restartFail;
    let reqs = recordTrackingRequests(h.page);
    await uiStart(ctx, h, job.id, s);
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "a point before reload");
    await act(ctx.gate, () => h.page.reload({ waitUntil: "domcontentloaded" }));
    reqs = recordTrackingRequests(h.page);
    await expectReloadInterrupted(h.page);
    await simulateReassignment(ctx, s, job, ctx.users.artisanA, ctx.users.artisanB);
    await act(ctx.gate, () => panel(h.page).getByRole("button", { name: UI.resume, exact: true }).click());
    await waitFor(ctx, async () => actions(reqs, "stop").some((r) => r.status !== null), "the stop answer");
    await gatedWait(ctx.gate, 4000);
    const stops = actions(reqs, "stop");
    assert.equal(stops.length, 1, "exactly one stop");
    assert.ok([403, 404, 409].includes(stops[0].status), `stop after losing the assignment answered ${stops[0].status}`);
    assert.equal(actions(reqs, "start").length, 0, "no start after a failed stop");
    assert.ok(reqs.some((r) => r.method === "GET" && r.kind === "tracking"), "the snapshot must be re-read after the failed stop");
    if (await panel(h.page).getByRole("button", { name: UI.consent, exact: true }).count()) throw new AppDefect("consent offered after losing the assignment");
    s.network(publicView(reqs));
    await ctx.closeSession("artisanA-ui8f");
  },

  async T9(ctx, s) {
    const api = await ctx.session("artisanA-api", ctx.users.artisanA);
    const site = ctx.jobs.site.id;
    let body = await okSnap(ctx, api.page, site, "T9");
    const { sessionId } = body.tracking.shared ? { sessionId: body.tracking.session_id } : await start(ctx, api.page, site);
    body = await okSnap(ctx, api.page, site, "T9");
    assert.equal((await command(ctx, api.page, site, "point", body.tracking.control_version, pointPayload(sessionId, body.tracking.last_seq + 1))).status, 200);
    const readers = [["owner", true], ["manager", true], ["viewer", false]];
    for (const [who, canConfirm] of readers) {
      const h = await ctx.session(who, ctx.users[who]);
      const r = await okSnap(ctx, h.page, site, `T9 ${who}`);
      assert.equal(r.tracking.position_state, "fresh", `${who} must read the fresh position`);
      assert.equal(r.permissions.can_share, false, `${who} must not share`);
      assert.equal(r.permissions.can_confirm_destination, canConfirm, `${who} can_confirm_destination`);
    }
    // Client of the private dossier (fresh point sent here too) + card UI.
    const main = ctx.jobs.main.id;
    let m = await okSnap(ctx, api.page, main, "T9 main");
    const sid = m.tracking.shared ? m.tracking.session_id : (await start(ctx, api.page, main)).sessionId;
    m = await okSnap(ctx, api.page, main, "T9 main");
    assert.equal((await command(ctx, api.page, main, "point", m.tracking.control_version, pointPayload(sid, m.tracking.last_seq + 1))).status, 200);
    const client = await ctx.session("client", ctx.users.client);
    const cr = await okSnap(ctx, client.page, main, "T9 client");
    assert.equal(cr.tracking.position_state, "fresh");
    assert.equal(cr.permissions.can_confirm_destination, true);
    await openHash(client.page, ctx.base, VIEWS.client(main));
    await expectVisible(card(client.page).getByText(UI.activeTracking, { exact: true }), `« ${UI.activeTracking} »`);
    await expectVisible(client.page.getByRole("img").first(), "map role=img");
    await capture(client, ctx.out, "t9-client-fresh-1280", s);
    s.note(POSITION_DISCLAIMER);
  },

  async T10(ctx, s) {
    const job = ctx.jobs.main.id;
    for (const who of ["outsider", "otherOrg", "artisanB", "artisanC"]) {
      const h = await ctx.session(who, ctx.users[who]);
      const g = await snap(ctx, h.page, job);
      assert.equal(g.status, 404, `${who} GET answered ${g.status}`);
      noPositionIn(g.body, `${who} GET`);
      const p = await command(ctx, h.page, job, "start", 0, { session_id: randomUUID(), consent: true, consent_policy: CONSENT_POLICY });
      assert.equal(p.status, 403, `${who} POST answered ${p.status}`);
      noPositionIn(p.body, `${who} POST`);
    }
    const client = await ctx.session("client", ctx.users.client);
    const q = await ctx.api.get(client.page, `${trackingPath(job)}?x=1`);
    assert.equal(q.status, 422, `query string answered ${q.status}`);
  },

  async T11(ctx, s) {
    const viewer = await ctx.session("viewer", ctx.users.viewer);
    const site = ctx.jobs.site.id;
    assert.equal((await snap(ctx, viewer.page, site)).status, 200, "viewer reads before revocation");
    await ctx.tf.remove("organization_member_site_grants", { organization_id: `eq.${ctx.org.id}`, user_id: `eq.${ctx.users.viewer.id}`, site_id: `eq.${ctx.site.id}` }, "viewer grant S1");
    const after = await snap(ctx, viewer.page, site);
    assert.equal(after.status, 404, `viewer after revocation answered ${after.status}`);
    noPositionIn(after.body, "viewer after revocation");
    await ctx.tf.insert("organization_member_site_grants", [{ organization_id: ctx.org.id, user_id: ctx.users.viewer.id, site_id: ctx.site.id, can_write: false }], "viewer grant S1 restore", { organization_id: `eq.${ctx.org.id}`, user_id: `eq.${ctx.users.viewer.id}`, site_id: `eq.${ctx.site.id}` });
    assert.equal((await snap(ctx, viewer.page, site)).status, 200, "viewer reads after restoring the grant");
  },

  async "T12-sim"(ctx, s) {
    const job = ctx.jobs.reassign;
    const a = await ctx.session("artisanA-api", ctx.users.artisanA);
    const { sessionId } = await start(ctx, a.page, job.id);
    const v = (await okSnap(ctx, a.page, job.id, "T12")).tracking.control_version;
    assert.equal((await command(ctx, a.page, job.id, "point", v, pointPayload(sessionId, 1))).status, 200);
    await simulateReassignment(ctx, s, job, ctx.users.artisanA, ctx.users.artisanB);
    const g = await snap(ctx, a.page, job.id);
    assert.equal(g.status, 404, `former artisan GET answered ${g.status}`);
    noPositionIn(g.body, "former artisan");
    const p = await command(ctx, a.page, job.id, "point", v, pointPayload(sessionId, 2));
    assert.ok([403, 404].includes(p.status), `former artisan POST answered ${p.status}`);
    const b = await ctx.session("artisanB", ctx.users.artisanB);
    const nb = await okSnap(ctx, b.page, job.id, "T12 new artisan");
    assert.equal(nb.tracking.shared, false, "the new artisan must consent again");
    assert.equal(nb.tracking.position, null);
    assert.ok(nb.tracking.control_version > v, "control_version must increase");
    assert.equal(nb.permissions.can_share, true);
    const leases = await ctx.tf.db.count("tracking_provider_leases", { intervention_id: `eq.${job.id}` });
    assert.equal(leases, 0, "leases must be purged");
    const c = await ctx.session("client", ctx.users.client);
    assert.equal((await okSnap(ctx, c.page, job.id, "T12 client")).tracking.position_state, "stopped");
  },

  async T13(ctx, s) {
    const d = await ctx.session("artisanD", ctx.users.artisanD);
    const job = ctx.jobs.suspend.id;
    const { sessionId } = await start(ctx, d.page, job);
    const v = (await okSnap(ctx, d.page, job, "T13")).tracking.control_version;
    assert.equal((await command(ctx, d.page, job, "point", v, pointPayload(sessionId, 1))).status, 200);
    await ctx.tf.update("profiles", { id: `eq.${ctx.users.artisanD.id}` }, { artisan_approved: false }, `suspend ${ctx.users.artisanD.id}`);
    s.note("Suspension simulated by the service key on a cohort artisan (profile column, as the existing fixtures do).");
    const late = await command(ctx, d.page, job, "point", v, pointPayload(sessionId, 2));
    assert.ok([403, 409].includes(late.status), `late point after suspension answered ${late.status}`);
    const c = await ctx.session("client", ctx.users.client);
    const r = await okSnap(ctx, c.page, job, "T13 client");
    assert.equal(r.tracking.shared, false);
    assert.equal(r.tracking.position, null);
  },

  async T14(ctx, s) {
    const h = await ctx.freshSession("artisanA-ui14", ctx.users.artisanA);
    await emulate(h, ctx.base);
    const job = ctx.jobs.isoA.id;
    const pre = await okSnap(ctx, h.page, job, "T14");
    if (pre.tracking.shared) await command(ctx, h.page, job, "stop", pre.tracking.control_version, { session_id: pre.tracking.session_id });
    const reqs = recordTrackingRequests(h.page);
    const p = await uiStart(ctx, h, job, s);
    await waitFor(ctx, async () => actions(reqs, "point").some((r) => r.status === 200), "a point before stop");
    const sid = actions(reqs, "start")[0].session_id;
    await act(ctx.gate, () => p.getByRole("button", { name: UI.stop, exact: true }).click());
    await waitFor(ctx, async () => actions(reqs, "stop").some((r) => r.status === 200), "stop accepted");
    const stopped = await okSnap(ctx, h.page, job, "T14");
    assert.equal(stopped.tracking.shared, false);
    assert.equal(stopped.tracking.position, null);
    const again = await command(ctx, h.page, job, "stop", stopped.tracking.control_version, { session_id: sid });
    assert.equal(again.status, 409, `repeated stop answered ${again.status}`);
    const late = await command(ctx, h.page, job, "point", stopped.tracking.control_version, pointPayload(sid, 99));
    assert.equal(late.status, 409, `point after stop answered ${late.status}`);
    // Arrived on the main dossier (UI button). A10: MAIN may be inherited shared (T9 API session):
    // normalise it (CAS stop + readback) BEFORE opening its panel; no catch, no late retry.
    await ensureUnsharedMain(ctx, h.page);
    const reqs2 = recordTrackingRequests(h.page);
    const p2 = await uiStart(ctx, h, ctx.jobs.main.id, s);
    await waitFor(ctx, async () => actions(reqs2, "point").some((r) => r.status === 200), "a point before arrival");
    await act(ctx.gate, () => p2.getByRole("button", { name: UI.arrived, exact: true }).click());
    await waitFor(ctx, async () => actions(reqs2, "arrived").some((r) => r.status === 200), "arrived accepted");
    const arrived = await okSnap(ctx, h.page, ctx.jobs.main.id, "T14 arrived");
    assert.equal(arrived.tracking.travel_stage, "on_site");
    assert.equal(arrived.tracking.shared, false);
    assert.equal(arrived.tracking.position, null);
    await capture(h, ctx.out, "t14-arrived-1280", s);
    await ctx.closeSession("artisanA-ui14");
  },

  async T15(ctx, s) {
    const a = await ctx.session("artisanA-api", ctx.users.artisanA);
    const job = ctx.jobs.complete.id;
    const { sessionId } = await start(ctx, a.page, job);
    const v = (await okSnap(ctx, a.page, job, "T15")).tracking.control_version;
    assert.equal((await command(ctx, a.page, job, "point", v, pointPayload(sessionId, 1))).status, 200);
    for (const action of ["start", "complete"]) {
      const r = await ctx.api.post(a.page, `/api/interventions/${job}/actions`, { action }, `action:${action}:${job}`);
      assert.equal(r.status, 200, `intervention action ${action} answered ${r.status}`);
    }
    const c = await ctx.session("client", ctx.users.client);
    const r = await okSnap(ctx, c.page, job, "T15");
    assert.equal(r.tracking.position, null, "a position remains after completion");
    assert.equal(r.tracking.shared, false);
    const late = await command(ctx, a.page, job, "point", r.tracking.control_version, pointPayload(sessionId, 2));
    assert.ok([403, 409].includes(late.status), `point after completion answered ${late.status}`);
  },

  async T16(ctx, s) {
    const c = await ctx.session("client", ctx.users.client);
    const job = ctx.jobs.isoB.id;
    const before = await okSnap(ctx, c.page, job, "T16");
    const confirm = await command(ctx, c.page, job, "destination", before.tracking.control_version, { latitude: PUBLIC_POINTS.airport.latitude, longitude: PUBLIC_POINTS.airport.longitude, label: "Zone aéroport (point public QA)", source: "manual" });
    assert.equal(confirm.status, 200, `destination confirm answered ${confirm.status}`);
    assert.equal(confirm.body.tracking.destination_version, before.tracking.destination_version + 1);
    assert.equal(confirm.body.tracking.control_version, before.tracking.control_version + 1);
    for (const who of ["viewer", "artisanA-api"]) {
      const h = await ctx.session(who, who === "viewer" ? ctx.users.viewer : ctx.users.artisanA);
      const target = who === "viewer" ? ctx.jobs.site.id : job;
      const cur = await snap(ctx, h.page, target);
      const r = await command(ctx, h.page, target, "destination", cur.body?.tracking?.control_version ?? 0, { clear: true });
      assert.equal(r.status, 403, `${who} destination answered ${r.status}`);
    }
    const mixed = await command(ctx, c.page, job, "destination", confirm.body.tracking.control_version, { clear: true, latitude: 1, longitude: 1, label: "x", source: "manual" });
    assert.equal(mixed.status, 422, `mixed clear+point answered ${mixed.status}`);
    await openHash(c.page, ctx.base, VIEWS.client(job));
    await expectVisible(c.page.getByRole("button", { name: UI.removeDestination, exact: true }), `« ${UI.removeDestination} »`);
    const cleared = await command(ctx, c.page, job, "destination", confirm.body.tracking.control_version, { clear: true });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.tracking.destination, null);
    assert.equal(cleared.body.tracking.shared, false);
    assert.equal(cleared.body.tracking.destination_version, confirm.body.tracking.destination_version + 1);
  },

  async T18(ctx, s) {
    // Cache/session isolation (ROOT amendment): two dossiers, same artisan, same session UUID.
    const a = await ctx.session("artisanA-api", ctx.users.artisanA);
    const shared = randomUUID();
    const ids = [ctx.jobs.isoA.id, ctx.jobs.isoB.id];
    for (const id of ids) {
      const b = await okSnap(ctx, a.page, id, "T18");
      if (b.tracking.shared) await command(ctx, a.page, id, "stop", b.tracking.control_version, { session_id: b.tracking.session_id });
    }
    const snaps = [];
    for (const [i, id] of ids.entries()) {
      await start(ctx, a.page, id, shared);
      const v = (await okSnap(ctx, a.page, id, "T18")).tracking.control_version;
      const where = i === 0 ? PUBLIC_POINTS.savane : PUBLIC_POINTS.airport;
      assert.equal((await command(ctx, a.page, id, "point", v, pointPayload(shared, 1, where))).status, 200);
      snaps.push(await okSnap(ctx, a.page, id, "T18"));
    }
    assert.notEqual(snaps[0].tracking.intervention_id, snaps[1].tracking.intervention_id);
    assert.notDeepEqual(snaps[0].tracking.position, snaps[1].tracking.position, "two dossiers returned the same position");
    s.note("Route-cache isolation across dossiers is covered by the backend tests (no extra real IGN call here, ROOT A3).");
    for (const [i, id] of ids.entries()) await command(ctx, a.page, id, "stop", snaps[i].tracking.control_version, { session_id: shared });
  },

  async T19(ctx, s) {
    const h = await ctx.freshSession("switch", ctx.users.client);
    await openHash(h.page, ctx.base, VIEWS.client(ctx.jobs.main.id));
    await expectVisible(card(h.page), `client card « ${UI.clientCardTitle} » before the switch`);
    await act(ctx.gate, () => logout(h.page));
    ctx.revokeUser(ctx.users.client.id); // the app logout is global: every pooled client session is now revoked
    await act(ctx.gate, () => login(h, ctx.base, ctx.users.outsider, ctx.projectRef, { sameDocument: true }));
    await waitForWorkspace(h.page, ctx.users.outsider.id);
    ctx.rebind("switch", ctx.users.outsider);
    await goHash(h.page, VIEWS.client(ctx.jobs.main.id));
    await gatedWait(ctx.gate, 2000);
    if (await card(h.page).count()) throw new AppDefect("the tracking card of the previous identity is still rendered");
    const g = await snap(ctx, h.page, ctx.jobs.main.id);
    assert.equal(g.status, 404);
    await capture(h, ctx.out, "t19-identity-switch-1280", s);
    await ctx.closeSession("switch");
  },
};

/** T12-sim / T8-fail: guarded service-key reassignment on validated cohort ids only (A3). */
export async function simulateReassignment(ctx, s, job, from, to) {
  const reasons = [];
  if (!ctx.fixtures.manifest.created.interventions.includes(job.id)) reasons.push("dossier not in this run's manifest");
  if (!ctx.fixtures.manifest.created.profiles.includes(to.id)) reasons.push("target artisan not in this run's manifest");
  if (to.email !== ctx.cohort.email(to.label)) reasons.push("target artisan e-mail is not this run's canonical e-mail");
  const [row] = await ctx.tf.db.select("interventions", { id: `eq.${job.id}` }, "id,client_id,artisan_id,status");
  if (!row) reasons.push("dossier not found");
  else {
    if (row.client_id !== job.client_id) reasons.push("client differs from the cohort client");
    if (row.artisan_id !== from.id) reasons.push("current artisan differs from the expected cohort artisan");
    if (!["accepted", "in_progress"].includes(row.status)) reasons.push(`status ${row.status}`);
  }
  if (reasons.length) {
    const error = new Error(`reassignment simulation refused: ${reasons.join("; ")}`);
    error.blocked = true;
    throw error;
  }
  const rows = await ctx.tf.update("interventions", { id: `eq.${job.id}`, artisan_id: `eq.${from.id}` }, { artisan_id: to.id }, `reassign ${job.id}`);
  if (!rows.length) {
    const error = new Error("reassignment simulation updated 0 row");
    error.blocked = true;
    throw error;
  }
  s.note(`${REASSIGNMENT_SOURCE}: ${REASSIGNMENT_DISCLAIMER}`);
}

// ---------------------------------------------------------------------------------------------
// Provider proof (opt-in, ONE real call each; never a burst, never a retry). An unavailable
// provider (any 503, 429, gateway error, timeout, unknown transport) is NOT a proof: BLOCKED.
export function providerBlocked(what, verdict) {
  const error = new Error(`provider ${what} unavailable (${verdict.reason}${verdict.note ? `; ${verdict.note}` : ""}): not a proof`);
  error.blocked = true;
  return error;
}
export const PROVIDER_RUNNERS = {
  async "provider-route"(ctx, s) {
    const a = await ctx.session("artisanA-api", ctx.users.artisanA);
    const c = await ctx.session("client", ctx.users.client);
    const job = ctx.jobs.isoB.id;
    let snapshot = await okSnap(ctx, c.page, job, "provider");
    if (!snapshot.tracking.destination) {
      const d = await command(ctx, c.page, job, "destination", snapshot.tracking.control_version, { latitude: PUBLIC_POINTS.airport.latitude, longitude: PUBLIC_POINTS.airport.longitude, label: "Zone aéroport (point public QA)", source: "manual" });
      assert.equal(d.status, 200);
    }
    const { sessionId } = await start(ctx, a.page, job);
    const v = (await okSnap(ctx, a.page, job, "provider")).tracking.control_version;
    assert.equal((await command(ctx, a.page, job, "point", v, pointPayload(sessionId, 1))).status, 200);
    snapshot = await okSnap(ctx, c.page, job, "provider");
    const answer = await ctx.api.post(c.page, routePath(job), {}, `route:${job}`);
    const verdict = classifyRoute({ status: answer.status, body: answer.body, retryAfter: answer.status === 429 ? "present" : null }, snapshot);
    s.note(`provider route (real IGN call, fixed public coordinates): ${JSON.stringify(verdict)}`);
    if (verdict.verdict !== "available") {
      await command(ctx, a.page, job, "stop", v, { session_id: sessionId }); // never leave the session open
      if (verdict.verdict === "fail") throw new AppDefect(verdict.why);
      throw providerBlocked("route", verdict);
    }
    const budget = await ctx.tf.db.select("tracking_provider_budget", { id: "eq.ign" }, "backoff_until");
    s.note(`budget read-only: backoff ${budget[0] && Date.parse(budget[0].backoff_until) > Date.now() ? "active" : "inactive"}`);
    if (verdict.verdict === "available") {
      await openHash(c.page, ctx.base, VIEWS.client(job));
      await expectVisible(card(c.page).getByText(/Arrivée estimée/), "« Arrivée estimée »");
      await expectVisible(c.page.getByText(UI.osmAttribution, { exact: true }), `« ${UI.osmAttribution} »`);
      await capture(c, ctx.out, "provider-route-client-1280", s);
    }
    await command(ctx, a.page, job, "stop", v, { session_id: sessionId });
  },
  async "provider-geocode"(ctx, s) {
    const c = await ctx.session("client", ctx.users.client);
    const answer = await ctx.api.post(c.page, geocodePath(ctx.jobs.isoB.id), { query: "Place de la Savane 97200 Fort-de-France" }, `geocode:${ctx.jobs.isoB.id}`);
    const verdict = classifyGeocode({ status: answer.status, body: answer.body, retryAfter: answer.status === 429 ? "present" : null });
    s.note(`provider geocode (real IGN/BAN call, public query): ${JSON.stringify(verdict)}`);
    // The viewer refusal happens before any provider call: checked whatever the provider state.
    const v = await ctx.session("viewer", ctx.users.viewer);
    const denied = await ctx.api.post(v.page, geocodePath(ctx.jobs.site.id), { query: "Place de la Savane 97200" }, `geocode:${ctx.jobs.site.id}`);
    assert.equal(denied.status, 403, `viewer geocode answered ${denied.status}`);
    if (verdict.verdict === "fail") throw new AppDefect(verdict.why);
    if (verdict.verdict !== "available") throw providerBlocked("geocode", verdict);
    await okSnap(ctx, c.page, ctx.jobs.isoB.id, "geocode"); // no target is stored without an explicit destination command
  },
};

/**
 * Session pool: one browser context per user label (login once), plus fresh contexts. Opening a
 * session awaits the page creation, then re-checks the gate IMMEDIATELY before the first emission
 * (login), and the whole opening is registered in the drain. Every page gets the browser mutation
 * barrier before any navigation. `deps` are injectable for offline tests.
 */
/** Reusing a session revoked by a global logout is BLOCKED, never a silent relogin (A8 §6). */
export function revokedSession(label) {
  const error = new Error(`session « ${label} » révoquée par une déconnexion globale : réutilisation refusée`);
  error.blocked = true;
  return error;
}

export function createSessionPool({ browser, base, projectRef, redactor, gate, intents, reconcile = null, onEvent = () => {}, deps = {} }) {
  const { newPageFn = newPage, loginFn = login, waitFn = waitForWorkspace, trackFn = trackBrowserMutations, observeFn = observeTrackingNetwork } = deps;
  const handles = new Map();
  const origin = new URL(base).origin;
  let used = []; // labels used by the running scenario (A8 §1 diagnostics), most recent last
  const use = (label) => {
    used = [...used.filter((l) => l !== label), label];
  };
  function open(label, user) {
    gate.check();
    const opening = (async () => {
      const handle = await newPageFn(browser, { baseUrl: base, redactor });
      try {
        gate.check(); // after the await, before the barrier and the login emission
        handle.network = observeFn(handle.page); // passive observer, before the first request (A8 §1)
        handle.mutations = await trackFn(handle.page, { gate, intents, reconcile, origin, onEvent });
        gate.check(); // after the await, immediately before the login submission
        await loginFn(handle, base, user, projectRef);
        await waitFn(handle.page, user.id);
      } catch (error) {
        await handle.close?.().catch(() => {});
        throw error;
      }
      handle.label = label;
      handle.userId = user.id;
      handle.revoked = false;
      handles.set(label, handle);
      return handle;
    })();
    return gate.register(opening);
  }
  return {
    async session(label, user) {
      use(label);
      const existing = handles.get(label);
      if (existing?.revoked) throw revokedSession(label);
      return existing || open(label, user);
    },
    async freshSession(label, user) {
      use(label);
      if (handles.has(label)) await this.closeSession(label);
      return open(label, user);
    },
    async closeSession(label) {
      const h = handles.get(label);
      handles.delete(label);
      if (h) await h.close();
    },
    /** A8 §1: start of a scenario (resets the pages it used). */
    beginScenario() {
      used = [];
    },
    /** A8 §1: pages the running scenario used and that are still open (most recent first). */
    diagnosticHandles(limit = DIAG_LIMITS.pages) {
      return [...used].reverse().map((l) => handles.get(l)).filter((h) => h && !(h.page?.isClosed?.() ?? false)).slice(0, limit);
    },
    /** A8 §5d/§6: the app logout is GLOBAL — every pooled session of that user is revoked. */
    revokeUser(userId) {
      for (const h of handles.values()) if (h.userId === userId) h.revoked = true;
    },
    /** The handle now belongs to `user` (same-document login after a logout, T19). */
    rebind(label, user) {
      const h = handles.get(label);
      if (h) Object.assign(h, { userId: user.id, revoked: false });
    },
    async closeAll() {
      for (const label of [...handles.keys()]) await this.closeSession(label);
    },
  };
}
