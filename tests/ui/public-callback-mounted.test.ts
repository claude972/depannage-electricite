// PUB-04 mounted for real (React root, StrictMode, Chromium 390 px): public form only when
// available; consent required; same UUID on retry after a lost reply / 5xx, new UUID after an edit;
// nothing in URL or storage; 429 countdown without auto-retry. Operator: no « Classer » when
// can_close is false; 409 ⇒ re-read; numbered pages; 403 ⇒ refusal; identity change ⇒ reset.
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
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PublicCallbackForm } from "./components/features/public-callback/public-callback-form";
import { OperatorCallbacks } from "./components/features/public-callback/operator-callbacks";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
const U = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const row = (n, v) => ({ id: U(n), phone: "+59669600000" + (n % 10), reason: "new_request", version: v, created_at: "2026-11-07T10:" + String(59 - n).padStart(2, "0") + ":00Z", closed_at: v === 2 ? "2026-11-09T12:00:00Z" : null });
const S = window.S = { calls: [], posts: [], postModes: cfg.postModes || [], closeMode: cfg.closeMode || "ok", gen: 1, open: cfg.open || [1, 2] };
const json = (b, s, hd) => new Response(JSON.stringify(b), { status: s || 200, headers: { "Content-Type": "application/json", ...(hd || {}) } });
const fetcher = async (url, init) => {
  const method = (init && init.method) || "GET";
  S.calls.push(method + " " + url);
  if (url === "/api/public/callback" && method === "GET") return json({ available: cfg.available !== false });
  if (url === "/api/public/callback") {
    S.posts.push(JSON.parse(init.body));
    const mode = S.postModes.shift() || "ok";
    if (mode === "lost") throw new TypeError("lost");
    if (mode === "503") return json({ error: "x" }, 503, { "Retry-After": "2" });
    if (mode === "429") return json({ error: "x" }, 429, { "Retry-After": "3" });
    return json({ received: true });
  }
  if (url.startsWith("/api/support/callbacks") && method === "GET") {
    if (cfg.forbidden) return json({}, 403);
    const u = new URL(url, location.href), st = u.searchParams.get("status"), pg = Number(u.searchParams.get("page"));
    if (st === "closed") return json({ items: [row(9, 2)], total: 1, can_close: cfg.canClose !== false, page: { number: 1, limit: 25, pages: 1 } });
    const total = 26 + (S.open.length - 2);
    const items = pg === 1 ? Array.from({ length: 25 }, (_, i) => row(i + 1 + (S.open.length === 1 ? 1 : 0), 1)) : [row(40, 1)];
    return json({ items: pg === 1 ? items : items, total: pg === 1 ? 26 : 26, can_close: cfg.canClose !== false, page: { number: pg, limit: 25, pages: 2 } });
  }
  if (url === "/api/support/callbacks") {
    S.closeBody = JSON.parse(init.body);
    if (S.closeMode === "409") return json({}, 409);
    return json({ closed: true });
  }
  return json({}, 404);
};
document.documentElement.setAttribute("data-ui-theme", cfg.theme || "light");
let n = 0;
const newId = () => "c0000000-0000-4000-8000-" + String(++n).padStart(12, "0");
function Host() {
  const [gen, setGen] = useState(1);
  window.switchIdentity = () => { S.gen++; setGen(S.gen); };
  const ctx = { userId: () => "op-1", generation: () => S.gen };
  return cfg.operator ? h(OperatorCallbacks, { context: ctx, fetcher }) : h(PublicCallbackForm, { fetcher, newId });
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type S = { calls: string[]; posts: { request_id: string; phone: string; reason: string; consent: boolean }[]; closeBody?: unknown };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
async function open(browser: Any, base: string, cfg: Record<string, unknown>) {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e)));
  await page.goto(`${base}#${encodeURIComponent(JSON.stringify(cfg))}`);
  return { page, errors };
}
const st = (page: Any) => page.evaluate(() => (window as unknown as { S: S }).S) as Promise<S>;

test("Chromium public : formulaire seulement si disponible ; consentement requis ; même UUID après réponse perdue / 5xx, nouveau après modification ; 429 ; rien en URL ni stockage", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    let { page } = await open(browser, base, { available: false });
    await page.waitForTimeout(300);
    assert.equal(await page.locator("[data-public-callback]").count(), 0, "closed ⇒ no form");
    assert.equal((await st(page)).calls.filter((c) => c.startsWith("POST")).length, 0);
    await page.context().close();

    for (const theme of ["light", "dark"]) {
      const opened = await open(browser, base, { theme, postModes: ["lost", "503", "ok"] });
      page = opened.page;
      await page.locator("[data-public-callback]").waitFor();
      assert.match(await page.locator("[data-public-callback]").innerText(), /J’accepte d’être rappelé à ce numéro au sujet de cette demande\./);
      await page.getByLabel("Numéro de téléphone").fill("0696 00 00 01");
      await page.getByLabel("Objet").selectOption("new_request");
      await page.getByRole("button", { name: "Demander à être rappelé" }).click();
      assert.match(await page.locator("[data-public-callback-error]").innerText(), /consentement/);
      assert.equal((await st(page)).posts.length, 0, "no POST without consent");
      await page.getByLabel("J’accepte d’être rappelé à ce numéro au sujet de cette demande.").check();
      await page.getByRole("button", { name: "Demander à être rappelé" }).click();
      await page.locator("[data-public-callback-error]").waitFor();
      assert.match(await page.locator("[data-public-callback-error]").innerText(), /la même demande sera renvoyée/);
      await page.getByRole("button", { name: "Demander à être rappelé" }).click(); // 503
      await page.waitForTimeout(150);
      // Edit ⇒ a new UUID.
      await page.getByLabel("Numéro de téléphone").fill("0696 00 00 02");
      await page.getByRole("button", { name: "Demander à être rappelé" }).click(); // ok
      await page.locator("[data-public-callback-receipt]").waitFor();
      const s = await st(page);
      assert.equal(s.posts.length, 3);
      assert.equal(s.posts[0].request_id, s.posts[1].request_id, "same content ⇒ same UUID");
      assert.notEqual(s.posts[2].request_id, s.posts[1].request_id, "edited ⇒ new UUID");
      assert.deepEqual({ ...s.posts[0], request_id: "" }, { request_id: "", phone: "0696 00 00 01", reason: "new_request", consent: true });
      assert.match(await page.locator("[data-public-callback-receipt]").innerText(), /sans délai garanti[\s\S]*Aucun SMS ni appel automatique/);
      const leak = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
      assert.doesNotMatch(leak, /0696|00 00 0/, "nothing in URL or storage");
      const small = await page.evaluate(`[...document.querySelectorAll("[data-public-callback] button, [data-public-callback] input:not([type=checkbox]), [data-public-callback] select")].filter((e) => e.getBoundingClientRect().height < 43.5).length`);
      assert.equal(small, 0);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 390);
      assert.deepEqual(opened.errors, []);
      await page.context().close();
    }

    ({ page } = await open(browser, base, { postModes: ["429"] }));
    await page.locator("[data-public-callback]").waitFor();
    await page.getByLabel("Numéro de téléphone").fill("0696 00 00 01");
    await page.getByLabel("Objet").selectOption("other");
    await page.getByLabel("J’accepte d’être rappelé à ce numéro au sujet de cette demande.").check();
    await page.getByRole("button", { name: "Demander à être rappelé" }).click();
    await page.locator("[data-public-callback-wait]").waitFor();
    assert.match(await page.locator("[data-public-callback-wait]").innerText(), /Trop de demandes[\s\S]*dans [123] s/);
    assert.equal(await page.getByRole("button", { name: "Demander à être rappelé" }).isDisabled(), true);
    await page.waitForTimeout(3500);
    assert.equal((await st(page)).posts.length, 1, "no automatic retry");
    assert.equal(await page.getByRole("button", { name: "Demander à être rappelé" }).isDisabled(), false);
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium opérateur : « Classer » seulement si can_close ; 409 ⇒ relecture ; pages numérotées ; 403 ⇒ refus ; identité ⇒ remise à zéro", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    let { page, errors } = await open(browser, base, { operator: true });
    await page.locator("[data-op-callback]").first().waitFor();
    assert.equal(await page.locator("[data-op-callback]").count(), 25);
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.locator('[data-op-callback="b0000000-0000-4000-8000-000000000040"]').waitFor();
    assert.ok((await st(page)).calls.includes("GET /api/support/callbacks?status=open&page=2"));
    const getsBefore = (await st(page)).calls.length;
    await page.locator('[data-op-callback-close="b0000000-0000-4000-8000-000000000040"]').click();
    await page.locator("[data-op-callbacks-notice]").waitFor();
    let s = await st(page);
    assert.equal(JSON.stringify(s.closeBody), JSON.stringify({ id: "b0000000-0000-4000-8000-000000000040", expected_version: 1 }));
    assert.equal(s.calls[s.calls.length - 1], "GET /api/support/callbacks?status=open&page=2", "re-read after success");
    assert.ok(s.calls.length > getsBefore + 1);
    await page.getByRole("tab", { name: "Classées" }).click();
    await page.locator('[data-op-callback="b0000000-0000-4000-8000-000000000009"]').waitFor();
    assert.equal(await page.locator("[data-op-callback-close]").count(), 0, "version 2: never « Classer »");
    assert.match(await page.locator("[data-op-callback]").first().innerText(), /Classé \(action opérateur\)/);
    await page.evaluate(() => (window as unknown as { switchIdentity: () => void }).switchIdentity());
    await page.locator('[data-op-callbacks="ready"] [role=tab][aria-selected=true]').waitFor();
    assert.equal(await page.locator('[role=tab][aria-selected=true]').innerText(), "À traiter", "identity change ⇒ reset to the open tab, page 1");
    assert.deepEqual(errors, []);
    await page.context().close();

    ({ page } = await open(browser, base, { operator: true, canClose: false }));
    await page.locator("[data-op-callback]").first().waitFor();
    assert.equal(await page.locator("[data-op-callback-close]").count(), 0, "can_close false ⇒ no button");
    await page.context().close();

    ({ page } = await open(browser, base, { operator: true, closeMode: "409" }));
    await page.locator("[data-op-callback-close]").first().click();
    await page.locator("[data-op-callbacks-notice]").waitFor();
    assert.match(await page.locator("[data-op-callbacks-notice]").innerText(), /déjà été classée ou a changé : la liste a été relue/);
    s = await st(page);
    assert.equal(s.calls[s.calls.length - 1], "GET /api/support/callbacks?status=open&page=1", "409 ⇒ re-read");
    await page.context().close();

    ({ page } = await open(browser, base, { operator: true, forbidden: true }));
    await page.locator("[data-op-callbacks-forbidden]").waitFor();
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});
