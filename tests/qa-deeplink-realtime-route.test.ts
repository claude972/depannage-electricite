// @ts-nocheck — drives the untyped ESM harness through tsx.
// WEB-DEEPLINK-QA-001 A1 §4 / A3 / A3b — LOCAL control of the Realtime interception against a REAL
// local WebSocket server and real headless Chromium, with the SAME pattern and handler as the harness
// (scripts/qa-deeplink/lib/realtime-block.mjs). The NATIVE in-page client proves code 4000; the page-
// side Playwright event is never required. No cloud. Chromium absent ⇒ SKIPPED (never PASS).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRealtimeBlock, installRealtimeBlock } from "../scripts/qa-deeplink/lib/realtime-block.mjs";
import { REALTIME_CLOSE } from "../scripts/qa-deeplink/lib/constants.mjs";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const HAVE_BROWSER = existsSync(path.join(PW, "package.json")) && existsSync(CHROMIUM);
const SKIP = HAVE_BROWSER ? false : `headless Chromium unavailable (set QA_PLAYWRIGHT_PATH and QA_CHROMIUM_PATH): ${PW} / ${CHROMIUM}`;

/** Minimal RFC 6455 server: handshake + one text frame "hello" to the client. */
function startServer() {
  const state = { upgrades: [] };
  const page = `<!doctype html><meta charset="utf-8"><script>
    window.qa = { events: [] };
    window.openWs = (p) => { const ws = new WebSocket("ws://" + location.host + p); const rec = { path: p.split("?")[0], code: null, messages: 0, opened: false };
      window.qa.events.push(rec); ws.onopen = () => (rec.opened = true); ws.onmessage = () => rec.messages++; ws.onclose = (e) => (rec.code = e.code); return true; };
  </script>`;
  const server = http.createServer((req, res) => res.writeHead(200, { "content-type": "text/html" }).end(page));
  server.on("upgrade", (req, socket) => {
    state.upgrades.push(new URL(req.url, "http://x").pathname);
    const accept = createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.from([0x81, 5, ...Buffer.from("hello")]));
    socket.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}
async function withPage(fn) {
  const { chromium } = createRequire(import.meta.url)(PW);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    return await fn({ context, page });
  } finally {
    await browser.close();
  }
}
const SECRET_PATH = "/realtime/v1/websocket?apikey=SECRET-KEY-123&vsn=1.0.0";
const waitFor = async (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });

test("control (a): WITHOUT the handler the Realtime socket really connects (1 upgrade, a frame received)", { skip: SKIP }, async (t) => {
  const { server, state, base } = await startServer();
  t.after(() => server.close());
  await withPage(async ({ page }) => {
    await page.goto(base);
    await page.evaluate((p) => window.openWs(p), SECRET_PATH);
    await waitFor(page, () => window.qa.events[0].messages > 0);
    assert.deepEqual(state.upgrades, ["/realtime/v1/websocket"]);
  });
});

test("control (b,c): WITH the harness handler — 1 hit, close resolved, 0 upgrades, NATIVE client close 4000, 0 frames; no secret or query recorded", { skip: SKIP }, async (t) => {
  const { server, state, base } = await startServer();
  t.after(() => server.close());
  await withPage(async ({ context, page }) => {
    const block = await installRealtimeBlock(context, createRealtimeBlock({ supabaseOrigin: base }));
    await page.goto(base);
    await page.evaluate((p) => window.openWs(p), SECRET_PATH);
    await waitFor(page, () => window.qa.events[0].code !== null);
    const native = await page.evaluate(() => window.qa.events[0]);
    assert.equal(native.code, REALTIME_CLOSE.code, "the native client receives the applied code");
    assert.equal(native.messages, 0);
    assert.deepEqual(state.upgrades, [], "never reached the server");
    const proof = block.proof();
    assert.equal(proof.ok, true, proof.reason);
    assert.deepEqual({ hits: proof.hits, close_resolved: proof.close_resolved }, { hits: 1, close_resolved: 1 });
    const recorded = JSON.stringify(block.stats());
    for (const leak of ["SECRET-KEY-123", "apikey", "vsn", "1.0.0"]) assert.ok(!recorded.includes(leak), `no ${leak} recorded`);
  });
});

test("control (d,e): a socket opened BEFORE installation is not intercepted (⇒ BLOCKED); another path is left alone", { skip: SKIP }, async (t) => {
  const { server, state, base } = await startServer();
  t.after(() => server.close());
  await withPage(async ({ context, page }) => {
    await page.goto(base);
    await page.evaluate((p) => window.openWs(p), SECRET_PATH);
    await waitFor(page, () => window.qa.events[0].messages > 0);
    const block = await installRealtimeBlock(context, createRealtimeBlock({ supabaseOrigin: base }));
    assert.equal(block.proof().ok, false, "0 hits ⇒ not proven ⇒ the scenario would be BLOCKED");
    assert.match(block.proof().reason, /handler called 0 times/);
    await page.evaluate(() => window.openWs("/other/socket"));
    await waitFor(page, () => window.qa.events[1].messages > 0);
    assert.deepEqual(state.upgrades, ["/realtime/v1/websocket", "/other/socket"], "the other path reached the server");
    assert.equal(block.stats().other_sockets, 1);
    assert.equal(block.stats().hits, 0);
  });
});
