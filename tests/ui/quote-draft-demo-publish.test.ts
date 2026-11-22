import { fileURLToPath as localSourcePath } from "node:url";
// Demo quote publication from the draft editor (QA finding on 0c2): quoteDraftCommand ran in the
// global runner and called action(), which re-entered run() and was refused as busy ⇒ « Le devis
// n’a pas pu être publié ». Drives the REAL app (CourantApp) in Chromium, demo artisan, no API.
// Skipped — never passed — without local Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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

const APP = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import App from "./components/courant-app";
import { ThemeProvider } from "./components/app/theme-provider";
createRoot(document.getElementById("app")).render(h(ThemeProvider, null, h(App)));
`;

type Quote = { id: string; intervention_id: string; status: string; total_cents: number; subtotal_cents: number; tax_rate: number };

test("demo: publishing a draft creates exactly one sent quote (single click and double click)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({
    absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out",
    platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" },
    logLevel: "error",
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const apiCalls: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url?.startsWith("/api/")) {
      apiCalls.push(`${rq.method} ${rq.url}`);
      rs.statusCode = 500;
      rs.end("{}");
      return;
    }
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/#demo/artisan-detail.demo-001`;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  const quotesOf = (page: { evaluate: <T>(f: () => T) => Promise<T> }) =>
    page.evaluate(() => (JSON.parse(localStorage.getItem("courant-demo-v3") || "{}").data?.quotes || []) as Quote[]);
  try {
    for (const clicks of [1, 2]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(url);
      await page.getByRole("button", { name: "Envoyer le devis au client" }).waitFor();
      const before = (await quotesOf(page)).filter((q) => q.intervention_id === "demo-001");
      const previousSent = before.find((q) => q.status === "sent");
      assert.ok(previousSent, "seed: demo-001 has a sent quote (revision path)");
      // The revision editor is prefilled from the sent quote: change line 1, keep the others.
      await page.getByRole("textbox", { name: "Prestation 1", exact: true }).fill("Remplacement disjoncteur différentiel");
      await page.getByLabel("Quantité", { exact: true }).first().fill("2");
      await page.getByLabel("Prix unitaire HT (€)", { exact: true }).first().fill("45.50");
      await page.getByLabel("Taux de TVA (%)").selectOption({ index: 1 });
      const rate = Number(await page.getByLabel("Taux de TVA (%)").inputValue());
      // Plain string: tsx would inject a __name helper into a serialized arrow function.
      const expectedSubtotal: number = await page.evaluate(`(() => {
        const num = (v) => Number(String(v).replace(/\\s/g, "").replace(",", "."));
        const byLabel = (t) => [...document.querySelectorAll("input")].filter((i) => i.labels && i.labels[0] && i.labels[0].textContent.trim() === t);
        const qty = byLabel("Quantité"), price = byLabel("Prix unitaire HT (€)");
        return qty.reduce((n, q, k) => n + Math.round(num(q.value) * Math.round(num(price[k].value) * 100)), 0);
      })()`);
      const send = page.getByRole("button", { name: "Envoyer le devis au client" });
      if (clicks === 2) await send.dblclick();
      else await send.click();
      await page.getByText("Devis publié dans la démonstration").first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
      const text = await page.locator("body").innerText();
      assert.doesNotMatch(text, /n’a pas pu être publié/, `clicks=${clicks}: no failure message`);
      const after = (await quotesOf(page)).filter((q) => q.intervention_id === "demo-001");
      const added = after.filter((q) => !before.some((b) => b.id === q.id));
      assert.equal(added.length, 1, `clicks=${clicks}: exactly one new quote`);
      assert.equal(added[0].status, "sent");
      assert.equal(added[0].subtotal_cents, expectedSubtotal, "amounts preserved from the editor");
      assert.equal(added[0].tax_rate, rate);
      assert.equal(added[0].total_cents, expectedSubtotal + Math.round((expectedSubtotal * rate) / 100));
      assert.equal(after.find((q) => q.id === previousSent!.id)?.status, "rejected", "revision replaces the sent version");
      const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem("courant-demo-quote-drafts-v1") || "null")?.data ?? null);
      if (drafts) assert.equal(drafts["demo-001"]?.draft ?? null, null, "draft consumed only after success");
      assert.deepEqual(errors, []);
      await context.close();
    }
    assert.deepEqual(apiCalls, [], "demo never calls the API");
  } finally {
    await browser.close();
    server.close();
  }
});
