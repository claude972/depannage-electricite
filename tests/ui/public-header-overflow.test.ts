// Mount the public header with the production CSS and self-hosted Plus Jakarta Sans.
// Check its layout and disclosure under both system preferences.
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
const noop = () => {};
const handlers = { onNew: noop, onLogin: noop, onNavigate: noop, onDemo: noop };
const view = new URLSearchParams(location.search).get("view");
const sections = [{ id: "a", label: "Interventions" }, { id: "b", label: "Services" }, { id: "c", label: "Conseils" }];
const div = document.createElement("div");
document.body.appendChild(div);
createRoot(div).render(h(ThemeProvider, null,
  view === "home"
    ? h(PublicChrome, { current: "home", handlers, onHome: noop, sections, onSection: noop }, h("p", null, "contenu"))
    : h(PublicChrome, { current: "pricing", handlers, onHome: noop }, h("p", null, "contenu")),
));
`;
const FONT_CSS = [400, 500, 600, 700]
  .map((w) => `@font-face{font-family:"JakartaQA";src:url(/font/${w}.ttf) format("truetype");font-weight:${w};font-display:block}`)
  .join("") + `:root{--font-jakarta:"JakartaQA"}`;
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0;
  const header = document.querySelector("[data-public-header]");
  const menu = header.querySelector("button[aria-controls]");
  const nav = header.querySelector('nav[aria-label="Navigation principale"]');
  const contact = header.querySelector('a[href="/#help/contact"]');
  const offenders = [...header.querySelectorAll("*")]
    .filter((el) => visible(el) && el.getBoundingClientRect().right > vw + 0.5)
    .map((el) => el.tagName + "." + String(el.className).slice(0, 40) + " r=" + el.getBoundingClientRect().right.toFixed(1));
  return {
    vw,
    scroll: document.documentElement.scrollWidth,
    offenders,
    right: menu.getBoundingClientRect().left >= contact.getBoundingClientRect().right,
    panelRight: nav.getBoundingClientRect().right,
    menuRight: menu.getBoundingClientRect().right,
    headerH: header.getBoundingClientRect().height,
  };
})()`;
const WIDTHS = [320, 390, 641, 939, 940, 1280, 1440];

test("public header: right-aligned menu and no overflow at 320–1440 px under both system preferences", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction((scheme: string) => document.documentElement.dataset.uiTheme === scheme, theme);
        const header = page.locator("[data-public-header]");
        assert.equal(await header.evaluate((el: Element) => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
        assert.equal(await header.locator("[data-theme-toggle]").count(), 0);
        await header.getByText("Candidature électricien", { exact: true }).waitFor();
        const toggle = header.getByRole("button", { name: "Ouvrir le menu" });
        const nav = header.getByRole("navigation", { name: "Navigation principale" });
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
          await toggle.press("Enter");
          await nav.waitFor();
          assert.equal(await nav.getByRole("link", { name: "Services" }).count(), view === "home" ? 0 : 1);
          assert.equal(await nav.getByRole("button", { name: "Services" }).count(), view === "home" ? 1 : 0);
          // Passed as source text: tsx's keepNames would inject an undefined __name helper.
          const r = (await page.evaluate(MEASURE)) as { vw: number; scroll: number; offenders: string[]; right: boolean; panelRight: number; menuRight: number; headerH: number };
          if (r.scroll > r.vw || r.offenders.length) failures.push(`${view}/${theme}/${width}: scroll ${r.scroll} > ${r.vw} ${r.offenders.join(", ")}`);
          assert.ok(r.right, `${view}/${theme}/${width}: menu à droite`);
          assert.ok(Math.abs(r.panelRight - r.menuRight) < 2, "menu déroulant aligné à droite");
          assert.ok(r.headerH <= (width < 940 ? 110 : 76), `${width}: hauteur ${r.headerH}px`);
          await page.keyboard.press("Escape");
          assert.equal(await nav.isVisible(), false);
          assert.equal(await toggle.evaluate((el: Element) => el === document.activeElement), true);
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
