import { fileURLToPath as localSourcePath } from "node:url";
// PUB-02 RequestForm review step in Chromium at 390 px: live ⇒ the range of the server's active
// version (never the static amount), « estimation non vérifiée » when the read fails; demo ⇒ the
// unchanged local range and zero fetch.
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RequestForm } from "./components/app/forms";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
window.calls = [];
const R = { outage: { min_cents: 15000, max_cents: 25000 }, panel: { min_cents: 17000, max_cents: 39000 }, socket: { min_cents: 8000, max_cents: 18000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } };
window.fetch = async (url) => {
  window.calls.push(String(url));
  if (cfg.fail) return new Response("{}", { status: 503 });
  return new Response(JSON.stringify({ version: 3, currency: "eur", ranges: R, indicative: true, publication_available: false, source: "operator_version" }), { status: 200 });
};
const values = { category: "panel", description: "Le disjoncteur saute dès que j’allume le four", address: "3 rue des Ateliers", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled" };
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(RequestForm, { initialCategory: "panel", initialValues: values, sites: [], mode: cfg.mode || "client", busy: false, onBack() {}, onSubmit: async () => {}, onDemo() {} })));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function toRecap(page: any) {
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: /Continuer/ }).first().click();
    await page.waitForTimeout(150);
  }
  await page.locator(".estimate-box").waitFor();
}

test("Chromium 390 : récapitulatif live = version active du serveur ; lecture en échec ⇒ « estimation non vérifiée » ; démo ⇒ fourchette locale, zéro appel", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const [cfg, expect] of [
      [{}, /^170\s€\s–\s390\s€$/],
      [{ fail: true }, /^estimation non vérifiée$/],
      [{ mode: "demo" }, /^150,00\s€\s–\s350,00\s€$/],
    ] as const) {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}#${encodeURIComponent(JSON.stringify(cfg))}`);
      await toRecap(page);
      if (!("mode" in cfg)) await page.locator(`[data-review-estimate="${"fail" in cfg ? "error" : "ready"}"]`).waitFor();
      const shown = (await page.locator(".estimate-box strong").innerText()).trim();
      assert.match(shown, expect, JSON.stringify(cfg));
      if ("fail" in cfg) assert.doesNotMatch(shown, /€/, "never the static amount as current");
      if ("mode" in cfg) assert.deepEqual(await page.evaluate("window.calls"), [], "demo: zero fetch");
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 390);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
