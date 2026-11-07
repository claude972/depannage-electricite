// « Plus proches d’abord » + radius fixes, mounted for real (React root, StrictMode, local Chromium)
// with the SAME host logic as artisan-space Missions (confirmed radius ⇒ selector; key =
// identity|confirmed radius rev|order). Server simulated per the 12f62f2 route: ranked pages carry
// radius_version in the cursor; no active radius / other version ⇒ 422. Real app: demo Missions has
// no selector and makes zero /api calls (360/390/1280, light/dark).
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
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { MissionRadiusPanel } from "./components/features/mission-radius/mission-radius-panel";
import { AvailableMissionsPanel } from "./components/features/available-missions/available-missions-panel";
const ACTOR = "10000000-0000-4000-8000-0000000000ad";
const U = (n) => "80000000-0000-4000-8000-" + String(n).padStart(12, "0");
const offer = (n, band) => ({ id: U(n), category: "panel", city: "Ville " + n, postal_code: "972**", urgency: "scheduled", status: "requested", estimate_min_cents: 8000, estimate_max_cents: 15000, created_at: "2026-11-01T10:00:00.000Z", ...(band === undefined ? {} : { distance_band_km: band }) });
const b64 = (o) => btoa(JSON.stringify(o)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const unb64 = (s) => JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/")));
const hash = location.hash;
window.S = { pref: hash.includes("active") ? { version: 7, reference_code: "97209", radius_km: 25 } : { version: 3, reference_code: null, radius_km: null }, postMode: "ok", hold: hash.includes("hold") };
window.lists = []; window.posts = []; window.gets = 0;
const view = () => ({ preference: window.S.pref, options: [{ code: "97209", name: "Fort-de-France" }, { code: "97213", name: "Le Lamentin" }], source: { url: "https://geo.api.gouv.fr/communes", retrieved_at: "2026-11-07T21:13:50Z" }, basis: "commune_centres", unknown_postal_policy: "postal_only" });
const radiusApi = {
  load: async () => {
    window.gets++;
    if (window.S.hold) await new Promise((r) => (window.release = r));
    return { status: 200, body: view(), retryAfterS: null };
  },
  save: async (body) => {
    window.posts.push(body);
    const mode = window.S.postMode;
    if (mode === "conflict") { window.S.pref = { version: 9, reference_code: "97213", radius_km: 40 }; return { status: 409, body: {}, retryAfterS: null }; }
    window.S.pref = { version: body.expected_version + 1, reference_code: body.reference_code, radius_km: body.radius_km };
    if (mode === "lost") return { status: 503, body: {}, retryAfterS: null };
    return { status: 200, body: view(), retryAfterS: null };
  },
};
const page = (items, more, ranked, version) => ({ items, eligible: true, captured_at: "2026-11-07T12:00:00.000Z",
  page: { limit: 50, has_more: more, next_cursor: more ? b64({ actor_id: ACTOR, created_at: items[items.length - 1].created_at, id: items[items.length - 1].id, ...(ranked ? { distance_band_km: items[items.length - 1].distance_band_km, radius_version: version } : {}) }) : null },
  projection: "anonymized", order: ranked ? "nearest_first" : "oldest_first", distance: ranked ? "commune_centre_bands" : "not_calculated" });
const missionsApi = {
  list: async (cursor, order) => {
    window.lists.push((order || "oldest_first") + "|" + (cursor === null ? "p1" : "next"));
    const p = window.S.pref;
    if (order === "nearest_first") {
      if (p.radius_km === null) return { status: 422, body: {}, retryAfter: null };
      if (cursor !== null && unb64(cursor).radius_version !== p.version) return { status: 422, body: {}, retryAfter: null };
      if (cursor === null) return { status: 200, body: page([offer(1, 5), offer(2, 10), ...Array.from({ length: 47 }, (_, i) => offer(10 + i, 15)), offer(60, 20)], true, true, p.version), retryAfter: null };
      return { status: 200, body: page([offer(70, 25), offer(71, null)], false, true, p.version), retryAfter: null };
    }
    return { status: 200, body: page([offer(1), offer(2)], false, false), retryAfter: null };
  },
  point: async (id) => ({ status: 200, body: page([offer(Number(id.slice(-3)))], false, false), retryAfter: null }),
};
window.gen = 1;
function Host() {
  const [gen, setGen] = useState(1);
  window.switchIdentity = () => { window.gen++; setGen(window.gen); };
  const ctx = { userId: () => ACTOR, generation: () => window.gen };
  const [radius, setRadius] = useState(null);
  const [order, setOrder] = useState("oldest_first");
  const ident = ACTOR + "|" + gen;
  const confirmed = radius && radius.ident === ident ? radius : null;
  const shownOrder = confirmed && confirmed.active ? order : "oldest_first";
  return h("div", null,
    h("button", { type: "button", onClick: () => window.switchIdentity(), "data-switch": "" }, "Changer d’identité"),
    h(MissionRadiusPanel, { key: "r|" + gen, demo: false, context: ctx, api: radiusApi, onConfirmed: (p) => {
      setRadius((prev) => ({ ident, ...p, rev: prev && prev.ident === ident && prev.version !== p.version ? prev.rev + 1 : prev ? prev.rev : 0 }));
      if (!p.active) setOrder("oldest_first");
    } }),
    h(AvailableMissionsPanel, { key: ident + "|live|" + (confirmed ? confirmed.rev : 0) + "|" + shownOrder, context: ctx, api: missionsApi, order: shownOrder, nearestAvailable: Boolean(confirmed && confirmed.active), radiusVersion: confirmed ? confirmed.version : null, onOrderChange: setOrder, onAccept: async () => false, onOpenAccepted: () => {} }));
}
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type W = { lists: string[]; posts: unknown[]; gets: number; S: { pref: { version: number }; postMode: string; hold: boolean }; release: () => void };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Page = any;
const lists = (page: Page) => page.evaluate(() => [...(window as unknown as W).lists]) as Promise<string[]>;
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("[data-available-sort] button, [data-available-back], [data-mission-radius] button")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim()) }))()`;
const sortButton = (page: Page, name: string) => page.locator("[data-available-sort]").getByRole("button", { name });

test("Chromium : sélecteur seulement après un rayon CONFIRMÉ ; tranches ; changement de tri ⇒ page 1 + résumé fermé ; version changée ⇒ 422 honnête, retour chronologique en un clic", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}#active-hold`);
      await page.locator('[data-available-missions="ready"]').waitFor();
      assert.equal(await page.locator("[data-available-sort]").count(), 0, "no selector before the radius GET is confirmed");
      await page.evaluate(() => (window as unknown as W).release());
      await page.locator('[data-available-sort="oldest_first"]').waitFor();
      await sortButton(page, "Plus proches d’abord").click();
      await page.locator('[data-available-band="5"]').waitFor();
      assert.equal(await page.locator('[data-available-band="5"]').innerText(), "jusqu’à 5 km · approximation entre centres de communes");
      assert.match(await page.locator('[data-available-band="10"]').innerText(), /^5–10 km/);
      assert.match(await page.locator("[data-available-basis]").innerText(), /entre centres de communes[\s\S]*ni GPS, ni durée de trajet/);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      // Summary keeps the list-row band (the ?id read is chronological, without a band).
      await page.locator(`[data-available-offer="80000000-0000-4000-8000-000000000002"]`).click();
      assert.match(await page.locator('[data-available-point="ready"]').innerText(), /Distance\s*5–10 km \(approximation entre centres de communes\)/);
      await page.getByRole("button", { name: "Afficher plus" }).click();
      await page.locator('[data-available-band="unknown"]').waitFor();
      assert.equal(await page.locator('[data-available-band="unknown"]').innerText(), "distance inconnue · approximation entre centres de communes");
      // Changing the order resets page, cursor and the opened summary.
      await sortButton(page, "Chronologique").click();
      await page.locator('[data-available-sort="oldest_first"]').waitFor();
      await page.waitForTimeout(150);
      assert.equal(await page.locator("[data-available-point]").count(), 0, "summary closed");
      assert.equal(await page.locator("[data-available-band]").count(), 0);
      let l = await lists(page);
      assert.equal(l[l.length - 1], "oldest_first|p1");
      // Back to nearest; the radius changes elsewhere (version 8): the next page is refused (422) ⇒
      // restart ⇒ the new version's page is not the confirmed one ⇒ honest refusal, no auto-switch.
      await sortButton(page, "Plus proches d’abord").click();
      await page.locator('[data-available-band="5"]').waitFor();
      await page.evaluate(() => { (window as unknown as W).S.pref = { version: 8, reference_code: "97209", radius_km: 30 } as never; });
      await page.getByRole("button", { name: "Afficher plus" }).click();
      await page.locator("[data-available-back]").waitFor();
      assert.match(await page.locator("[data-available-error]").innerText(), /rayon de recherche a changé ou est désactivé[\s\S]*Rien n’a été basculé automatiquement/);
      assert.equal(await page.locator("[data-available-offer]").count(), 0, "never mixes pages of two radius versions");
      l = await lists(page);
      assert.equal(l[l.length - 1], "nearest_first|p1", "no chronological call behind the user's back");
      await page.locator("[data-available-back]").click();
      await page.locator('[data-available-sort="oldest_first"]').waitFor();
      await page.locator("[data-available-offer]").first().waitFor();
      l = await lists(page);
      assert.equal(l[l.length - 1], "oldest_first|p1", "one click back to chronological");
      // Identity change: everything restarts chronologically at page 1 until the radius is re-confirmed.
      await sortButton(page, "Plus proches d’abord").click();
      await page.locator('[data-available-missions="error"], [data-available-band]').first().waitFor();
      const before = (await lists(page)).length;
      await page.locator("[data-switch]").click();
      await page.waitForTimeout(250);
      l = await lists(page);
      assert.equal(l[before], "oldest_first|p1", "identity change ⇒ page 1, chronological");
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("Chromium : réglage local non enregistré ⇒ pas de sélecteur ; 409 ⇒ relecture puis offres relancées ; réponse incertaine ⇒ « Relire le réglage », sans annonce d’annulation", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`${base}#none`);
    await page.locator('[data-mission-radius-current="none"]').waitFor();
    await page.getByLabel("Commune de référence").selectOption("97209");
    await page.getByLabel(/Rayon \(km/).fill("25");
    await page.waitForTimeout(150);
    assert.equal(await page.locator("[data-available-sort]").count(), 0, "unsaved local edits never enable the sort");
    // 409: the server moved to version 9 meanwhile ⇒ re-read ⇒ offers restarted for the new radius.
    await page.evaluate(() => { (window as unknown as W).S.postMode = "conflict"; });
    let before = (await lists(page)).length;
    await page.getByRole("button", { name: "Enregistrer le rayon" }).click();
    await page.locator('[data-mission-radius-current="40"]').waitFor();
    await page.waitForTimeout(200);
    assert.match(await page.locator("[data-mission-radius-error]").innerText(), /a changé entre-temps/);
    let l = await lists(page);
    assert.ok(l.length > before && l.slice(before).every((x) => x === "oldest_first|p1"), "offers restarted at page 1");
    await page.locator('[data-available-sort="oldest_first"]').waitFor();
    // Uncertain reply (503) although the server applied it ⇒ « Relire le réglage » ⇒ confirmed ⇒ offers refreshed.
    await page.evaluate(() => { (window as unknown as W).S.postMode = "lost"; });
    await page.getByLabel(/Rayon \(km/).fill("60");
    await page.getByRole("button", { name: "Enregistrer le rayon" }).click();
    await page.getByRole("button", { name: "Relire le réglage" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Abandonner" }).count(), 0);
    before = (await lists(page)).length;
    await page.getByRole("button", { name: "Relire le réglage" }).click();
    await page.locator('[data-mission-radius-current="60"]').waitFor();
    await page.waitForTimeout(200);
    const notice = await page.locator("[data-mission-radius-notice]").innerText();
    assert.match(notice, /a pu être pris en compte ou non/);
    assert.doesNotMatch(notice, /annul/i, "never claims the save was cancelled");
    l = await lists(page);
    assert.ok(l.length > before && l.slice(before).every((x) => x.endsWith("|p1")), "offers refreshed after the confirmed re-read");
    // Clearing (confirmed) removes the sort and goes back to chronological.
    await page.evaluate(() => { (window as unknown as W).S.postMode = "ok"; });
    await page.getByRole("button", { name: "Effacer" }).click();
    await page.locator('[data-mission-radius-current="none"]').waitFor();
    await page.waitForTimeout(150);
    assert.equal(await page.locator("[data-available-sort]").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : « Missions » artisan (démo) — aucun sélecteur de tri, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const theme of ["light", "dark"])
      for (const width of [360, 390, 1280]) {
        const where = `${theme} ${width}px`;
        const { page, errors, api } = await open("artisan-missions", width);
        await page.evaluate((t: string) => localStorage.setItem("courant-ui-theme", t), theme);
        const origin = new URL(page.url()).origin;
        await page.goto("about:blank");
        api.length = 0;
        await page.goto(`${origin}/#demo/artisan-missions`);
        await page.locator('[data-mission-radius="demo"]').waitFor();
        await page.locator("[data-available-missions]").waitFor();
        assert.equal(await page.locator("[data-available-sort]").count(), 0, where);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});
