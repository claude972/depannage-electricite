// Hosted preview bug (7b4eed7, 1280 px, light + dark): the public header overflowed by 7 px
// (topbarActions / « Décrire ma panne » right edge 1286.6). Mounts the real PublicChrome with the
// real globals.css, home module and self-hosted Plus Jakarta Sans, then sweeps widths in both
// themes, on the home (in-page sections) and on another view: no horizontal overflow, and the
// navigation stays reachable (inline nav or the menu button). Skipped — never passed — without
// local Playwright/Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { PublicChrome } from "./components/role/public-chrome";
import { ThemeProvider } from "./components/app/theme-provider";
import home from "./components/role/public-home.module.css";
const noop = () => {};
const handlers = { onNew: noop, onLogin: noop, onNavigate: noop, onDemo: noop };
const view = new URLSearchParams(location.search).get("view");
const sections = [{ id: "a", label: "Interventions" }, { id: "b", label: "Services" }, { id: "c", label: "Conseils" }];
const div = document.createElement("div");
document.body.appendChild(div);
createRoot(div).render(h(ThemeProvider, null,
  view === "home"
    ? h(PublicChrome, { current: "home", handlers, onHome: noop, sections, onSection: noop, className: home.home }, h("p", null, "contenu"))
    : h(PublicChrome, { current: "pricing", handlers, onHome: noop }, h("p", null, "contenu")),
));
`;
const FONT_CSS = [400, 500, 600, 700]
  .map((w) => `@font-face{font-family:"JakartaQA";src:url(/font/${w}.ttf) format("truetype");font-weight:${w};font-display:block}`)
  .join("") + `:root{--font-jakarta:"JakartaQA"}`;
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  const header = document.querySelector("header");
  const offenders = [...header.querySelectorAll("*")]
    .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 0.5)
    .map((el) => el.tagName + "." + String(el.className).slice(0, 40) + " r=" + el.getBoundingClientRect().right.toFixed(1));
  return {
    vw,
    scroll: document.documentElement.scrollWidth,
    offenders,
    nav: visible(document.querySelector('nav[aria-label="Navigation principale"]')),
    menu: visible(document.querySelector("button[aria-controls]")),
    headerH: header.getBoundingClientRect().height,
  };
})()`;
const WIDTHS = [390, 641, 1241, 1280, 1366, 1440];

test("public header: no horizontal overflow 360–1440 px, light and dark, home and other views; nav reachable", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".ttf": "empty", ".woff2": "empty", ".svg": "empty", ".png": "empty" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  // globals.css is global CSS in Next (not a module): served verbatim, before the module CSS.
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((rq, rs) => {
    const m = /^\/font\/(\d{3})\.ttf$/.exec(String(rq.url));
    if (m) {
      rs.setHeader("content-type", "font/ttf");
      return rs.end(readFileSync(path.join(ROOT, `app/fonts/plus-jakarta-sans-${m[1]}.ttf`)));
    }
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"><style>${FONT_CSS}${css}</style></head><body><script>${js}</script></body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  const failures: string[] = [];
  try {
    // One page for every case (--single-process: closing a context would end the browser).
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    for (const view of ["home", "pricing"]) {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`http://127.0.0.1:${port}/?view=${view}`);
        await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
        await page.waitForSelector('[data-theme-toggle="ready"]', { timeout: 8000 }).catch(async () => {
          throw new Error(`theme toggle never ready; page errors: ${errors.join(" | ")}; body: ${(await page.content()).slice(0, 300)}`);
        });
        const isDark = () => page.evaluate(() => document.querySelector('[data-theme-toggle="ready"]')!.getAttribute("aria-pressed") === "true");
        if ((await isDark()) !== (theme === "dark")) await page.click('[data-theme-toggle="ready"]');
        assert.equal(await isDark(), theme === "dark", `${view}: theme ${theme} applied`);
        const font = await page.evaluate(async () => {
          const fonts = (document as Document & { fonts: FontFaceSet }).fonts;
          await Promise.all(["400", "500", "600", "700"].map((w) => fonts.load(`${w} 16px "JakartaQA"`)));
          await fonts.ready;
          return { ok: fonts.check('700 18px "JakartaQA"'), used: getComputedStyle(document.querySelector("header strong")!).fontFamily };
        });
        assert.ok(font.ok, "Plus Jakarta Sans loaded (widths measured with the real font)");
        assert.match(font.used, /JakartaQA/, "header text is set in Plus Jakarta Sans");
        for (const width of WIDTHS) {
          await page.setViewportSize({ width, height: 800 });
          await page.waitForTimeout(30);
          // Passed as source text: tsx's keepNames would inject an undefined __name helper.
          const r = (await page.evaluate(MEASURE)) as { vw: number; scroll: number; offenders: string[]; nav: boolean; menu: boolean; headerH: number };
          if (r.scroll > r.vw || r.offenders.length) failures.push(`${view}/${theme}/${width}: scroll ${r.scroll} > ${r.vw} ${r.offenders.join(", ")}`);
          if (!r.nav && !r.menu) failures.push(`${view}/${theme}/${width}: navigation unreachable`);
          if (r.headerH > 100) failures.push(`${view}/${theme}/${width}: header wraps (${r.headerH}px)`);
        }
        assert.deepEqual(errors, []);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  assert.deepEqual(failures, []);
});
