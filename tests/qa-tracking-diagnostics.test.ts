// @ts-nocheck — drives the untyped ESM harness (scripts/qa-tracking/*.mjs) through tsx.
// WEB-TRACKING-QA-006 amendment A8 — bounded failure diagnostics (§1), strict T8 status locator (§2),
// global-logout isolation and ordering (§6). Pure unit tests + a REAL headless Chromium against a
// local server (no cloud, no credentials). Chromium: QA_PLAYWRIGHT_PATH / QA_CHROMIUM_PATH; when
// absent the browser tests are SKIPPED with the reason (never PASS).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { allowlistedAction, boundedReason, urlWithoutQuery, observeTrackingNetwork, captureDiagnostics, TRACKING_ACTIONS, DIAG_LIMITS, KNOWN_REASONS } from "../scripts/qa-tracking/lib/diagnostics.mjs";
import { createSessionPool, expectReloadInterrupted, revokedSession } from "../scripts/qa-tracking/scenarios.mjs";
import { runOne, scenarioOrder } from "../scripts/qa-tracking/run.mjs";
import { UI, SCENARIOS } from "../scripts/qa-tracking/lib/constants.mjs";
import { withPositionRedaction } from "../scripts/qa-tracking/lib/position-redact.mjs";
import { createRedactor } from "../scripts/qa/lib/redact.mjs";
import { createReport, AppDefect } from "../scripts/qa/lib/report.mjs";
import { createStopGate } from "../scripts/qa/lib/lifecycle.mjs";
import { configureBrowser } from "../scripts/qa/lib/browser.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;
const tmp = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "qa-tracking-diag-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const mode = (p) => statSync(p).mode & 0o777;
const fakePage = (url = "http://127.0.0.1:9/#x") => ({ on() {}, isClosed: () => false, url: () => url, screenshot: async () => { throw new Error("no browser"); }, evaluate: async () => ({}) });

// ---------------------------------------------------------------------------------------------
test("pure: POST action allowlist, bounded server reason, URL without query", () => {
  for (const a of TRACKING_ACTIONS) assert.equal(allowlistedAction("POST", "tracking", JSON.stringify({ action: a, payload: { label: "12 rue secrète" } })), a);
  assert.deepEqual([...TRACKING_ACTIONS], ["start", "point", "stop", "arrived", "destination"]);
  assert.equal(allowlistedAction("POST", "tracking", JSON.stringify({ action: "12 rue secrète" })), "other", "free text is never recorded");
  assert.equal(allowlistedAction("POST", "tracking", "not json"), "other");
  assert.equal(allowlistedAction("POST", "geocode", JSON.stringify({ query: "12 rue secrète" })), null, "geocode bodies are never read");
  assert.equal(allowlistedAction("GET", "tracking", null), null);
  for (const known of KNOWN_REASONS) assert.equal(boundedReason(JSON.stringify({ reason: known, latitude: 14.61234 })), known);
  assert.deepEqual([...KNOWN_REASONS].sort(), ["application_quota", "destination_required", "invalid_provider_response", "position_unavailable", "provider_quota", "provider_timeout", "provider_unavailable", "route_unavailable", "server_configuration", "tracking_changed"]);
  // A8 §8a repro: an unknown snake_case reason is NEVER persisted (closed set ⇒ "other").
  assert.equal(boundedReason(JSON.stringify({ reason: "private_token_from_upstream" })), "other");
  for (const other of [JSON.stringify({ reason: "Rue Secrète 12" }), JSON.stringify({ reason: "x".repeat(65) }), JSON.stringify({ reason: 3 })]) assert.equal(boundedReason(other), "other");
  for (const none of ["<html>", "", JSON.stringify({ error: "x" }), JSON.stringify({ reason: null }), JSON.stringify({ reason: "tracking_changed", pad: "x".repeat(DIAG_LIMITS.reasonBytes) })]) assert.equal(boundedReason(none), null);
  assert.equal(urlWithoutQuery("https://a.test/app?token=SECRET#mission/1"), "/app#mission/1");
  assert.equal(urlWithoutQuery("nope"), null);
});

test("§6 order: tracking scenarios except T19, then provider proofs, then T19 last", () => {
  const order = scenarioOrder([...SCENARIOS], ["provider-route", "provider-geocode"]).map((e) => `${e.suite}:${e.name}`);
  assert.deepEqual(order.slice(-3), ["provider:provider-route", "provider:provider-geocode", "tracking:T19"]);
  assert.equal(order.length, SCENARIOS.length + 2);
  assert.deepEqual(scenarioOrder(["T6"], []), [{ suite: "tracking", name: "T6" }], "--only T6 runs T6 alone");
  assert.deepEqual(scenarioOrder(["T19", "T6"], ["provider-route"]).map((e) => e.name), ["T6", "provider-route", "T19"]);
});

test("§6 pool: a global logout revokes every pooled session of the user ⇒ BLOCKED, no relogin; diagnostics see the scenario's pages", async () => {
  const gate = createStopGate();
  const calls = { login: 0 };
  const pool = createSessionPool({
    browser: {}, base: "http://127.0.0.1:9", projectRef: "p", redactor: null, gate, intents: null,
    deps: { newPageFn: async () => ({ page: fakePage(), close: async () => {} }), trackFn: async () => ({}), loginFn: async () => { calls.login++; }, waitFn: async () => {}, observeFn: () => ({ summary: () => [] }) },
  });
  const client = { id: randomUUID() };
  const outsider = { id: randomUUID() };
  pool.beginScenario();
  const c = await pool.session("client", client);
  const sw = await pool.freshSession("switch", client);
  assert.deepEqual(pool.diagnosticHandles().map((h) => h.label), ["switch", "client"], "most recent first");
  pool.revokeUser(client.id);
  pool.rebind("switch", outsider);
  const before = calls.login;
  await assert.rejects(pool.session("client", client), (e) => e.blocked === true && /révoquée/.test(e.message));
  assert.equal(calls.login, before, "never a silent relogin");
  assert.equal(await pool.session("switch", outsider), sw, "the rebound handle stays usable");
  assert.equal(c.revoked, true);
  pool.beginScenario();
  assert.deepEqual(pool.diagnosticHandles(), [], "reset at each scenario");
  for (const l of ["a", "b", "c", "d"]) await pool.session(l, { id: randomUUID() });
  assert.equal(pool.diagnosticHandles().length, DIAG_LIMITS.pages);
  assert.equal(revokedSession("x").blocked, true);
});

test("runOne: diagnostics once at the first failure, never on PASS, never changing the verdict (even when they throw)", async () => {
  const report = createReport({}, createRedactor());
  const seen = [];
  const pass = await runOne(report, "tracking", "T1", async () => {}, async () => {}, null, async (n) => seen.push(n));
  assert.equal(pass.status, "PASS");
  assert.deepEqual(seen, []);
  const fail = await runOne(report, "tracking", "T6", async () => { throw new AppDefect("card missing"); }, async () => {}, null, async (n) => seen.push(n));
  assert.equal(fail.status, "FAIL");
  assert.deepEqual(seen, ["T6"]);
  const failThrowing = await runOne(report, "tracking", "T8", async () => { throw new AppDefect("x"); }, async () => {}, null, async () => { throw new Error("diag broke"); });
  assert.equal(failThrowing.status, "FAIL");
  const blocked = await runOne(report, "tracking", "T12-sim", async () => { throw revokedSession("client"); }, async () => {}, null, async (n) => seen.push(n));
  assert.equal(blocked.status, "BLOCKED");
  assert.deepEqual(seen, ["T6", "T12-sim"]);
});

test("captureDiagnostics bounds: skipped once stopping, at most 3 pages, errors recorded, never throws, 0700/0600", async (t) => {
  const out = tmp(t);
  const gate = createStopGate();
  gate.stop("SIGINT");
  assert.deepEqual(await captureDiagnostics({ scenario: "T6", handles: [{ label: "a", page: fakePage() }], out, redactor: null, gate }), { skipped: "stopping" });
  assert.equal(existsSync(path.join(out, "diagnostics")), false);
  const handles = ["a", "b", "c", "d"].map((label) => ({ label, page: fakePage("http://h.test/x?secret=1#detail/1") }));
  const r = await captureDiagnostics({ scenario: "T6", handles, out, redactor: null });
  assert.equal(r.truncated, true);
  assert.equal(r.files.filter((f) => f.endsWith(".json")).length, 3);
  assert.ok(r.errors.some((e) => e.endsWith("SCREENSHOT:ERROR")));
  assert.equal(mode(path.join(out, "diagnostics")), 0o700);
  assert.equal(mode(path.join(out, "diagnostics", "T6")), 0o700);
  for (const f of r.files) assert.equal(mode(f), 0o600);
  assert.equal(JSON.parse(readFileSync(r.files[0], "utf8")).url, "/x#detail/1");
  // Hard time cap: a page that never answers is abandoned after the per-op/total bound.
  const hang = { label: "hang", page: { ...fakePage(), screenshot: () => new Promise(() => {}), evaluate: () => new Promise(() => {}) } };
  const t0 = Date.now();
  const h = await captureDiagnostics({ scenario: "T14", handles: [hang], out, redactor: null, limits: { ...DIAG_LIMITS, opMs: 100, totalMs: 300 } });
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(h.errors.some((e) => e.includes("TIMEOUT")));
});

test("A8 §8b repro — stop raised during the screenshot ⇒ no evaluate, capture truncated, next pages skipped, verdict unchanged", async (t) => {
  const out = tmp(t);
  const gate = createStopGate();
  const calls = { screenshot: 0, evaluate: 0 };
  const stopping = { label: "client", page: { ...fakePage(), screenshot: async () => { calls.screenshot++; gate.stop("SIGINT"); }, evaluate: async () => { calls.evaluate++; return {}; } } };
  const next = { label: "artisan", page: { ...fakePage(), screenshot: async () => { calls.screenshot++; }, evaluate: async () => { calls.evaluate++; return {}; } } };
  const d = await captureDiagnostics({ scenario: "T6", handles: [stopping, next], out, redactor: null, gate });
  assert.deepEqual(calls, { screenshot: 1, evaluate: 0 }, "no DOM read after the stop, second page never touched");
  assert.equal(d.truncated, "stopping");
  assert.equal(JSON.parse(readFileSync(path.join(out, "diagnostics", "T6", "client.json"), "utf8")).truncated, "stopping");
  assert.equal(existsSync(path.join(out, "diagnostics", "T6", "artisan.json")), false);
  // Stop during the DOM read: recorded as truncated too.
  const gate2 = createStopGate();
  const domStop = { label: "c2", page: { ...fakePage(), screenshot: async () => {}, evaluate: async () => { gate2.stop("SIGTERM"); return {}; } } };
  assert.equal((await captureDiagnostics({ scenario: "T9", handles: [domStop, next], out, redactor: null, gate: gate2 })).truncated, "stopping");
  // Verdict unchanged through runOne with the real capture.
  const gate3 = createStopGate();
  const report = createReport({}, createRedactor());
  const page3 = { label: "client", page: { ...fakePage(), screenshot: async () => { gate3.stop("SIGINT"); }, evaluate: async () => { calls.evaluate++; return {}; } } };
  const entry = await runOne(report, "tracking", "T6", async () => { throw new AppDefect("card missing"); }, async () => {}, null, () => captureDiagnostics({ scenario: "T6b", handles: [page3], out, redactor: null, gate: gate3 }));
  assert.equal(entry.status, "FAIL");
  assert.equal(calls.evaluate, 0);
});

// ---------------------------------------------------------------------------------------------
// Real Chromium against a local server mimicking the panel markup of the 4c source.
const JOB = randomUUID();
const STALE_PANEL = `<section class="panel"><h2>Partage de ma position</h2>
  <p role="status">Partage interrompu par le rechargement de la page. L’arrêt
  côté service est tenté ; s’il n’aboutit pas, la position cesse d’être affichée après 60 s.</p>
  <button type="button">Reprendre le partage</button></section>`;
function startServer(body) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url.startsWith("/api/")) {
        if (req.method === "POST") return res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify(req.url.endsWith("/geocode") ? { reason: "private_token_from_upstream" } : { reason: "tracking_changed", latitude: 14.61234, label: "12 rue secrète" }));
        return res.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" }).end(JSON.stringify({ tracking: { position: { latitude: 14.61234 } } }));
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8"><body>${body}</body>`);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, hits, base: `http://127.0.0.1:${server.address().port}` })));
}
async function withBrowser(fn) {
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

test("real Chromium — capture under the same page: no request, no navigation, passive reason, no body/header/position leak", { skip: SKIP }, async (t) => {
  const out = tmp(t);
  const html = `${STALE_PANEL}<div class="unavailable" role="note" data-blocker="capability:tracking"><strong>Suivi de l’artisan</strong><p>Disponibilité du service en cours de vérification.</p></div>
    <p role="status">Dernière position 14.61234, -61.01234</p>
    <script>
      fetch("/api/interventions/${JOB}/tracking", { headers: { Authorization: "Bearer SECRET-TOKEN-123" } }).then((r) => r.text());
      fetch("/api/interventions/${JOB}/tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "destination", expected_version: 1, payload: { label: "12 rue secrète", latitude: 14.61234 } }) }).then((r) => r.text());
      fetch("/api/interventions/${JOB}/tracking/geocode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "12 rue secrète" }) }).then((r) => r.text());
    </script>`;
  const { server, hits, base } = await startServer(html);
  t.after(() => server.close());
  await withBrowser(async (browser) => {
    const page = await browser.newPage();
    const network = observeTrackingNetwork(page);
    await page.goto(`${base}/app?token=SECRET-QUERY#mission/${JOB}`);
    for (let i = 0; i < 50 && !(network.summary().length === 3 && network.summary().every((e) => e.status !== null && (e.status < 400 || e.reason))); i++) await new Promise((r) => setTimeout(r, 50));
    let navigations = 0;
    page.on("framenavigated", () => navigations++);
    const hitsBefore = hits.length;
    const urlBefore = page.url();
    const redactor = withPositionRedaction(createRedactor());
    const r = await captureDiagnostics({ scenario: "T8", handles: [{ label: "artisanA-ui8", page, network }], out, redactor });
    assert.equal(hits.length, hitsBefore, "the capture made no request of its own");
    assert.equal(navigations, 0, "no navigation/reload");
    assert.equal(page.url(), urlBefore);
    assert.deepEqual(r.errors, []);
    const dir = path.join(out, "diagnostics", "T8");
    assert.deepEqual(readdirSync(dir).sort(), ["artisanA-ui8.json", "artisanA-ui8.png"]);
    for (const f of readdirSync(dir)) assert.equal(mode(path.join(dir, f)), 0o600);
    assert.equal(mode(dir), 0o700);
    const text = readFileSync(path.join(dir, "artisanA-ui8.json"), "utf8");
    const rec = JSON.parse(text);
    assert.equal(rec.url, `/app#mission/${JOB}`);
    assert.deepEqual(rec.dom.blockers.map((b) => b.blocker), ["capability:tracking"]);
    assert.match(rec.dom.artisan_panel.text, /Partage interrompu par le rechargement de la page\. L’arrêt/);
    assert.equal(rec.dom.client_card.present, false);
    const byKind = Object.fromEntries(rec.requests.map((e) => [`${e.method} ${e.path.endsWith("geocode") ? "geocode" : "tracking"}`, e]));
    assert.equal(byKind["POST tracking"].action, "destination");
    assert.equal(byKind["POST tracking"].reason, "tracking_changed");
    assert.equal(byKind["POST geocode"].reason, "other", "unknown upstream reason replaced by the constant");
    assert.equal(byKind["POST tracking"].status, 409);
    assert.equal(byKind["POST geocode"].action, null);
    assert.equal(byKind["GET tracking"].status, 200);
    assert.equal(byKind["GET tracking"].source, "ui");
    for (const leak of ["private_token_from_upstream", "SECRET-TOKEN-123", "Authorization", "authorization", "SECRET-QUERY", "12 rue secrète", "14.61234", "61.01234"]) assert.ok(!text.includes(leak), `no ${leak} in the diagnostics`);
  });
});

test("real Chromium — T8 strict locator: whole sentence in the panel status + resume button; exact text never matched", { skip: SKIP }, async (t) => {
  configureBrowser({ timeoutMs: 1500 });
  t.after(() => configureBrowser({ timeoutMs: 90000 }));
  // The panel markup really renders the sentence inside a longer status paragraph (source 4c).
  const source = readFileSync(path.resolve(import.meta.dirname, "../components/features/tracking/artisan-tracking-panel.tsx"), "utf8");
  assert.match(source, /<p className=\{styles\.warn\} role="status">\s*\{status\.kind === "interrupted" \? status\.reason : status\.kind === "error" \? "Le partage n’est plus actif sur cette page\." : "Partage interrompu par le rechargement de la page\."\} L’arrêt/);
  const cases = {
    ok: STALE_PANEL,
    twoStatuses: STALE_PANEL.replace("</section>", `<p role="status">${UI.reloadInterrupted}</p></section>`),
    noButton: STALE_PANEL.replace("<button type=\"button\">Reprendre le partage</button>", ""),
    outsidePanel: `<section><h2>Autre</h2><p role="status">${UI.reloadInterrupted} L’arrêt…</p><button>Reprendre le partage</button></section><section><h2>Partage de ma position</h2></section>`,
    lowercase: STALE_PANEL.replace("Partage interrompu", "partage interrompu"),
  };
  await withBrowser(async (browser) => {
    for (const [name, body] of Object.entries(cases)) {
      const { server, base } = await startServer(body);
      try {
        const page = await browser.newPage();
        await page.goto(`${base}/`);
        if (name === "ok") {
          await expectReloadInterrupted(page);
          assert.equal(await page.getByText(UI.reloadInterrupted, { exact: true }).count(), 0, "the former exact locator can never match this markup");
        } else {
          await assert.rejects(expectReloadInterrupted(page), (e) => e instanceof AppDefect || /strict mode/i.test(String(e?.message)), name);
        }
        await page.close();
      } finally {
        server.close();
      }
    }
  });
});
