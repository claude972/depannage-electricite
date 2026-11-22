import { fileURLToPath as localSourcePath } from "node:url";
// Appointment reminder panel mounted for real (React root, StrictMode, local Chromium): one GET
// on mount, an instant after the appointment is refused locally (0 POST), a valid local instant
// posts once; fits 360 px with 44 px targets in light and dark. Skipped without Chromium.
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const JOB = "20000000-0000-4000-8000-000000000001";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppointmentReminderPanel } from "./components/features/appointment-reminders/appointment-reminder-panel";
window.loads = 0; window.posts = [];
const starts = new Date(Date.now() + 3 * 86400000); starts.setSeconds(0, 0);
window.startsAt = starts.toISOString();
const state = { intervention_id: "${JOB}", appointment: { version: 1, starts_at: starts.toISOString(), ends_at: new Date(starts.getTime() + 7200000).toISOString() }, record: null, can_schedule: true, eligibility: "available", scheduled_for_current_slot: false };
const api = { load: async () => { window.loads++; return { status: 200, body: state }; }, command: async (b) => { window.posts.push(b); return { status: 503, body: null }; } };
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(AppointmentReminderPanel, { interventionId: "${JOB}", role: "client", context: { userId: () => "client-1", generation: () => 1 }, api })));
`;

test("Chromium : un GET (StrictMode), refus local après le rendez-vous, un POST valide, 360 px clair / sombre", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
      await page.evaluate((t: string) => document.documentElement.setAttribute("data-ui-theme", t), theme);
      await page.locator("[data-reminder-form]").waitFor();
      assert.equal(await page.evaluate(() => (window as unknown as { loads: number }).loads), 1, "one GET under StrictMode");
      // After the appointment ⇒ refused locally, nothing sent.
      const at = (ms: number) => page.evaluate(`(() => { const d = new Date(Date.parse(window.startsAt) + (${ms})); const p = (n) => String(n).padStart(2, "0"); return { date: d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()), time: p(d.getHours()) + ":" + p(d.getMinutes()) }; })()`) as Promise<{ date: string; time: string }>;
      const after = await at(3600000);
      await page.getByLabel("Date").fill(after.date);
      await page.getByLabel("Heure").fill(after.time);
      await page.locator("[data-reminder-submit]").click();
      await page.locator("[data-reminder-form-error]").waitFor();
      assert.equal((await page.evaluate(() => (window as unknown as { posts: unknown[] }).posts)).length, 0);
      // Two hours before ⇒ one POST with the local offset.
      const before = await at(-7200000);
      await page.getByLabel("Date").fill(before.date);
      await page.getByLabel("Heure").fill(before.time);
      await page.locator("[data-reminder-submit]").click();
      await page.locator("[data-reminder-retry]").waitFor();
      const posts = await page.evaluate(() => (window as unknown as { posts: { remind_at: string; action: string }[] }).posts);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].action, "schedule");
      assert.match(posts[0].remind_at, /[+-]\d{2}:\d{2}$|Z$/);
      const layout = await page.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, input")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 43.5; }).map((e) => e.outerHTML.slice(0, 60)) }))()`) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
