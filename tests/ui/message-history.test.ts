// FASTSPLIT-MESSAGE-HISTORY-001: paginated message history. Pure merge/order/cursor tests, then
// the real MessageCenter in a real React root in local Chromium with a fake fetch. The browser
// part is skipped — never passed — when no local Playwright/Chromium is available.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  applyOutcome,
  fetchHistoryPage,
  historyKey,
  historyUrl,
  initialHistory,
  mergeMessages,
  offersOlder,
  parseHistoryPage,
} from "../../components/app/message-history";
import type { Message } from "../../components/app/types";

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const msg = (n: number, dossier = A, at = `2026-10-01T10:${String(n % 60).padStart(2, "0")}:00.000Z`): Message => ({
  id: `m-${dossier.slice(-1)}-${String(n).padStart(4, "0")}`,
  intervention_id: dossier,
  author_id: "u1",
  body: `b${n}`,
  created_at: at,
});

test("merge: dedupe by id, chronological (created_at then id), other dossiers dropped", () => {
  const same = "2026-10-01T10:00:00.000Z";
  const preview = [msg(3, A, "2026-10-01T10:03:00.000Z"), msg(2, A, same), msg(9, B)];
  const page = [msg(3, A, "2026-10-01T10:03:00.000Z"), msg(1, A, same), msg(0, A, "2026-10-01T09:00:00.000Z")];
  const merged = mergeMessages(A, preview, page);
  assert.deepEqual(merged.map((m) => m.id), ["m-a-0000", "m-a-0001", "m-a-0002", "m-a-0003"]);
  assert.ok(merged.every((m) => m.intervention_id === A));
  assert.equal(new Set(merged.map((m) => m.id)).size, merged.length);
});

test("parse + cursor: opaque cursor kept per dossier, foreign rows or bad page refused, resume after error", async () => {
  assert.equal(historyUrl(A, null), `/api/messages?intervention_id=${A}&limit=25`);
  assert.equal(historyUrl(A, "x/y+z="), `/api/messages?intervention_id=${A}&limit=25&cursor=x%2Fy%2Bz%3D`);
  const ok = parseHistoryPage({ messages: [msg(1)], page: { limit: 25, has_more: true, next_cursor: "C1" } }, A);
  assert.deepEqual(ok?.nextCursor, "C1");
  assert.equal(parseHistoryPage({ messages: [msg(1, B)], page: { limit: 25, has_more: false, next_cursor: null } }, A), null);
  assert.equal(parseHistoryPage({ messages: [], page: { limit: 25, has_more: true, next_cursor: null } }, A), null);
  assert.deepEqual(parseHistoryPage({ messages: [], page: { limit: 25, has_more: false, next_cursor: null } }, A), { messages: [], hasMore: false, nextCursor: null });

  const kA = historyKey("u1", A);
  let s = applyOutcome(initialHistory(kA), kA, { kind: "loaded", messages: [msg(5)], hasMore: true, nextCursor: "C1" });
  s = applyOutcome(s, kA, { kind: "failed", status: 503 });
  assert.equal(s.status, "error");
  assert.equal(s.cursor, "C1", "a failure keeps the cursor: retry resumes at the same page");
  assert.equal(s.pages.length, 1, "what was shown stays");
  // A reply for another dossier/identity never lands in this state.
  assert.equal(applyOutcome(s, historyKey("u2", A), { kind: "loaded", messages: [msg(1)], hasMore: false, nextCursor: null }), s);

  const seen: [string, RequestInit][] = [];
  const fake = async (url: string, init: RequestInit) => {
    seen.push([url, init]);
    return new Response(JSON.stringify({ messages: [], page: { limit: 25, has_more: false, next_cursor: null } }), { status: 200 });
  };
  const out = await fetchHistoryPage(fake, A, "C1", new AbortController().signal);
  assert.equal(out.kind, "loaded");
  assert.equal(seen[0][1].credentials, "same-origin");
  assert.equal(seen[0][1].cache, "no-store");
  for (const [status, kind] of [[401, "signed_out"], [404, "not_found"], [503, "failed"], [422, "failed"]] as const)
    assert.equal((await fetchHistoryPage(async () => new Response("{}", { status }), A, null, new AbortController().signal)).kind, kind);
  assert.equal((await fetchHistoryPage(async () => { throw new TypeError("net"); }, A, null, new AbortController().signal)).kind, "failed");
  const ctl = new AbortController();
  ctl.abort();
  assert.equal((await fetchHistoryPage(async () => { throw new DOMException("x", "AbortError"); }, A, null, ctl.signal)).kind, "aborted");
});

test("401 after a partial page: no older-page offer, loaded messages kept, never re-requested", () => {
  const k = historyKey("u1", A);
  let s = applyOutcome(initialHistory(k), k, { kind: "loaded", messages: [msg(1), msg(2)], hasMore: true, nextCursor: "C1" });
  assert.equal(offersOlder(s), true);
  s = applyOutcome(s, k, { kind: "signed_out" });
  assert.equal(s.status, "signed_out");
  assert.equal(offersOlder(s), false, "no dead « Charger les messages plus anciens » button");
  assert.equal(s.pages.length, 2, "already loaded messages stay shown");
  // A later reply (e.g. a stale read) cannot revive the offer for this identity: only a new key resets.
  assert.equal(offersOlder(applyOutcome(s, k, { kind: "failed", status: 503 })), false);
  assert.equal(offersOlder(applyOutcome(initialHistory(k), k, { kind: "not_found" })), false);
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const APP = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { MessageCenter } from "./components/app/forms";
const A = "${A}", B = "${B}";
const kind = new URLSearchParams(location.search).get("case");
const TOTAL = kind === "empty" ? 0 : 237;
const pad = (n) => String(n).padStart(4, "0");
// Server truth: TOTAL messages per dossier; several share a created_at (tie broken by id).
const all = (d) => Array.from({ length: d === A ? TOTAL : 30 }, (_, n) => ({ id: "m-" + d.slice(-1) + "-" + pad(n), intervention_id: d, author_id: n % 2 ? "u1" : "u2", body: "body " + n, created_at: new Date(Date.UTC(2026, 9, 1, 0, Math.floor(n / 2))).toISOString() }));
const desc = (d) => all(d).sort((x, y) => (x.created_at === y.created_at ? (x.id < y.id ? 1 : -1) : x.created_at < y.created_at ? 1 : -1));
window.calls = [];
let n503 = 0;
const fakeFetch = async (url, init) => {
  const u = new URL(url, location.origin);
  const d = u.searchParams.get("intervention_id"), cursor = u.searchParams.get("cursor"), limit = Number(u.searchParams.get("limit"));
  window.calls.push({ d, cursor, limit, credentials: init.credentials, cache: init.cache });
  const late = kind === "switch" && d === A && window.calls.length === 1;
  await new Promise((r) => setTimeout(r, late ? 400 : 20)); // late reply ignores the abort on purpose
  if (kind === "401") return new Response("{}", { status: 401 });
  if (kind === "401late" && cursor) return new Response("{}", { status: 401 });
  if (kind === "404") return new Response("{}", { status: 404 });
  if (kind === "503" && cursor && n503++ === 0) return new Response("{}", { status: 503 });
  const off = cursor ? Number(cursor.split(":")[1]) : 0; // opaque to the client
  const rows = desc(d).slice(off, off + limit);
  const more = off + limit < desc(d).length;
  return new Response(JSON.stringify({ messages: rows, page: { limit, has_more: more, next_cursor: more ? d.slice(-1) + ":" + (off + limit) : null } }), { status: 200 });
};
// Workspace preview: the 5 newest of A (duplicated by page 1) + 2 of B.
const preview = kind === "empty" ? [] : [...desc(A).slice(0, 5), ...desc(B).slice(0, 2)];
const interventions = [A, B].map((id) => ({ id, category: "panel", status: "requested", created_at: "2026-10-01T00:00:00.000Z" }));
createRoot(document.getElementById("app")).render(h(MessageCenter, { interventions, messages: preview, role: "client", profileId: "u1", selectedId: A, busy: false, onSubmit: async () => true, live: kind !== "demo", fetchHistory: fakeFetch }));
`;

test("MessageCenter history in real React/Chromium: 237 messages over 10 pages, 503+retry, 404, 401, empty, switch, demo", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: APP, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' } });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const server = createServer((_rq, rs) => {
    rs.setHeader("content-type", "text/html");
    rs.end('<div id="app"></div><script>' + js + "</script>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  type Call = { d: string; cursor: string | null; limit: number; credentials: string; cache: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Page = any;
  const open = async (kind: string) => {
    const page: Page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?case=${kind}`);
    return { page, errors };
  };
  const ids = (page: Page): Promise<string[]> => page.$$eval("[data-message-id]", (els: Element[]) => els.map((e) => e.getAttribute("data-message-id") as string));
  const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as unknown as { calls: Call[] }).calls);
  const OLDER = "text=Charger les messages plus anciens";
  try {
    // 1. 237 messages: first page automatically, then « Charger les messages plus anciens » until exhausted.
    {
      const { page, errors } = await open("pages");
      await page.waitForSelector(OLDER);
      assert.equal((await ids(page)).length, 25, "page 1 (25) merged with the 5-message preview, no duplicate");
      for (let n = 0; n < 20 && (await page.$(OLDER)); n++) {
        const before = (await calls(page)).length;
        await page.click(OLDER);
        await page.waitForFunction((k: number) => (window as unknown as { calls: Call[] }).calls.length > k && !document.querySelector("[data-message-history=loading]"), before);
      }
      const shown = await ids(page);
      assert.equal(shown.length, 237);
      assert.equal(new Set(shown).size, 237, "never a duplicate");
      assert.deepEqual(shown, [...shown].sort(), "chronological (ids sort like created_at, id here)");
      assert.ok(shown.every((i) => i.startsWith("m-a-")), "no message of dossier B");
      const c = await calls(page);
      assert.equal(c.length, 10, "ceil(237/25) reads");
      assert.equal(c[0].cursor, null);
      c.slice(1).forEach((call, i) => assert.equal(call.cursor, `a:${(i + 1) * 25}`, "cursor sent back unchanged"));
      assert.ok(c.every((call) => call.d === A && call.limit === 25 && call.credentials === "same-origin" && call.cache === "no-store"));
      assert.equal(await page.$(OLDER), null, "no button once has_more is false");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 2. 503 on an older page: error + Réessayer, what is shown stays, retry resumes with the same cursor.
    {
      const { page, errors } = await open("503");
      await page.waitForSelector(OLDER);
      await page.click(OLDER);
      await page.waitForSelector("[data-message-history=error]");
      assert.equal((await ids(page)).length, 25, "messages already shown are kept");
      await page.click("text=Réessayer");
      await page.waitForFunction(() => document.querySelectorAll("[data-message-id]").length === 50);
      const c = await calls(page);
      assert.deepEqual(c.map((x) => x.cursor), [null, "a:25", "a:25"]);
      assert.equal(await page.$("[data-message-history=error]"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 3. 404: uniform unavailable state, nothing of the dossier shown (not even the preview), no compose.
    {
      const { page, errors } = await open("404");
      await page.waitForSelector("[data-message-history=not_found]");
      assert.deepEqual(await ids(page), []);
      assert.equal(await page.$("#message-body"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 4. 401: session-expired message, no retry button, no automatic re-read.
    {
      const { page, errors } = await open("401");
      await page.waitForSelector("[data-message-history=signed_out]");
      await page.waitForTimeout(400);
      assert.equal((await calls(page)).length, 1);
      assert.equal(await page.$("text=Réessayer"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 4b. 401 AFTER a partial page: button gone (not a dead control), messages kept, 0 further GET.
    {
      const { page, errors } = await open("401late");
      await page.waitForSelector(OLDER);
      await page.click(OLDER);
      await page.waitForSelector("[data-message-history=signed_out]");
      assert.equal(await page.$(OLDER), null, "older-page button removed after the 401");
      assert.equal((await ids(page)).length, 25, "already loaded messages stay shown");
      await page.click(".message-threads button:nth-child(2)"); // re-render, same dossier and identity
      await page.waitForTimeout(400);
      assert.equal((await calls(page)).length, 2, "no request after the 401 for this identity");
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 5. Empty dossier: empty state, no older button.
    {
      const { page, errors } = await open("empty");
      await page.waitForSelector("text=Commencez l’échange");
      assert.equal(await page.$(OLDER), null);
      assert.equal((await calls(page)).length, 1);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 6. Dossier switch while A's first page is in flight: A's late reply is ignored; B uses its own cursor.
    {
      const { page, errors } = await open("switch");
      await page.click(`.message-threads button:nth-child(3)`); // B (h2 is child 1, A child 2)
      await page.waitForSelector(OLDER);
      await page.click(OLDER);
      await page.waitForFunction(() => document.querySelectorAll("[data-message-id]").length === 30);
      await page.waitForTimeout(500); // A's late reply has arrived by now
      const shown = await ids(page);
      assert.ok(shown.every((i) => i.startsWith("m-b-")), "never a message of A in B's conversation");
      const c = await calls(page);
      assert.deepEqual(c.map((x) => [x.d, x.cursor]), [[A, null], [B, null], [B, "b:25"]]);
      assert.deepEqual(errors, []);
      await page.close();
    }
    // 7. Demo: workspace preview only, zero fetch.
    {
      const { page, errors } = await open("demo");
      await page.waitForSelector("[data-message-id]");
      await page.waitForTimeout(200);
      assert.equal((await calls(page)).length, 0);
      assert.equal((await ids(page)).length, 5);
      assert.equal(await page.$(OLDER), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
