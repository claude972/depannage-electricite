// @ts-nocheck — drives the untyped ESM harness (scripts/qa-tracking/*.mjs) through tsx.
// WEB-TRACKING-QA-006 — REAL behaviour of the mutation barrier (root review of 8aa5a78): a local
// HTTP server (real sockets: deferred 503, commit-then-lost-response, held replies) and a real
// headless Chromium driven by the harness code itself (pageTransport, trackBrowserMutations,
// createSessionPool, shared createLifecycle + createGuardedCleanup). No cloud, no credentials.
// Chromium: QA_PLAYWRIGHT_PATH / QA_CHROMIUM_PATH, defaulting to the local Playwright install;
// when absent the browser tests are reported SKIPPED with the reason (never PASS).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { IntentLog, intentsVerdict } from "../scripts/qa-tracking/lib/intents.mjs";
import { createTrackingApi, trackBrowserMutations, pageTransport } from "../scripts/qa-tracking/lib/guard.mjs";
import { proveTracking } from "../scripts/qa-tracking/lib/reconcile.mjs";
import { createGuardedCleanup, exitCodeFor } from "../scripts/qa-tracking/lib/finalize.mjs";
import { TrackingFixtures, createSessionPool } from "../scripts/qa-tracking/scenarios.mjs";
import { createLifecycle, createStopGate, StopRequestedError } from "../scripts/qa/lib/lifecycle.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;
const JOB = randomUUID();
const SID = randomUUID();
const PATH = `/api/interventions/${JOB}/tracking`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = () => mkdtempSync(path.join(tmpdir(), "qa-tracking-barrier-"));

/** Local server: the tracking POST behaviour is taken from `plan` (one entry per request). */
function startServer() {
  const state = { mutations: 0, plan: [], held: [], row: null };
  const page = `<!doctype html><meta charset="utf-8"><button id="a">a</button><button id="b">b</button><script>
    const send = (seq) => fetch(${JSON.stringify(PATH)}, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "point", expected_version: 1, payload: { session_id: ${JSON.stringify(SID)}, seq } }) }).then((r) => r.text()).catch(() => {}); // like the app: the JSON answer is read
    document.getElementById("a").onclick = () => send(2);
    document.getElementById("b").onclick = () => send(3);
  </script>`;
  const server = http.createServer((req, res) => {
    if (req.method === "GET") return res.writeHead(200, { "content-type": "text/html" }).end(page);
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      state.mutations++;
      const body = JSON.parse(raw || "{}");
      const behaviour = state.plan.shift() || "ok";
      const reply = (status) => res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" }).end(JSON.stringify({ ok: status < 300 }));
      if (behaviour === "ok") return reply(200);
      if (behaviour === "defer503") return setTimeout(() => reply(503), 250);
      if (behaviour === "commitDrop") {
        state.row = { session_id: body.payload.session_id, last_seq: body.payload.seq }; // the server APPLIED it…
        return req.socket.destroy(); // …and the response is lost
      }
      if (behaviour === "hold") return state.held.push(() => reply(200));
      reply(500);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ state, origin, release: () => state.held.splice(0).forEach((f) => f()), close: () => new Promise((r) => { state.held.splice(0).forEach((f) => f()); server.closeAllConnections?.(); server.close(() => r()); }) });
    }),
  );
}
async function launch() {
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  return browser;
}
const readback = (srv) => async (meta) => proveTracking(meta, srv.state.row, null);

test("repro 1 — deferred 503 ⇒ outcome UNKNOWN, intent open, reconciled only once a readback proves the state", { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(srv.origin);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(tmp(), "intents.json"));
    const api = createTrackingApi({ gate, intents, reconcile: readback(srv), transportFor: (p) => pageTransport(p, 5000) });
    srv.state.plan.push("defer503");
    const answer = await api.post(page, PATH, { action: "point", expected_version: 1, payload: { session_id: SID, seq: 7 } });
    assert.equal(answer.status, 503);
    assert.equal(answer.outcome, "unknown", "a 5xx is never a refusal");
    assert.equal(intentsVerdict(intents).ok, false, "intent stays open ⇒ run INCOMPLETE");
    await intents.reconcileOpen();
    assert.equal(intents.open().length, 1, "readback shows nothing applied: still unknown (not proof)");
    srv.state.row = { session_id: SID, last_seq: 7 }; // the server state becomes observable
    await intents.reconcileOpen();
    assert.equal(intentsVerdict(intents).ok, true);
    assert.equal(intents.entries[0].outcome, "reconciled");
  } finally {
    await browser.close();
    await srv.close();
  }
});

test("repro 2 — commit then lost response (server applied, client gets a network error) ⇒ unknown, readback proves it", { skip: SKIP }, async () => {
  const srv = await startServer();
  const browser = await launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(srv.origin);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(tmp(), "intents.json"));
    const api = createTrackingApi({ gate, intents, reconcile: readback(srv), transportFor: (p) => pageTransport(p, 5000) });
    // Chromium silently retries a POST once when a reused keep-alive connection drops (observed):
    // both attempts are applied server-side then lose their response.
    srv.state.plan.push("commitDrop", "commitDrop");
    const answer = await api.post(page, PATH, { action: "point", expected_version: 1, payload: { session_id: SID, seq: 9 } });
    assert.equal(answer.transportError, true);
    assert.equal(answer.outcome, "unknown");
    assert.ok(srv.state.mutations >= 1);
    assert.deepEqual(srv.state.row, { session_id: SID, last_seq: 9 }, "the server did apply it");
    assert.equal(intents.entries[0].outcome, "reconciled", "the immediate readback proves the applied state");
    assert.equal(intentsVerdict(intents).ok, true);
  } finally {
    await browser.close();
    await srv.close();
  }
});

async function barrierRun({ release, drainTimeoutMs }) {
  const srv = await startServer();
  const browser = await launch();
  const dir = tmp();
  const manifestFile = path.join(dir, "manifest.json");
  writeFileSync(manifestFile, JSON.stringify({ run_id: "0123456789ab", created: { interventions: [JOB] } }));
  const manifestBefore = readFileSync(manifestFile, "utf8");
  const events = [];
  const ev = (type, extra = {}) => events.push({ type, at: performance.now(), ...extra });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(srv.origin);
    const gate = createStopGate();
    const intents = new IntentLog(path.join(dir, "intents.json"));
    const reconcile = readback(srv);
    const api = createTrackingApi({ gate, intents, reconcile, transportFor: (p) => pageTransport(p, 20000) });
    await trackBrowserMutations(page, { gate, intents, reconcile, origin: srv.origin, onEvent: (e) => ev(e.type, { outcome: e.outcome }) });
    let proveAndCleanCalls = 0;
    const lifecycle = createLifecycle({
      gate,
      drainTimeoutMs,
      writeResults: async () => {},
      cleanup: createGuardedCleanup({
        gate,
        recovery: `node scripts/qa-tracking/run.mjs --cleanup-manifest ${manifestFile} --credentials <credentials.json> --project p`,
        onEvent: (e) => ev(e.type),
        stopProducers: async () => ev("producers-stopped"),
        proveAndClean: async () => {
          proveAndCleanCalls++; // would read Auth and delete in a real run
          ev("delete");
          return { ok: true };
        },
      }),
    });
    const proc = new EventEmitter();
    const exited = new Promise((resolve) => lifecycle.installSignalHandlers(proc, { codeFor: (sig, cleanup) => exitCodeFor({ cleanup, signal: true }), exit: resolve }));
    srv.state.plan.push("hold", "hold");
    const apiCall = api.post(page, PATH, { action: "point", expected_version: 1, payload: { session_id: SID, seq: 1 } });
    apiCall.then(() => ev("api-settled"));
    await page.click("#a"); // browser-triggered mutation, held by the server
    while (srv.state.mutations < 2) await sleep(20);
    assert.equal(gate.pending, 2, "both pending mutations are counted by the drain");
    ev("sigint");
    proc.emit("SIGINT");
    assert.throws(() => api.post(page, PATH, { action: "point", expected_version: 1, payload: { session_id: SID, seq: 5 } }), StopRequestedError);
    await page.click("#b"); // a NEW browser mutation after the signal
    await sleep(250);
    assert.equal(srv.state.mutations, 2, "no new mutation reached the server after SIGINT");
    assert.ok(events.some((e) => e.type === "browser-mutation-blocked"));
    if (release) {
      await sleep(200);
      ev("released");
      srv.release();
    }
    const code = await exited;
    const intentsAtExit = JSON.parse(readFileSync(intents.file, "utf8")).intents; // what a real process leaves on disk
    if (release) await apiCall;
    return { code, events, intents, intentsAtExit, proveAndCleanCalls, manifestFile, manifestBefore, srv };
  } finally {
    if (!release) srv.release();
    await browser.close();
    await srv.close();
  }
}

test("repro 3 — SIGINT with a pending harness POST and a pending browser mutation: barrier, drain waits, cleanup strictly after", { skip: SKIP }, async () => {
  const r = await barrierRun({ release: true, drainTimeoutMs: 10000 });
  assert.equal(r.code, 130, "interrupted, cleanup complete");
  const t = (type) => r.events.find((e) => e.type === type)?.at;
  const browserSettled = r.events.filter((e) => e.type === "browser-mutation-settled").map((e) => e.at);
  assert.equal(browserSettled.length, 1, "the held browser mutation settled");
  assert.ok(t("api-settled") !== undefined, "the held harness POST settled");
  assert.ok(t("cleanup-start") > t("released"), "cleanup did not start before the replies were released");
  assert.ok(t("cleanup-start") > Math.max(t("api-settled"), ...browserSettled), "cleanup strictly after both settlements");
  assert.ok(t("delete") > t("cleanup-start"));
  assert.equal(r.proveAndCleanCalls, 1);
  assert.equal(intentsVerdict(r.intents).ok, true, "both mutations completed (2xx): nothing unknown");
});

test("repro 4 — drain timeout with pending producers ⇒ zero deletion, zero Auth read, manifest untouched, exit 3 + recovery", { skip: SKIP }, async () => {
  const r = await barrierRun({ release: false, drainTimeoutMs: 400 });
  assert.equal(r.code, 3);
  assert.equal(r.proveAndCleanCalls, 0, "no deletion and no Auth read while producers are undrained");
  assert.ok(r.events.some((e) => e.type === "cleanup-refused"));
  assert.equal(readFileSync(r.manifestFile, "utf8"), r.manifestBefore, "manifest intact");
  const onDisk = r.intentsAtExit;
  assert.equal(onDisk.length, 2);
  assert.ok(onDisk.every((e) => e.state === "open"), "both writes recorded as open (unknown) on disk");
});

test("repro 5 — SIGINT during the await that precedes an emission ⇒ the call is never emitted (session opening, service write)", async () => {
  const gate = createStopGate();
  const intents = new IntentLog(path.join(tmp(), "intents.json"));
  let releasePage;
  const pageReady = new Promise((r) => (releasePage = r));
  const calls = { login: 0, track: 0, close: 0 };
  const pool = createSessionPool({
    browser: {}, base: "http://127.0.0.1:9", projectRef: "p", redactor: null, gate, intents,
    deps: {
      newPageFn: async () => { await pageReady; return { page: {}, close: async () => { calls.close++; } }; },
      trackFn: async () => { calls.track++; return {}; },
      loginFn: async () => { calls.login++; },
      waitFn: async () => {},
    },
  });
  const opening = pool.session("artisan", { id: randomUUID() });
  assert.equal(gate.pending, 1, "the session opening is part of the drain");
  gate.stop("SIGINT"); // signal arrives while the page/context is being created
  releasePage();
  await assert.rejects(opening, StopRequestedError);
  assert.deepEqual({ login: calls.login, track: calls.track }, { login: 0, track: 0 }, "nothing emitted after the await");
  assert.equal(calls.close, 1, "the half-open context is closed");
  // Service write: a stopped gate refuses before any intent or emission.
  let emitted = 0;
  const tf = new TrackingFixtures({ fixtures: { createUser: async () => { emitted++; } }, intents, cohort: { email: (l) => `qa-0123456789ab-${l}@qa.invalid`, runId: "0123456789ab" }, gate });
  assert.throws(() => tf.createUser("late", "client"), StopRequestedError);
  assert.equal(emitted, 0);
  assert.equal(intents.entries.length, 0, "no intent announced for a write that was never emitted");
});
