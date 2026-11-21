import { fileURLToPath as localSourcePath } from "node:url";
// Review finding: mapView(snapshot, now()) was only recomputed on render, so a shown position could
// stay visible past its freshness limit if nothing re-rendered. The real panel in a real React root
// (local Chromium), NO re-render from outside: a position sampled 59.2 s ago must disappear on its
// own once it crosses the 60 s limit. Skipped — never passed — without local Playwright/Chromium.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { nextTransitionMs, SNAPSHOT_STALE_MS } from "../../components/features/dossier-map/dossier-map-model";
import type { TrackingSnapshot } from "../../lib/features/tracking/types";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");

const snap = (now: number, sampledAgo: number): TrackingSnapshot => ({
  server_time: new Date(now).toISOString(),
  permissions: { can_share: false, can_confirm_destination: false },
  tracking: { intervention_id: "i", artisan_id: "a", travel_stage: "en_route", session_id: "s", control_version: 1, shared: true, consent_at: new Date(now - 600_000).toISOString(), last_seq: 3, destination_version: 0, position_state: "fresh", position: { latitude: 14.6, longitude: -61.07, accuracy_m: 12, sampled_at: new Date(now - sampledAgo).toISOString(), received_at: new Date(now - sampledAgo).toISOString() }, destination: null },
});

test("nextTransitionMs: wakes at the position limit, then at the snapshot limit, never later than 60 s", () => {
  const now = Date.parse("2026-11-07T10:00:00Z");
  assert.equal(nextTransitionMs(snap(now, 59_000), now), 1_501, "aligned with trackingDisplay’s whole-second rounding");
  const noPos = { ...snap(now, 0), tracking: { ...snap(now, 0).tracking, position: null, position_state: "no_position" as const } };
  assert.equal(nextTransitionMs(noPos, now), 60_001, "« il y a … » refreshed at least every minute");
  assert.ok(SNAPSHOT_STALE_MS > 60_000);
});

const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { DossierMapPanel } from "./components/features/dossier-map/dossier-map-panel";
// Built at page load: position sampled 59.2 s ago ⇒ ~0.8 s left before it must disappear.
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const snapshot = {
  server_time: iso(now),
  permissions: { can_share: false, can_confirm_destination: false },
  tracking: { intervention_id: "i", artisan_id: "a", travel_stage: "en_route", session_id: "s", control_version: 1, shared: true, consent_at: iso(now - 600000), last_seq: 3, destination_version: 0, position_state: "fresh", position: { latitude: 14.6, longitude: -61.07, accuracy_m: 12, sampled_at: iso(now - 59200), received_at: iso(now - 59200) }, destination: null },
};
const div = document.createElement("div"); document.body.appendChild(div);
createRoot(div).render(h(DossierMapPanel, { address: { address: "8 rue Victor Hugo", postal_code: "97200", city: "Fort-de-France" }, tracking: null, demoSnapshot: snapshot }));
`;

test("Chromium: a fresh position disappears by itself at its freshness limit (no outside re-render)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><body><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    await page.waitForSelector("[data-map-sharing]");
    const before = await page.locator("[data-map-position]").count();
    await page.waitForTimeout(2500); // nothing re-renders the panel from outside
    const after = { position: await page.locator("[data-map-position]").count(), sharing: await page.locator("[data-map-sharing]").getAttribute("data-map-sharing") };
    assert.equal(before, 1, "fresh position shown at first");
    assert.equal(after.position, 0, "position removed once past its limit");
    assert.equal(after.sharing, "stale");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
