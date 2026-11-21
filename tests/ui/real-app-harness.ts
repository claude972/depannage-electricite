import { fileURLToPath as localSourcePath } from "node:url";
// Shared real-app harness: CourantApp bundled with esbuild (real globals.css + module CSS), served
// by a local server that records every /api call (answered 500), driven by single-process
// Chromium. Used by the nominal / interactive journey tests. Not a test file itself.
import { existsSync, readFileSync } from "node:fs";
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
export const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

const APP = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import App from "./components/courant-app";
import { ThemeProvider } from "./components/app/theme-provider";
createRoot(document.getElementById("app")).render(h(ThemeProvider, null, h(App)));
`;
// playwright-core is loaded at runtime from a local path (no type package): pages are untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Page = any;
export async function withApp(run: (open: (route: string, width?: number) => Promise<{ page: Page; errors: string[]; api: string[] }>) => Promise<void>) {
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
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>> | undefined;
  try {
    browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, timeout: 30_000 });
    await run(async (route, width = 1280) => {
      const context = await browser!.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.setDefaultNavigationTimeout(30_000);
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      api.length = 0;
      await page.goto(`${base}#demo/${route}`);
      await page.waitForTimeout(1200);
      return { page, errors, api };
    });
  } finally {
    try { await browser?.close(); } finally {
      server.closeAllConnections();
      server.close();
    }
  }
}


/** Opens « Paramètres du compte » the way a user does: the header button on desktop, or the
 *  account menu (« Ouvrir le menu ») below 1024 px. */
export async function openAccountSettings(page: Page) {
  const direct = page.getByRole("button", { name: "Paramètres du compte" });
  if (await direct.first().isVisible().catch(() => false)) {
    await direct.first().click();
    return;
  }
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Paramètres du compte" }).click();
}
