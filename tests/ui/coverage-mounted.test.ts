// Postal coverage mounted for real (React root, StrictMode, local Chromium) + real-app wiring.
// Public check: invalid ⇒ 0 call; valid ⇒ exactly one GET; editing the code drops a stale reply;
// nothing written to storage. Editor: empty list, add/dedupe/remove, explicit confirmation, one POST
// with the command already stored under courant-private-coverage:<uid>:<gen>; 360 px light/dark,
// 44 px targets. Real app: « Tarifs » mounts the check (one exact GET on submit, honest error on 500);
// admin « Paramètres » in demo: honest note, zero /api, no page errors (360/390/1280, light/dark).
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
const UID = "10000000-0000-4000-8000-0000000000ad";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PostalCoverageCheck } from "./components/features/coverage/postal-coverage-check";
import { CoverageEditor } from "./components/features/coverage/coverage-editor";
window.calls = []; window.resolvers = []; window.storedAtPost = null; window.published = { version: 2, postal_codes: ["97200"] };
const pub = (url) => { window.calls.push("GET " + url); return new Promise((r) => window.resolvers.push(r)); };
const admin = async (url, init) => {
  const method = (init && init.method) || "GET";
  window.calls.push(method + " " + url + (init && init.body ? " " + init.body : ""));
  if (method === "GET") return new Response(JSON.stringify(window.published), { status: 200 });
  window.storedAtPost = sessionStorage.getItem("courant-private-coverage:${UID}:1");
  const body = JSON.parse(init.body);
  window.published = { version: body.expected_version + 1, postal_codes: body.postal_codes };
  return new Response(JSON.stringify({ ...window.published, replayed: false }), { status: 200 });
};
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const ctx = { generation: () => 1, userId: () => "${UID}" };
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, location.hash === "#editor" ? h(CoverageEditor, { demo: false, context: ctx, fetcher: admin }) : h(PostalCoverageCheck, { fetcher: pub })));
`;
type W = { calls: string[]; resolvers: ((r: Response) => void)[]; storedAtPost: string | null };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button, input")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.getAttribute("aria-label") || e.textContent.trim() || e.tagName) }))()`;

test("Chromium : vérification publique — 5 chiffres, une requête, réponse périmée ignorée, rien en stockage", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 800 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}`);
      const input = page.getByLabel("Code postal");
      await input.fill("972");
      await page.getByRole("button", { name: "Vérifier" }).click();
      assert.match(await page.locator("[role=alert]").innerText(), /cinq chiffres/);
      assert.deepEqual(await page.evaluate(() => (window as unknown as W).calls), [], "invalid ⇒ no call");
      await input.fill("9a7-2");
      assert.equal(await input.inputValue(), "972", "digits only");
      await input.fill("97200");
      await page.getByRole("button", { name: "Vérifier" }).click();
      await page.waitForTimeout(100);
      // The visitor edits the code before the reply: the stale reply is dropped.
      await input.fill("9723");
      await page.evaluate(() => (window as unknown as W).resolvers[0](new Response(JSON.stringify({ status: "covered", version: 2 }), { status: 200 })));
      await page.waitForTimeout(100);
      assert.equal(await page.locator("[data-coverage-status]").count(), 0, "stale reply ignored");
      await input.fill("97233");
      await page.getByRole("button", { name: "Vérifier" }).click();
      await page.waitForTimeout(100);
      await page.evaluate(() => (window as unknown as W).resolvers[1](new Response(JSON.stringify({ status: "unknown", version: null }), { status: 200 })));
      await page.locator('[data-coverage-status="unknown"]').waitFor();
      assert.match(await page.locator('[data-coverage-status="unknown"]').innerText(), /Zone non encore publiée[\s\S]*ne bloque jamais le dépôt d’une demande/);
      const s = await page.evaluate(() => ({ calls: (window as unknown as W).calls, ls: localStorage.length, ss: sessionStorage.length, url: location.href }));
      assert.deepEqual(s.calls, ["GET /api/public/coverage?postal_code=97200", "GET /api/public/coverage?postal_code=97233"]);
      assert.equal(s.ls + s.ss, 0, "the code is never stored");
      assert.doesNotMatch(s.url, /97233/);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : éditeur — liste vide, ajout/dédoublonnage/retrait, confirmation, 1 POST avec la commande déjà stockée", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}#editor`);
      await page.locator('[data-coverage-published="2"]').waitFor();
      assert.equal(await page.locator('[data-coverage-draft="0"]').count(), 1, "never prefilled");
      assert.equal(await page.getByRole("button", { name: "Publier cette liste" }).isDisabled(), true);
      const field = page.getByLabel("Codes postaux (séparés par des espaces ou des virgules)");
      await field.fill("97233, 97100 97233 abc");
      await page.getByRole("button", { name: "Ajouter", exact: true }).click();
      assert.match(await page.locator('[data-coverage-draft="2"] [role=status]').innerText(), /2 code\(s\) ajouté\(s\)[\s\S]*abc[\s\S]*Déjà dans la liste : 97233/);
      assert.equal(await field.inputValue(), "abc", "invalid entries stay for correction");
      await field.fill("97200");
      await page.getByRole("button", { name: "Ajouter", exact: true }).click();
      await page.getByRole("button", { name: "Retirer 97100" }).click();
      assert.equal(await page.locator('[data-coverage-draft="2"]').count(), 1);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.getByRole("button", { name: "Publier cette liste" }).click();
      assert.match(await page.locator('[data-coverage-confirm="publish"]').innerText(), /Publier 2 code\(s\)[\s\S]*version 3[\s\S]*n’engage aucune disponibilité/);
      const before = (await page.evaluate(() => (window as unknown as W).calls)).length;
      await page.getByRole("button", { name: "Confirmer la publication" }).click();
      await page.locator("[data-coverage-notice]").waitFor();
      const w = await page.evaluate(() => ({ calls: (window as unknown as W).calls, stored: (window as unknown as W).storedAtPost, left: sessionStorage.length }));
      const posts = w.calls.slice(before).filter((c: string) => c.startsWith("POST"));
      assert.equal(posts.length, 1);
      const cmd = JSON.parse(posts[0].slice("POST /api/admin/coverage ".length));
      assert.equal(cmd.action, "publish");
      assert.equal(cmd.expected_version, 2);
      assert.deepEqual(cmd.postal_codes, ["97200", "97233"]);
      assert.equal(JSON.parse(w.stored!).command.command_id, cmd.command_id, "stored and read back before the POST");
      assert.equal(w.left, 0, "cleared after success");
      assert.match(await page.locator("[data-coverage-notice]").innerText(), /version 3/);
      await page.locator('[data-coverage-published="3"]').waitFor();
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : « Tarifs » monte la vérification (1 GET exact, erreur honnête) ; Paramètres admin en démo : note, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"])
      for (const width of [360, 390, 1280]) {
        const where = `${theme} ${width}px`;
        const { page, errors, api } = await open("admin-admin-settings", width);
        await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
        const origin = new URL(page.url()).origin;
        await page.goto("about:blank");
        api.length = 0;
        await page.goto(`${origin}/#demo/admin-admin-settings`);
        await page.waitForTimeout(1200);
        const panel = page.locator('[data-coverage-editor="demo"]');
        assert.equal(await panel.count(), 1, where);
        assert.match(await panel.innerText(), /aucun appel n’est fait/);
        assert.deepEqual(api, [], `${where}: admin demo makes no call`);
        let overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow (admin)`);
        // Public « Tarifs ».
        await page.goto("about:blank");
        await page.goto(`${origin}/#pricing`);
        await page.locator("[data-coverage-check]").waitFor();
        assert.equal(api.filter((a: string) => a.includes("/coverage")).length, 0, `${where}: no coverage call before submit`);
        await page.getByLabel("Code postal").fill("97200");
        await page.getByRole("button", { name: "Vérifier" }).click();
        await page.locator('[data-coverage-check="error"]').waitFor();
        assert.deepEqual(api.filter((a: string) => a.includes("/coverage")), ["GET /api/public/coverage?postal_code=97200"], where);
        assert.match(await page.locator('[data-coverage-check="error"] [role=alert]').innerText(), /La vérification n’a pas abouti/);
        overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow (pricing)`);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
