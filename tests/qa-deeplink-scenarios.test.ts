// @ts-nocheck — drives the untyped ESM harness through tsx.
// WEB-DEEPLINK-QA-001 — the REAL scenarios D1–D4 (scripts/qa-deeplink/scenarios.mjs) run in real
// headless Chromium against a LOCAL mini-app reproducing the deep-link behaviour of the shells
// (cached workspace, one refresh per absent id, « Recherche du dossier… », error + « Réessayer » on a
// failed/invalid reply, « introuvable » after a loaded reply, badge « … · Actualiser », Realtime socket).
// Real pool (tracking createSessionPool + deep-link deps), probe, Realtime interception, observer,
// windows. Fake seed (no service key) and a cookie login. Broken app variants must FAIL, not PASS.
// No cloud, no credentials. Chromium absent ⇒ SKIPPED (never PASS). Short limits injected (ctx.limits).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDeeplinkPool, setupDeeplink, SCENARIO_RUNNERS } from "../scripts/qa-deeplink/scenarios.mjs";
import { runOne } from "../scripts/qa-tracking/run.mjs";
import { IntentLog } from "../scripts/qa-tracking/lib/intents.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";
import { createReport } from "../scripts/qa/lib/report.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { createCohort } from "../scripts/qa/lib/cohort.mjs";
import { configureBrowser } from "../scripts/qa/lib/browser.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;

const APP = String.raw`<!doctype html><meta charset="utf-8"><div id="badge"></div><main id="m"></main><script>
const VARIANT = __VARIANT__;
const st = { data: null, memory: {}, flight: null, connected: false };
async function readWorkspace() {
  const r = await fetch("/api/workspace", { cache: "no-store" });
  if (!r.ok) throw new Error("status " + r.status);
  const j = await r.json();
  if (!j || !j.profile || !Array.isArray(j.interventions)) throw new Error("invalid_response");
  return j;
}
function refresh() {
  if (st.flight) return st.flight;
  st.flight = (async () => {
    try { const j = await readWorkspace(); if (VARIANT === "double") await readWorkspace(); st.data = j; return true; }
    catch (e) { if (VARIANT === "clearOnFailure") st.data = Object.assign({}, st.data, { interventions: [] }); return false; }
    finally { st.flight = null; }
  })();
  return st.flight;
}
const role = () => st.data.profile.role;
const notFound = () => role() === "artisan" ? "<h2>Dossier introuvable</h2>" : role() === "manager" ? "<h2>Dossier introuvable sur ce périmètre</h2>" : "<h2>Intervention introuvable</h2><p>Ce dossier n’existe pas dans votre espace ou son lien n’est plus valide.</p>";
function attempt(id) { st.memory[id] = "pending"; render(); refresh().then((ok) => { st.memory[id] = ok ? "loaded" : "failed"; render(); }); }
function render() {
  if (!st.data) return;
  const [view, id] = location.hash.slice(1).split("/");
  document.getElementById("badge").innerHTML = role() === "client" ? '<button type="button" id="b">Connexion temps réel : ' + (st.connected ? "Connecté" : "non connectée") + " · Actualiser</button>" : "";
  const b = document.getElementById("b"); if (b) b.onclick = () => refresh().then(render);
  const m = document.getElementById("m");
  if ((view === "detail" || view === "mission") && id) {
    const row = st.data.interventions.find((i) => i.id === id);
    if (row) { m.innerHTML = "<h1>Détail de l’intervention</h1><p></p>"; m.querySelector("p").textContent = row.description; return; }
    const mem = st.memory[id];
    if (!mem) { if (VARIANT === "eagerNotFound") { m.innerHTML = notFound(); setTimeout(() => attempt(id), 30); return; } return attempt(id); }
    if (mem === "pending") { m.innerHTML = '<p role="status">Recherche du dossier…</p>'; return; }
    if (mem === "failed") { m.innerHTML = '<div class="unavailable" role="note" data-blocker="deeplink:error"><strong>Dossier momentanément indisponible</strong><p>Ce dossier n’a pas pu être vérifié.</p><button type="button">Réessayer</button></div>'; m.querySelector("button").onclick = () => attempt(id); return; }
    m.innerHTML = notFound();
    if (VARIANT.startsWith("flash")) { // transient leak of the foreign id, removed after 50 ms
      const el = document.createElement("span");
      if (VARIANT === "flashText") el.textContent = id;
      if (VARIANT === "flashData") el.setAttribute("data-ref", id);
      if (VARIANT === "flashAria") el.setAttribute("aria-label", "dossier " + id);
      m.appendChild(el); setTimeout(() => el.remove(), 50);
    }
    return;
  }
  m.innerHTML = "<h1>Mes demandes</h1><ul>" + st.data.interventions.map((i) => "<li>" + i.id.slice(0, 8) + "</li>").join("") + "</ul>";
}
window.__appLogout = () => {
  if (VARIANT === "reloadOnLogout") return location.reload();
  st.data = null; document.getElementById("badge").innerHTML = ""; document.getElementById("m").innerHTML = "<p>Connexion</p>";
};
window.__appLogin = () => readWorkspace().then((j) => {
  st.data = j;
  if (VARIANT !== "memoryNoIdentity") st.memory = {}; // attempt memory keyed by identity: reset on identity change
  render();
});
(async () => {
  try { st.data = await readWorkspace(); } catch { return; }
  const ws = new WebSocket("ws://" + location.host + "/realtime/v1/websocket?apikey=SECRET&vsn=1.0.0");
  ws.onopen = () => { st.connected = true; render(); }; ws.onclose = () => { st.connected = false; render(); };
  addEventListener("hashchange", render); render();
})();
</script>`;

function startApp(variant = "ok") {
  const users = new Map(); // id → role
  const jobs = []; // { id, description, visibleTo: [] }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const who = /qa-user=([0-9a-f-]{36})/.exec(req.headers.cookie || "")?.[1];
    if (u.pathname === "/api/workspace") {
      if (!who || !users.has(who)) return res.writeHead(401, { "content-type": "application/json" }).end("{}");
      const interventions = jobs.filter((j) => j.visibleTo.includes(who)).map(({ id, description }) => ({ id, status: "requested", description }));
      return res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" }).end(JSON.stringify({ profile: { id: who, role: users.get(who) }, interventions }));
    }
    if (u.pathname.startsWith("/api/")) return res.writeHead(404, { "content-type": "application/json", "cache-control": "private, no-store" }).end("{}");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(APP.replace("__VARIANT__", JSON.stringify(variant)));
  });
  server.on("upgrade", (req, socket) => socket.destroy()); // never reached when the block works
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, users, jobs, base: `http://127.0.0.1:${server.address().port}` })));
}

/** Fake seed with the TrackingFixtures surface used by the scenarios (no service key). */
function fakeTf(app, cohort) {
  const roleOf = { client: "client", artisan: "artisan", manager: "manager" };
  return {
    async createUser(label, role) {
      const user = { id: randomUUID(), label, role, email: cohort.email(label) };
      app.users.set(user.id, roleOf[role]);
      return user;
    },
    async createOrganization() { return { id: randomUUID() }; },
    async addMember() {},
    async createSite() { return { id: randomUUID() }; },
    async setSiteScope() {},
    async createIntervention(spec) {
      const job = { id: randomUUID(), description: cohort.description(spec.description), visibleTo: [spec.client?.id, spec.artisan?.id].filter(Boolean) };
      if (spec.site) job.visibleTo = [spec.client.id]; // outside the viewer's perimeter
      app.jobs.push(job);
      return { id: job.id, description: job.description };
    },
    db: { count: async (_t, f) => app.jobs.filter((j) => `eq.${j.id}` === f.id).length },
  };
}

async function runScenarios(variant, names, { failLogin = false } = {}) {
  configureBrowser({ timeoutMs: 8000 });
  const app = await startApp(variant);
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  const gate = createStopGate();
  const redactor = createRedactor();
  const cohort = createCohort();
  const intents = new IntentLog(path.join(mkdtempSync(path.join(tmpdir(), "qa-dl-")), "intents.json"));
  const state = { watch: new Map(), canaries: [] };
  const calls = { login: 0 };
  const pool = createDeeplinkPool({
    browser, base: app.base, supabaseOrigin: app.base, projectRef: "p", redactor, gate, intents, state,
    deps: {
      loginFn: async (handle, base, user) => {
        await handle.context.addCookies([{ name: "qa-user", value: user.id, url: base }]);
        await handle.page.goto(`${base}/#requests`);
      },
    },
  });
  const ctx = {
    base: app.base, gate, intents, cohort, redactor, log: () => {}, state, tf: fakeTf(app, cohort),
    api: { get: async () => ({ status: 404, cache: "private, no-store" }) },
    limits: { guardMs: 400, quietMs: 250, timeoutMs: 10000, showMs: 4000, quietWindowMs: 600 },
    session: (l, u) => pool.session(l, u), freshSession: (l, u) => pool.freshSession(l, u), closeSession: (l) => pool.closeSession(l),
    revokeUser: (id) => pool.revokeUser(id), rebind: (l, u) => pool.rebind(l, u),
    // A4: the mini-app's own identity switch, in the SAME document (no navigation).
    identity: {
      logout: async (h) => {
        await h.context.clearCookies();
        await h.page.evaluate(() => window.__appLogout());
      },
      login: async (h, user) => {
        calls.login++;
        if (failLogin) throw new Error("login refused by the test");
        await h.context.addCookies([{ name: "qa-user", value: user.id, url: app.base }]);
        await h.page.waitForFunction(() => typeof window.__appLogin === "function");
        await h.page.evaluate(() => window.__appLogin());
      },
    },
  };
  const report = createReport({}, redactor);
  const results = {};
  results.calls = calls;
  try {
    await setupDeeplink(ctx);
    for (const name of names) {
      pool.beginScenario();
      const entry = await runOne(report, "deeplink", name, (s) => SCENARIO_RUNNERS[name](ctx, s), async () => {}, gate);
      results[name] = { status: entry.status, error: entry.error?.message || entry.note || null };
    }
  } finally {
    await pool.closeAll().catch(() => {});
    await browser.close();
    app.server.close();
    configureBrowser({ timeoutMs: 90000 });
  }
  return results;
}

test("real Chromium — D1, D2, D3, D4 PASS on a conforming mini-app (Realtime blocked, hash only, clean windows)", { skip: SKIP, timeout: 240000 }, async () => {
  const r = await runScenarios("ok", ["D1", "D2", "D3", "D4"]);
  for (const name of ["D1", "D2", "D3", "D4"]) assert.equal(r[name].status, "PASS", `${name}: ${JSON.stringify(r[name])}`);
});

test("real Chromium — broken apps are FAIL, never PASS: eager « introuvable » (D1), double fetch (D1), data cleared on failure (D2)", { skip: SKIP, timeout: 240000 }, async () => {
  const eager = await runScenarios("eagerNotFound", ["D1"]);
  assert.equal(eager.D1.status, "FAIL", JSON.stringify(eager.D1));
  assert.match(eager.D1.error, /introuvable/);
  const double = await runScenarios("double", ["D1"]);
  assert.equal(double.D1.status, "FAIL", JSON.stringify(double.D1));
  assert.match(double.D1.error, /2 GET \/api\/workspace in a clean window \(expected 1\)/);
  const cleared = await runScenarios("clearOnFailure", ["D2"]);
  assert.equal(cleared.D2.status, "FAIL", JSON.stringify(cleared.D2));
  assert.match(cleared.D2.error, /witness missing|data cleared/);
});

test("real Chromium — DL-QA-806-001: a TRANSIENT foreign-id leak (text, data-*, aria-*; removed after 50 ms) is FAIL, never PASS", { skip: SKIP, timeout: 240000 }, async () => {
  for (const variant of ["flashText", "flashData", "flashAria"]) {
    const r = await runScenarios(variant, ["D3"]);
    assert.equal(r.D3.status, "FAIL", `${variant}: ${JSON.stringify(r.D3)}`);
    assert.match(r.D3.error, /foreign dossier id appeared in the DOM .*even transiently/, variant);
  }
});

test("real Chromium — A4 / DL-QA-806-002: D4 (g) other identity in the SAME document — identity-less memory FAIL, reload BLOCKED, failed login BLOCKED after 1 attempt", { skip: SKIP, timeout: 300000 }, async () => {
  const noIdentity = await runScenarios("memoryNoIdentity", ["D4"]);
  assert.equal(noIdentity.D4.status, "FAIL", JSON.stringify(noIdentity.D4));
  assert.match(noIdentity.D4.error, /D4 \(g\).*0 GET \/api\/workspace in a clean window \(expected 1\)/);
  const reload = await runScenarios("reloadOnLogout", ["D4"]);
  assert.equal(reload.D4.status, "BLOCKED", JSON.stringify(reload.D4));
  assert.match(reload.D4.error, /document changed during the identity switch/);
  const failed = await runScenarios("ok", ["D4"], { failLogin: true });
  assert.equal(failed.D4.status, "BLOCKED", JSON.stringify(failed.D4));
  assert.match(failed.D4.error, /login of the second identity failed.*no retry/);
  assert.equal(failed.calls.login, 1, "exactly one login attempt");
});
