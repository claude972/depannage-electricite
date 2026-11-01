// @ts-nocheck — drives the untyped ESM probe through tsx.
// WEB-REALTIME-PROBE-001 — the REAL app SDK (@supabase/ssr createBrowserClient + supabase-js /
// realtime-js 2.118 from node_modules, bundled locally) in REAL headless Chromium, against a LOCAL
// fake Supabase (auth + Phoenix Realtime). The real proxy, projector and runMeasurement are used.
// Covered: join ok + event delivery, binding mismatch ⇒ CHANNEL_ERROR without INSERT, system error
// after join, setAuth / access_token epochs after join, anon token ⇒ H2 observed, no secret persisted.
// No cloud, no credentials. Chromium absent ⇒ SKIPPED (never PASS).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { startFakeSupabase } from "../scripts/qa-realtime/test-support/fake-supabase.mjs";
import { buildBundle, servePage } from "../scripts/qa-realtime/lib/page.mjs";
import { installRealtimeProxy } from "../scripts/qa-realtime/lib/proxy.mjs";
import { runMeasurement } from "../scripts/qa-realtime/lib/measure.mjs";
import { conclude } from "../scripts/qa-realtime/lib/verdict.mjs";
import { MEASUREMENTS } from "../scripts/qa-realtime/lib/constants.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;
const APP_DIR = path.resolve(import.meta.dirname, "..");
const LIMITS = { joinTimeoutMs: 8000, windowMs: 2500 };
let bundleFile = null;
const bundleDir = mkdtempSync(path.join(tmpdir(), "qa-rt-bundle-"));
test.after(() => rmSync(bundleDir, { recursive: true, force: true }));

/** Real page + real proxy + logged-in QA client against the fake Supabase in `mode`. */
async function probe(mode, names, { afterJoin = null } = {}) {
  bundleFile ||= await buildBundle({ appDir: APP_DIR, outDir: bundleDir });
  const fake = await startFakeSupabase({ mode });
  const pageServer = await servePage(bundleFile);
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const email = `qa-0123456789ab-rt-client@qa.invalid`;
  const password = `pw-${randomUUID()}`;
  const uid = fake.addUser(email, password);
  const user = { id: uid, email, password };
  const inserts = [];
  const tf = {
    createIntervention: async ({ client }) => {
      const id = randomUUID();
      inserts.push(id);
      fake.insert(id, client.id);
      return { id };
    },
    db: { select: async (_t, f) => (inserts.includes(f.id.slice(3)) ? [{ id: f.id.slice(3), client_id: uid }] : []) },
  };
  const gate = createStopGate();
  try {
    const context = await browser.newContext();
    const proxy = await installRealtimeProxy(context, { supabaseOrigin: fake.url });
    const page = await context.newPage();
    await page.goto(pageServer.url);
    await page.evaluate(([u, k]) => window.__rt.init(u, k), [fake.url, "publishable-key-fake-000000000"]);
    const session = await page.evaluate(([e, p]) => window.__rt.signIn(e, p), [email, password]);
    assert.deepEqual(session, { ok: true, uid });
    const results = [];
    for (const spec of MEASUREMENTS.filter((m) => names.includes(m.name))) {
      const wrapped = afterJoin ? { ...spec } : spec;
      const page2 = afterJoin
        ? new Proxy(page, { get: (t, k) => (k === "evaluate" ? async (fn, arg) => { const r = await t.evaluate(fn, arg); if (Array.isArray(arg) && arg[0]?.channel) await afterJoin(page); return r; } : typeof t[k] === "function" ? t[k].bind(t) : t[k]) })
        : page;
      results.push(await runMeasurement({ spec: wrapped, uid, user, page: page2, proxy, tf, gate, ...LIMITS }));
    }
    return { results, inserts, stats: fake.stats, proxy: proxy.stats() };
  } finally {
    await browser.close();
    pageServer.server.close();
    fake.close();
  }
}
const SECRETS = /eyJ|access_token|refresh|password|Bearer|apikey|pw-/;

test("SDK + fake Realtime — join ok: SUBSCRIBED, server bindings match, ONE insert, own event received; auth epoch 0 proven; nothing secret", { skip: SKIP, timeout: 120000 }, async () => {
  const r = await probe("ok", ["app-4", "int-1"]);
  for (const m of r.results) {
    assert.equal(m.statuses.at(-1).status, "SUBSCRIBED", m.name);
    assert.equal(m.join.status, "ok");
    assert.equal(m.join.has_postgres_changes, true);
    assert.equal(m.join.server_bindings_count, m.tables.length);
    assert.equal(m.join.all_match, true);
    assert.deepEqual(m.insert, { performed: true, readback_ok: true });
    assert.equal(m.event_received_within_window, true, m.name);
    assert.equal(m.verdict, "event_received");
    assert.equal(m.auth.verdict, "proven", JSON.stringify(m.auth));
    assert.equal(m.auth.epochs[0].epoch, 0);
    assert.equal(m.auth.epochs[0].role_authenticated_sub_matches, true);
  }
  assert.equal(r.inserts.length, 2, "exactly one INSERT per confirmed measurement");
  assert.ok(!SECRETS.test(JSON.stringify(r.results)), "no token / claim / secret in the projection");
});

test("SDK + fake Realtime — payments not published (mismatch): app-4 CHANNEL_ERROR « mismatch… », NO insert; pub-3 event ⇒ H1a", { skip: SKIP, timeout: 120000 }, async () => {
  const r = await probe("mismatch", ["app-4", "pub-3"]);
  const [app, pub] = r.results;
  assert.equal(app.join_outcome, "CHANNEL_ERROR");
  assert.ok(app.statuses.some((x) => x.status === "CHANNEL_ERROR"));
  assert.equal(app.error_message, "mismatch between server and client bindings for postgres changes");
  assert.equal(app.verdict, "join_refused");
  assert.equal(app.insert.performed, false);
  assert.equal(app.join.server_bindings_count, 3);
  assert.equal(app.join.all_match, false);
  assert.equal(pub.verdict, "event_received");
  assert.equal(r.inserts.length, 1, "the refused join made no INSERT");
  assert.deepEqual(conclude(r.results).map((c) => c.code), ["H1a"]);
});

test("SDK + fake Realtime — system error after an ok join: app-4 SUBSCRIBED + whitelisted error + no own event, int-1 event ⇒ H1b", { skip: SKIP, timeout: 120000 }, async () => {
  const r = await probe("systemError", ["app-4", "int-1"]);
  const [app, int] = r.results;
  assert.equal(app.join_outcome, "SUBSCRIBED");
  assert.ok(app.system.some((s) => s.status === "error" && s.message === "Unable to subscribe to changes with given parameters"), JSON.stringify(app.system));
  assert.equal(app.verdict, "no_event");
  assert.equal(int.verdict, "event_received");
  assert.ok(int.system.every((s) => s.status !== "error"));
  assert.ok(conclude(r.results).some((c) => c.code === "H1b"));
});

test("SDK + fake Realtime — setAuth after join: a refreshed session sends access_token on the channel ⇒ epoch 1 captured, still proven", { skip: SKIP, timeout: 120000 }, async () => {
  let refreshed = false;
  const r = await probe("ok", ["int-1"], { afterJoin: async (page) => { if (!refreshed) { refreshed = true; assert.equal(await page.evaluate(() => window.__rt.refreshSession()), true); await new Promise((res) => setTimeout(res, 300)); } } });
  const [m] = r.results;
  assert.ok(r.stats.accessTokens >= 1, "the SDK pushed access_token after the join");
  assert.ok(m.auth.epochs.length >= 2, JSON.stringify(m.auth));
  assert.equal(m.auth.sdk_token_changes, m.auth.epochs.length - 1);
  assert.equal(m.auth.verdict, "proven");
});

test("SDK + fake Realtime — anon token at join ⇒ H2 observed for that measurement (captured, not unknown)", { skip: SKIP, timeout: 120000 }, async () => {
  const r = await probe("anonToken", ["int-1"]);
  assert.equal(r.results[0].auth.verdict, "observed_false");
  assert.ok(conclude(r.results).some((c) => c.code === "H2_observed"));
});

test("SDK + fake Realtime — no event delivered on a proven, matching int-1 ⇒ UNKNOWN_H3_POSSIBLE (absence alone is never H3)", { skip: SKIP, timeout: 120000 }, async () => {
  const r = await probe("noEvents", ["int-1"]);
  assert.equal(r.results[0].verdict, "no_event");
  assert.deepEqual(conclude(r.results).map((c) => c.code), ["UNKNOWN_H3_POSSIBLE"]);
});
