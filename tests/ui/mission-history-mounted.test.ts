// Artisan mission history mounted (React root, StrictMode, Chromium 390 px) with the host logic of
// artisan-space: labels without a number until the server's counts are read, then exact counts;
// « Afficher plus » appends; a row opens through openIntervention (id outside any cache); segment
// switch restarts at page 1. Real app: demo « Missions » keeps its local lists and counts, zero /api.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withApp, skip as appSkip } from "./real-app-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MissionHistoryPanel, historyLabel } from "./components/features/mission-history/mission-history-panel";
const U = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const item = (n, status) => ({ id: U(n), category: "panel", address: "3 rue des Ateliers", city: "Fort-de-France", urgency: "scheduled", status, created_at: "2026-11-0" + (9 - (n % 8)) + "T10:00:00.000Z", completed_at: status === "paid" || status === "completed" ? "2026-11-07T10:00:00Z" : null, paid_at: status === "paid" ? "2026-11-07T11:00:00Z" : null });
window.calls = []; window.opened = []; window.hold = true;
const reply = (filter, items, next) => ({ items, counts: { active: 123, done: 112 }, filter, order: "newest_first", captured_at: "2026-11-07T12:00:00.000Z", page: { limit: 50, has_more: next !== null, next_cursor: next } });
const fetcher = async (url) => {
  window.calls.push(String(url));
  if (window.hold) await new Promise((r) => (window.release = r));
  const u = new URL(url, location.href), f = u.searchParams.get("filter"), c = u.searchParams.get("cursor");
  const st = f === "active" ? "in_progress" : "paid";
  const body = c ? reply(f, [item(3, st), item(150, st)], null) : reply(f, Array.from({ length: 50 }, (_, i) => item(i + 1, st)), "CUR");
  return new Response(JSON.stringify(body), { status: 200 });
};
const ctx = { userId: () => "u1", generation: () => 1 };
function Host() {
  const [segment, setSegment] = useState("active");
  const [counts, setCounts] = useState(null);
  return h("div", null,
    h("div", { role: "group" }, ["active", "done"].map((k) => h("button", { key: k, type: "button", "aria-pressed": segment === k, onClick: () => setSegment(k), "data-seg": k }, historyLabel(k, counts)))),
    h(MissionHistoryPanel, { key: "u1|1|" + segment, filter: segment, context: ctx, fetcher, onCounts: setCounts, empty: h("p", null, "vide"),
      renderRow: (i) => h("button", { type: "button", style: { minHeight: "44px", width: "100%" }, onClick: () => window.opened.push(i.id) }, i.city + " · " + (i.paid_at ? "Réglée" : "Terminée")) }));
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type W = { calls: string[]; opened: string[]; hold: boolean; release: () => void };

test("Chromium : pas de nombre avant lecture, puis compteurs serveur ; « Afficher plus » ; ouverture hors cache ; changement de segment ⇒ page 1", { skip }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.locator('[data-mission-history="loading"]').waitFor();
    assert.equal(await page.locator('[data-seg="active"]').innerText(), "En cours", "no number before the server's counts");
    assert.equal(await page.locator('[data-seg="done"]').innerText(), "Terminées");
    await page.evaluate(() => { const w = window as unknown as W; w.hold = false; w.release(); });
    await page.locator("[data-mission-history-row]").first().waitFor();
    assert.equal(await page.locator('[data-seg="active"]').innerText(), "En cours (123)");
    assert.equal(await page.locator('[data-seg="done"]').innerText(), "Terminées (112)");
    assert.equal(await page.locator("[data-mission-history-row]").count(), 50);
    await page.locator("[data-mission-history-more]").click();
    await page.locator('[data-mission-history-row="a0000000-0000-4000-8000-000000000150"]').waitFor();
    assert.equal(await page.locator("[data-mission-history-row]").count(), 51, "appended, duplicate dropped");
    await page.locator('[data-mission-history-row="a0000000-0000-4000-8000-000000000150"] button').click();
    assert.deepEqual(await page.evaluate(() => (window as unknown as W).opened), ["a0000000-0000-4000-8000-000000000150"], "opened beyond the cache");
    await page.locator('[data-seg="done"]').click();
    await page.locator('[data-filter="done"] [data-mission-history-row]').first().waitFor();
    const calls = await page.evaluate(() => (window as unknown as W).calls);
    assert.ok(calls.includes("/api/artisan/mission-history?filter=active&cursor=CUR"));
    assert.equal(calls[calls.length - 1], "/api/artisan/mission-history?filter=done", "segment change ⇒ page 1");
    const small = await page.evaluate(`[...document.querySelectorAll("[data-mission-history] > button, [data-mission-history] .note button")].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).length`);
    assert.equal(small, 0);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : « Missions » artisan (démo, 390 px) — En cours / Terminées locales et comptées, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("artisan-missions", 390);
    await page.waitForTimeout(1200);
    for (const label of [/^En cours \(\d+\)$/, /^Terminées \(\d+\)$/]) {
      const seg = page.getByRole("button", { name: label });
      assert.equal(await seg.count(), 1, String(label));
      await seg.click();
      await page.waitForTimeout(200);
      assert.equal(await page.locator("[data-mission-history]").count(), 0, "demo never mounts the live history");
    }
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
