// ENT-07 — SLA case ↔ intervention link, real SiteOperationsView « Délais » (React root, StrictMode,
// Chromium 390 and 1280) in live with an injected client and enterprise search api. Editing notes
// keeps intervention_id; an intervention beyond page 1 is chosen and sent; errors / out-of-scope
// pages keep the link and offer no foreign row; « Retirer le lien » sends null; reader ⇒ no edit.
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
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SiteOperationsView } from "./components/features/site-operations/site-operations-view";
import { demoReport } from "./lib/features/site-operations/demo";
const SITE = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
const T = (n) => "aa000000-0000-4000-8000-" + String(n).padStart(12, "0");
const OLD = "bb000000-0000-4000-8000-000000000099";
window.T = T; window.OLD = OLD;
const report = demoReport();
report.snapshot.sla_cases[0].intervention_id = OLD; // old linked ticket, never in any loaded page
const reader = location.hash === "#reader";
window.cmds = []; window.lists = []; window.mode = "ok";
const row = (n, site = SITE) => ({ id: T(n), category: "panel", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", status: "completed", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: new Date(Date.UTC(2026, 9, 30) - n * 3600000).toISOString(), site_id: site, site_name: "Site", artisan_assigned: true });
const all = Array.from({ length: 25 }, (_, k) => row(k + 1));
const api = {
  async list(body) {
    window.lists.push(JSON.parse(JSON.stringify(body)));
    if (window.mode === "fail") return { status: 503, body: null };
    const items = all.slice((body.page - 1) * 10, body.page * 10);
    if (window.mode === "foreign") items[0] = row(900, OTHER);
    return { status: 200, body: { items, total: all.length, page: { number: body.page, limit: 10, pages: 3 } } };
  },
  async exportCsv() { return { status: 503, blob: null, filename: null, csv: false }; },
};
window.cmdGates = []; window.holdCmd = false; window.cmdFail = false;
const client = { load: async () => JSON.parse(JSON.stringify(report)), command: async (c) => {
  window.cmds.push(JSON.parse(JSON.stringify(c)));
  if (window.holdCmd) await new Promise((r) => window.cmdGates.push(r));
  if (window.cmdFail) throw new Error("Refus simulé du serveur.");
  return { action: c.action, result: {} };
} };
const scope = { userId: "u1", role: "manager", organizationId: report.snapshot.site.organization_id, siteId: SITE, authority: reader ? { canWrite: false, reason: "Lecture seule sur ce site." } : { canWrite: true } };
window.opened = [];
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(SiteOperationsView, { state: "available", unavailableMessage: "", scope, client,
  onNavigate: (v, p) => window.opened.push([v, p]),
  interventionSearch: { context: { userId: () => "u1", generation: () => 1 }, api } })));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
type Cmd = { action: string; payload: { intervention_id: string | null; notes: string } };
const OLD = "bb000000-0000-4000-8000-000000000099";
const T25 = "aa000000-0000-4000-8000-000000000025";

test("Chromium 390/1280 : notes ⇒ lien conservé ; choix paginé ⇒ envoyé ; erreurs / hors périmètre ⇒ lien gardé ; retrait explicite ⇒ null", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.getByRole("tab", { name: "Délais" }).or(page.getByRole("button", { name: "Délais" })).first().click();
      await page.locator(`[data-sla-case-link="${OLD}"]`).waitFor();
      const editFirst = async () => {
        await page.locator("li").filter({ hasText: "DEMO-001" }).getByRole("button", { name: "Modifier" }).click();
        await page.locator("[data-sla-intervention]").waitFor();
      };
      const save = async (n: number) => {
        await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
        await page.waitForFunction(`window.cmds.length === ${n}`);
        await page.locator("[data-sla-intervention]").waitFor({ state: "detached" });
      };
      const last = async () => ((await page.evaluate("window.cmds")) as Cmd[]).at(-1)!;
      // 1) Edit notes only ⇒ link preserved; the old ticket's reference is shown though not in any page.
      await editFirst();
      assert.match(await page.locator("[data-sla-current-link]").innerText(), /INT-BB0000(?![0-9A-F])/);
      await page.getByLabel("Notes (facultatif)").fill("Relance du prestataire.");
      await save(1);
      assert.equal((await last()).action, "save_sla_case");
      assert.equal((await last()).payload.intervention_id, OLD, "notes edit keeps the link");
      assert.equal((await last()).payload.notes, "Relance du prestataire.");
      // 2) Paginated choice: an intervention on page 3 ⇒ selected and sent.
      await editFirst();
      await page.getByRole("button", { name: "Choisir un autre ticket" }).click();
      await page.locator('[data-sla-picker="ready"]').waitFor();
      await page.locator("[data-sla-next]").click();
      await page.waitForFunction("document.querySelector('[data-sla-picker]')?.textContent.includes('Page 2 sur 3')");
      await page.locator("[data-sla-next]").click();
      await page.locator(`[data-sla-option="${T25}"]`).waitFor();
      assert.match(await page.locator("[data-sla-current-link]").innerText(), /INT-BB0000(?![0-9A-F])/, "current link kept across pages");
      await page.locator(`[data-sla-option="${T25}"] input`).check();
      const bodies = (await page.evaluate("window.lists")) as Array<{ organization_id: string; site_id: string; page: number }>;
      assert.ok(bodies.every((b) => b.site_id === "22222222-2222-4222-8222-222222222222" && b.organization_id), "bounded to org + site");
      assert.ok(bodies.some((b) => b.page === 3));
      await save(2);
      assert.equal((await last()).payload.intervention_id, T25);
      // 3) Read error ⇒ Réessayer, link kept; out-of-scope page ⇒ no foreign row offered, link kept.
      await editFirst();
      await page.evaluate("window.mode = 'fail'");
      await page.getByRole("button", { name: "Choisir un autre ticket" }).click();
      await page.locator("[data-sla-picker-error]").waitFor();
      assert.match(await page.locator("[data-sla-current-link]").innerText(), /INT-BB0000(?![0-9A-F])/);
      await page.evaluate("window.mode = 'foreign'");
      await page.locator("[data-sla-picker-error]").getByRole("button", { name: "Réessayer" }).click();
      await page.waitForTimeout(300);
      assert.equal(await page.locator('[data-sla-option="aa000000-0000-4000-8000-000000000900"]').count(), 0, "no foreign intervention offered");
      assert.equal(await page.locator("[data-sla-option]").count(), 0, "invalid page refused entirely");
      await page.evaluate("window.mode = 'ok'");
      await save(3);
      assert.equal((await last()).payload.intervention_id, OLD, "link kept through errors");
      // 4) Explicit removal ⇒ null.
      await editFirst();
      await page.locator("[data-sla-unlink]").click();
      assert.match(await page.locator("[data-sla-current-link]").innerText(), /Aucun ticket lié/);
      await save(4);
      assert.equal((await last()).payload.intervention_id, null, "removed only on explicit action");
      // A case without link stays without link when edited.
      await page.locator("li").filter({ hasText: "DEMO-002" }).getByRole("button", { name: "Modifier" }).click();
      await page.getByLabel("Notes (facultatif)").fill("Note");
      await save(5);
      assert.equal((await last()).payload.intervention_id, null);
      const small = await page.evaluate("[...document.querySelectorAll('[data-sla-intervention] button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).length");
      assert.equal(small, 0);
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium 390 : lecteur ⇒ aucune modification, ticket lié consultable", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    await page.goto(url + "#reader");
    await page.getByRole("tab", { name: "Délais" }).or(page.getByRole("button", { name: "Délais" })).first().click();
    await page.locator(`[data-sla-case-link="${OLD}"]`).waitFor();
    assert.equal(await page.locator("li").filter({ hasText: "DEMO-001" }).getByRole("button", { name: "Modifier" }).count(), 0, "reader ⇒ no edit");
    assert.equal(await page.locator("[data-sla-intervention]").count(), 0);
    await page.locator(`[data-sla-case-link="${OLD}"] button`).click();
    assert.deepEqual(await page.evaluate("window.opened"), [["intervention", OLD]]);
    assert.equal(await page.evaluate("window.cmds.length"), 0);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium 390/1280 : POST retenu ⇒ tout verrouillé (champs + lien), 2e envoi ⇒ aucun POST ; échec ⇒ brouillon + lien gardés, reprise identique ; succès ⇒ fermeture unique ; INT-6 ; échéance calculée après réponse", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.getByRole("tab", { name: "Délais" }).or(page.getByRole("button", { name: "Délais" })).first().click();
      const card = page.locator("li").filter({ hasText: "DEMO-001" });
      await card.locator(`[data-sla-case-link="${OLD}"]`).waitFor();
      // INT- + 6 characters, as the enterprise CSV.
      assert.equal((await card.locator(`[data-sla-case-link="${OLD}"]`).innerText()).trim(), "INT-BB0000");
      // A responded case still shows its computed due date.
      assert.ok((await card.locator("[data-sla-deadline]").count()) >= 1, "computed due date shown after a response");
      assert.match(await card.innerText(), /échéance calculée/);
      // Open the editor, choose a ticket on page 2, edit notes.
      await card.getByRole("button", { name: "Modifier" }).click();
      await page.getByRole("button", { name: "Choisir un autre ticket" }).click();
      await page.locator('[data-sla-picker="ready"]').waitFor();
      await page.locator("[data-sla-next]").click();
      const T15 = "aa000000-0000-4000-8000-000000000015";
      await page.locator(`[data-sla-option="${T15}"] input`).check();
      await page.getByLabel("Notes (facultatif)").fill("Note A avant envoi.");
      // Held POST ⇒ every field and link control disabled; a second submit sends nothing.
      await page.evaluate("window.holdCmd = true; window.cmdFail = true");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await page.waitForFunction("window.cmds.length === 1");
      await page.locator('[data-sla-case-form="saving"]').waitFor();
      const enabled = await page.evaluate("[...document.querySelectorAll('[data-sla-case-form] input, [data-sla-case-form] textarea, [data-sla-case-form] select, [data-sla-case-form] button')].filter((e) => !e.matches(':disabled')).length");
      assert.equal(enabled, 0, "all fields and link controls locked");
      await page.evaluate("document.querySelector('[data-sla-case-form]').requestSubmit()");
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate("window.cmds.length"), 1, "second submit ⇒ no POST");
      // Error ⇒ draft + chosen link kept, unlocked; identical manual retry.
      await page.evaluate("window.cmdGates.shift()()");
      await page.locator('[data-sla-case-form="idle"]').waitFor();
      assert.equal(await page.getByLabel("Notes (facultatif)").inputValue(), "Note A avant envoi.");
      assert.match(await page.locator("[data-sla-current-link]").innerText(), /INT-AA0000/);
      assert.equal(await page.getByLabel("Notes (facultatif)").isDisabled(), false);
      await page.evaluate("window.cmdFail = false");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await page.waitForFunction("window.cmds.length === 2");
      const cmds = (await page.evaluate("window.cmds")) as Cmd[];
      assert.deepEqual(cmds[1], cmds[0], "identical retry");
      assert.equal(cmds[1].payload.intervention_id, T15);
      // Success ⇒ closes once.
      await page.evaluate("window.cmdGates.shift()()");
      await page.locator("[data-sla-case-form]").waitFor({ state: "detached" });
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate("window.cmds.length"), 2);
      assert.equal(await page.locator("[data-sla-case-form]").count(), 0);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
