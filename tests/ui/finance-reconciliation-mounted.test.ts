import { fileURLToPath as localSourcePath } from "node:url";
// FIN-06 observer mounted for real (React root, StrictMode, local Chromium) + real-app wiring.
// List with the contract's cursor paging (next/previous), labels « Observation du fournisseur
// (lecture) », detail + review behind an explicit confirmation ⇒ one POST with the command already
// stored under courant-private-reconciliation:, result shown as returned; read-only without write;
// 360 px light/dark, 44 px targets. Real app: platform finance (demo) shows the tab with an honest
// note, zero /api, no page errors (360/390/1280, light/dark).
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const UID = "10000000-0000-4000-8000-0000000000fa";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ReconciliationPanel } from "./components/features/finance-reconciliation/reconciliation-panel";
const T = "2026-11-07T10:00:00.000Z";
const U = (n) => "50000000-0000-4000-8000-" + String(n).padStart(12, "0");
const evt = (n) => "evt_" + String(n).padStart(6, "0");
const rec = (n, review, version) => ({
  event: { id: evt(n), type: review ? "payout.paid" : "transfer.created", family: review ? "payout" : "transfer", livemode: false, source_account: null, created: T, object: { id: (review ? "po_" : "tr_") + n, amount: 12345, currency: "eur", source_charge: review ? null : "ch_1", destination: review ? null : "acct_1", amount_reversed: review ? null : 0, reversed: review ? null : false, status: review ? "paid" : null } },
  result: review ? { state: "needs_review", reason: "aggregate_payout_unallocated", settlement_id: null, intervention_id: null, quote_id: null } : { state: "matched", reason: "linked_transfer_observation", settlement_id: U(1), intervention_id: U(2), quote_id: U(3) },
  version: version || 1, received_at: T,
});
window.calls = []; window.stored = null; window.opened = []; window.version = 1;
const fetcher = async (url, init) => {
  const method = (init && init.method) || "GET";
  window.calls.push(method + " " + url + (init && init.body ? " " + init.body : ""));
  const u = new URL(url, location.href);
  let body;
  if (method === "POST") {
    window.stored = sessionStorage.getItem("courant-private-reconciliation:${UID}:0:" + evt(51));
    const cmd = JSON.parse(init.body);
    window.version = cmd.expected_version + 1;
    body = { event_id: evt(51), version: window.version, result: rec(51, true).result, replayed: false };
  } else if (u.pathname.split("/").pop().startsWith("evt_") && Number(u.pathname.slice(-6)) <= 50) {
    const n = Number(u.pathname.slice(-6));
    body = { record: rec(n), history: [], history_limited: false };
  } else if (u.pathname.endsWith("/" + evt(51))) {
    body = { record: rec(51, true, window.version), history: window.version > 1 ? [{ actor_id: "${UID}", note: "Versement agrégé vérifié", created_at: T, version: window.version, outcome: rec(51, true).result }] : [], history_limited: false };
  } else if (u.searchParams.get("after") === evt(50)) {
    body = { records: [rec(51, true, window.version)], next_after: null };
  } else {
    body = { records: Array.from({ length: 50 }, (_, i) => rec(i + 1)), next_after: evt(50) };
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
};
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(ReconciliationPanel, { demo: false, canRead: true, canWrite: !location.hash.includes("ro"), context: { userId: () => "${UID}", generation: () => 0 }, fetcher, onOpenDossier: (id) => window.opened.push(id) })));
`;
type W = { calls: string[]; stored: string | null; opened: string[] };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, select, textarea")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim() || e.tagName) }))()`;

test("Chromium : liste paginée par curseur, libellé d’observation, revue confirmée ⇒ 1 POST (commande stockée), résultat tel que renvoyé ; 360 px clair/sombre", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}`);
      await page.locator("[data-reconciliation-event]").first().waitFor();
      assert.equal(await page.locator("[data-reconciliation-event]").count(), 50);
      const first = await page.locator("[data-reconciliation-event]").first().innerText();
      assert.match(first, /Observation du fournisseur \(lecture\)/i);
      assert.match(first, /correspond exactement au transfert déjà enregistré[\s\S]*n’est pas la preuve d’un versement bancaire/);
      assert.match(first, /123,45 €/);
      // Matched observation: the proven dossier link opens the dossier.
      await page.locator("[data-reconciliation-event]").first().getByRole("button", { name: "Examiner" }).click();
      await page.locator("[data-reconciliation-dossier]").click();
      assert.deepEqual(await page.evaluate(() => (window as unknown as W).opened), ["50000000-0000-4000-8000-000000000002"]);
      await page.getByRole("button", { name: "Page suivante" }).click();
      await page.locator('[data-reconciliation-event="evt_000051"]').waitFor();
      assert.match(await page.locator('[data-reconciliation-event="evt_000051"]').innerText(), /Versement bancaire agrégé[\s\S]*État indiqué par le fournisseur\s*paid[\s\S]*À examiner[\s\S]*jamais réparti entre dossiers/);
      assert.match(await page.locator(".ui-v2, body").first().innerText(), /Pas de page suivante pour ce filtre au moment de la lecture/);
      await page.getByRole("button", { name: "Examiner" }).click();
      await page.getByLabel("Note de revue (obligatoire)").fill("Versement agrégé vérifié");
      await page.getByRole("button", { name: "Enregistrer une revue…" }).click();
      assert.match(await page.locator('[role="group"]').innerText(), /ne crée aucun paiement, transfert, remboursement ni facture, ne force aucun rattachement/);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.getByRole("button", { name: "Confirmer la revue (version 1)" }).click();
      await page.locator("[data-reconciliation-notice]").waitFor();
      const w = await page.evaluate(() => ({ calls: (window as unknown as W).calls, stored: (window as unknown as W).stored, left: sessionStorage.length }));
      const posts = w.calls.filter((c: string) => c.startsWith("POST"));
      assert.equal(posts.length, 1);
      const cmd = JSON.parse(posts[0].slice(posts[0].indexOf("{")));
      assert.ok(posts[0].startsWith("POST /api/platform-operations/stripe-observations/evt_000051 "));
      assert.equal(cmd.expected_version, 1);
      assert.equal(cmd.note, "Versement agrégé vérifié");
      assert.equal(JSON.parse(w.stored!).command.command_id, cmd.command_id, "stored and read back before the POST");
      assert.equal(w.left, 0);
      assert.match(await page.locator("[data-reconciliation-notice]").innerText(), /Résultat : À examiner \(needs_review \/ aggregate_payout_unallocated\), version 2/);
      const lists = [...new Set(w.calls.filter((c: string) => c.startsWith("GET") && !c.includes("/evt_")))];
      assert.deepEqual(lists, ["GET /api/platform-operations/stripe-observations", "GET /api/platform-operations/stripe-observations?after=evt_000050"]);
      assert.ok(w.calls.every((c: string) => c.includes(" /api/platform-operations/stripe-observations")), "only our server");
      await page.getByRole("button", { name: "Page précédente" }).click();
      await page.locator('[data-reconciliation-event="evt_000001"]').waitFor();
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : lecture seule sans droit d’écriture (aucun formulaire de revue)", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(`${base}#ro`);
    await page.locator("[data-reconciliation-event]").first().waitFor();
    assert.match(await page.locator("[data-reconciliation]").innerText(), /Lecture seule/);
    await page.locator("[data-reconciliation-event]").first().getByRole("button", { name: "Examiner" }).click();
    await page.locator('[data-reconciliation-detail="ready"]').waitFor();
    assert.equal(await page.locator("textarea").count(), 0);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : finance plateforme (démo) — onglet « Observations fournisseur », note honnête, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"])
      for (const width of [360, 390, 1280]) {
        const where = `${theme} ${width}px`;
        const { page, errors, api } = await open("admin-platform-finance", width);
        await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
        const origin = new URL(page.url()).origin;
        await page.goto("about:blank");
        api.length = 0;
        await page.goto(`${origin}/#demo/admin-platform-finance`);
        await page.getByRole("tab", { name: "Observations fournisseur" }).click();
        const panel = page.locator('[data-reconciliation="demo"]');
        await panel.waitFor();
        assert.match(await panel.innerText(), /aucun appel n’est fait/, where);
        assert.match(await panel.innerText(), /ni un paiement, ni un versement, ni un remboursement/, where);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
        // Existing tabs untouched.
        await page.getByRole("tab", { name: "Remboursements" }).click();
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
