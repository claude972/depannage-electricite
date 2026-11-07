// ROOT review of 18e44ff: new request (preferred A) → profile (preferred becomes B) → new request,
// same uid/generation. The real usePreferredAddress must render null until B's fresh reply, never
// A again; a stale A reply arriving after leaving is dropped. Real hook in a real React root in local
// Chromium; skipped — never passed — without Playwright/Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { usePreferredAddress } from "./components/features/client-addresses/client-addresses-panel";
const USER = "10000000-0000-4000-8000-000000000001";
const rec = (id, label, address) => ({ label, first_name: "Camille", last_name: "Durand", address, postal_code: "97200", city: "Fort-de-France", country_code: "FR", latitude: null, longitude: null, geo_source: null, is_preferred: true, id, user_id: USER, version: 1, created_at: "2026-11-01T10:00:00+00:00", updated_at: "2026-11-01T10:00:00+00:00", archived_at: null });
const body = (r) => ({ records: [r], page: { limit: 50, count: 1, complete: true }, permissions: { can_write: true } });
const A = rec("20000000-0000-4000-8000-000000000001", "Domicile", "1 rue A");
const B = rec("20000000-0000-4000-8000-000000000002", "Bureau", "2 rue B");
const pending = [];
const api = { list: () => new Promise((resolve) => pending.push(resolve)), command: async () => ({ status: 500, body: null, retryAfter: null }) };
const context = { generation: () => 1, userId: () => USER };
const seen = [];
function Probe({ enabled }) {
  const v = usePreferredAddress({ enabled, context, api });
  seen.push(v ? v.label : null);
  return h("output", null, v ? v.label : "none");
}
const div = document.createElement("div");
document.body.appendChild(div);
const root = createRoot(div);
const render = (enabled) => flushSync(() => root.render(h(Probe, { enabled })));
const tick = () => new Promise((r) => setTimeout(r, 20));
const text = () => div.textContent;
window.run = async () => {
  const out = {};
  render(true); await tick();                       // new request: GET #1 pending
  pending[0]({ status: 200, body: body(A), retryAfter: null }); await tick();
  out.first = text();                                // A
  render(false); await tick();                       // profile (preferred changes to B server-side)
  out.away = text();
  seen.length = 0;
  render(true);                                      // back on new request: GET #2 deferred
  out.reentryImmediate = text();
  await tick();
  out.beforeFresh = text();
  out.requests = pending.length;
  pending[1]({ status: 200, body: body(B), retryAfter: null }); await tick();
  out.after = text();
  out.sawAOnReentry = seen.includes("Domicile");
  // Stale reply: leave while GET #3 is pending, its (A) answer must never surface later.
  render(false); await tick();
  render(true); await tick();                        // GET #4 pending
  render(false); await tick();
  pending[2]({ status: 200, body: body(A), retryAfter: null }); await tick();
  out.staleAway = text();
  render(true); await tick();                        // GET #5 pending
  out.staleBack = text();
  return out;
};
`;

test("usePreferredAddress: re-entering the new request never shows the previous preferred address before the fresh reply", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_rq, rs) => {
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><body><script>${js}</script></body>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const r = (await page.evaluate("window.run()")) as Record<string, unknown>;
    assert.deepEqual(errors, []);
    assert.equal(r.first, "Domicile");
    assert.equal(r.away, "none");
    assert.equal(r.reentryImmediate, "none", "no old selection on re-activation");
    assert.equal(r.beforeFresh, "none", "still nothing before the fresh reply");
    assert.equal(r.requests, 2, "a fresh GET is made on re-entry");
    assert.equal(r.after, "Bureau", "the fresh preferred address B");
    assert.equal(r.sawAOnReentry, false, "A never rendered after re-entry");
    assert.equal(r.staleAway, "none");
    assert.equal(r.staleBack, "none", "a stale reply from an earlier visit never surfaces");
  } finally {
    await browser.close();
    server.close();
  }
});
