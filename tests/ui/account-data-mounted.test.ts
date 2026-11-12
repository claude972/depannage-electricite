// Account data panel mounted for real (React root, StrictMode, local Chromium): one GET per page,
// a real browser download of one JSON file (object URL revoked); an identity change mid-collection
// downloads nothing; the erasure goes through the explicit confirmation, POSTs once with the fenced
// request_id and links to the ticket; 360 px light/dark, 44 px targets. Real app: the client profile
// mounts the panel (demo note, zero /api, no page errors) at 360/390/1280, light and dark.
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
const UID = "10000000-0000-4000-8000-0000000000aa";
const T = "2026-11-01T10:00:00+00:00";
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AccountDataPanel } from "./components/features/account-data/account-data-panel";
const UID = "${UID}", T = "${T}";
const id = (n) => "30000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.calls = []; window.gen = 1; window.created = 0; window.revoked = 0; window.opened = []; window.hold = null;
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (b) => { window.created++; return create(b); };
URL.revokeObjectURL = (u) => { window.revoked++; return revoke(u); };
// Contract 6625a97 also exports erasure_requests and payment_reminders (empty here); realigned in lot B.
const rows = { addresses: [], requests: [], booking_locations: [{ id: id(2), intervention_id: null, location: { latitude: 14.605, longitude: -61.07, access_details: "Portail bleu" } }], documents: [], support: [{ id: id(1), creator_id: UID, intervention_id: null, subject: "Aide", status: "open", created_at: T, updated_at: T }], erasure_requests: [], payment_reminders: [] };
const msg = (n) => ({ id: id(n), author_id: UID, intervention_id: null, body: "m" + n, created_at: T });
const reply = (url, init) => {
  if (init && init.method === "POST") return { ticket_id: id(900), status: "open", replayed: false };
  const s = new URL(url, location.href).searchParams;
  const section = s.get("section"), after = s.get("after");
  if (section === "account") return { section, data: { email: null, verified_phone: null, profile: { id: UID, full_name: "Camille", phone: "", role: "client", created_at: T }, notification_preferences: null }, next_cursor: null };
  if (section === "messages") {
    if (!after) { const r = Array.from({ length: 100 }, (_, i) => msg(i + 1)); return { section, rows: r, next_cursor: r[99].id }; }
    return { section, rows: [msg(101)], next_cursor: null };
  }
  return { section, rows: rows[section], next_cursor: null };
};
const fetcher = async (url, init) => {
  window.calls.push((init && init.method || "GET") + " " + String(url) + (init && init.body ? " " + init.body : ""));
  if (window.hold && String(url).includes(window.hold)) await new Promise((r) => (window.release = r));
  return new Response(JSON.stringify(reply(String(url), init)), { status: 200, headers: { "Content-Type": "application/json" } });
};
const ctx = { generation: () => window.gen, userId: () => UID };
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(AccountDataPanel, { demo: false, context: ctx, fetcher, onOpenTicket: (t) => window.opened.push(t) })));
`;
type W = { calls: string[]; gen: number; created: number; revoked: number; opened: string[]; hold: string | null; release: () => void };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const state = (page: { evaluate: (f: () => unknown) => Promise<unknown> }) => page.evaluate(() => { const w = window as unknown as W; return { calls: w.calls, created: w.created, revoked: w.revoked, opened: w.opened }; }) as Promise<{ calls: string[]; created: number; revoked: number; opened: string[] }>;

test("Chromium : téléchargement complet paginé (1 GET par page), vrai fichier JSON, URL révoquée ; effacement confirmé ⇒ 1 POST, lien vers le ticket", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(base);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Télécharger mes données" }).click();
    const file = await dl;
    assert.match(file.suggestedFilename(), /^mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(readFileSync(await file.path(), "utf8"));
    assert.equal(saved.messages.length, 101);
    assert.deepEqual(saved.booking_locations[0].location, { latitude: 14.605, longitude: -61.07, access_details: "Portail bleu" });
    assert.equal(saved.support.length, 1);
    await page.waitForTimeout(100);
    let s = await state(page);
    assert.deepEqual(s.calls, ["account", "addresses", "requests", "booking_locations", "messages", "messages&after=30000000-0000-4000-8000-000000000100", "documents", "support", "erasure_requests", "payment_reminders"].map((x) => `GET /api/profile/data?section=${x}`));
    assert.equal(s.created, 1);
    assert.equal(s.revoked, 1);
    assert.match(await page.locator('[data-account-download="done"]').innerText(), /généré sur cet appareil/);
    // Erasure: explanation, then exactly one POST.
    await page.getByRole("button", { name: "Demander l’effacement" }).click();
    assert.match(await page.locator('[data-account-erasure="confirming"]').innerText(), /ouvre un ticket[\s\S]*Aucune donnée n’est effacée à ce stade/);
    await page.getByRole("button", { name: "Confirmer la demande d’effacement" }).click();
    await page.locator("[data-account-erasure-ticket]").waitFor();
    s = await state(page);
    const posts = s.calls.filter((c) => c.startsWith("POST"));
    assert.equal(posts.length, 1);
    assert.match(posts[0], /^POST \/api\/profile\/data \{"action":"request_erasure","request_id":"[0-9a-f-]{36}","confirmed":true\}$/);
    assert.match(await page.locator("[data-account-erasure-ticket]").innerText(), /Aucune donnée n’a été effacée/);
    await page.getByRole("button", { name: "Voir le ticket d’assistance" }).click();
    assert.deepEqual((await state(page)).opened, ["30000000-0000-4000-8000-000000000900"]);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : changement d’identité en pleine collecte ⇒ aucun fichier ; 360 px clair/sombre, cibles ≥ 44 px", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 800 }, acceptDownloads: true })).newPage();
      const errors: string[] = [];
      const downloads: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      page.on("download", (d: { suggestedFilename(): string }) => downloads.push(d.suggestedFilename()));
      await page.goto(`${base}?${theme}`);
      await page.evaluate(() => { (window as unknown as W).hold = "section=documents"; });
      await page.getByRole("button", { name: "Télécharger mes données" }).click();
      await page.waitForTimeout(200);
      assert.match(await page.locator('[data-account-section="messages"]').innerText(), /101 élément/);
      const layout = await page.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("button")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim()) }))()`) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.evaluate(() => { const w = window as unknown as W; w.gen = 2; w.release(); });
      await page.waitForTimeout(300);
      assert.match(await page.locator('[data-account-download="aborted"]').innerText(), /aucun fichier n’a été enregistré/);
      const s = await state(page);
      assert.equal(s.created, 0);
      assert.deepEqual(downloads, []);
      await page.getByRole("button", { name: "Demander l’effacement" }).click();
      const confirm = await page.evaluate(`(() => [...document.querySelectorAll("button")].map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), r.height, r.right]; }))()`) as [string, number, number][];
      for (const [label, h, right] of confirm) assert.ok(h >= 43.5 && right <= 360, `${theme}: ${label}`);
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : les paramètres du compte client montent « Mes données » (démo, aucun /api) — 360/390/1280, clair/sombre", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"])
      for (const width of [360, 390, 1280]) {
        const { page, errors, api } = await open("client-profile", width);
        await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
        const origin = new URL(page.url()).origin;
        await page.goto("about:blank");
        await page.goto(`${origin}/#demo/client-profile`);
        await page.getByRole("button", { name: "Paramètres du compte" }).click();
        const where = `${theme} ${width}px`;
        const panel = page.locator('[data-account-data="demo"]');
        await panel.waitFor();
        assert.equal(await panel.count(), 1, where);
        assert.match(await panel.innerText(), /En démonstration, aucune donnée n’est lue ni téléchargée/);
        assert.equal(await panel.locator("button").count(), 0, where);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
