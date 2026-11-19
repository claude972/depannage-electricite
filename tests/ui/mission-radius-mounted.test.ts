import { fileURLToPath as localSourcePath } from "node:url";
// Mission radius mounted for real (React root, StrictMode, local Chromium) with the SAME wiring as
// artisan-space (AvailableMissionsPanel keyed by …|radiusRev): a confirmed save restarts the offers
// from page 1 (a new GET without cursor); a refused radius (0 / 201) sends nothing; « Effacer » sends
// both null; navigator.geolocation is never touched; 360 px light/dark, 44 px targets. Real app:
// artisan « Missions » (demo) shows the honest note, zero /api, no page errors (360/390/1280).
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
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const UID = "10000000-0000-4000-8000-0000000000ac";
const ENTRY = `
import { createElement as h, StrictMode, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { MissionRadiusPanel } from "./components/features/mission-radius/mission-radius-panel";
import { AvailableMissionsPanel } from "./components/features/available-missions/available-missions-panel";
window.geo = 0;
try {
  Object.defineProperty(navigator, "geolocation", { configurable: true, get() { window.geo++; return { getCurrentPosition() { window.geo++; }, watchPosition() { window.geo++; }, clearWatch() {} }; } });
} catch {}
window.failRadius = location.search.includes("offline");
window.radiusCalls = []; window.listCalls = []; window.stored = null;
let pref = { version: 3, reference_code: null, radius_km: null };
const view = () => ({ preference: pref, options: [{ code: "97209", name: "Fort-de-France" }, { code: "97213", name: "Le Lamentin" }], source: { url: "https://geo.api.gouv.fr/communes", retrieved_at: "2026-11-01" }, basis: "commune_centres", unknown_postal_policy: "postal_only" });
const radiusApi = {
  load: async () => { window.radiusCalls.push("GET"); if (window.failRadius) return { status: 503, body: null, retryAfterS: null }; return { status: 200, body: view(), retryAfterS: null }; },
  save: async (body) => {
    window.radiusCalls.push("POST " + JSON.stringify(body));
    window.stored = sessionStorage.getItem("courant-private-mission-radius:${UID}:1");
    pref = { version: body.expected_version + 1, reference_code: body.reference_code, radius_km: body.radius_km };
    return { status: 200, body: view(), retryAfterS: null };
  },
};
const missionsApi = {
  list: async (cursor) => { window.listCalls.push(cursor); return { status: 200, body: { items: [], eligible: true, captured_at: "2026-11-07T12:00:00Z", page: { limit: 50, has_more: false, next_cursor: null }, projection: "anonymized", order: "oldest_first", distance: "not_calculated" }, retryAfter: null }; },
  point: async () => ({ status: 404, body: null, retryAfter: null }),
};
const ctx = { userId: () => "${UID}", generation: () => 1 };
function Host() {
  const [radiusRev, setRadiusRev] = useState({ v: null, n: 0 });
  const details = useRef(null);
  const onAttention = useCallback(() => { if (details.current) details.current.open = true; }, []);
  return h("div", null,
    h("details", { ref: details, open: !location.search.includes("offline") }, h("summary", null, "Zone de recherche"),
    h(MissionRadiusPanel, { onAttention, demo: false, context: ctx, api: radiusApi, onConfirmed: (p) => setRadiusRev((prev) => (prev.v !== null && prev.v !== p.version ? { v: p.version, n: prev.n + 1 } : { v: p.version, n: prev.n })) })),
    h(AvailableMissionsPanel, { key: "uid|1|live|" + radiusRev.n, context: ctx, api: missionsApi, onAccept: async () => false, onOpenAccepted: () => {} }));
}
document.documentElement.setAttribute("data-ui-theme", location.search.includes("dark") ? "dark" : "light");
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(StrictMode, null, h(Host)));
`;
type W = { radiusCalls: string[]; listCalls: (string | null)[]; stored: string | null; geo: number };

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
const SMALL = `(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("[data-mission-radius] button, [data-mission-radius] select, [data-mission-radius] input, [data-mission-radius] a")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim() || e.tagName) }))()`;
const state = (page: { evaluate: (f: () => unknown) => Promise<unknown> }) => page.evaluate(() => { const w = window as unknown as W; return { radius: [...w.radiusCalls], lists: [...w.listCalls], stored: w.stored, geo: w.geo }; }) as Promise<{ radius: string[]; lists: (string | null)[]; stored: string | null; geo: number }>;

test("Chromium : bornes refusées sans appel, enregistrement ⇒ offres relancées page 1, effacer ⇒ deux null ; jamais de géolocalisation ; 360 px", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`${base}?${theme}`);
      await page.locator('[data-mission-radius-current="none"]').waitFor();
      const text = await page.locator("[data-mission-radius]").innerText();
      assert.match(text, /approximation entre centres de communes/);
      assert.match(text, /commune unique restent soumises à vos zones postales/);
      assert.match(text, /geo\.api\.gouv\.fr[\s\S]*1 novembre 2026/);
      const layout = (await page.evaluate(SMALL)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.waitForTimeout(200);
      const before = await state(page);
      assert.ok(before.lists.length >= 1 && before.lists.every((c) => c === null), "offers loaded from page 1");
      await page.getByLabel("Commune de référence").selectOption("97209");
      for (const bad of ["0", "201"]) {
        await page.getByLabel(/Rayon \(km/).fill(bad);
        await page.getByRole("button", { name: "Enregistrer le rayon" }).click();
        assert.match(await page.locator("[data-mission-radius-error]").innerText(), /1 à 200 km/);
      }
      assert.equal((await state(page)).radius.filter((c) => c.startsWith("POST")).length, 0, "refused locally");
      const listsBefore = (await state(page)).lists.length;
      await page.getByLabel(/Rayon \(km/).fill("25");
      await page.getByRole("button", { name: "Enregistrer le rayon" }).click();
      await page.locator('[data-mission-radius-current="25"]').waitFor();
      await page.waitForTimeout(200);
      let s = await state(page);
      const posts = s.radius.filter((c) => c.startsWith("POST"));
      assert.deepEqual(posts, ['POST {"expected_version":3,"reference_code":"97209","radius_km":25}']);
      assert.equal(JSON.parse(s.stored!).command.radius_km, 25, "stored and read back before the POST");
      assert.ok(s.lists.length > listsBefore, "offers restarted");
      assert.ok(s.lists.slice(listsBefore).every((c) => c === null), "from page 1 (no cursor)");
      assert.match(await page.locator("[data-mission-radius-notice]").innerText(), /première page/);
      const listsMid = s.lists.length;
      await page.getByRole("button", { name: "Effacer" }).click();
      await page.locator('[data-mission-radius-current="none"]').waitFor();
      await page.waitForTimeout(200);
      s = await state(page);
      assert.equal(s.radius.filter((c) => c.startsWith("POST"))[1], 'POST {"expected_version":4,"reference_code":null,"radius_km":null}');
      assert.ok(s.lists.length > listsMid && s.lists.slice(listsMid).every((c) => c === null));
      assert.equal(s.geo, 0, "navigator.geolocation never touched");
      assert.deepEqual(errors, []);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("app réelle : « Missions » artisan (démo) — note honnête du rayon, aucun /api, aucune erreur", { skip: appSkip }, async () => {
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
        // The radius panel sits in the collapsed « Zone de recherche » disclosure: open it like a user.
        await page.getByText("Zone de recherche", { exact: false }).first().click();
        const panel = page.locator('[data-mission-radius="demo"]');
        await panel.waitFor();
        assert.match(await panel.innerText(), /aucun appel n’est fait/, where);
        assert.equal(await panel.locator("button, select, input").count(), 0, where);
        const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
        assert.ok(overflow <= 0, `${where}: ${overflow}px overflow`);
        assert.deepEqual(api, [], where);
        assert.deepEqual(errors, [], where);
        await page.context().close();
      }
  });
});


test("Chromium : erreur du rayon rend le panneau replie visible puis reprise GET sans mutation", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${base}?offline`);
    await page.getByRole("button", { name: "Réessayer", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.locator("details").evaluate((el: HTMLDetailsElement) => el.open), true);
    await page.evaluate(() => { (window as unknown as { failRadius: boolean }).failRadius = false; });
    await page.getByRole("button", { name: "Réessayer", exact: true }).click();
    await page.locator('[data-mission-radius-current="none"]').waitFor();
    assert.equal((await state(page)).radius.some((call) => call.startsWith("POST")), false);
  } finally { await browser.close(); server.close(); }
});
