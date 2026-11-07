// ART-10 mounted (React root, StrictMode, Chromium 390 and 1280 px). Host = the live branches of
// artisan-space (Overview summary, Profile rating + grid, Performance subtitle + grid) on a fake
// session whose cache holds 120 dossiers: the screen shows the server figures, never the cache;
// a late reply after an identity change is dropped; error ⇒ « Réessayer »; null ⇒ unavailable.
// Real app (demo): Overview, Profile and Performance keep their local figures, zero /api.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { withApp, skip as appSkip } from "./real-app-harness";
import { serveLiveArtisan } from "./artisan-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useArtisanPerformance, LivePerformanceSummary, LivePerformanceGrid, LiveRatingLine, livePerformanceSubtitle } from "./components/features/artisan-performance";
import { artisanPerformance, monthPeriods } from "./components/app/session";
import { money } from "./components/app/format";
window.uid = "u1"; window.gen = 1; window.calls = []; window.pending = []; window.hold = false; window.st = "ok";
window.mode = location.hash === "#demo" ? "demo" : "live";
// Cache: 120 paid dossiers of 100,00 € this month (what the old screen summed).
const now = new Date();
const paidAt = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
const I = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const interventions = Array.from({ length: 120 }, (_, n) => ({ id: I(n), artisan_id: "u1", status: "paid" }));
const quotes = interventions.map((i, n) => ({ id: "q" + n, intervention_id: i.id }));
const payments = quotes.map((q, n) => ({ id: "p" + n, quote_id: q.id, status: "paid", paid_at: paidAt, total_cents: 10000 }));
window.cacheTotal = money(artisanPerformance(interventions, quotes, payments, [], "u1", now).monthRevenueCents);
const report = (uid) => {
  const p = monthPeriods(now);
  const cents = uid === "u1" ? 1234500 : 777700;
  return { period: { current_start: p.current_start, current_end: p.current_end, previous_start: p.previous_start, previous_end: p.previous_end, boundary: "inclusive_start_exclusive_end" },
    current: { paid_service_cents: cents, paid_count: 131, completed_missions_count: 118 },
    previous: { paid_service_cents: 1000000, paid_count: 97, completed_missions_count: 90 },
    rating: { average: uid === "u1" ? 4.6 : 3.9, count: 212, period: "all_time" }, growth_percent: uid === "u1" ? 23.5 : -22.2,
    punctuality_rate: null, currency: "eur", scope: "all_current_artisan_records", limited: false,
    basis: { revenue: "Prestations TTC payées.", completed: "Terminées.", rating: "Avis.", growth: "Écart.", punctuality: "Non calculée." } };
};
const loadArtisanPerformance = () => {
  const uid = window.uid, st = window.st;
  window.calls.push(uid);
  return new Promise((res, rej) => {
    const go = () => (st === "null" ? res(null) : st === "throw" ? rej(new Error("x")) : st === "junk" ? res({ nope: 1 }) : res(report(uid)));
    if (window.hold) window.pending.push(go); else go();
  });
};
function Host() {
  const [, setTick] = useState(0);
  window.rerender = () => setTick((t) => t + 1);
  const session = { mode: window.mode, mutationContext: { userId: () => window.uid, generation: () => window.gen }, loadArtisanPerformance };
  const perf = useArtisanPerformance(session);
  if (perf.phase === "demo") return h("p", { "data-demo": "1" }, "démo");
  return h("main", null,
    h("section", { "data-mount": "overview" }, h(LivePerformanceSummary, { perf, onDetail: () => {} })),
    h("section", { "data-mount": "profile" }, h("div", { "data-rating": "1" }, h(LiveRatingLine, { perf })), h(LivePerformanceGrid, { perf, since: "2 ans" })),
    h("section", { "data-mount": "performance" }, h("p", { "data-subtitle": "1" }, livePerformanceSubtitle(perf))));
}
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css", ".svg": "dataurl", ".png": "dataurl" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const text = (s: string) => s.replace(/\s/g, " ");

test("Chromium 390/1280 : chiffres serveur (≠ cache de 120 dossiers) sur les 3 montages ; réponse tardive après changement d’identité ignorée ; erreur ⇒ Réessayer ; null ⇒ indisponible", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.locator('[data-testid="perf-grid"]').waitFor();
      const cache = text(await page.evaluate("window.cacheTotal"));
      assert.equal(cache, "12 000,00 €");
      const body = text(await page.locator("main").innerText());
      assert.ok(body.includes("12 345,00 €"), "server total shown");
      assert.ok(!body.includes(cache), "cache total never shown");
      assert.ok(!/dossiers chargés/.test(body));
      assert.equal(await page.locator('[data-mount="overview"] [data-testid="perf-current-paid"]').count(), 1, "overview mount");
      assert.equal(await page.locator('[data-mount="profile"] [data-testid="perf-current-paid"]').count(), 1, "profile mount");
      assert.equal(text(await page.locator('[data-mount="profile"] [data-testid="perf-current-completed"]').innerText()), "118");
      assert.match(text(await page.locator("[data-rating]").innerText()), /4,6 \/ 5 \(212 avis\)/);
      assert.match(text(await page.locator("[data-subtitle]").innerText()), /chiffres calculés par le serveur/);
      assert.ok(body.includes("+23,5 %"));
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width, "no horizontal overflow");

      // Identity change while u1's read is pending: no old frame, the late u1 reply is dropped.
      await page.evaluate("window.hold = true; window.uid = 'u1'; window.gen = 9; window.rerender()");
      await page.waitForFunction("window.pending.length === 1");
      await page.evaluate("window.uid = 'u2'; window.gen = 10; window.rerender()");
      await page.waitForFunction("window.pending.length === 2");
      await page.locator('[data-mount="overview"] [role="status"]').waitFor();
      assert.ok(!text(await page.locator("main").innerText()).includes("12 345,00 €"), "no old frame for the new identity");
      await page.evaluate("window.pending.shift()()"); // u1 reply, arriving after the switch
      await page.waitForTimeout(200);
      const late = text(await page.locator("main").innerText());
      assert.ok(!late.includes("12 345,00 €"), "late u1 reply dropped");
      assert.match(late, /Lecture des indicateurs/, "still loading for u2");
      await page.evaluate("window.hold = false; window.pending.shift()()");
      await page.waitForFunction("(document.querySelector('[data-mount=overview] [data-testid=perf-current-paid]')?.textContent || '').replace(/\\s/g, ' ') === '7 777,00 €'");
      assert.ok(!text(await page.locator("main").innerText()).includes("12 345,00 €"));
      assert.match(text(await page.locator("[data-rating]").innerText()), /3,9 \/ 5/);

      // Error ⇒ « Réessayer » (each mount), then recovery.
      await page.evaluate("window.st = 'throw'; window.gen = 3; window.rerender()");
      await page.getByText("Lecture impossible").first().waitFor();
      assert.ok(!text(await page.locator("main").innerText()).includes("7 777,00 €"), "no figures on error");
      const retry = page.getByRole("button", { name: "Réessayer" });
      assert.equal(await retry.count(), 2, "overview + profile/performance grid");
      const h = await retry.first().boundingBox();
      assert.ok(h && h.height >= 43.5, "44 px target");
      const before = (await page.evaluate("window.calls.length")) as number;
      await page.evaluate("window.st = 'ok'");
      await retry.first().click();
      await page.locator('[data-testid="perf-grid"]').waitFor();
      assert.ok(((await page.evaluate("window.calls.length")) as number) > before, "retry re-reads");
      // Off-contract payload ⇒ error, null (401/403/5xx collapsed by the session) ⇒ unavailable.
      await page.evaluate("window.st = 'junk'; window.gen = 4; window.rerender()");
      await page.getByText("Lecture impossible").first().waitFor();
      await page.evaluate("window.st = 'null'; window.gen = 5; window.rerender()");
      await page.getByText("Performance indisponible").first().waitFor();
      const off = text(await page.locator("main").innerText());
      assert.ok(!off.includes("€"), "no amount at all when unavailable");
      assert.ok(!off.includes(cache));
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : démo ⇒ aucun appel du chargeur", { skip }, async () => {
  const { server, url } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(url + "#demo");
    await page.locator("[data-demo]").waitFor();
    await page.evaluate("window.rerender()");
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate("window.calls"), []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo, 390 px) : Accueil, Profil et Performance gardent leurs chiffres locaux, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const route of ["artisan-overview", "artisan-profile", "artisan-performance"]) {
      const { page, errors, api } = await open(route, 390);
      await page.waitForTimeout(1000);
      const body = await page.locator("body").innerText();
      assert.ok(/Performance/.test(body), route);
      assert.ok(!/Lecture des indicateurs|Performance indisponible/.test(body), `${route}: demo never mounts the live read`);
      if (route === "artisan-performance") assert.match(body, /sur vos dossiers chargés/, "demo unchanged");
      assert.deepEqual(api, [], route);
      assert.deepEqual(errors, [], route);
    }
  });
});

// Real ArtisanSpace in live (fake Session): Performance shows the server totals AND, as a distinct
// panel, the detailed payments of the loaded dossiers under its own title; Overview and Profile too.
const LIVE_SETUP = `
const now = new Date();
const paidAt = new Date(now.getFullYear(), now.getMonth(), 1, 12).toISOString();
const I = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const Q = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const interventions = Array.from({ length: 120 }, (_, n) => ({ id: I(n), client_id: "c1", artisan_id: "u1", site_id: null, category: "panel", description: "Tableau", address: "3 rue des Ateliers", city: "Fort-de-France", urgency: "scheduled", status: "paid", estimate_min_cents: 10000, estimate_max_cents: 20000, created_at: paidAt, completed_at: paidAt }));
const quotes = interventions.map((i, n) => ({ id: Q(n), intervention_id: i.id, artisan_id: "u1", lines: [{ label: "Pose", quantity: 1, unit_price_cents: 10000 }], subtotal_cents: 10000, tax_rate: 0, tax_cents: 0, total_cents: 10000, status: "accepted", created_at: paidAt, accepted_at: paidAt }));
const payments = quotes.map((q, n) => ({ id: "p" + n, quote_id: q.id, total_cents: 10000, currency: "eur", status: "paid", created_at: paidAt, paid_at: paidAt }));
const p = (d) => new Date(d).toISOString();
const report = { period: { current_start: p(new Date(now.getFullYear(), now.getMonth(), 1)), current_end: p(new Date(now.getFullYear(), now.getMonth() + 1, 1)), previous_start: p(new Date(now.getFullYear(), now.getMonth() - 1, 1)), previous_end: p(new Date(now.getFullYear(), now.getMonth(), 1)), boundary: "inclusive_start_exclusive_end" },
  current: { paid_service_cents: 1234500, paid_count: 131, completed_missions_count: 118 }, previous: { paid_service_cents: 1000000, paid_count: 97, completed_missions_count: 90 },
  rating: { average: 4.6, count: 212, period: "all_time" }, growth_percent: 23.5, punctuality_rate: null, currency: "eur", scope: "all_current_artisan_records", limited: false,
  basis: { revenue: "Prestations TTC payées.", punctuality: "Non calculée." } };
window.perfCalls = 0;
window.view = "performance";
window.seed = { data: { interventions, quotes, payments, reviews: [] }, session: { loadArtisanPerformance: async () => { window.perfCalls++; return JSON.parse(JSON.stringify(report)); } } };
`;

test("ArtisanSpace réel en live (390/1280) : totaux serveur + liste distincte « Règlements sur les dossiers chargés » ; Accueil et Profil lisent le serveur", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(LIVE_SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.locator('[data-testid="perf-grid"]').waitFor();
      const grid = text(await page.locator('[data-testid="perf-grid"]').innerText());
      assert.ok(grid.includes("12 345,00 €"), "server total in the grid");
      assert.ok(!grid.includes("12 000,00 €"), "cache sum never in the totals");
      const list = page.locator("[data-perf-loaded-payments]");
      assert.equal(await list.count(), 1, "detailed list restored in live");
      assert.equal(text(await list.locator("h2").innerText()), "Règlements sur les dossiers chargés");
      assert.match(text(await list.innerText()), /totaux ci-dessus sont calculés par le serveur/);
      assert.equal(await list.locator("strong").count(), 120, "one row per loaded payment");
      assert.ok(!/Règlements confirmés ce mois-ci/.test(await page.locator("main, body").first().innerText()), "demo title only in demo");
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width);
      await page.screenshot({ path: `/tmp/art10/performance-${width}.png`, fullPage: false });
      // Overview and Profile: same server source.
      await page.evaluate("window.view = 'overview'; window.rerender()");
      await page.locator('[data-testid="perf-current-paid"]').first().waitFor();
      assert.equal(text(await page.locator('[data-testid="perf-current-paid"]').first().innerText()), "12 345,00 €");
      await page.evaluate("window.view = 'profile'; window.rerender()");
      await page.locator('[data-testid="perf-grid"]').waitFor();
      assert.match(text(await page.locator("body").innerText()), /4,6 \/ 5 \(212 avis\)/);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width);
      assert.ok(((await page.evaluate("window.perfCalls")) as number) >= 3);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("ArtisanSpace réel en live : liste vide ⇒ texte qui n’implique pas un zéro global", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(LIVE_SETUP + "window.seed.data = { interventions: [], quotes: [], payments: [], reviews: [] };");
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    await page.goto(url);
    await page.locator('[data-testid="perf-grid"]').waitFor();
    assert.ok(text(await page.locator('[data-testid="perf-grid"]').innerText()).includes("12 345,00 €"));
    assert.match(text(await page.locator("[data-perf-loaded-payments]").innerText()), /Aucun règlement confirmé parmi les dossiers chargés ce mois-ci\./);
  } finally {
    await browser.close();
    server.close();
  }
});
