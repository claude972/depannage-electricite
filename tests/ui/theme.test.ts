import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build } from "esbuild";
import {
  createThemeController,
  readStoredTheme,
  resolveInitialTheme,
  systemTheme,
  THEME_COLOR,
  THEME_INIT_SCRIPT,
  UI_THEME_ATTRIBUTE,
  UI_THEME_STORAGE_KEY,
  writeStoredTheme,
  type MediaLike,
  type StorageLike,
} from "../../components/app/theme";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

// ---------- fakes ----------
function fakeStorage(initial: Record<string, string> = {}, opts: { throwOnGet?: boolean; throwOnSet?: boolean } = {}) {
  const data = new Map(Object.entries(initial));
  const s: StorageLike = {
    getItem: (k) => {
      if (opts.throwOnGet) throw new Error("SecurityError");
      return data.has(k) ? (data.get(k) as string) : null;
    },
    setItem: (k, v) => {
      if (opts.throwOnSet) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
  };
  return { storage: s, data };
}
function fakeDoc(attr: string | null = null, meta: string | null = "#102a43") {
  const attrs = new Map<string, string>();
  if (attr !== null) attrs.set(UI_THEME_ATTRIBUTE, attr);
  const metaAttrs = new Map<string, string>();
  if (meta !== null) metaAttrs.set("content", meta);
  return {
    attrs,
    metaAttrs,
    doc: {
      documentElement: { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => void attrs.set(n, v) },
      querySelector: (sel: string) =>
        meta === null || sel !== 'meta[name="theme-color"]'
          ? null
          : { getAttribute: (n: string) => metaAttrs.get(n) ?? null, setAttribute: (n: string, v: string) => void metaAttrs.set(n, v) },
    },
  };
}
const media = (dark: boolean): MediaLike => ({ matches: dark });

// ---------- resolution & storage ----------
test("resolution: valid stored choice wins, then system, then dark default", () => {
  assert.equal(resolveInitialTheme({ stored: "light", system: "dark" }), "light");
  assert.equal(resolveInitialTheme({ stored: null, system: "light" }), "light");
  assert.equal(resolveInitialTheme({ stored: null, system: null }), "dark");
  assert.equal(systemTheme(media(true)), "dark");
  assert.equal(systemTheme(media(false)), "light");
  assert.equal(systemTheme(null), null);
});

test("storage: invalid values ignored; read/write never throw; key is non-sensitive", () => {
  assert.equal(readStoredTheme(fakeStorage({ [UI_THEME_STORAGE_KEY]: "purple" }).storage), null);
  assert.equal(readStoredTheme(fakeStorage({}, { throwOnGet: true }).storage), null);
  assert.equal(readStoredTheme(null), null);
  assert.equal(writeStoredTheme(fakeStorage({}, { throwOnSet: true }).storage, "dark"), false);
  const ok = fakeStorage();
  assert.equal(writeStoredTheme(ok.storage, "light"), true);
  assert.deepEqual([...ok.data.entries()], [[UI_THEME_STORAGE_KEY, "light"]]);
  assert.equal(UI_THEME_STORAGE_KEY, "courant-ui-theme");
});

// ---------- controller (the logic the provider runs) ----------
test("controller: initial from the attribute set by the script; toggle persists and updates the attribute", () => {
  const d = fakeDoc("light");
  const s = fakeStorage();
  const c = createThemeController({ doc: d.doc, storage: s.storage, media: media(true) });
  assert.equal(c.get(), "light");
  c.toggle();
  assert.equal(c.get(), "dark");
  assert.equal(d.attrs.get(UI_THEME_ATTRIBUTE), "dark");
  assert.equal(s.data.get(UI_THEME_STORAGE_KEY), "dark");
});

test("controller: storage unavailable keeps the session choice (no throw, applies)", () => {
  const d = fakeDoc(null);
  const c = createThemeController({ doc: d.doc, storage: fakeStorage({}, { throwOnGet: true, throwOnSet: true }).storage, media: media(false) });
  assert.equal(c.get(), "light");
  c.set("dark");
  assert.equal(c.get(), "dark");
  assert.equal(d.attrs.get(UI_THEME_ATTRIBUTE), "dark");
  assert.equal(c.hasStoredChoice(), true, "the explicit choice holds for the session");
  c.onSystemChange(false);
  assert.equal(c.get(), "dark", "system change ignored once the user chose");
});

test("controller: system changes followed only without an explicit choice", () => {
  const d = fakeDoc(null);
  const c = createThemeController({ doc: d.doc, storage: fakeStorage().storage, media: media(true) });
  assert.equal(c.get(), "dark");
  c.onSystemChange(false);
  assert.equal(c.get(), "light");
  c.set("dark");
  c.onSystemChange(false);
  assert.equal(c.get(), "dark");
});

test("controller: cross-tab — valid value applied; key removed or storage cleared ⇒ back to system", () => {
  const d = fakeDoc(null);
  const m = { matches: false } as MediaLike;
  const c = createThemeController({ doc: d.doc, storage: fakeStorage({ [UI_THEME_STORAGE_KEY]: "dark" }).storage, media: m });
  assert.equal(c.get(), "dark");
  c.onStorageEvent("other-key", null);
  assert.equal(c.get(), "dark", "unrelated key ignored");
  c.onStorageEvent(UI_THEME_STORAGE_KEY, "garbage");
  assert.equal(c.get(), "dark", "invalid value ignored");
  c.onStorageEvent(UI_THEME_STORAGE_KEY, null);
  assert.equal(c.get(), "light", "key removed ⇒ system (light)");
  assert.equal(c.hasStoredChoice(), false);
  c.onStorageEvent(UI_THEME_STORAGE_KEY, "dark");
  assert.equal(c.get(), "dark");
  c.onStorageEvent(null, null);
  assert.equal(c.get(), "light", "storage.clear() ⇒ system");
});

test("controller: meta theme-color only while surfaces are mounted; restored exactly (several surfaces, StrictMode double mount)", () => {
  const d = fakeDoc("dark", "#102a43");
  const c = createThemeController({ doc: d.doc, storage: fakeStorage().storage, media: media(true) });
  assert.equal(d.metaAttrs.get("content"), "#102a43", "untouched without surface");
  c.set("light");
  assert.equal(d.metaAttrs.get("content"), "#102a43");
  // StrictMode: mount, unmount, mount again
  const r1 = c.acquireSurface();
  r1();
  assert.equal(d.metaAttrs.get("content"), "#102a43");
  const a = c.acquireSurface();
  assert.equal(d.metaAttrs.get("content"), THEME_COLOR.light);
  const b = c.acquireSurface();
  c.set("dark");
  assert.equal(d.metaAttrs.get("content"), THEME_COLOR.dark);
  a();
  a(); // double release is idempotent
  assert.equal(d.metaAttrs.get("content"), THEME_COLOR.dark, "still one surface");
  b();
  assert.equal(d.metaAttrs.get("content"), "#102a43", "original restored after the last surface");
});

// ---------- inline anti-flash script ----------
function runScript(opts: { stored?: string; throwStorage?: boolean; dark?: boolean | "throw" }) {
  const attrs = new Map<string, string>();
  const sandbox = {
    window: {
      get localStorage() {
        if (opts.throwStorage) throw new Error("SecurityError");
        return { getItem: (k: string) => (k === UI_THEME_STORAGE_KEY ? (opts.stored ?? null) : null) };
      },
      matchMedia: (_q: string) => {
        if (opts.dark === "throw") throw new Error("no matchMedia");
        return { matches: Boolean(opts.dark) };
      },
    },
    document: { documentElement: { setAttribute: (n: string, v: string) => attrs.set(n, v) } },
  };
  vm.runInNewContext(THEME_INIT_SCRIPT, sandbox);
  return attrs;
}

test("inline script: stored ⇒ stored; invalid/absent ⇒ system; storage throwing ⇒ system; nothing ⇒ dark; only data-ui-theme set", () => {
  assert.deepEqual([...runScript({ stored: "light", dark: true })], [["data-ui-theme", "light"]]);
  assert.deepEqual([...runScript({ stored: "nope", dark: false })], [["data-ui-theme", "light"]]);
  assert.deepEqual([...runScript({ throwStorage: true, dark: true })], [["data-ui-theme", "dark"]]);
  assert.deepEqual([...runScript({ dark: "throw" })], [["data-ui-theme", "dark"]]);
});

test("inline script is static: SHA-256 pinned for a future CSP hash", () => {
  const hash = createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64");
  assert.equal(hash, "J2FpBxCekBVrTjaq4TnO+8/vssXIfydhqs7jBwDob8g=", `update the pinned hash and the contract: sha256-${hash}`);
});

// ---------- SSR (react-dom/server) with the real components ----------
async function compileComponents() {
  const result = await build({
    absWorkingDir: ROOT,
    stdin: {
      contents: `export { ThemeProvider, ThemeSurface, useUiTheme } from "./components/app/theme-provider";
export { ThemeToggle } from "./components/app/theme-toggle";`,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    external: ["react", "react/jsx-runtime", "react-dom"],
    loader: { ".module.css": "local-css" },
    outdir: path.join(ROOT, ".theme-test-out"),
  });
  const js = result.outputFiles.find((f) => f.path.endsWith(".js"));
  if (!js) throw new Error("no js output");
  const mod = { exports: {} as Record<string, unknown> };
  const req = (n: string) => (n === "react" || n === "react/jsx-runtime" || n === "react-dom" ? require(n) : (() => { throw new Error(`unexpected import ${n}`); })());
  vm.runInThisContext(`(function(module, exports, require){${js.text}\n})`)(mod, mod.exports, req);
  return mod.exports as {
    ThemeProvider: (p: { children: unknown }) => unknown;
    ThemeSurface: (p: { children: unknown }) => unknown;
    ThemeToggle: () => unknown;
  };
}

test("SSR: provider + surface + toggle render identically without browser APIs (pending placeholder, no theme-dependent attribute, no Auth data)", async () => {
  const { ThemeProvider, ThemeSurface, ThemeToggle } = await compileComponents();
  const React = require("react");
  const { renderToString } = require("react-dom/server");
  const html: string = renderToString(
    React.createElement(ThemeProvider, null, React.createElement(ThemeSurface, null, React.createElement(ThemeToggle))),
  );
  assert.match(html, /class="ui-v2"/);
  assert.match(html, /data-theme-toggle="pending"/);
  assert.doesNotMatch(html, /aria-pressed/, "no state announced before hydration");
  assert.doesNotMatch(html, /data-ui-theme/, "the attribute belongs to <html>, set by the script");
  assert.doesNotMatch(html, /token|session|email|@/i);
});

// ---------- real React in a real browser (skipped when no local Chromium) ----------
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const browserAvailable = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);

async function bundleBrowserApp() {
  const result = await build({
    absWorkingDir: ROOT,
    stdin: {
      contents: `import { StrictMode, useState, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ThemeSurface } from "./components/app/theme-provider";
import { ThemeToggle } from "./components/app/theme-toggle";
function App() {
  const [second, setSecond] = useState(false);
  window.__setSecond = setSecond;
  return h(ThemeProvider, null,
    h(ThemeSurface, null, h(ThemeToggle)),
    second ? h(ThemeSurface, null, h("p", null, "second")) : null);
}
let root = null;
window.__mount = () => { root = createRoot(document.getElementById("root")); root.render(h(StrictMode, null, h(App))); };
window.__unmount = () => { root && root.unmount(); root = null; };`,
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
    loader: { ".module.css": "local-css" },
    outdir: path.join(ROOT, ".theme-test-out"),
  });
  const js = result.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
  return { js, css };
}

test("real React (StrictMode) in Chromium: script + provider + toggle, persistence, meta restore, blocked storage", { skip: browserAvailable ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const { js, css } = await bundleBrowserApp();
  const page = (bodyScript: string) =>
    `<!doctype html><html lang="fr"><head><meta name="theme-color" content="#102a43"><script>${THEME_INIT_SCRIPT}</script><style>${css}</style></head><body><div id="root"></div><script>${bodyScript}</script><script>${js}</script></body></html>`;
  const server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page(""));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    // 1. System dark, nothing stored ⇒ dark before React; toggle ⇒ light persisted; meta managed.
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const p = await ctx.newPage();
    const errors: string[] = [];
    p.on("pageerror", (e: Error) => errors.push(e.message));
    p.on("console", (m: { type(): string; text(): string }) => {
      if (m.type() === "error") errors.push(m.text());
    });
    await p.goto(`http://127.0.0.1:${port}/`);
    assert.equal(await p.evaluate(() => document.documentElement.getAttribute("data-ui-theme")), "dark", "set before React");
    await p.evaluate(() => (window as unknown as { __mount(): void }).__mount());
    const toggle = p.getByRole("button", { name: "Thème sombre" });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    assert.equal(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute("content")), "#000000");
    const box = await toggle.boundingBox();
    assert.ok(box && box.height >= 44, `toggle height ${box?.height}`);
    await toggle.press("Enter");
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    assert.equal(await p.evaluate(() => document.documentElement.getAttribute("data-ui-theme")), "light");
    assert.equal(await p.evaluate(() => localStorage.getItem("courant-ui-theme")), "light");
    assert.equal(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute("content")), "#FFFFFF");
    // second surface mounts and unmounts: meta stays managed; then reload keeps the choice
    await p.evaluate(() => (window as unknown as { __setSecond(v: boolean): void }).__setSecond(true));
    await p.getByText("second").waitFor();
    await p.evaluate(() => (window as unknown as { __setSecond(v: boolean): void }).__setSecond(false));
    assert.equal(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute("content")), "#FFFFFF");
    await p.reload();
    assert.equal(await p.evaluate(() => document.documentElement.getAttribute("data-ui-theme")), "light", "stored choice beats system dark, before React");
    // unmount everything ⇒ meta restored exactly
    await p.evaluate(() => (window as unknown as { __mount(): void }).__mount());
    await p.getByRole("button", { name: "Thème sombre" }).waitFor();
    assert.equal(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute("content")), "#FFFFFF");
    await p.evaluate(() => (window as unknown as { __unmount(): void }).__unmount());
    assert.equal(await p.evaluate(() => document.querySelector('meta[name="theme-color"]')!.getAttribute("content")), "#102a43", "original restored after unmount");
    assert.deepEqual(errors, [], "no console/page error (hydration or otherwise)");
    await ctx.close();

    // 2. Storage blocked (opaque origin): theme follows system and the toggle still works for the session.
    const ctx2 = await browser.newContext({ colorScheme: "light" });
    const p2 = await ctx2.newPage();
    const errors2: string[] = [];
    p2.on("pageerror", (e: Error) => errors2.push(e.message));
    await p2.setContent(page(""), { waitUntil: "load" });
    assert.equal(await p2.evaluate(() => { try { localStorage.getItem("x"); return "ok"; } catch { return "blocked"; } }), "blocked");
    assert.equal(await p2.evaluate(() => document.documentElement.getAttribute("data-ui-theme")), "light");
    await p2.evaluate(() => (window as unknown as { __mount(): void }).__mount());
    const t2 = p2.getByRole("button", { name: "Thème sombre" });
    await t2.waitFor();
    await t2.click();
    assert.equal(await p2.evaluate(() => document.documentElement.getAttribute("data-ui-theme")), "dark");
    assert.equal(await t2.getAttribute("aria-pressed"), "true");
    assert.deepEqual(errors2, []);
    await ctx2.close();
  } finally {
    await browser.close();
    server.close();
  }
});
