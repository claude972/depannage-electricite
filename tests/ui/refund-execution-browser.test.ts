import { fileURLToPath as localSourcePath } from "node:url";
// RefundExecutionPanel MOUNTED in Chromium in a real React root (fake API, no network):
// <StrictMode> mount → cleanup → mount ends ready with the SECOND mount's GET (the first one is
// dropped); capability revoked by a rerender (same uid / generation) after the confirmation step or
// during a retryable error ⇒ zero additional POST; every panel button ≥ 44 px high.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RefundExecutionPanel } from "./components/features/refund-execution/refund-execution-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const REQ = "70000000-0000-4000-8000-000000000001";
const EXEC = "e0000000-0000-4000-8000-000000000001";
const request = { id: REQ, payment_id: "40000000-0000-4000-8000-000000000001", amount_cents: 12345, currency: "eur", status: "approved", version: 3 };
const read = (o = {}) => ({ status: 200, retryAfter: null, body: { request_status: "approved", execution_status: null, execution_id: null, eligible: true, available: true, reason: "approval_required", ...o } });
const context = { generation: () => 0, userId: () => "10000000-0000-4000-8000-000000000001" };
const store = () => { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => (m.set(k, v), true) }; };
function setup({ reads, posts }) {
  const calls = { get: 0, post: 0 };
  const api = {
    read: () => { const r = reads[calls.get++] ?? reads[reads.length - 1]; return tick(r.delay).then(() => r.res); },
    execute: () => { calls.post++; return Promise.resolve(posts.shift() ?? { status: 503, body: null, retryAfter: null }); },
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  const s = store();
  let n = 0;
  const render = (capability) => root.render(h(StrictMode, null, h(RefundExecutionPanel, { request, capability, api, context, store: s, newId: () => "c0000000-0000-4000-8000-00000000000" + ++n })));
  return { div, calls, render };
}
const click = (div, sel) => { const b = div.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
const heights = (div) => [...div.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().height));
w.scenarios = {
  async strict() {
    // First (discarded) mount's GET is slow and different; the second mount's GET must be the one shown.
    const { div, calls, render } = setup({ reads: [{ delay: 300, res: read({ execution_status: "unknown", execution_id: EXEC }) }, { delay: 40, res: read() }] });
    render(true);
    await tick(700);
    const panel = div.querySelector("[data-rx]");
    return { phase: panel?.getAttribute("data-rx"), status: div.querySelector("[data-rx-status]")?.getAttribute("data-rx-status") ?? null, gets: calls.get, posts: calls.post, heights: heights(div) };
  },
  async revokeAfterConfirm() {
    const { div, calls, render } = setup({ reads: [{ delay: 10, res: read() }] });
    render(true);
    await tick(200);
    const opened = click(div, "[data-rx-open]");
    await tick(50);
    const confirmHeights = heights(div);
    render(false); // same uid / generation, capability revoked
    await tick(50);
    const clicked = click(div, "[data-rx-execute]");
    await tick(100);
    return { opened, clicked, posts: calls.post, dialog: !!div.querySelector("[data-rx-confirm]"), open: !!div.querySelector("[data-rx-open]"), confirmHeights };
  },
  async revokeDuringRetry() {
    const { div, calls, render } = setup({ reads: [{ delay: 10, res: read() }], posts: [{ status: 503, body: null, retryAfter: null }] });
    render(true);
    await tick(200);
    click(div, "[data-rx-open]");
    await tick(50);
    click(div, "[data-rx-execute]");
    await tick(100);
    const retryShown = !!div.querySelector("[data-rx-retry]");
    const retryHeights = heights(div);
    render(false);
    await tick(50);
    const clicked = click(div, "[data-rx-retry]");
    await tick(100);
    return { retryShown, clicked, posts: calls.post, retryHeights };
  },
};
`;

test("RefundExecutionPanel monté (Chromium, StrictMode, faux API)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({
    absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out",
    platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error",
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2" id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run = (name: string) => page.evaluate((n: string) => (window as unknown as { scenarios: Record<string, () => Promise<unknown>> }).scenarios[n](), name);

    const strict = (await run("strict")) as { phase: string; status: string; gets: number; posts: number; heights: number[] };
    same([strict.phase, strict.status, strict.gets, strict.posts], ["ready", "none", 2, 0], "StrictMode: ready with the second mount's GET, never a POST");
    const confirm = (await run("revokeAfterConfirm")) as { opened: boolean; clicked: boolean; posts: number; dialog: boolean; open: boolean; confirmHeights: number[] };
    same([confirm.opened, confirm.posts, confirm.dialog, confirm.open], [true, 0, false, false], "revoked after the confirmation step: no dialog, no action, zero POST");
    const retry = (await run("revokeDuringRetry")) as { retryShown: boolean; clicked: boolean; posts: number; retryHeights: number[] };
    same([retry.retryShown, retry.posts], [true, 1], "revoked during a retryable error: the retry never posts");
    for (const h of [...strict.heights, ...confirm.confirmHeights, ...retry.retryHeights]) assert.ok(h >= 44, `button height ${h} ≥ 44 px`);
    assert.ok(strict.heights.length && confirm.confirmHeights.length >= 2 && retry.retryHeights.length, "buttons measured");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});
