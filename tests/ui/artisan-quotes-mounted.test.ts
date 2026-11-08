// ART-07 mounted: real ArtisanSpace in live (fake Session, StrictMode, Chromium 390 and 1280 px), « Devis »:
// 124 server quotes (more than the 100-row cache) over 3 pages with a duplicate, filter reset to page 1,
// late reply after a filter change dropped, 503 + Retry-After ⇒ « Réessayer » after the wait,
// « Voir le dossier » ⇒ openIntervention(intervention_id). Real app (demo): local lists, zero /api.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { withApp, skip as appSkip } from "./real-app-harness";
import { serveLiveArtisan } from "./artisan-live-space-harness";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";

export const QUOTES_SETUP = `
window.view = "quotes";
const Q = (n) => "b0000000-0000-4000-8000-" + String(n).padStart(12, "0");
const I = (n) => "a0000000-0000-4000-8000-" + String(n).padStart(12, "0");
window.Q = Q; window.I = I;
const item = (n, status) => ({ id: Q(n), intervention_id: I(n), status, total_cents: 10000 + n, created_at: "2026-11-07T10:00:00.123456+00:00", accepted_at: status === "accepted" ? "2026-11-07T11:00:00Z" : null, intervention: { id: I(n), category: "panel", status: status === "accepted" ? "accepted" : "quoted" } });
const range = (a, b, status) => Array.from({ length: b - a + 1 }, (_, k) => item(a + k, status));
const page = (items, next) => ({ items, page: { limit: 50, has_more: next !== null, next_cursor: next }, order: "newest_first" });
window.quoteCalls = []; window.hold = null; window.gates = []; window.fail = null;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
window.respond = async (url) => {
  if (!url.startsWith("/api/artisan/quotes")) return json({ error: "x" }, 503);
  window.quoteCalls.push(url);
  const u = new URL(url, location.href), st = u.searchParams.get("status"), c = u.searchParams.get("cursor");
  if (window.hold && window.hold(st, c)) await new Promise((r) => window.gates.push(r));
  if (window.fail) { const f = window.fail; window.fail = null; return json({ error: "x" }, f, f === 503 ? { "Retry-After": "2" } : {}); }
  if (st === "rejected") return json(page(range(500, 501, "rejected"), null));
  if (st === "accepted") return json(page(range(700, 702, "accepted"), null));
  if (!c) return json(page(range(1, 50, "sent"), "C1"));
  if (c === "C1") return json(page(range(50, 99, "sent"), "C2")); // Q(50) duplicated
  if (c === "C2") return json(page(range(100, 124, "sent"), null));
  return json({ error: "Curseur invalide" }, 422);
};
// The 100-row cache holds none of these quotes: the screen must not depend on it.
window.seed = { data: { interventions: [], quotes: [] } };
`;

test("ArtisanSpace live « Devis » (390/1280) : 124 devis serveur paginés + dédup ; filtre ⇒ page 1 ; réponse tardive ignorée ; 503 Retry-After ; Voir le dossier", { skip }, async () => {
  const { server, url } = await serveLiveArtisan(QUOTES_SETUP);
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(url);
      await page.locator("[data-quote-row]").first().waitFor();
      assert.equal(await page.locator("[data-quote-row]").count(), 50);
      await page.screenshot({ path: `/tmp/art10/quotes-${width}.png` });
      assert.ok(!/dossiers chargés/.test(await page.locator("main").innerText()), "no cache wording in live");
      await page.locator("[data-quotes-more]").click();
      await page.waitForFunction("document.querySelectorAll('[data-quote-row]').length === 99");
      await page.locator("[data-quotes-more]").click();
      await page.waitForFunction("document.querySelectorAll('[data-quote-row]').length === 124");
      assert.equal(await page.locator("[data-quotes-more]").count(), 0, "end of list");
      const ids = (await page.evaluate("[...document.querySelectorAll('[data-quote-row]')].map((r) => r.dataset.quoteRow)")) as string[];
      assert.equal(new Set(ids).size, 124, "dedup by id");
      // StrictMode mounts twice in development: consecutive identical reads are collapsed.
      assert.deepEqual(await page.evaluate("window.quoteCalls.filter((c, k, a) => c !== a[k - 1]).slice(0, 3)"), ["/api/artisan/quotes?status=all", "/api/artisan/quotes?status=all&cursor=C1", "/api/artisan/quotes?status=all&cursor=C2"]);
      // « Voir le dossier »: the current dossier through openIntervention, no quote claimed.
      await page.locator(`[data-quote-row="${"b0000000-0000-4000-8000-000000000120"}"] [data-quote-dossier]`).click();
      assert.deepEqual(await page.evaluate("window.opened"), [["a0000000-0000-4000-8000-000000000120", null]]);
      // Filter change ⇒ page 1 of the new filter; a late reply of the old filter is dropped.
      await page.evaluate("window.hold = (st) => st === 'accepted'");
      await page.locator('[data-quotes-filter="accepted"]').click();
      await page.locator('[data-artisan-quotes="loading"]').waitFor();
      assert.equal(await page.locator("[data-quote-row]").count(), 0, "no old frame");
      await page.evaluate("window.hold = null");
      await page.locator('[data-quotes-filter="rejected"]').click();
      await page.waitForFunction("document.querySelectorAll('[data-quote-row]').length === 2");
      await page.evaluate("window.gates.shift()()"); // late « accepted » reply
      await page.waitForTimeout(200);
      assert.equal(await page.locator("[data-quote-row]").count(), 2, "late reply dropped");
      assert.equal(await page.locator('[data-filter="rejected"]').count(), 1);
      assert.match(await page.locator("[data-quote-row]").first().innerText(), /Refusé par le client/);
      assert.equal(await page.evaluate("window.quoteCalls[window.quoteCalls.length - 1]"), "/api/artisan/quotes?status=rejected", "filter ⇒ page 1, no cursor");
      // 503 + Retry-After 2 ⇒ « Réessayer » disabled during the wait, then re-reads.
      await page.evaluate("window.fail = 503");
      await page.locator('[data-quotes-filter="sent"]').click();
      await page.locator("[data-quotes-error]").waitFor();
      assert.equal(await page.locator("[data-quote-row]").count(), 0, "no list on error");
      assert.equal(await page.locator("[data-quotes-retry]").isDisabled(), true, "Retry-After honoured");
      await page.waitForFunction("!document.querySelector('[data-quotes-retry]')?.disabled", null, { timeout: 5000 });
      await page.locator("[data-quotes-retry]").click();
      await page.locator("[data-quote-row]").first().waitFor();
      // 403 ⇒ honest unavailable, list cleared.
      await page.evaluate("window.fail = 403");
      await page.locator('[data-quotes-filter="all"]').click();
      await page.locator("[data-quotes-forbidden]").waitFor();
      assert.equal(await page.locator("[data-quote-row]").count(), 0);
      // 44 px targets, no horizontal overflow.
      const small = await page.evaluate("[...document.querySelectorAll('[data-artisan-quotes] button')].filter((b) => b.getBoundingClientRect().height > 0 && b.getBoundingClientRect().height < 43.5).length");
      assert.equal(small, 0);
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width);
      assert.deepEqual(errors, []);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle (démo, 390 px) : « Devis » garde ses listes locales, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    const { page, errors, api } = await open("artisan-quotes", 390);
    await page.waitForTimeout(1200);
    assert.match(await page.locator("body").innerText(), /sur les dossiers chargés/, "demo unchanged");
    assert.equal(await page.locator("[data-artisan-quotes]").count(), 0, "demo never mounts the live list");
    assert.deepEqual(api, []);
    assert.deepEqual(errors, []);
  });
});
