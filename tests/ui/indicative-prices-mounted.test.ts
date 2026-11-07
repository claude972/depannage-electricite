// PUB-02 / ADM-08 in Chromium at 390 px. Mount: one shared GET feeds every IndicativeRange (values
// from the server, never static); a failed read shows the honest fallback (no number); the admin
// « Barème public » shows the active version + « publication fermée », and « Préparer une version »
// sends one POST with the command already stored. Real app: the public home with the API down shows
// the fallback on every card, never a price.
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
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IndicativeRange } from "./components/features/indicative-prices/indicative-range";
import { IndicativePricesAdmin } from "./components/features/indicative-prices/indicative-prices-admin";
const cfg = JSON.parse(decodeURIComponent(location.hash.slice(1) || "{}"));
const R = { outage: { min_cents: 16000, max_cents: 26000 }, panel: { min_cents: 15000, max_cents: 35000 }, socket: { min_cents: 9000, max_cents: 19000 }, lighting: { min_cents: 8000, max_cents: 20000 }, diagnostic: { min_cents: 12000, max_cents: 28000 } };
const PUBLIC = { version: 3, currency: "eur", ranges: R, indicative: true, publication_available: false, source: "operator_version" };
const S = window.S = { calls: [], stored: null, latest: 3 };
window.fetch = async (url, init) => {
  const method = (init && init.method) || "GET";
  S.calls.push(method + " " + url);
  if (cfg.fail) return new Response("{}", { status: 503 });
  if (url === "/api/public/indicative-prices") return new Response(JSON.stringify(PUBLIC), { status: 200 });
  if (url === "/api/admin/indicative-prices/publication") { S.publish = JSON.parse(init.body); S.active = S.publish.expected_latest_version; return new Response(JSON.stringify({ published_version: S.active, active_version: S.active, replayed: false }), { status: 200 }); }
  const active = { ...PUBLIC, version: S.active || 3 };
  if (method === "GET") return new Response(JSON.stringify({ active, latest_version: S.latest, staged: S.latest > active.version ? { version: S.latest, ranges: R, reason: "Révision annuelle des fourchettes", created_at: "2026-11-07T20:00:00Z" } : null, publication_available: Boolean(cfg.publish) }), { status: 200 });
  S.stored = sessionStorage.getItem("courant-private-indicative-prices:admin-1:1");
  const b = JSON.parse(init.body);
  S.post = b; S.latest = b.expected_version + 1;
  return new Response(JSON.stringify({ version: S.latest, replayed: false, publication_available: false, active_version: 3 }), { status: 200 });
};
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h("div", null,
  ["outage", "socket"].map((c) => h("p", { key: c }, h(IndicativeRange, { category: c }))),
  cfg.admin ? h(IndicativePricesAdmin, { context: { userId: () => "admin-1", generation: () => 1 } }) : null)));
`;
type S = { calls: string[]; stored: string | null; post?: { expected_version: number; reason: string; ranges: Record<string, { min_cents: number }> } };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}

test("Chromium 390 : fourchettes du serveur (un seul GET partagé), repli honnête en erreur ; barème admin + « Préparer une version »", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    let page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify({ admin: true }))}`);
    await page.locator('[data-indicative-range="outage"][data-indicative-state="ready"]').waitFor();
    assert.match(await page.locator('[data-indicative-range="outage"]').innerText(), /^Estimation indicative : 160\s€\s–\s260\s€$/);
    assert.match(await page.locator('[data-indicative-range="socket"]').innerText(), /90\s€\s–\s190\s€/);
    let s = (await page.evaluate(() => (window as unknown as { S: S }).S)) as S;
    assert.equal(s.calls.filter((c) => c === "GET /api/public/indicative-prices").length, 1, "one shared read");
    await page.locator('[data-indicative-admin="ready"]').waitFor();
    assert.match(await page.locator('[data-indicative-admin="ready"]').innerText(), /Version active 3[\s\S]*Publication fermée/);
    assert.equal(await page.getByRole("button", { name: /Publier/ }).count(), 0);
    await page.locator("[data-indicative-stage-open]").click();
    await page.getByRole("button", { name: "Partir de la version active" }).click();
    await page.getByLabel("Motif (obligatoire, 10 à 1000 caractères)").fill("Révision annuelle des fourchettes");
    await page.locator("[data-indicative-stage-form] button[type=submit]").click();
    await page.locator("[data-indicative-stage-notice]").waitFor();
    s = (await page.evaluate(() => (window as unknown as { S: S }).S)) as S;
    assert.equal(s.post!.expected_version, 3);
    assert.equal(s.post!.ranges.outage.min_cents, 16000);
    assert.ok(s.stored && JSON.parse(s.stored).command.reason === "Révision annuelle des fourchettes", "stored before the POST");
    assert.match(await page.locator("[data-indicative-stage-notice]").innerText(), /Version 4 préparée\. Elle n’est pas active/);
    assert.match(await page.locator("[data-indicative-admin-version]").innerText(), /Version active 3[\s\S]*Dernière version préparée : 4 \(non active\)/);
    const small = await page.evaluate(`[...document.querySelectorAll("[data-indicative-admin] button, [data-indicative-admin] input, [data-indicative-admin] textarea")].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 43.5).length`);
    assert.equal(small, 0);
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 390);
    assert.deepEqual(errors, []);
    await page.context().close();

    page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify({ fail: true }))}`);
    await page.locator('[data-indicative-range="outage"][data-indicative-state="error"]').waitFor();
    const t = await page.locator('[data-indicative-range="outage"]').innerText();
    assert.match(t, /indisponible pour le moment/);
    assert.doesNotMatch(t, /\d/, "never an invented price");
    await page.context().close();
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (390 px, API coupée) : l’accueil public affiche le repli honnête sur chaque carte, jamais un montant", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    const { page, errors } = await open("client", 390);
    const origin = new URL(page.url()).origin;
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(`${origin}/`);
    await page.locator("[data-service-card]").first().waitFor();
    await page.locator('[data-indicative-state="error"]').first().waitFor();
    for (const t of await page.locator("[data-service-card] [data-indicative-range]").allInnerTexts()) {
      assert.match(t, /^Estimation indicative : indisponible pour le moment/);
      assert.doesNotMatch(t, /€/);
    }
    assert.deepEqual(errors, []);
  });
});

test("Chromium 390 : « Publier » seulement si le serveur l’autorise ; versions affichées ; confirmation explicite ; un seul POST", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1200 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`${base}#${encodeURIComponent(JSON.stringify({ admin: true, publish: true }))}`);
    await page.locator('[data-indicative-admin="ready"]').waitFor();
    assert.equal(await page.locator("[data-indicative-publish-open]").count(), 0, "nothing prepared yet ⇒ no publish");
    await page.locator("[data-indicative-stage-open]").click();
    await page.getByRole("button", { name: "Partir de la version active" }).click();
    await page.getByLabel("Motif (obligatoire, 10 à 1000 caractères)").fill("Révision annuelle des fourchettes");
    await page.locator("[data-indicative-stage-form] button[type=submit]").click();
    await page.locator("[data-indicative-publish-open]").waitFor();
    await page.locator("[data-indicative-publish-open]").click();
    assert.match(await page.locator("[data-indicative-publish-confirm]").innerText(), /Version active : 3\. Version préparée : 4/);
    assert.equal((await page.evaluate(() => (window as unknown as { S: { publish?: unknown } }).S.publish)) ?? null, null, "no automatic call");
    await page.getByLabel("Motif de publication (obligatoire, 10 à 1000 caractères)").fill("Publication validée par l’exploitant");
    await page.getByRole("button", { name: "Confirmer la publication de la version 4" }).click();
    await page.locator("[data-indicative-publish-notice]").waitFor();
    const pub = (await page.evaluate(() => (window as unknown as { S: { publish: unknown } }).S.publish)) as Record<string, unknown>;
    assert.equal(pub.expected_active_version, 3);
    assert.equal(pub.expected_latest_version, 4);
    await page.waitForFunction(() => /Version active 4/.test(document.querySelector("[data-indicative-admin-version]")?.textContent ?? ""));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
