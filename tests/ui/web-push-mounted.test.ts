// Web push enrollment mounted for real (React root, StrictMode, local Chromium, 360 px) with injected
// browser APIs: real MessageChannel handshake; subscribe called synchronously inside the click;
// permission granted / default+refused / denied; unsupported; worker not ready (timeout); preference
// not saved; same-key reuse vs other-key reset; identity change and unmount between permission and
// POST ⇒ no POST; 409 / lost reply / unconfirmed ⇒ re-read only; 401 honest; « autre navigateur ».
// No endpoint or key ever lands in local/session storage. Real app: demo notifications preferences
// show the honest note, zero /api, no page errors.
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
const ENDPOINT = "https://push.example.test/private-endpoint-123";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WebPushPanel } from "./components/features/web-push/web-push-panel";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
const keyBytes = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256));
const otherBytes = keyBytes.slice(); otherBytes[10] ^= 1;
const KEY = btoa(String.fromCharCode(...keyBytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const S = window.S = { gets: 0, posts: [], subscribeCalls: 0, unsubscribes: 0, permission: cfg.permission || "granted", prompt: cfg.prompt || "grant", gen: 1,
  view: cfg.view || { available: true, public_key: KEY, enrollment: null }, postMode: cfg.postMode || "ok" };
const makeSub = (bytes) => ({ options: { applicationServerKey: bytes.buffer.slice(0) }, toJSON: () => ({ endpoint: "${ENDPOINT}", expirationTime: null, keys: { p256dh: "Bxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", auth: "authSecretAAAAAAAAAAAAA".slice(0, 22) } }), unsubscribe: async () => { S.unsubscribes++; S.existing = null; return true; } });
S.existing = cfg.existing === "same" ? makeSub(keyBytes) : cfg.existing === "other" ? makeSub(otherBytes) : null;
const reg = {
  active: cfg.ready === "no" ? null : { postMessage: (msg, [port]) => { if (msg && msg.type === "CHECK_PRIVATE_PUSH" && cfg.ready !== "silent") port.postMessage({ type: "PRIVATE_PUSH_READY" }); } },
  pushManager: {
    getSubscription: async () => S.existing,
    subscribe: (opts) => {
      S.subscribeCalls++;
      S.subscribeOpts = { userVisibleOnly: opts.userVisibleOnly, keyMatches: opts.applicationServerKey.length === 65 && opts.applicationServerKey.every((v, i) => v === keyBytes[i]) };
      if (S.permission === "default") S.permission = S.prompt === "deny" ? "denied" : "granted";
      if (S.permission !== "granted") return Promise.reject(new DOMException("denied", "NotAllowedError"));
      if (S.prompt === "hold") return new Promise((r) => (S.release = () => { S.existing = makeSub(keyBytes); r(S.existing); }));
      S.existing = makeSub(keyBytes);
      return Promise.resolve(S.existing);
    },
  },
};
const env = { supported: () => cfg.supported !== false, permission: () => S.permission, registration: async () => reg };
const api = {
  load: async () => { S.gets++; return S.postMode === "401" && S.posts.length ? { status: 401, body: null } : { status: 200, body: S.view }; },
  command: async (body) => {
    S.posts.push(body);
    const v = S.view.enrollment ? S.view.enrollment.version : 0;
    if (S.postMode === "409") return { status: 409, body: { error: "x" } };
    if (S.postMode === "lost") return { status: 0, body: null };
    if (S.postMode === "401") return { status: 401, body: null };
    S.view = { ...S.view, enrollment: body.action === "register" ? { version: v + 1, opted_in: true, browser: "current" } : { version: v + 1, opted_in: false, browser: "none" } };
    return { status: 200, body: S.view };
  },
};
document.documentElement.setAttribute("data-ui-theme", cfg.theme || "light");
const div = document.createElement("div"); document.body.appendChild(div);
const root = createRoot(div);
window.unmount = () => root.unmount();
window.tags = [];
root.render(h(StrictMode, null, h(WebPushPanel, { onTag: (t) => window.tags.push(t), demo: false, pushSaved: cfg.pushSaved !== false, readyTimeoutMs: 300, api, env, context: { userId: () => "10000000-0000-4000-8000-0000000000ee", generation: () => S.gen } })));
`;
type S = { gets: number; posts: { action: string; expected_version: number; consent?: boolean; subscription?: { endpoint: string } }[]; subscribeCalls: number; unsubscribes: number; subscribeOpts?: { userVisibleOnly: boolean; keyMatches: boolean }; gen: number; release: () => void };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Browser = any;
async function open(browser: Browser, base: string, cfg: Record<string, unknown>) {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  await page.goto(`${base}#${encodeURIComponent(JSON.stringify(cfg))}`);
  await page.waitForFunction(() => document.querySelector("[data-web-push]")?.getAttribute("data-web-push") !== "checking");
  return { page, errors };
}
const st = (page: Browser) => page.evaluate(() => { const s = (window as unknown as { S: S }).S; return { gets: s.gets, posts: s.posts, subscribeCalls: s.subscribeCalls, unsubscribes: s.subscribeOpts ? s.unsubscribes : s.unsubscribes, opts: s.subscribeOpts }; }) as Promise<{ gets: number; posts: S["posts"]; subscribeCalls: number; unsubscribes: number; opts?: S["subscribeOpts"] }>;
/** Clicks in a single task and reports how many subscribe() calls happened synchronously. */
const clickSync = (page: Browser, sel: string) => page.evaluate((s: string) => { const w = window as unknown as { S: S }; const before = w.S.subscribeCalls; (document.querySelector(s) as HTMLButtonElement).click(); return w.S.subscribeCalls - before; }, sel) as Promise<number>;
const storageHas = (page: Browser, needle: string) => page.evaluate((n: string) => JSON.stringify({ ...localStorage }).includes(n) || JSON.stringify({ ...sessionStorage }).includes(n), needle) as Promise<boolean>;

test("Chromium : activation nominale (abonnement synchrone dans le clic), désactivation, rien en stockage ; 360 px clair/sombre", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const { page, errors } = await open(browser, base, { theme });
      assert.equal(await page.locator("[data-web-push]").getAttribute("data-web-push"), "ready");
      const small = await page.evaluate(`[...document.querySelectorAll("[data-web-push] button")].filter((b) => b.getBoundingClientRect().height < 43.5).length`);
      assert.equal(small, 0);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 360);
      assert.equal(await clickSync(page, "[data-web-push-activate]"), 1, "subscribe() runs inside the click, no await before it");
      await page.locator('[data-web-push-status="current"]').waitFor();
      let s = await st(page);
      assert.deepEqual(s.opts, { userVisibleOnly: true, keyMatches: true });
      assert.equal(s.posts.length, 1);
      assert.equal(s.posts[0].action, "register");
      assert.equal(s.posts[0].consent, true);
      assert.equal(s.posts[0].expected_version, 0);
      assert.equal(s.posts[0].subscription!.endpoint, ENDPOINT);
      assert.equal(await storageHas(page, "private-endpoint"), false);
      assert.equal(await storageHas(page, "authSecret"), false);
      await page.getByRole("button", { name: "Désactiver" }).click();
      await page.locator('[data-web-push-status="off"]').waitFor();
      s = await st(page);
      assert.deepEqual(s.posts.map((x) => x.action), ["register", "remove"]);
      assert.equal(s.posts[1].expected_version, 1);
      assert.equal(s.unsubscribes, 1, "this browser's subscription dropped after the confirmed removal");
      const tags = (await page.evaluate("window.tags")) as (string | null)[];
      const distinct = tags.filter((t, i) => i === 0 || t !== tags[i - 1]);
      assert.deepEqual(distinct.filter((t) => t !== null), ["available", "current", "available"], "tag: Disponible → Actif sur ce navigateur → Disponible");
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : permission refusée / bloquée ; non pris en charge ; worker non prêt ; préférence non enregistrée ; « autre navigateur »", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    let { page } = await open(browser, base, { permission: "default", prompt: "deny" });
    assert.equal(await clickSync(page, "[data-web-push-activate]"), 1);
    await page.locator("[data-web-push-error]").waitFor();
    assert.match(await page.locator("[data-web-push-error]").innerText(), /Autorisation refusée : rien n’a été activé/);
    assert.equal((await st(page)).posts.length, 0);
    await page.context().close();

    ({ page } = await open(browser, base, { permission: "denied" }));
    assert.equal(await clickSync(page, "[data-web-push-activate]"), 0, "blocked: no subscribe");
    assert.match(await page.locator("[data-web-push-error]").innerText(), /bloquées pour ce site/);
    assert.equal((await st(page)).posts.length, 0);
    await page.context().close();

    ({ page } = await open(browser, base, { supported: false }));
    assert.equal(await page.locator("[data-web-push]").getAttribute("data-web-push"), "unsupported");
    assert.equal((await st(page)).gets, 0, "no call when unsupported");
    assert.equal(await page.locator("[data-web-push] button").count(), 0);
    await page.context().close();

    for (const ready of ["silent", "no"]) {
      ({ page } = await open(browser, base, { ready }));
      assert.equal(await page.locator("[data-web-push]").getAttribute("data-web-push"), "notReady", ready);
      assert.equal(await page.locator("[data-web-push-activate]").count(), 0);
      assert.match(await page.locator("[data-web-push]").innerText(), /pas encore prêt/);
      await page.context().close();
    }

    ({ page } = await open(browser, base, { pushSaved: false }));
    assert.equal(await page.locator("[data-web-push]").getAttribute("data-web-push"), "needPreference");
    assert.equal(await page.locator("[data-web-push-activate]").count(), 0);
    await page.context().close();

    ({ page } = await open(browser, base, { view: { available: false, public_key: null, enrollment: null } }));
    assert.equal(await page.locator("[data-web-push]").getAttribute("data-web-push"), "unavailable");
    await page.context().close();

    const KEYV = await (async () => { const b = new Uint8Array(65).map((_, i) => (i === 0 ? 4 : (i * 7) % 256)); return Buffer.from(b).toString("base64url"); })();
    ({ page } = await open(browser, base, { view: { available: true, public_key: KEYV, enrollment: { version: 4, opted_in: true, browser: "other" } } }));
    assert.match(await page.locator('[data-web-push-status="other"]').innerText(), /autre navigateur[\s\S]*remplacera/);
    await page.getByRole("button", { name: "Remplacer par ce navigateur" }).click();
    await page.locator('[data-web-push-status="current"]').waitFor();
    assert.equal((await st(page)).posts[0].expected_version, 4);
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : même clé ⇒ réutilisée ; autre clé ⇒ réinitialisation sur clic ; identité changée / démontage entre permission et POST ⇒ aucun POST ; 409 / perdu ⇒ relecture seule ; 401 honnête", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    let { page, errors } = await open(browser, base, { existing: "same" });
    assert.equal(await clickSync(page, "[data-web-push-activate]"), 0, "same key: reused, no new subscribe");
    await page.locator('[data-web-push-status="current"]').waitFor();
    assert.equal((await st(page)).posts.length, 1);
    await page.context().close();

    ({ page } = await open(browser, base, { existing: "other" }));
    assert.equal(await page.locator("[data-web-push-activate]").count(), 0, "other key: no activation before an explicit reset");
    await page.locator("[data-web-push-reset]").click();
    await page.locator("[data-web-push-activate]").waitFor();
    let s = await st(page);
    assert.equal(s.unsubscribes, 1);
    assert.equal(s.subscribeCalls, 0, "never re-subscribed without a click");
    assert.equal(await clickSync(page, "[data-web-push-activate]"), 1);
    await page.locator('[data-web-push-status="current"]').waitFor();
    await page.context().close();

    ({ page, errors } = await open(browser, base, { prompt: "hold" }));
    await clickSync(page, "[data-web-push-activate]");
    await page.evaluate(() => { const w = window as unknown as { S: S }; w.S.gen = 2; w.S.release(); });
    await page.waitForTimeout(200);
    assert.equal((await st(page)).posts.length, 0, "identity changed between permission and POST: no POST");
    assert.deepEqual(errors, []);
    await page.context().close();

    ({ page, errors } = await open(browser, base, { prompt: "hold" }));
    await clickSync(page, "[data-web-push-activate]");
    await page.evaluate(() => { const w = window as unknown as { S: S; unmount: () => void }; w.unmount(); w.S.release(); });
    await page.waitForTimeout(200);
    assert.equal((await st(page)).posts.length, 0, "unmounted mid-flow: no POST");
    assert.deepEqual(errors, []);
    await page.context().close();

    for (const postMode of ["409", "lost"]) {
      ({ page } = await open(browser, base, { postMode }));
      const before = (await st(page)).gets;
      await clickSync(page, "[data-web-push-activate]");
      await page.locator("[data-web-push-notice]").waitFor();
      await page.waitForTimeout(150);
      s = await st(page);
      assert.equal(s.posts.length, 1, `${postMode}: never re-posted`);
      assert.equal(s.subscribeCalls, 1, `${postMode}: never re-subscribed`);
      assert.equal(s.gets, before + 1, `${postMode}: re-read once`);
      assert.match(await page.locator("[data-web-push-notice]").innerText(), /relu[\s\S]*Rien n’est renvoyé automatiquement/);
      await page.context().close();
    }

    ({ page } = await open(browser, base, { postMode: "401" }));
    await clickSync(page, "[data-web-push-activate]");
    await page.locator('[data-web-push="forbidden"]').waitFor();
    assert.match(await page.locator("[data-web-push]").innerText(), /Session expirée/);
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : préférences de notification (démo) — note push honnête, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const width of [360, 1280]) {
      const { page, errors, api } = await open("client-profile", width);
      await page.getByRole("button", { name: "Paramètres du compte" }).click();
      const panel = page.locator('[data-web-push="demo"]');
      await panel.waitFor();
      assert.equal(await panel.count(), 1);
      assert.match(await panel.innerText(), /aucun appel n’est fait/);
      const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      assert.ok(overflow <= 0);
      assert.deepEqual(api, []);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  });
});
