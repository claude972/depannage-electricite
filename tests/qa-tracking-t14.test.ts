// @ts-nocheck — drives the untyped ESM harness through tsx.
// WEB-TRACKING-QA-006 amendment A10 — T14 normalises MAIN (CAS stop + readback shared=false) BEFORE
// opening its panel; the 90 s catch / late retry is gone; every T14 assertion is kept. Pure order
// tests + a REAL headless Chromium against a local server reproducing the inherited-share markup.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureUnshared, ensureUnsharedMain } from "../scripts/qa-tracking/scenarios.mjs";
import { UI } from "../scripts/qa-tracking/lib/constants.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;
const MAIN = randomUUID();
const SID = randomUUID();

function fakeApi(rows, { stopStatus = 200, stopClears = true } = {}) {
  const events = [];
  return {
    events,
    api: {
      get: async (_page, p) => {
        events.push(`GET ${p}`);
        const row = rows[p.split("/")[3]];
        return { status: 200, cache: "private, no-store", body: { tracking: { ...row } } };
      },
      post: async (_page, p, body) => {
        events.push(`POST ${body.action} v${body.expected_version} ${body.payload.session_id}`);
        const row = rows[p.split("/")[3]];
        if (stopStatus === 200 && stopClears) Object.assign(row, { shared: false, session_id: null, control_version: row.control_version + 1 });
        return { status: stopStatus, outcome: stopStatus === 200 ? "done" : stopStatus >= 500 || stopStatus === 0 ? "unknown" : "refused", body: stopStatus === 200 ? {} : { reason: "tracking_changed", secret: "x" } };
      },
    },
  };
}

test("A10 order: inherited share ⇒ snapshot, CAS stop (current version + session), readback shared=false, then the caller opens the panel", async () => {
  const rows = { [MAIN]: { shared: true, session_id: SID, control_version: 7 } };
  const { api, events } = fakeApi(rows);
  assert.deepEqual(await ensureUnshared({ api }, {}, MAIN, "T14 main"), { stopped: true });
  assert.deepEqual(events, [`GET /api/interventions/${MAIN}/tracking`, `POST stop v7 ${SID}`, `GET /api/interventions/${MAIN}/tracking`]);
});

test("A10: not shared ⇒ no stop sent; refused stop or readback still shared ⇒ BLOCKED with the reason", async () => {
  const idle = fakeApi({ [MAIN]: { shared: false, session_id: null, control_version: 3 } });
  assert.deepEqual(await ensureUnshared({ api: idle.api }, {}, MAIN, "T14 main"), { stopped: false });
  assert.equal(idle.events.filter((e) => e.startsWith("POST")).length, 0);
  const refused = fakeApi({ [MAIN]: { shared: true, session_id: SID, control_version: 7 } }, { stopStatus: 409 });
  await assert.rejects(ensureUnshared({ api: refused.api }, {}, MAIN, "T14 main"), (e) => e.blocked === true && /status 409, tracking_changed/.test(e.message) && !e.message.includes("secret"));
  const sticky = fakeApi({ [MAIN]: { shared: true, session_id: SID, control_version: 7 } }, { stopClears: false });
  await assert.rejects(ensureUnshared({ api: sticky.api }, {}, MAIN, "T14 main"), (e) => e.blocked === true && /still shared/.test(e.message));
});

test("A10: unknown/malformed shapes or an unknown stop outcome ⇒ UNKNOWN (BLOCKED, never PASS); ensureUnsharedMain targets MAIN", async () => {
  const shapes = [{}, { tracking: null }, { tracking: { shared: "yes", control_version: 1 } }, { tracking: { shared: true, control_version: 1 } }, { tracking: { shared: false } }];
  for (const body of shapes) {
    const api = { get: async () => ({ status: 200, cache: "private, no-store", body }), post: async () => { throw new Error("must not stop on an unknown shape"); } };
    await assert.rejects(ensureUnshared({ api }, {}, MAIN, "T14 main"), (e) => e.blocked === true && e.unknown === true, JSON.stringify(body));
  }
  const lost = fakeApi({ [MAIN]: { shared: true, session_id: SID, control_version: 7 } }, { stopStatus: 503 });
  await assert.rejects(ensureUnshared({ api: lost.api }, {}, MAIN, "T14 main"), (e) => e.unknown === true && /intent stays open/.test(e.message));
  let n = 0;
  const readback = { get: async () => ({ status: 200, cache: "private, no-store", body: n++ === 0 ? { tracking: { shared: true, session_id: SID, control_version: 2 } } : { nope: 1 } }), post: async () => ({ status: 200, outcome: "done", body: {} }) };
  await assert.rejects(ensureUnshared({ api: readback }, {}, MAIN, "T14 main"), (e) => e.unknown === true && /readback/.test(e.message));
  const main = fakeApi({ [MAIN]: { shared: false, session_id: null, control_version: 1 } });
  assert.deepEqual(await ensureUnsharedMain({ api: main.api, jobs: { main: { id: MAIN } } }, {}), { stopped: false });
  assert.deepEqual(main.events, [`GET /api/interventions/${MAIN}/tracking`]);
});

test("A10 source: T14 has no catch/late retry, normalises MAIN before opening its panel, keeps every assertion", () => {
  const source = readFileSync(path.resolve(import.meta.dirname, "../scripts/qa-tracking/scenarios.mjs"), "utf8");
  const a = source.indexOf("  async T14(ctx, s) {");
  const t14 = source.slice(a, source.indexOf("  async T15(ctx, s) {"));
  const code = t14.replace(/^\s*\/\/.*$/gm, ""); // comments aside
  assert.doesNotMatch(code, /\.catch\(|retry|reload\(|login\(/);
  assert.equal(code.match(/uiStart\(ctx, h, ctx\.jobs\.main\.id, s\)/g).length, 1, "a single attempt on MAIN");
  const norm = t14.indexOf("await ensureUnsharedMain(ctx, h.page);");
  const open = t14.indexOf("const p2 = await uiStart(ctx, h, ctx.jobs.main.id, s);");
  assert.ok(norm > 0 && open > norm, "normalise → readback → open panel");
  for (const kept of [
    /assert\.equal\(again\.status, 409, `repeated stop answered \$\{again\.status\}`\);/,
    /assert\.equal\(late\.status, 409, `point after stop answered \$\{late\.status\}`\);/,
    /p2\.getByRole\("button", \{ name: UI\.arrived, exact: true \}\)\.click\(\)/,
    /actions\(reqs2, "arrived"\)\.some\(\(r\) => r\.status === 200\)/,
    /assert\.equal\(arrived\.tracking\.travel_stage, "on_site"\);/,
    /assert\.equal\(arrived\.tracking\.shared, false\);/,
    /assert\.equal\(arrived\.tracking\.position, null\);/,
  ]) assert.match(t14, kept);
  // uiStart still requires « Partager ma position » then the consent (no fallback on « Reprendre »).
  const ui = source.slice(source.indexOf("async function uiStart("), source.indexOf("async function waitFor("));
  assert.match(ui, /getByRole\("button", \{ name: UI\.share, exact: true \}\)\.click\(\)/);
  assert.doesNotMatch(ui, /UI\.resume/);
});

// Local app: the panel re-reads its snapshot when the dossier (hash) changes, like TrackingAnchor.
function startServer(rows) {
  const page = `<!doctype html><meta charset="utf-8"><main id="m"></main><script>
    async function render() {
      const id = location.hash.split("/")[1];
      const r = await fetch("/api/interventions/" + id + "/tracking", { cache: "no-store" });
      const t = (await r.json()).tracking;
      document.getElementById("m").innerHTML = '<section><h2>Partage de ma position</h2>' + (t.shared
        ? '<p role="status">Partage interrompu par le rechargement de la page. L’arrêt côté service est tenté.</p><button type="button">Reprendre le partage</button>'
        : '<button type="button">Partager ma position</button>') + '</section>';
    }
    addEventListener("hashchange", render); render();
  </script>`;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const m = /^\/api\/interventions\/([0-9a-f-]{36})\/tracking$/.exec(req.url);
      if (!m) return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
      const row = (rows[m[1]] ||= { shared: false, session_id: null, control_version: 1 });
      const send = (status, body) => res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store" }).end(JSON.stringify(body));
      if (req.method === "GET") return send(200, { tracking: row });
      const body = JSON.parse(raw);
      if (body.action !== "stop" || body.expected_version !== row.control_version || body.payload.session_id !== row.session_id) return send(409, { reason: "tracking_changed" });
      Object.assign(row, { shared: false, session_id: null, control_version: row.control_version + 1 });
      send(200, { tracking: row });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const pageApi = {
  get: (page, p) => page.evaluate(async (p) => { const r = await fetch(p, { cache: "no-store" }); return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() }; }, p),
  post: (page, p, body) => page.evaluate(async ({ p, body }) => { const r = await fetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; }, { p, body }),
};

test("real Chromium repro — inherited share shows « Reprendre le partage »; after the precondition the MAIN panel shows « Partager ma position »", { skip: SKIP }, async (t) => {
  const ISO = randomUUID();
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  t.after(() => browser.close());
  for (const normalise of [false, true]) {
    const rows = { [MAIN]: { shared: true, session_id: SID, control_version: 4 }, [ISO]: { shared: false, session_id: null, control_version: 2 } };
    const { server, base } = await startServer(rows);
    try {
      const page = await browser.newPage();
      await page.goto(`${base}/#mission/${ISO}`);
      await page.getByRole("button", { name: UI.share, exact: true }).waitFor({ timeout: 5000 });
      if (normalise) assert.deepEqual(await ensureUnshared({ api: pageApi }, page, MAIN, "T14 main"), { stopped: true });
      await page.goto(`${base}/#mission/${MAIN}`); // the panel changes dossier and re-reads its snapshot
      if (normalise) {
        await page.getByRole("button", { name: UI.share, exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole("button", { name: UI.resume, exact: true }).count(), 0);
      } else {
        await page.getByRole("button", { name: UI.resume, exact: true }).waitFor({ timeout: 5000 });
        assert.equal(await page.getByRole("button", { name: UI.share, exact: true }).count(), 0, "the inherited state hides « Partager ma position » (the 4c ANOMALY)");
      }
      await page.close();
    } finally {
      server.close();
    }
  }
});
