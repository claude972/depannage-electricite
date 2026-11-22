// WEB-DEEPLINK-QA-001 scenarios D1–D4 (docs/CLAUDE_DEEPLINK_QA_CONTRACT.md §3–4, A1–A3b, B2 claim).
// Every deep-link session: Realtime interception + QA probe installed on the context BEFORE login;
// navigation by hash only (goHash, same document); counting windows opened by the passive gate.
// Mutations are the service seed only (TrackingFixtures: durable intent BEFORE emission, readback).
import { randomUUID } from "node:crypto";
import { AppDefect } from "../qa/lib/report.mjs";
import { newPage, login, logout, goHash, waitForWorkspace, expectVisible } from "../qa/lib/browser.mjs";
import { createSessionPool } from "../qa-tracking/scenarios.mjs";
import { gatedWait, act } from "../qa-tracking/lib/guard.mjs";
import { StopRequestedError } from "../qa/lib/lifecycle.mjs";
import { trackingPath } from "../qa-tracking/lib/constants.mjs";
import { assertUnknownIs404 } from "../qa-tracking/lib/preflight.mjs";
import { UI, VIEWS, SHOW_TIMEOUT_MS, QUIET_WINDOW_MS, REVALIDATE_GUARD_MS, QUIET_MS, GATE_TIMEOUT_MS } from "./lib/constants.mjs";
import { createRealtimeBlock, installRealtimeBlock } from "./lib/realtime-block.mjs";
import { observeDeeplinkNetwork } from "./lib/observe.mjs";
import { installProbe, resetSeen, readProbe, leakFlags, armLeakLatch, readLeakLatch } from "./lib/probe.mjs";
import { openCleanWindow, closeWindow, assertWindow, blocked } from "./lib/window.mjs";

export const PREFLIGHT_SESSION = "dl-preflight";
const isStop = (error) => error instanceof StopRequestedError || error?.name === "StopRequestedError";
export const canaryFor = (runId) => `QA-DL-CANARY-${runId}`;

/**
 * Session pool of the tracking harness (read-only import) with deep-link deps: the context receives
 * the QA probe and the Realtime interception BEFORE the mutation barrier and the login.
 */
export function createDeeplinkPool({ browser, base, supabaseOrigin, projectRef, redactor, gate, intents, reconcile = null, onEvent, state, deps = {} }) {
  const basePage = deps.newPageFn || newPage;
  return createSessionPool({
    browser, base, projectRef, redactor, gate, intents, reconcile, onEvent,
    deps: {
      ...deps,
      newPageFn: async (b, opts) => {
        const handle = await basePage(b, opts);
        try {
          await installProbe(handle.context);
          handle.realtime = await installRealtimeBlock(handle.context, createRealtimeBlock({ supabaseOrigin }));
        } catch (error) {
          await handle.close?.().catch(() => {});
          throw error;
        }
        return handle;
      },
      observeFn: (page) => observeDeeplinkNetwork(page, { watch: () => state.watch, canaries: () => state.canaries }),
      loginFn: deps.loginFn || login,
      waitFn: deps.waitFn || waitForWorkspace,
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Setup: preflight in a dedicated context (closed in every path), then the seed for D3.
export async function setupDeeplink(ctx) {
  const { tf } = ctx;
  const u = {};
  u.clientA = await tf.createUser("dl-client-a", "client");
  try {
    const preflight = await ctx.freshSession(PREFLIGHT_SESSION, u.clientA);
    assertUnknownIs404(await ctx.api.get(preflight.page, trackingPath(randomUUID())));
  } finally {
    await ctx.closeSession(PREFLIGHT_SESSION);
  }
  u.clientB = await tf.createUser("dl-client-b", "client");
  u.clientC = await tf.createUser("dl-client-c", "client"); // A4: second identity for D4 (g), owns nothing
  u.artisanA = await tf.createUser("dl-artisan-a", "artisan");
  u.artisanB = await tf.createUser("dl-artisan-b", "artisan");
  u.owner = await tf.createUser("dl-owner", "manager");
  u.viewer = await tf.createUser("dl-viewer", "manager");
  const org = await tf.createOrganization(u.owner, "Org deeplink");
  await tf.addMember(org, u.viewer, "viewer");
  const s1 = await tf.createSite(org, "Site DL1");
  const s2 = await tf.createSite(org, "Site DL2");
  await tf.setSiteScope(org, u.viewer, "selected", [{ site_id: s1.id, can_write: false }]);
  const canary = canaryFor(ctx.cohort.runId);
  ctx.state.canaries = [canary];
  const foreign = {
    client: await seed(ctx, { client: u.clientB, status: "requested", description: `dossier étranger ${canary}` }),
    artisan: await seed(ctx, { client: u.clientB, artisan: u.artisanB, status: "accepted", description: `mission étrangère ${canary}` }),
    enterprise: await seed(ctx, { client: u.owner, site: s2, status: "accepted", description: `dossier hors périmètre ${canary}` }),
  };
  Object.assign(ctx, { users: u, org, sites: { s1, s2 }, foreign, canary });
  return { users: Object.keys(u).length, foreign: Object.keys(foreign).length };
}

/** One dossier by the service key (durable intent first), proven by readback BEFORE use. */
export async function seed(ctx, spec) {
  const job = await ctx.tf.createIntervention(spec);
  const n = await ctx.tf.db.count("interventions", { id: `eq.${job.id}` });
  if (n !== 1) throw blocked(`seed not read back (${n} row(s) for the new dossier)`);
  return job;
}

// ---------------------------------------------------------------------------------------------
// Helpers
const limits = (ctx) => ({ guardMs: REVALIDATE_GUARD_MS, quietMs: QUIET_MS, timeoutMs: GATE_TIMEOUT_MS, showMs: SHOW_TIMEOUT_MS, quietWindowMs: QUIET_WINDOW_MS, ...(ctx.limits || {}) });
const open = (ctx, h) => openCleanWindow({ page: h.page, observer: h.network, gate: ctx.gate, guardMs: limits(ctx).guardMs, quietMs: limits(ctx).quietMs, timeoutMs: limits(ctx).timeoutMs });
const close = (ctx, h, win) => closeWindow({ page: h.page, observer: h.network, win, quietMs: limits(ctx).quietMs });

/** A3/A3b handler-side proof; the badge is a secondary check. Not proven ⇒ BLOCKED, never PASS. */
export async function proveRealtimeBlocked(ctx, h, what, { badge: checkBadge = true, waitMs = 15000 } = {}) {
  // The app opens its Realtime socket after the workspace loads: wait (bounded) for the handler hit.
  const until = Date.now() + waitMs;
  const settled = () => {
    const st = h.realtime.stats();
    return st.hits >= 1 && st.close_resolved + st.handler_errors === st.hits; // every close awaited
  };
  while (!settled() && Date.now() < until) await gatedWait(ctx.gate, 100);
  const proof = h.realtime.proof({ pageRealtimeFrames: h.network.pageRealtimeFrames() });
  if (!proof.ok) throw blocked(`${what}: Realtime interception not proven: ${proof.reason}`);
  if (!checkBadge) return proof; // the badge exists in the client shell only
  const badge = h.page.getByRole("button", { name: UI.badgeBlocked, exact: true });
  try {
    await badge.first().waitFor({ state: "visible", timeout: 5000 });
  } catch {
    throw blocked(`${what}: badge « ${UI.badgeBlocked} » not shown although Realtime is blocked`);
  }
  return proof;
}

async function expectShown(ctx, h, job, what) {
  await expectVisible(h.page.getByText(job.description, { exact: true }), `${what}: dossier description`, { timeout: limits(ctx).showMs });
}
async function expectClientError(ctx, h, what) {
  await expectVisible(h.page.getByText(UI.errorTitle, { exact: true }), `${what}: « ${UI.errorTitle} »`, { timeout: limits(ctx).showMs });
  if (!(await h.page.locator(`[data-blocker="${UI.errorBlocker}"]`).count())) throw new AppDefect(`${what}: error state without data-blocker="${UI.errorBlocker}"`);
  await expectVisible(retryButton(h), `${what}: « ${UI.retry} »`, { timeout: limits(ctx).showMs });
}
const retryButton = (h) => h.page.locator(`[data-blocker="${UI.errorBlocker}"]`).getByRole("button", { name: /^(Réessayer|Nouvelle tentative…)$/ });
function neverNotFound(w, what) {
  if (w.seen.clientNotFound || w.seen.artisanNotFound || w.seen.enterpriseNotFound) throw new AppDefect(`${what}: « introuvable » was rendered`);
}
async function sameIdentity(h, user, what) {
  try {
    await waitForWorkspace(h.page, user.id, 30000);
  } catch (error) {
    throw new AppDefect(`${what}: identity not kept (${error.message})`);
  }
}
async function measure(ctx, h, what, expected, action) {
  await resetSeen(h.page);
  const win = await open(ctx, h);
  await action();
  return assertWindow(await close(ctx, h, win), expected, what);
}

// ---------------------------------------------------------------------------------------------
export const SCENARIO_RUNNERS = {
  async D1(ctx, s) {
    const user = ctx.users.clientA;
    const h = await ctx.freshSession("dl-d1", user); // session BEFORE the creation (LIVE-WORKSPACE-001 case)
    await proveRealtimeBlocked(ctx, h, "D1");
    const late = await seed(ctx, { client: user, status: "requested", description: "D1 dossier créé après la connexion" });
    const w = await measure(ctx, h, "D1 deep link to a dossier created after login", 1, async () => {
      await goHash(h.page, VIEWS.client(late.id));
      await expectShown(ctx, h, late, "D1");
    });
    neverNotFound(w, "D1");
    s.note(`D1: one refresh, loader ${w.seen.loading ? "observed" : "not observed (request ordering proven by the window)"}; Realtime blocked (handler-side proof)`);
    await sameIdentity(h, user, "D1");
  },

  async D2(ctx, s) {
    const user = ctx.users.clientA;
    const witness = await seed(ctx, { client: user, status: "requested", description: "D2 témoin présent avant la session" });
    ctx.state.watch.set("witnessD2", witness.id);
    const h = await ctx.freshSession("dl-d2", user);
    await proveRealtimeBlocked(ctx, h, "D2");
    if (!h.network.witnessSeen("witnessD2")) throw blocked("D2: non-empty witness not proven in a real workspace reply before the stub");
    const late = await seed(ctx, { client: user, status: "requested", description: "D2 dossier créé après la connexion" });
    // Stub: exactly the next two GET /api/workspace — 503, then a DEFERRED malformed 200 — then real.
    let n = 0;
    let release;
    const released = new Promise((r) => (release = r));
    const entered = { second: false };
    const stubbed = (url) => url.pathname === "/api/workspace";
    await h.page.route(stubbed, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      n += 1;
      if (n === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "qa-stub" }) });
      if (n === 2) {
        entered.second = true;
        await released;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: { id: user.id, role: "client" } }) });
      }
      return route.fallback();
    });
    // The response barrier is ALWAYS released (and the stub removed) so the drain can complete.
    try {
      const witnessFromCache = async (what) => {
        await measure(ctx, h, `${what}: witness from the cache`, 0, async () => {
          await goHash(h.page, VIEWS.client(witness.id));
          try {
            await expectShown(ctx, h, witness, what);
          } catch {
            throw new AppDefect(`${what}: witness missing — data cleared`);
          }
        });
        await measure(ctx, h, `${what}: back to the failed dossier`, 0, async () => {
          await goHash(h.page, VIEWS.client(late.id));
          await expectClientError(ctx, h, what);
        });
      };
      let w = await measure(ctx, h, "D2 #1 (503)", 1, async () => {
        await goHash(h.page, VIEWS.client(late.id));
        await expectClientError(ctx, h, "D2 #1");
      });
      neverNotFound(w, "D2 #1");
      await witnessFromCache("D2 after 503");
      w = await measure(ctx, h, "D2 #2 (malformed 200, double click while in flight)", 1, async () => {
        await retryButton(h).click();
        const until = Date.now() + limits(ctx).showMs;
        while (!entered.second && Date.now() < until) await gatedWait(ctx.gate, 50);
        if (!entered.second) throw new AppDefect("D2 #2: the retry did not send a request");
        // While the request is in flight the view either shows « Recherche du dossier… » (the button is
        // gone: no second click possible) or keeps a DISABLED / busy button; a second click is attempted.
        const button = retryButton(h);
        if (await button.count()) {
          const busy = (await button.first().getAttribute("aria-busy", { timeout: 1000 }).catch(() => null)) === "true" || (await button.first().isDisabled({ timeout: 1000 }).catch(() => false));
          if (!busy) throw new AppDefect("D2 #2: « Réessayer » still enabled while its request is in flight");
          await button.first().click({ force: true, timeout: 2000 }).catch(() => {});
        } else {
          await expectVisible(h.page.getByText(UI.loading, { exact: true }), "D2 #2: loader while the retry is in flight", { timeout: 2000 });
        }
        await gatedWait(ctx.gate, 300);
        const inFlight = h.network.workspaceGets({ from: 0 }).filter((e) => e.endedAt === null).length;
        if (inFlight !== 1) throw new AppDefect(`D2 #2: ${inFlight} workspace request(s) in flight after the double click (expected 1)`);
        release();
        await expectClientError(ctx, h, "D2 #2");
      });
      neverNotFound(w, "D2 #2");
      await witnessFromCache("D2 after the malformed 200");
      await resetSeen(h.page);
      const win = await open(ctx, h);
      await retryButton(h).click();
      let notShown = null;
      try {
        await expectShown(ctx, h, late, "D2 #3");
      } catch (error) {
        notShown = error;
      }
      const shown = notShown === null;
      const w3 = await close(ctx, h, win);
      const real = h.network.workspaceGets({ from: win.openedAt }).at(-1);
      if (!shown && real && (real.status === 0 || real.status >= 500)) throw blocked(`D2 #3: the real workspace answered ${real.status} (environment unavailable)`);
      assertWindow(w3, 1, "D2 #3 (real)");
      if (!shown) throw notShown;
      neverNotFound(w3, "D2 #3");
    } finally {
      release();
      await h.page.unroute(stubbed).catch(() => {});
    }
    s.note("D2: 503 and malformed 200 ⇒ error state with retry, witness kept, no sign-out; real retry ⇒ dossier");
    await sameIdentity(h, user, "D2");
  },

  async D3(ctx, s) {
    const variants = [
      { label: "dl-d3a", user: ctx.users.clientA, hash: VIEWS.client(ctx.foreign.client.id), id: ctx.foreign.client.id, title: UI.clientNotFound, text: UI.clientNotFoundText },
      { label: "dl-d3b", user: ctx.users.artisanA, hash: VIEWS.artisan(ctx.foreign.artisan.id), id: ctx.foreign.artisan.id, title: UI.artisanNotFound },
      { label: "dl-d3c", user: ctx.users.viewer, hash: VIEWS.enterprise(ctx.foreign.enterprise.id), id: ctx.foreign.enterprise.id, title: UI.enterpriseNotFound },
    ];
    for (const v of variants) {
      const h = await ctx.session(v.label, v.user); // opened AFTER the full seed
      await proveRealtimeBlocked(ctx, h, `D3 ${v.label}`, { badge: v.label === "dl-d3a" });
      const expectNotFound = async () => {
        await expectVisible(h.page.getByText(v.title, { exact: true }), `${v.label}: « ${v.title} »`, { timeout: limits(ctx).showMs });
        if (v.text) await expectVisible(h.page.getByText(v.text, { exact: true }), `${v.label}: wording`, { timeout: limits(ctx).showMs });
      };
      // DL-QA-806-001: a latching boolean observer is armed BEFORE each navigation and read after
      // EVERY window, so a transient appearance (shown then removed) is a FAIL too.
      const latched = async (what, expected, action) => {
        if (!(await armLeakLatch(h.page, [ctx.canary, v.id]))) throw blocked(`${what}: leak observer not armed`);
        await measure(ctx, h, what, expected, action);
        const flags = await readLeakLatch(h.page);
        if (!flags) throw blocked(`${what}: leak observer lost (document changed)`);
        if (flags[0]) throw new AppDefect(`${what}: foreign canary appeared in the DOM (text/data/aria), even transiently`);
        if (flags[1]) throw new AppDefect(`${what}: foreign dossier id appeared in the DOM (text/data/aria), even transiently`);
      };
      await latched(`D3 ${v.label} foreign id`, 1, async () => {
        await goHash(h.page, v.hash);
        await expectNotFound();
      });
      await latched(`D3 ${v.label} same id again`, 0, async () => {
        await goHash(h.page, VIEWS.requests);
        await goHash(h.page, v.hash);
        await expectNotFound();
      });
      const [canaryInDom, idInDom] = await leakFlags(h.page, [ctx.canary, v.id]);
      if (canaryInDom) throw new AppDefect(`${v.label}: foreign canary visible in the DOM`);
      if (idInDom) throw new AppDefect(`${v.label}: foreign dossier id present in the DOM (text/data/aria)`);
      if (h.network.canarySeen()) throw new AppDefect(`${v.label}: foreign canary present in a workspace reply`);
      const leaks = h.network.interventionEntries(v.id).filter((e) => e.status !== 404 && e.status !== null);
      if (leaks.length) throw new AppDefect(`${v.label}: foreign dossier request answered ${leaks.map((e) => e.status).join(",")} (expected 404)`);
      await ctx.closeSession(v.label);
    }
    s.note("D3: foreign client/artisan/enterprise ids ⇒ one refresh then the existing wording; no canary, no id leak");
  },

  async D4(ctx, s) {
    const user = ctx.users.clientA;
    const h = await ctx.freshSession("dl-d4", user);
    await proveRealtimeBlocked(ctx, h, "D4");
    const badge = h.page.getByRole("button", { name: UI.badge });
    if (!(await badge.count())) throw new AppDefect("D4: « Connexion temps réel : … · Actualiser » not visible as text");
    const late = await seed(ctx, { client: user, status: "requested", description: "D4 dossier créé après la connexion" });
    await measure(ctx, h, "D4 (a) absent id", 1, async () => {
      await goHash(h.page, VIEWS.client(late.id));
      await expectShown(ctx, h, late, "D4 (a)");
    });
    await measure(ctx, h, "D4 (b) same id again", 0, async () => {
      await goHash(h.page, VIEWS.requests);
      await goHash(h.page, VIEWS.client(late.id));
      await expectShown(ctx, h, late, "D4 (b)");
    });
    await measure(ctx, h, "D4 (c) Actualiser", 1, async () => {
      await badge.first().click();
    });
    await measure(ctx, h, "D4 (d) quiet window", 0, async () => {
      await gatedWait(ctx.gate, limits(ctx).quietWindowMs);
    });
    const never = randomUUID(); // never seeded: absence memory (A2 P2-3)
    const notFound = () => expectVisible(h.page.getByText(UI.clientNotFound, { exact: true }), "D4: « introuvable »", { timeout: limits(ctx).showMs });
    let winE;
    const we = await measure(ctx, h, "D4 (e) never-seeded id", 1, async () => {
      winE = Date.now();
      await goHash(h.page, VIEWS.client(never));
      await notFound();
    });
    const reply = h.network.workspaceGets({ from: winE }).at(-1);
    if (!reply || reply.status !== 200) throw blocked(`D4 (e): the real workspace reply was ${reply?.status} (complete 200 required)`);
    if (!we.seen.clientNotFound) throw new AppDefect("D4 (e): « introuvable » not rendered after the loaded refresh");
    const wf = await measure(ctx, h, "D4 (f) never-seeded id again", 0, async () => {
      await goHash(h.page, VIEWS.requests);
      await goHash(h.page, VIEWS.client(never));
      await notFound();
    });
    if (wf.seen.loading) throw new AppDefect("D4 (f): « Recherche du dossier… » shown again for a known absence");
    await sameIdentity(h, user, "D4 before (g)");
    // (g) A4: a REALLY different identity in the SAME document. Precondition OUTSIDE any window, run
    // once, never retried: shared logout (global ⇒ every clientA session revoked) + same-document
    // login of clientC, identity proven, document marker unchanged. Any failure ⇒ BLOCKED.
    const switcher = identitySwitch(ctx);
    // DL-QA-806-004: the auth calls are outside the /api barrier, so the stop gate is checked BEFORE
    // each identity step and AFTER every await (act); a StopRequestedError is never turned into
    // BLOCKED — it propagates and nothing further is emitted.
    const step = async (what, fn) => {
      try {
        return await act(ctx.gate, fn);
      } catch (error) {
        if (isStop(error)) throw error;
        throw blocked(`D4 (g) precondition: ${what} (${error?.message || error}); no retry`);
      }
    };
    // Leave the absent dossier first: after the login the view must not re-resolve it by itself
    // (that read would land before the window); the window's own navigation is the only cause.
    await act(ctx.gate, () => goHash(h.page, VIEWS.requests));
    const m0 = (await act(ctx.gate, () => readProbe(h.page)))?.marker;
    if (!m0) throw blocked("D4 (g) precondition: document marker missing");
    await step("logout failed", () => switcher.logout(h));
    ctx.revokeUser(user.id); // the app logout is global: clientA sessions are revoked
    await step("login of the second identity failed", () => switcher.login(h, ctx.users.clientC));
    await act(ctx.gate, () => ctx.rebind("dl-d4", ctx.users.clientC));
    await step("second identity not proven", () => waitForWorkspace(h.page, ctx.users.clientC.id, 30000));
    const m1 = (await act(ctx.gate, () => readProbe(h.page)))?.marker;
    if (m1 !== m0) throw blocked("D4 (g) precondition: the document changed during the identity switch (reload)");
    await measure(ctx, h, "D4 (g) other identity, same document", 1, async () => {
      await goHash(h.page, VIEWS.client(never));
      await notFound();
    });
    s.note("D4: one read per cause, none in the quiet window, absence memory keyed by identity (same document); « Actualiser » visible");
    await sameIdentity(h, ctx.users.clientC, "D4 (g)");
  },
};

/** A4: identity switch, injectable for tests; defaults to the shared logout + same-document login. */
export function identitySwitch(ctx) {
  return {
    logout: ctx.identity?.logout || ((h) => logout(h.page)),
    login: ctx.identity?.login || ((h, user) => login(h, ctx.base, user, ctx.projectRef, { sameDocument: true })),
  };
}
