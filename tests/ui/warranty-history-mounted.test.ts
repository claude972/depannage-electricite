import { fileURLToPath as localSourcePath } from "node:url";
// ADM-10 / PUB-06 mounted (React root, StrictMode, Chromium 390 and 1280 px). Real WarrantyPanel on
// the paged GET /api/warranty: the REAL claim form only after proof (enabled + has_active === false),
// never while loading / on error / has_active true / global null; old case reached by pagination with
// the admin selection kept; 404 ⇒ inaccessible; dossier switch ⇒ late reply dropped. Real ClientSpace
// in live: an out-of-cache PAID dossier opened by point read gets the warranty panel with its exact id.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { serveLiveClient } from "./client-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");

const FIXTURES = `
const D = (n) => "d0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const W = (d, n) => "e0000000-0000-4000-8" + String(d).padStart(3, "0") + "-" + String(n).padStart(12, "0");
window.D = D; window.W = W;
const kase = (d, n, status) => ({ id: W(d, n), intervention_id: d === 0 ? D(1 + (n % 3)) : D(d), client_id: "c0000000-0000-4000-8000-000000000001", description: "Signalement numéro " + n + " du dossier " + d, status, resolution: "", created_at: new Date(Date.UTC(2025, 0, 1) + n * 60000).toISOString(), updated_at: new Date(Date.UTC(2025, 0, 1) + n * 60000).toISOString(), terms_version: 2 });
// D1: 130 closed cases (form allowed); D2: active case; D3: 404; D4: 503 then ok; D5: requests disabled;
// D0 = global admin list (has_active null) with a reviewing case on page 1 and an old one on page 2.
window.store = {
  1: Array.from({ length: 130 }, (_, k) => kase(1, k + 1, "resolved")),
  2: [kase(2, 1, "reviewing"), kase(2, 2, "resolved")],
  4: [kase(4, 1, "resolved")],
  5: [kase(5, 1, "resolved")],
  6: [kase(6, 1, "resolved")],
  0: Array.from({ length: 130 }, (_, k) => kase(0, k + 1, k === 129 ? "reviewing" : "declined")),
};
window.calls = []; window.hold = null; window.gates = []; window.fail4 = true;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: s === 503 ? { "Retry-After": "2" } : {} });
window.posts = []; window.postGates = [];
window.warrantyFetch = async (url, init) => {
  if (init && init.method === "POST") {
    window.posts.push(JSON.parse(init.body));
    await new Promise((r) => window.postGates.push(r));
    return json({ ok: true });
  }
  window.calls.push(String(url));
  const u = new URL(url, location.href), id = u.searchParams.get("intervention_id"), c = u.searchParams.get("cursor");
  if (window.hold && window.hold(String(url))) await new Promise((r) => window.gates.push(r));
  const d = id ? Number(id.slice(-12)) : 0;
  if (d === 3) return json({ error: "Dossier introuvable." }, 404);
  if (d === 4 && window.fail4) return json({ error: "x" }, 503);
  const rows = [...(window.store[d] || [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const start = c ? Number(c.slice(1)) : 0, items = rows.slice(start, start + 100), more = start + 100 < rows.length;
  const has_active = id ? (window.store[d] || []).some((k) => k.status === "submitted" || k.status === "reviewing") : null;
  return json({ cases: items, enabled: d !== 5, next_cursor: more ? "p" + (start + 100) : null, has_active });
};
`;

const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WarrantyPanel } from "./components/app/forms";
${FIXTURES}
const demo = location.hash === "#demo";
window.fetches = 0;
window.fetch = async (...a) => { window.fetches++; return window.warrantyFetch(...a); };
function Host() {
  const [d, setD] = useState(1);
  const [role, setRole] = useState("client");
  const [ident, setIdent] = useState({ uid: "u1", gen: 1 });
  const [owner, setOwner] = useState("u1");
  window.setD = setD; window.setRole = setRole; window.setIdent = setIdent; window.setOwner = setOwner;
  return h(WarrantyPanel, { interventionId: d === 0 ? undefined : D(d), demo, role, ownerId: owner, context: { userId: () => ident.uid, generation: () => ident.gen } });
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
const FORM = "Déposer une demande de suivi";
const cases = "document.querySelectorAll('[data-warranty-case]').length";

test("Chromium 390/1280 : formulaire seulement après preuve ; chargement / erreur / actif / global / désactivé ⇒ pas de formulaire ; pagination + sélection ; 404 ; réponse tardive", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      const form = () => page.getByRole("button", { name: FORM }).count();
      // Loading ⇒ no form.
      await page.evaluate("0");
      await page.goto(url);
      await page.locator('[data-warranty-history="ready"]').waitFor();
      assert.equal(await page.evaluate(cases), 100);
      assert.equal(await form(), 1, "D1: enabled + has_active false ⇒ real form");
      // Old case via pagination (page 2, beyond 100).
      await page.locator("[data-warranty-more]").click();
      await page.waitForFunction(`${cases} === 130`);
      assert.match(await page.locator("[data-warranty-case]").last().innerText(), /Signalement numéro 1 du dossier 1/);
      // Loading held on another dossier ⇒ no form; late reply of the previous dossier dropped.
      await page.evaluate("window.hold = (u) => u.includes('000000000005')");
      await page.evaluate("window.setD(5)");
      await page.locator('[data-warranty-history="loading"]').waitFor();
      assert.equal(await form(), 0, "no form while loading");
      assert.equal(await page.evaluate(cases), 0, "no old frame");
      await page.evaluate("window.hold = null; window.setD(2)");
      await page.locator('[data-warranty-history="ready"]').waitFor();
      await page.evaluate("while (window.gates.length) window.gates.shift()()"); // late D5 replies
      await page.waitForTimeout(150);
      assert.equal(await page.locator("[data-warranty-case]").filter({ hasText: "En cours d’examen" }).count(), 1, "D2 active case shown");
      assert.equal(await page.evaluate(cases), 2, "late D5 reply dropped");
      assert.equal(await form(), 0, "has_active true ⇒ no form");
      assert.equal(await page.locator('[data-warranty-claim-blocked="active"]').count(), 1);
      // Requests disabled ⇒ no form.
      await page.evaluate("window.setD(5)");
      await page.locator('[data-warranty-claim-blocked="disabled"]').waitFor();
      assert.equal(await form(), 0);
      // 503 ⇒ error, no form; Réessayer ⇒ proof ⇒ form.
      await page.evaluate("window.setD(4)");
      await page.locator('[data-warranty-history="error"]').waitFor();
      assert.equal(await form(), 0, "no form on error");
      await page.evaluate("window.fail4 = false");
      await page.locator('[data-warranty-history="error"] button').click();
      await page.locator('[data-warranty-history="ready"]').waitFor();
      assert.equal(await form(), 1);
      // Non-owner (another manager / reader of the dossier) ⇒ history only, honest note, no form.
      await page.evaluate("window.setOwner('someone-else')");
      await page.locator('[data-warranty-claim-blocked="not-owner"]').waitFor();
      assert.equal(await form(), 0, "non-owner ⇒ no form");
      assert.equal(await page.evaluate(cases), 1, "history still readable");
      await page.evaluate("window.setOwner('u1')");
      await page.getByRole("button", { name: FORM }).waitFor();
      // Draft typed on A, switch to B ⇒ empty; a late POST reply of A after the switch ⇒ ignored.
      const area = page.getByLabel("Signaler un problème après intervention");
      await area.fill("Le disjoncteur saute de nouveau depuis hier soir.");
      await page.evaluate("window.setD(6)");
      await page.getByRole("button", { name: FORM }).waitFor();
      assert.equal(await page.getByLabel("Signaler un problème après intervention").inputValue(), "", "B starts empty");
      await page.evaluate("window.setD(4)");
      await page.getByRole("button", { name: FORM }).waitFor();
      assert.equal(await page.getByLabel("Signaler un problème après intervention").inputValue(), "", "A's draft not kept either");
      await page.getByLabel("Signaler un problème après intervention").fill("Le disjoncteur saute de nouveau depuis hier soir.");
      await page.getByRole("button", { name: FORM }).click();
      await page.waitForFunction("window.posts.length === 1");
      await page.evaluate("window.setD(6)");
      await page.getByRole("button", { name: FORM }).waitFor();
      const before6 = ((await page.evaluate("window.calls")) as string[]).filter((c) => c.includes("000000000006")).length;
      await page.evaluate("window.postGates.shift()()"); // late POST reply of dossier 4
      await page.waitForTimeout(250);
      assert.equal(await page.locator(".alert.success").count(), 0, "late POST notice never shown on B");
      assert.equal(((await page.evaluate("window.calls")) as string[]).filter((c) => c.includes("000000000006")).length, before6, "no re-read of B caused by A's reply");
      assert.equal(((await page.evaluate("window.posts")) as Array<{ intervention_id: string }>)[0].intervention_id, "d0000000-0000-4000-8000-000000000004");
      // Another party's dossier ⇒ 404 ⇒ inaccessible, nothing shown.
      await page.evaluate("window.setD(3)");
      await page.locator('[data-warranty-history="refused"]').waitFor();
      assert.match(await page.locator('[data-warranty-history="refused"]').innerText(), /inaccessible/);
      assert.equal(await page.evaluate(cases), 0);
      assert.equal(await form(), 0);
      // Global admin list (has_active null): no form; admin selection kept across pages.
      await page.evaluate("window.setRole('admin'); window.setD(0)");
      await page.locator('[data-warranty-history="ready"]').waitFor();
      assert.equal(await form(), 0, "global read ⇒ no form");
      const active = page.locator("[data-warranty-case]").filter({ hasText: "En cours d’examen" }).first();
      const note = active.locator("textarea");
      await note.fill("Rendez-vous de contrôle planifié avec l’artisan.");
      await page.locator("[data-warranty-more]").click();
      await page.waitForFunction(`${cases} === 130`);
      assert.equal(await note.inputValue(), "Rendez-vous de contrôle planifié avec l’artisan.", "selection kept across pages");
      assert.ok(((await page.evaluate("window.calls")) as string[]).includes("/api/warranty?cursor=p100"), "global cursor followed");
      // Identity switch ⇒ no old frame.
      await page.evaluate("window.hold = () => true; window.setIdent({ uid: 'u2', gen: 2 })");
      await page.locator('[data-warranty-history="loading"]').waitFor();
      assert.equal(await page.evaluate(cases), 0);
      await page.evaluate("window.hold = null; while (window.gates.length) window.gates.shift()()");
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : démo ⇒ aucun fetch, suivi local inchangé", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(url + "#demo");
    await page.getByRole("button", { name: "Enregistrer un signalement de démonstration" }).waitFor();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate("window.fetches"), 0);
    assert.equal(await page.locator("[data-warranty-history]").count(), 0);
  } finally {
    await browser.close();
    server.close();
  }
});

test("ClientSpace live (390/1280) : dossier payé hors cache ouvert par PointReadState ⇒ panneau garantie avec l’intervention_id exact", { skip }, async () => {
  const setup = `${FIXTURES}
const id = "d0000000-0000-4000-8000-000000000001", stamp = "2025-01-02T10:00:00.000Z";
window.uid = "c0000000-0000-4000-8000-000000000001";
window.view = "detail"; window.param = id;
const envelope = { intervention: { id, client_id: window.uid, artisan_id: "a0000000-0000-4000-8000-000000000001", site_id: null, category: "panel", description: "Ancien dossier", address: "2 rue test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", estimate_min_cents: 1, estimate_max_cents: 2, status: "paid", created_at: stamp, updated_at: stamp, completed_at: stamp, paid_at: stamp, travel_stage: "on_site" }, site: { status: "none" }, organization: { status: "none" }, quotes: { status: "ok", items: [], limited: false }, messages: { status: "ok", items: [], limited: false }, documents: { status: "ok", items: [], limited: false }, appointments: { status: "ok", items: [], limited: false }, payments: { status: "ok", items: [], limited: false, incomplete: false }, generated_at: stamp };
window.respond = async (url, init) => {
  if (url.startsWith("/api/warranty")) return window.warrantyFetch(url, init);
  if (url === "/api/interventions/" + id) return new Response(JSON.stringify(envelope), { status: 200 });
  return new Response(JSON.stringify({ error: "x" }), { status: 503 });
};
window.seed = { data: { interventions: [], limits: { interventions: { limited: true, limit: 100 } } }, session: { refreshContext: "g1|client||", ensureFresh: async () => ({ kind: "loaded" }) } };
`;
  const { server, url } = await serveLiveClient(setup);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.getByText("Ancien dossier").first().waitFor();
      await page.locator('[data-warranty-history="ready"]').waitFor();
      const calls = (await page.evaluate("window.calls")) as string[];
      assert.ok(calls.length >= 1 && calls.every((c) => c === "/api/warranty?intervention_id=d0000000-0000-4000-8000-000000000001"), "exact intervention_id");
      assert.equal(await page.locator("[data-warranty-case]").count(), 100);
      assert.equal(await page.getByRole("button", { name: FORM }).count(), 1, "proof ⇒ form");
      assert.ok(((await page.evaluate("document.documentElement.scrollWidth")) as number) <= width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});
