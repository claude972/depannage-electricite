// ADM-01 in Chromium. (1) The snapshot hook mounted with the SAME render rule as admin-space
// (shownSnapshot of the current role + identity): « Non vérifié » until read, counts + rows once read,
// identity change ⇒ no old frame, « Actualiser » re-reads, 403 ⇒ nothing shown, count > array ⇒ never
// « aucune ». (2) Real app, demo admin at 390 / 1280: dashboard unchanged, zero /api; « Devis &
// Factures » shows the fixed texts, no financial button.
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
import { useAdminDashboard, shownSnapshot, DASH_COPY } from "./components/features/admin-dashboard/admin-dashboard";
const U = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const at = (n) => "2026-11-07T10:" + String(59 - n).padStart(2, "0") + ":00Z";
const S = window.S = { calls: 0, status: 200, pending: 9, shown: 2, hold: false };
const fetcher = async () => {
  S.calls++;
  if (S.hold) await new Promise((r) => (S.release = r));
  if (S.status !== 200) return new Response("{}", { status: S.status });
  const body = { counts: { interventions: 140, active_interventions: 12, pending_applications: S.pending }, active: Array.from({ length: 6 }, (_, i) => ({ id: U(i + 1), artisan_id: null, category: "panel", city: "Fort-de-France", urgency: "scheduled", status: "requested", created_at: at(i + 1) })), pending: Array.from({ length: S.shown }, (_, i) => ({ id: U(100 + i), full_name: "Artisan " + i, company_name: "", application_status: "submitted", account_created_at: at(i + 1) })), limit: 6, captured_at: "2026-11-07T12:00:00Z" };
  return new Response(JSON.stringify(body), { status: 200 });
};
function Host() {
  const [gen, setGen] = useState(1);
  window.switchIdentity = () => setGen((g) => g + 1);
  const ident = "admin|u1|" + gen;
  const dash = useAdminDashboard({ live: true, ident, fetcher });
  const snap = shownSnapshot(dash.view, ident);
  return h("div", null,
    h("button", { type: "button", onClick: () => void dash.reload(), "data-refresh": "" }, DASH_COPY.refresh),
    h("p", { "data-kpi-pending": "" }, snap ? String(snap.counts.pending_applications) : DASH_COPY.unverified),
    !snap ? h("p", { "data-unverified": "" }, DASH_COPY.unverified)
      : snap.pending.length === 0 && snap.counts.pending_applications === 0 ? h("p", { "data-empty": "" }, "Aucune candidature soumise")
      : h("div", null, snap.pending.map((p) => h("p", { key: p.id, "data-pending": p.id }, p.full_name + " · " + DASH_COPY.accountDate)),
          snap.counts.pending_applications > snap.pending.length ? h("p", { "data-more": "" }, DASH_COPY.morePending(snap.counts.pending_applications, snap.pending.length)) : null));
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type S = { calls: number; status: number; pending: number; shown: number; hold: boolean; release: () => void };

test("Chromium : « Non vérifié » avant lecture ; compteur > tableau ⇒ jamais « aucune » ; « Actualiser » relit ; identité ⇒ pas d’ancienne image ; 403 ⇒ rien", { skip }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><body><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.locator("[data-pending]").first().waitFor();
    assert.equal(await page.locator("[data-kpi-pending]").innerText(), "9");
    assert.equal(await page.locator("[data-pending]").count(), 2);
    assert.match(await page.locator("[data-more]").innerText(), /9 candidature\(s\) comptée\(s\), 2 affichable\(s\)/);
    assert.equal(await page.locator("[data-empty]").count(), 0, "count > array ⇒ never « aucune »");
    // Identity change with a pending read ⇒ « Non vérifié », never the previous frame.
    await page.evaluate(() => { (window as unknown as { S: S }).S.hold = true; (window as unknown as { switchIdentity: () => void }).switchIdentity(); });
    await page.waitForTimeout(100);
    assert.equal(await page.locator("[data-kpi-pending]").innerText(), "Non vérifié");
    assert.equal(await page.locator("[data-pending]").count(), 0, "no old frame");
    await page.evaluate(() => { const w = window as unknown as { S: S }; w.S.hold = false; w.S.pending = 4; w.S.release(); });
    await page.waitForFunction(() => document.querySelector("[data-kpi-pending]")?.textContent === "4");
    // « Actualiser » re-reads.
    const calls = await page.evaluate(() => (window as unknown as { S: S }).S.calls);
    await page.evaluate(() => { (window as unknown as { S: S }).S.pending = 5; });
    await page.locator("[data-refresh]").click();
    await page.waitForFunction(() => document.querySelector("[data-kpi-pending]")?.textContent === "5");
    assert.ok((await page.evaluate(() => (window as unknown as { S: S }).S.calls)) > calls);
    // 403 ⇒ nothing shown.
    await page.evaluate(() => { (window as unknown as { S: S }).S.status = 403; });
    await page.locator("[data-refresh]").click();
    await page.locator("[data-unverified]").waitFor();
    assert.equal(await page.locator("[data-pending]").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo admin, 390 / 1280) : tableau de bord inchangé sans /api ; « Devis & Factures » corrigé sans bouton financier", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const width of [390, 1280]) {
      let { page, errors, api } = await open("admin", width);
      await page.waitForTimeout(1200);
      assert.equal(await page.locator("[data-admin-dashboard]").count(), 0, "demo: no snapshot bar");
      assert.match(await page.locator("main").innerText(), /Validations artisans en attente/);
      assert.deepEqual(api, []);
      await page.context().close();
      ({ page, errors, api } = await open("admin-admin-quotes", width));
      await page.waitForTimeout(1200);
      const main = await page.locator("main").innerText();
      assert.doesNotMatch(main, /directement dans Stripe|Aucun montant de commission n’est calculé/);
      assert.match(main, /Remboursements, litiges et commissions : ces actions se traitent dans l’espace « Finance plateforme »/);
      const links = await page.locator("[data-admin-finance-links] a").count();
      const neutral = await page.locator("[data-admin-finance-neutral]").count();
      assert.equal(links + neutral > 0, true);
      if (links) for (const href of await page.locator("[data-admin-finance-links] a").evaluateAll((as: HTMLAnchorElement[]) => as.map((a) => a.getAttribute("href")))) assert.equal(href, "#platform-finance");
      assert.equal(await page.locator("[data-admin-finance-moved] button, [data-admin-finance-links] button").count(), 0);
      const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      assert.ok(overflow <= 0, `${width}: ${overflow}px`);
      assert.deepEqual(api, []);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  });
});
