// Nominal client / artisan journeys through the REAL app (CourantApp, demo mode, no API) in a
// single-process Chromium, with the real globals.css. Each test pins one reproduced finding.
// Skipped — never passed — without local Playwright/Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const APP = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import App from "./components/courant-app";
import { ThemeProvider } from "./components/app/theme-provider";
createRoot(document.getElementById("app")).render(h(ThemeProvider, null, h(App)));
`;
type Page = { goto(u: string): Promise<unknown>; waitForTimeout(ms: number): Promise<void>; locator(s: string): { innerText(): Promise<string>; first(): { waitFor(): Promise<void> } } };
async function withApp(run: (open: (route: string, width?: number) => Promise<{ page: Page; errors: string[]; api: string[] }>) => Promise<void>) {
  const out = await build({
    absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out",
    platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" },
    define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" },
    logLevel: "error",
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const api: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url?.startsWith("/api/")) {
      api.push(`${rq.method} ${rq.url}`);
      rs.statusCode = 500;
      rs.end("{}");
      return;
    }
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    await run(async (route, width = 1280) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      api.length = 0;
      await page.goto(`${base}#demo/${route}`);
      await page.waitForTimeout(1200);
      return { page, errors, api };
    });
  } finally {
    await browser.close();
    server.close();
  }
}

test("devis accepté avec avenant : le texte ne prétend plus que les avenants acceptés sont exclus du règlement", { skip }, async () => {
  await withApp(async (open) => {
    for (const route of ["client-quote.quote-demo-4", "artisan-detail.demo-004"]) {
      const { page, errors } = await open(route);
      const text = await page.locator("main").innerText();
      assert.match(text, /AV-1-DEV-DEMO01/, `${route}: amendment panel rendered`);
      // The platform checkout amount is the accepted quote PLUS its accepted amendments
      // (migration 20261107014010_platform_deferred_checkout.sql); saying otherwise is false.
      assert.doesNotMatch(text, /avenants acceptés ne sont pas encore reliés au paiement/, route);
      assert.match(text, /Le règlement sur la plateforme porte sur le devis accepté et ses avenants acceptés\./, route);
      assert.deepEqual(errors, []);
    }
  });
});
