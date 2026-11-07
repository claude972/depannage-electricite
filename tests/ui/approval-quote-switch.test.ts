// ROOT/Astra: a quoteId key alone is not enough — A→B→A before B answers, or a late reply of the
// unmounted A, must never reach the parent; only the latest load of the CURRENT mount applies.
// Real QuoteApprovalPanel in a real React root (Chromium, StrictMode), deferred fake API.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QuoteApprovalPanel } from "./components/features/advanced-approvals/approvals";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", SITE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const body = (q, approved) => ({ quote_id: q, site_id: SITE, required: true, approved_current: approved, policy: null, workflow: null, permissions: { can_submit: false, can_decide: false, can_respond: false }, events: [], next_after: null });
const pending = [];
const api = { policy: async () => ({ status: 503, body: null }), setPolicy: async () => ({ status: 503, body: null }), act: async () => ({ status: 503, body: null }),
  workflow: (q) => new Promise((resolve) => pending.push({ q, resolve })) };
const context = { generation: () => 1, userId: () => "11111111-1111-4111-8111-111111111111" };
window.reports = [];
let setQ;
function Parent() {
  const [q, set] = useState(A); setQ = set;
  return h(QuoteApprovalPanel, { key: q, quoteId: q, context, api, onStatus: (s) => window.reports.push(s ? s.quote_id + ":" + s.approved_current : "null") });
}
createRoot(document.body.appendChild(document.createElement("div"))).render(h(StrictMode, null, h(Parent)));
const tick = () => new Promise((r) => setTimeout(r, 30));
window.run = async () => {
  await tick();
  const firstA = pending.filter((p) => p.q === A);           // A mount(s) pending
  setQ(B); await tick();                                     // switch to B before A answers
  setQ(A); await tick();                                     // back to A before B answers
  for (const p of firstA) p.resolve({ status: 200, body: body(A, true) }); await tick();   // late reply of the OLD A mount
  for (const p of pending.filter((p) => p.q === B)) p.resolve({ status: 200, body: body(B, true) }); await tick(); // late B
  const afterStale = [...window.reports];
  const currentA = pending.filter((p) => p.q === A && !firstA.includes(p));
  for (const p of currentA) p.resolve({ status: 200, body: body(A, false) }); await tick(); // the current A mount's own read
  return { afterStale, final: [...window.reports], currentA: currentA.length };
};
`;

test("A→B→A: late replies of unmounted mounts never reach the parent; the current mount's read does", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_q, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><body><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const r = (await page.evaluate("window.run()")) as { afterStale: string[]; final: string[]; currentA: number };
    assert.deepEqual(errors, []);
    assert.deepEqual(r.afterStale, [], "no stale A (approved) nor unmounted B reply reported");
    assert.ok(r.currentA >= 1, "the current A mount issued its own read");
    assert.deepEqual(r.final.filter((x) => x !== "null"), ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:false"], "only the current mount's causal read applies");
  } finally {
    await browser.close();
    server.close();
  }
});

test("source: only a different quote clears the parent; write 401/403 invalidates earlier reads", () => {
  const ent = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(ent, /onClick=\{\(\) => \{\s+if \(displayed\?\.id === q\.id\) return;\s+setAdvancedRead\(null\);[^\n]*\n\s+setVersionId\(q\.id\);/);
  const ap = readFileSync("components/features/advanced-approvals/approvals.tsx", "utf8");
  assert.match(ap, /onForbidden: \(\) => \{\s+loadSeq\.current\+\+;\s+setStatus\("forbidden"\);\s+report\(null\);/);
  assert.match(ap, /return \(\) => \{\s+alive\.current = false;\s+loadSeq\.current\+\+;/);
});
