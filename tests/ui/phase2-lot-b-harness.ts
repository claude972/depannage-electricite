// Shared helper for the phase 2 lot B reproductions (not a test file): bundles an entry with esbuild
// (real components + real CSS), serves it on 127.0.0.1 and runs named in-page scenarios in
// headless Chromium. No network beyond the local page: every API is a fake injected by the entry.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || path.join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
export const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
export const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

export type Run = (name: string, arg?: unknown) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withScenarios(entry: string, body: (run: Run, ctx: { errors: string[]; requests: string[]; page: any }) => Promise<void>, width = 390) {
  const out = await build({
    absWorkingDir: ROOT, stdin: { contents: entry, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out",
    platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" },
    define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error",
  });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2" id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run: Run = (name, arg) =>
      page.evaluate(([n, a]: [string, unknown]) => (window as unknown as { scenarios: Record<string, (x: unknown) => Promise<unknown>> }).scenarios[n](a), [name, arg] as [string, unknown]);
    await body(run, { errors, requests, page });
  } finally {
    await browser.close();
    server.close();
  }
}

/** In-page helpers prepended to every entry. */
export const PRELUDE = `
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await tick(10); } return false; };
const txt = (el) => (el ? el.textContent || "" : "");
const btn = (root, label) => [...root.querySelectorAll("button")].find((b) => (b.textContent || "").trim().includes(label) || b.getAttribute("aria-label") === label) || null;
const mountPoint = () => { const d = document.createElement("div"); document.getElementById("app").appendChild(d); return d; };
const setInput = (el, value) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); };
`;
