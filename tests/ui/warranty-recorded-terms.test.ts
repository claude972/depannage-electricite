// PUB-06 — terms version recorded with a warranty case: on-demand exact read (?version=N, version
// checked), unavailable version honest, null ⇒ no request, wording never « acceptées »; Chromium 390:
// real WarrantyPanel, on-demand read, error ⇒ Réessayer, missing, scope switch ⇒ cleared, demo ⇒ 0 fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { RECORDED_COPY, loadRecordedTerms, recordedTermsUrl } from "../../components/features/warranty-policy/model";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const pub = (version: number) => ({ published: { version, title: "Conditions v" + version, body: "Texte de la version " + version, published_at: "2026-10-01T10:00:00Z" } });

test("model : exact ?version=N, version checked, null ⇒ missing, errors, invalid ⇒ no request", async () => {
  const urls: string[] = [];
  const f = (reply: () => Response) => (async (u: string) => (urls.push(u), reply())) as unknown as typeof fetch;
  assert.equal(recordedTermsUrl(3), "/api/public/warranty-terms?version=3");
  assert.deepEqual(await loadRecordedTerms(3, f(() => new Response(JSON.stringify(pub(3))))), { phase: "ready", published: pub(3).published });
  assert.equal(urls.at(-1), "/api/public/warranty-terms?version=3");
  assert.deepEqual(await loadRecordedTerms(4, f(() => new Response(JSON.stringify({ published: null })))), { phase: "missing" });
  assert.deepEqual(await loadRecordedTerms(5, f(() => new Response(JSON.stringify(pub(6))))), { phase: "error" }, "another version is never substituted");
  assert.deepEqual(await loadRecordedTerms(5, f(() => new Response("{}", { status: 503 }))), { phase: "error" });
  assert.deepEqual(await loadRecordedTerms(5, f(() => new Response(JSON.stringify({ published: { version: 5 } })))), { phase: "error" }, "strict parse");
  const n = urls.length;
  assert.deepEqual(await loadRecordedTerms(0, f(() => new Response("{}"))), { phase: "error" });
  assert.deepEqual(await loadRecordedTerms(1.5, f(() => new Response("{}"))), { phase: "error" });
  assert.equal(urls.length, n, "invalid version ⇒ no request");
  const copy = Object.values(RECORDED_COPY).map((v) => (typeof v === "function" ? v(2) : v)).join(" ");
  assert.ok(!/acceptées|accepté par|vous avez accepté/i.test(copy), "never presented as an acceptance");
  assert.match(RECORDED_COPY.label(2), /^Version des conditions enregistrée au dépôt : 2\.$/);
  assert.ok(!/en vigueur/.test(RECORDED_COPY.label(2)), "no right implied");
  assert.equal(RECORDED_COPY.missing.startsWith("Cette version n’est pas disponible."), true);
});

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WarrantyPanel } from "./components/app/forms";
const D = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const W = (n) => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.D = D;
const kase = (n, d, v) => ({ id: W(n), intervention_id: D(d), client_id: "c0000000-0000-4000-8000-000000000001", description: "Signalement numéro " + n, status: "resolved", resolution: "", created_at: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), updated_at: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString(), terms_version: v });
const store = { 1: [kase(1, 1, 2), kase(2, 1, null), kase(3, 1, 7), kase(4, 1, 9)], 2: [kase(5, 2, 2)] };
window.fetches = 0; window.terms = []; window.fail9 = true; window.hold = false; window.gates = [];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
window.fetch = async (url) => {
  window.fetches++;
  const u = new URL(String(url), location.href);
  if (u.pathname === "/api/public/warranty-terms") {
    window.terms.push(u.search);
    if (window.hold) await new Promise((r) => window.gates.push(r));
    const v = Number(u.searchParams.get("version"));
    if (v === 7) return json({ published: null });
    if (v === 9 && window.fail9) return json({ error: "x" }, 503);
    return json({ published: { version: v, title: "Conditions v" + v, body: "Texte de la version " + v, published_at: "2026-10-01T10:00:00Z" } });
  }
  const d = Number(u.searchParams.get("intervention_id").slice(-12));
  return json({ cases: [...store[d]].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), enabled: true, next_cursor: null, has_active: false });
};
const demo = location.hash === "#demo";
function Host() {
  const [d, setD] = useState(1);
  window.setD = setD;
  return h(WarrantyPanel, { interventionId: D(d), demo, role: "client", ownerId: "u1", context: { userId: () => "u1", generation: () => 1 } });
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl" }, define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SUPABASE_URL": "undefined", "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "undefined" }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body></html>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const W = (n: number) => "e0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const row = (n: number) => `[data-warranty-case="${W(n)}"]`;

test("Chromium 390 : lecture à la demande (version exacte), null sans requête, erreur ⇒ Réessayer, version non disponible, changement de dossier ⇒ effacé", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 1000 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(url);
    await page.locator('[data-warranty-history="ready"]').waitFor();
    assert.deepEqual(await page.evaluate("window.terms"), [], "nothing read before asking");
    assert.match(await page.locator(row(1)).innerText(), /Version des conditions enregistrée au dépôt : 2\./);
    // null ⇒ honest note, no button, no request.
    assert.match(await page.locator(row(2)).innerText(), /Version des conditions non enregistrée/);
    assert.equal(await page.locator(`${row(2)} button`).count(), 0);
    // On-demand exact read.
    await page.locator(row(1)).getByRole("button", { name: "Voir les conditions (version 2)" }).click();
    await page.locator(`${row(1)} [data-recorded-body]`).waitFor();
    assert.equal(await page.locator(`${row(1)} [data-recorded-body]`).innerText(), "Texte de la version 2");
    assert.deepEqual(await page.evaluate("window.terms"), ["?version=2"]);
    assert.match(await page.locator(row(1)).innerText(), /ne vaut ni acceptation/);
    // Unavailable version ⇒ « Cette version n’est pas disponible », nothing substituted.
    await page.locator(row(3)).getByRole("button", { name: "Voir les conditions (version 7)" }).click();
    await page.locator(`${row(3)} [data-recorded-terms="missing"]`).waitFor();
    assert.match(await page.locator(row(3)).innerText(), /Cette version n’est pas disponible\./);
    assert.equal(await page.locator(`${row(3)} [data-recorded-body]`).count(), 0);
    // Error ⇒ Réessayer ⇒ exact version.
    await page.locator(row(4)).getByRole("button", { name: "Voir les conditions (version 9)" }).click();
    await page.locator(`${row(4)} [data-recorded-retry]`).waitFor();
    await page.evaluate("window.fail9 = false");
    await page.locator(`${row(4)} [data-recorded-retry]`).click();
    await page.locator(`${row(4)} [data-recorded-body]`).waitFor();
    assert.equal(await page.locator(`${row(4)} [data-recorded-body]`).innerText(), "Texte de la version 9");
    const small = await page.evaluate("[...document.querySelectorAll('[data-recorded-terms] button')].filter((b) => b.getBoundingClientRect().height < 43.5).length");
    assert.equal(small, 0, "44 px targets");
    // Scope switch while a read is pending ⇒ cleared, the late reply never shows.
    await page.evaluate("window.hold = true");
    await page.locator(row(1)).getByRole("button", { name: "Masquer les conditions" }).click();
    await page.locator(row(3)).getByRole("button", { name: "Masquer les conditions" }).click();
    await page.locator(row(3)).getByRole("button", { name: "Voir les conditions (version 7)" }).click();
    await page.evaluate("window.setD(2)");
    await page.locator(row(5)).waitFor();
    await page.evaluate("window.hold = false; while (window.gates.length) window.gates.shift()()");
    await page.waitForTimeout(150);
    assert.equal(await page.locator("[data-recorded-body]").count(), 0, "nothing carried to the other dossier");
    assert.equal(await page.locator('[data-recorded-terms="idle"]').count(), 1);
    await page.evaluate("window.setD(1)");
    await page.locator(row(1)).waitFor();
    assert.equal(await page.locator("[data-recorded-body]").count(), 0, "back on dossier 1: cleared too");
    assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= 390);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : démo ⇒ aucun fetch", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(url + "#demo");
    await page.getByRole("button", { name: "Enregistrer un signalement de démonstration" }).waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate("window.fetches"), 0);
    assert.equal(await page.locator("[data-recorded-terms]").count(), 0);
  } finally {
    await browser.close();
    server.close();
  }
});
