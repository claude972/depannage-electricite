import { fileURLToPath as localSourcePath } from "node:url";
// Real React test of useDetailPresence (FASTSPLIT-DETAIL-CONSUMER-001 fixes): the hook runs in a
// real browser (local Chromium), driven by a real React root. Skipped — never passed — when no
// local Playwright/Chromium is available.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);

const APP = `
import React, { useState, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { useDetailPresence } from "./components/role/use-detail-presence";
import { ApiRequestError } from "./components/app/api";
const id = "10000000-0000-4000-8000-000000000001", uid = "10000000-0000-4000-8000-000000000002", stamp = "2026-10-31T10:00:00.000Z";
const envelope = (description) => ({ intervention: { id, client_id: uid, artisan_id: null, site_id: null, category: "panel", description, address: "2 rue test", postal_code: "97200", city: "Test", urgency: "scheduled", estimate_min_cents: 1, estimate_max_cents: 2, status: "requested", created_at: stamp, updated_at: stamp, completed_at: null, paid_at: null, travel_stage: "planned" }, site: { status: "none" }, organization: { status: "none" }, quotes: { status: "ok", items: [], limited: false }, messages: { status: "ok", items: [], limited: false }, documents: { status: "ok", items: [], limited: false }, appointments: { status: "ok", items: [], limited: false }, payments: { status: "ok", items: [], limited: false, incomplete: false }, generated_at: stamp });
const q = new URLSearchParams(location.search);
const kind = q.get("case");
window.calls = 0; window.fresh = 0; window.seen = [];
const fetcher = async () => {
  window.calls++;
  await new Promise((r) => setTimeout(r, 25));
  if (kind === "401") throw new ApiRequestError(401, "expired");
  if (kind === "focus503" && window.calls > 1) throw new ApiRequestError(503, "busy", { retry_after_s: Number(q.get("ra") || 5) });
  if (kind === "focus401" && window.calls > 1) throw new ApiRequestError(401, "expired");
  return envelope(window.calls === 1 ? "PRIVATE_OLD_DETAIL" : "FRESH_DETAIL_" + window.calls);
};
const ensureFresh = async () => { window.fresh++; return { kind: "loaded" }; };
function App() {
  const [ctx, setCtx] = useState("g1|client||");
  window.setCtx = setCtx;
  const limited = kind !== "unproven";
  const p = useDetailPresence({ mode: "live", refreshContext: ctx, ensureFresh, data: { limits: { interventions: { limited } } } }, "client-detail", id, false, fetcher);
  window.last = { retryInS: p.retryInS, decision: p.decision, detail: p.detail && p.detail.intervention.description, openAnyway: Boolean(p.openAnyway) };
  window.seen.push(window.last.detail || "");
  window.openAnyway = p.openAnyway;
  window.retry = p.retry;
  return h("pre", null, JSON.stringify(window.last));
}
createRoot(document.getElementById("app")).render(h(App));
`;

test("useDetailPresence in real React: 401 terminal, TTL after clock jump, focus revalidation, unproven absence, context purge", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const bundle = await build({ absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"development"' } });
  const js = bundle.outputFiles[0].text;
  const server = createServer((_rq, rs) => {
    rs.setHeader("content-type", "text/html");
    rs.end('<div id="app"></div><script>window.__off=0;const realNow=Date.now;Date.now=()=>realNow()+window.__off;</script><script>' + js + "</script>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  type W = Window & { calls: number; fresh: number; last: { decision: string; detail?: string; openAnyway: boolean }; seen: string[]; __off: number; setCtx(c: string): void; openAnyway?: () => void; retry(): void };
  const open = async (kind: string) => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?case=${kind}`);
    return { page, errors };
  };
  try {
    // 1. 401: one read, then terminal (no automatic loop), session notified once, never « introuvable ».
    {
      const { page, errors } = await open("401");
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail_error");
      await page.waitForTimeout(600);
      const s = await page.evaluate(() => ({ calls: (window as unknown as W).calls, fresh: (window as unknown as W).fresh, last: (window as unknown as W).last }));
      assert.equal(s.calls, 1, "a 401 is never re-read automatically");
      // 1 causal workspace refresh (id absent) + exactly 1 notification for the 401 — no loop.
      assert.equal(s.fresh, 2, "the session is notified once to handle the expired session");
      assert.equal(s.last.decision, "detail_error");
      await page.evaluate(() => (window as unknown as W).retry());
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => (window as unknown as W).calls), 2, "explicit user retry = exactly one more read");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2. TTL after a clock jump: the expired private copy is dropped without any external render.
    {
      const { page, errors } = await open("ttl");
      await page.waitForFunction(() => (window as unknown as W).last?.detail === "PRIVATE_OLD_DETAIL");
      await page.evaluate(() => {
        (window as unknown as W).__off += 61_000;
        (window as unknown as W).seen = [];
      });
      await page.waitForFunction(() => (window as unknown as W).calls >= 2, undefined, { timeout: 3000 });
      await page.waitForFunction(() => /^FRESH_DETAIL_/.test((window as unknown as W).last?.detail ?? ""));
      const seen = await page.evaluate(() => (window as unknown as W).seen);
      const firstFresh = seen.findIndex((d: string) => d.startsWith("FRESH_DETAIL_"));
      assert.ok(!seen.slice(1, firstFresh).includes("PRIVATE_OLD_DETAIL"), "after expiry the old copy is never rendered again before the fresh one");
      // 3. Focus revalidates in the background (the cached copy stays visible meanwhile).
      const before = await page.evaluate(() => (window as unknown as W).calls);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => (window as unknown as W).calls), before, "no focus re-read of a copy younger than 15 s");
      await page.evaluate(() => {
        (window as unknown as W).__off += 16_000;
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForFunction((n: number) => (window as unknown as W).calls === n + 1, before);
      assert.match((await page.evaluate(() => (window as unknown as W).last.detail)) ?? "", /^FRESH_DETAIL_/);
      // 5. Context change (identity / role / org / site): the old dossier is purged, re-read under the new context.
      await page.evaluate(() => {
        (window as unknown as W).seen = [];
        (window as unknown as W).setCtx("g1|manager|org|site");
      });
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail");
      const afterCtx = await page.evaluate(() => (window as unknown as W).seen);
      const lastShownBefore = afterCtx[0];
      assert.equal(lastShownBefore, "", "the first render under the new context shows no dossier from the old one");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2b. Root's repro: Playwright fake clock (Date + timers) +61 s, no external render.
    {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.clock.install();
      await page.goto(`http://127.0.0.1:${port}/?case=ttl`);
      await page.waitForFunction(() => (window as unknown as W).last?.detail === "PRIVATE_OLD_DETAIL");
      await page.clock.runFor(61_000);
      await page.waitForTimeout(150);
      await page.clock.runFor(100);
      await page.waitForFunction(() => /^FRESH_DETAIL_/.test((window as unknown as W).last?.detail ?? ""), undefined, { timeout: 3000 });
      assert.equal(await page.evaluate(() => (window as unknown as W).calls), 2, "expired copy re-read exactly once, without any external render");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2c. Focus storm on a cached copy, backend 503 Retry-After 5: one GET, then a visible error.
    {
      const { page, errors } = await open("focus503");
      await page.waitForFunction(() => (window as unknown as W).last?.detail === "PRIVATE_OLD_DETAIL");
      await page.evaluate(async () => {
        (window as unknown as W).__off += 16_000;
        for (let n = 0; n < 3; n++) {
          window.dispatchEvent(new Event("focus"));
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail_error");
      await page.evaluate(async () => {
        for (let n = 0; n < 3; n++) {
          window.dispatchEvent(new Event("focus"));
          await new Promise((r) => setTimeout(r, 100));
        }
      });
      const s = await page.evaluate(() => ({ calls: (window as unknown as W).calls, last: (window as unknown as W).last as unknown as { decision: string; retryInS?: number; detail?: string } }));
      assert.equal(s.calls, 2, "3+3 focuses => a single revalidation GET; Retry-After honoured");
      assert.equal(s.last.decision, "detail_error", "failed revalidation is visible, not a fresh-looking copy");
      assert.ok((s.last.retryInS ?? 0) > 0, "retry delayed by Retry-After");
      assert.equal(s.last.detail, undefined);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2d. Retry-After 2 s elapsed but < 15 s since the last passive attempt: focus must NOT re-read.
    {
      const { page, errors } = await (async () => {
        const page = await browser.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e: Error) => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${port}/?case=focus503&ra=2`);
        return { page, errors };
      })();
      await page.waitForFunction(() => (window as unknown as W).last?.detail === "PRIVATE_OLD_DETAIL");
      await page.evaluate(() => {
        (window as unknown as W).__off += 16_000;
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail_error");
      await page.evaluate(() => {
        (window as unknown as W).__off += 2_100;
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => (window as unknown as W).calls), 2, "passive cooldown 15 s between attempts, not only Retry-After");
      await page.evaluate(() => {
        (window as unknown as W).__off += 13_000;
        window.dispatchEvent(new Event("focus"));
      });
      await page.waitForFunction(() => (window as unknown as W).calls === 3);
      // Explicit user retry keeps its own rule (Retry-After only).
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail_error");
      await page.evaluate(() => { (window as unknown as W).__off += 2_100; });
      await page.evaluate(() => (window as unknown as W).retry());
      await page.waitForFunction(() => (window as unknown as W).calls === 4);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2e. Cached copy then 401: passive listeners are terminal (one GET, then focus storms emit none).
    {
      const { page, errors } = await open("focus401");
      await page.waitForFunction(() => (window as unknown as W).last?.detail === "PRIVATE_OLD_DETAIL");
      await page.evaluate(async () => {
        (window as unknown as W).__off += 16_000;
        for (let n = 0; n < 3; n++) {
          window.dispatchEvent(new Event("focus"));
          await new Promise((r) => setTimeout(r, 100));
        }
        (window as unknown as W).__off += 60_000;
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => ({ calls: (window as unknown as W).calls, last: (window as unknown as W).last }));
      assert.equal(s.calls, 2, "401 over a cached copy: no further passive GET");
      assert.equal(s.last.decision, "detail_error");
      assert.equal(s.last.detail, undefined, "the private copy is not shown after a 401");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 4. Window not truncated (absence unproven): no automatic read, « Ouvrir quand même » reads once.
    {
      const { page, errors } = await open("unproven");
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "not_found");
      await page.waitForTimeout(300);
      const s = await page.evaluate(() => ({ calls: (window as unknown as W).calls, last: (window as unknown as W).last }));
      assert.equal(s.calls, 0, "no point read without the truncation flag");
      assert.equal(s.last.openAnyway, true, "the view must offer « Ouvrir quand même » (non-definitive wording)");
      await page.evaluate(() => (window as unknown as W).openAnyway?.());
      await page.waitForFunction(() => (window as unknown as W).last?.decision === "detail");
      assert.equal(await page.evaluate(() => (window as unknown as W).calls), 1);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
