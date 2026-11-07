// Operational reminders mounted for real (React root, StrictMode, local Chromium) + artisan wiring.
// Credential panel: state as returned, explicit date + time ⇒ one POST with the command already stored
// under courant-private-op-reminders:, cancel behind a confirmation; no form when the server says
// no_date; 360 px light/dark, 44 px targets. Real app (demo artisan with one linked credential):
// « Mes documents » shows the reminder panel with its honest demo note, zero /api, no page errors,
// at 360/390/1280, light and dark.
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
const UID = "10000000-0000-4000-8000-0000000000ab";
const CRED = "60000000-0000-4000-8000-000000000001";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CredentialReminderPanel } from "./components/features/operational-reminders/operational-reminder-panel";
const CRED = "${CRED}";
window.calls = []; window.stored = null; window.rec = null;
const noDate = location.hash === "#nodate";
const fetcher = async (url, init) => {
  const method = (init && init.method) || "GET";
  window.calls.push(method + " " + url + (init && init.body ? " " + init.body : ""));
  let body;
  if (method === "POST") {
    window.stored = sessionStorage.getItem("courant-private-op-reminders:${UID}:1:credential:" + CRED);
    const c = JSON.parse(init.body);
    const v = (c.expected_version || 0) + 1;
    window.rec = c.action === "schedule"
      ? { id: "70000000-0000-4000-8000-000000000900", kind: "credential", record_id: CRED, source_version: 2, due_on: "2026-12-31", remind_at: c.remind_at, version: v, status: "scheduled", notification_id: null, processed_at: null, updated_at: "2026-11-07T12:00:00Z" }
      : { ...window.rec, version: v, status: "cancelled", processed_at: "2026-11-07T12:00:01Z" };
    body = { record: window.rec, replayed: false };
  } else {
    body = noDate
      ? { kind: "credential", record_id: CRED, source: { version: 1, due_on: null }, record: null, eligibility: "no_date", can_schedule: false, scheduled_for_current_source: false }
      : { kind: "credential", record_id: CRED, source: { version: 2, due_on: "2026-12-31" }, record: window.rec, eligibility: "available", can_schedule: true, scheduled_for_current_source: Boolean(window.rec && window.rec.status === "scheduled") };
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(CredentialReminderPanel, { credentialId: CRED, demo: false, context: { userId: () => "${UID}", generation: () => 1 }, fetcher, now: () => Date.parse("2026-11-07T12:00:00Z") })));
`;
type W = { calls: string[]; stored: string | null };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, input")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim() || e.tagName) }))()`;

test("Chromium : programmer (1 POST, commande stockée) puis annuler avec confirmation ; no_date ⇒ aucun formulaire ; 360 px clair/sombre", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}`);
      await page.locator('[data-op-eligibility="available"]').waitFor();
      assert.equal(await page.getByLabel("Date", { exact: true }).inputValue(), "", "nothing proposed");
      assert.equal(await page.getByLabel("Heure", { exact: true }).inputValue(), "");
      let layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.getByLabel("Date", { exact: true }).fill("2026-12-31");
      await page.getByLabel("Heure", { exact: true }).fill("08:00");
      await page.getByRole("button", { name: "Enregistrer le rappel" }).click();
      assert.match(await page.locator("[data-op-error]").innerText(), /avant le jour de l’échéance/);
      await page.getByLabel("Date", { exact: true }).fill("2026-12-20");
      await page.getByLabel("Heure", { exact: true }).fill("09:00");
      await page.getByRole("button", { name: "Enregistrer le rappel" }).click();
      await page.locator('[data-op-status="scheduled"]').waitFor();
      let w = await page.evaluate(() => ({ calls: (window as unknown as W).calls, stored: (window as unknown as W).stored, left: sessionStorage.length }));
      let posts = w.calls.filter((c: string) => c.startsWith("POST"));
      assert.equal(posts.length, 1);
      const cmd = JSON.parse(posts[0].slice(posts[0].indexOf("{")));
      assert.ok(posts[0].startsWith(`POST /api/artisan/credentials/${CRED}/reminder `));
      assert.equal(cmd.remind_at, "2026-12-20T09:00:00-04:00");
      assert.equal(cmd.expected_version, null);
      assert.equal(JSON.parse(w.stored!).command.command_id, cmd.command_id);
      assert.equal(w.left, 0);
      assert.match(await page.locator('[data-op-status="scheduled"]').innerText(), /Programmé pour le 20 décembre 2026[\s\S]*heure de Martinique/);
      await page.getByRole("button", { name: "Annuler le rappel" }).click();
      assert.match(await page.locator('[role="group"]').innerText(), /notification déjà émise n’est pas effacée/);
      layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.deepEqual(layout.small, [], theme);
      await page.getByRole("button", { name: "Confirmer l’annulation" }).click();
      await page.locator('[data-op-status="cancelled"]').waitFor();
      w = await page.evaluate(() => ({ calls: (window as unknown as W).calls, stored: null, left: sessionStorage.length }));
      posts = w.calls.filter((c: string) => c.startsWith("POST"));
      assert.equal(posts.length, 2);
      assert.equal(JSON.parse(posts[1].slice(posts[1].indexOf("{"))).expected_version, 1);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await page.goto(`${base}#nodate`);
    await page.locator('[data-op-eligibility="no_date"]').waitFor();
    assert.equal(await page.locator("input, form").count(), 0, "server says no_date: no form");
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : « Mes documents » artisan (démo, justificatif relié) — panneau de rappel, note honnête, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"])
      for (const width of [360, 390, 1280]) {
        const where = `${theme} ${width}px`;
        const { page, errors, api } = await open("artisan-documents", width);
        await page.evaluate((t: string) => {
          localStorage.setItem("courant-ui-theme", t);
          const raw = localStorage.getItem("courant-demo-artisan-v1");
          const data = raw ? JSON.parse(raw).data : null;
          const profile = data?.artisan_profile ?? { user_id: "x", company_name: "Démo", siret: "", legal_status: "EI", employee_count: 1, address: "3 rue des Ateliers, 97200", postal_codes: ["97200"], categories: ["panel"], available: true, application_status: "approved", submitted_at: "2026-10-01T09:00:00Z" };
          localStorage.setItem("courant-demo-artisan-v1", JSON.stringify({ version: 1, data: { artisan_profile: profile, credentials: [{ id: "60000000-0000-4000-8000-000000000001", user_id: profile.user_id, document_id: "doc-demo", kind: "liability", expires_on: "2027-06-30", created_at: "2026-10-01T09:00:00Z" }] } }));
        }, theme);
        const origin = new URL(page.url()).origin;
        await page.goto("about:blank");
        api.length = 0;
        await page.goto(`${origin}/#demo/artisan-documents`);
        await page.locator('[data-op-reminder="demo"]').first().waitFor();
        assert.match(await page.locator('[data-op-reminder="demo"]').first().innerText(), /aucun rappel n’est lu ni programmé : aucun appel n’est fait/, where);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
