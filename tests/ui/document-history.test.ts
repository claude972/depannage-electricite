// Documents history (documents centre capped at 100 workspace rows). Pure merge/order/cursor
// tests, then the real DocumentManager in a real React root in local Chromium with a fake fetch.
// The browser part is skipped — never passed — when no local Playwright/Chromium is available.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  applyDocumentOutcome,
  documentHistoryKey,
  documentHistoryUrl,
  fetchDocumentPage,
  initialDocumentHistory,
  mergeDocuments,
  offersOlderDocuments,
  olderDocumentsUsable,
  parseDocumentPage,
} from "../../components/app/document-history";
import type { StoredDocument } from "../../components/app/types";

const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";
const doc = (n: number, dossier: string | null = A, at = `2026-10-01T10:${String(n % 60).padStart(2, "0")}:00.000Z`): StoredDocument => ({
  id: `d-${String(n).padStart(4, "0")}`,
  intervention_id: dossier,
  owner_id: "u1",
  name: `f${n}.pdf`,
  mime_type: "application/pdf",
  created_at: at,
});
const page = (documents: unknown[], has_more = false, next_cursor: string | null = null) => ({ documents, page: { limit: 25, has_more, next_cursor } });

test("merge: dedupe by id, newest first (created_at DESC then id DESC), filter respected", () => {
  const same = "2026-10-01T10:00:00.000Z";
  const workspace = [doc(1, A, same), doc(3, null, "2026-10-01T10:03:00.000Z"), doc(9, B)];
  const older = [doc(1, A, same), doc(2, A, same), doc(0, A, "2026-10-01T09:00:00.000Z")];
  assert.deepEqual(mergeDocuments("", workspace, older).map((d) => d.id), ["d-0009", "d-0003", "d-0002", "d-0001", "d-0000"]);
  assert.deepEqual(mergeDocuments(A, workspace, older).map((d) => d.id), ["d-0002", "d-0001", "d-0000"], "a dossier filter never shows another dossier");
});

test("parse + cursor + outcomes: strict page, cursor scope, Retry-After, resume after error", async () => {
  assert.equal(documentHistoryUrl("", null), "/api/documents/history?limit=25");
  assert.equal(documentHistoryUrl(A, "x/y="), `/api/documents/history?limit=25&cursor=x%2Fy%3D&intervention_id=${A}`);
  const ok = parseDocumentPage(page([{ ...doc(1), storage_path: "secret/path" }], true, "C1"), "");
  assert.equal(ok?.nextCursor, "C1");
  assert.equal("storage_path" in (ok?.documents[0] ?? {}), false, "only displayed fields are kept");
  assert.equal(parseDocumentPage(page([doc(1, B)]), A), null, "row outside the filter refuses the page");
  assert.equal(parseDocumentPage(page([], true, null), ""), null);
  assert.equal(parseDocumentPage(page([{ id: "x" }]), ""), null);
  assert.deepEqual(parseDocumentPage(page([]), ""), { documents: [], hasMore: false, nextCursor: null });

  const k = documentHistoryKey("u1", "");
  let s = applyDocumentOutcome(initialDocumentHistory(k), k, { kind: "loaded", documents: [doc(5)], hasMore: true, nextCursor: "C1" }, 0);
  s = applyDocumentOutcome(s, k, { kind: "failed", status: 503, retryAfterS: 2 }, 1000);
  assert.equal(s.status, "error");
  assert.equal(s.cursor, "C1", "a failure keeps the cursor");
  assert.equal(s.retryAt, 3000);
  assert.equal(s.pages.length, 1, "what was shown stays");
  assert.equal(applyDocumentOutcome(s, documentHistoryKey("u1", A), { kind: "loaded", documents: [], hasMore: false, nextCursor: null }, 0), s, "another scope never lands here");
  assert.equal(applyDocumentOutcome(s, documentHistoryKey("u2", ""), { kind: "loaded", documents: [], hasMore: false, nextCursor: null }, 0), s, "another identity never lands here");

  const seen: RequestInit[] = [];
  const out = await fetchDocumentPage(async (_u, init) => (seen.push(init), new Response(JSON.stringify(page([])), { status: 200 })), "", null, new AbortController().signal);
  assert.equal(out.kind, "loaded");
  assert.equal(seen[0].credentials, "same-origin");
  assert.equal(seen[0].cache, "no-store");
  const busy = await fetchDocumentPage(async () => new Response("{}", { status: 503, headers: { "retry-after": "2" } }), "", null, new AbortController().signal);
  assert.deepEqual(busy, { kind: "failed", status: 503, retryAfterS: 2 });
  for (const [status, kind] of [[401, "signed_out"], [404, "not_found"], [422, "failed"]] as const)
    assert.equal((await fetchDocumentPage(async () => new Response("{}", { status }), "", null, new AbortController().signal)).kind, kind);
  assert.equal((await fetchDocumentPage(async () => { throw new TypeError("net"); }, "", null, new AbortController().signal)).kind, "failed");
  const ctl = new AbortController();
  ctl.abort();
  assert.equal((await fetchDocumentPage(async () => { throw new DOMException("x", "AbortError"); }, "", null, ctl.signal)).kind, "aborted");
});

test("401 after a partial page: no older-page offer, loaded documents kept, terminal for this key", () => {
  const k = documentHistoryKey("u1", "");
  let s = applyDocumentOutcome(initialDocumentHistory(k), k, { kind: "loaded", documents: [doc(1), doc(2)], hasMore: true, nextCursor: "C1" }, 0);
  assert.equal(offersOlderDocuments(s), true);
  s = applyDocumentOutcome(s, k, { kind: "signed_out" }, 0);
  assert.equal(offersOlderDocuments(s), false);
  assert.equal(s.pages.length, 2);
  assert.equal(offersOlderDocuments(applyDocumentOutcome(s, k, { kind: "failed", status: 503, retryAfterS: 2 }, 0)), false);
});

test("503 Retry-After: the older-page button is disabled until the delay ends, then usable", () => {
  const k = documentHistoryKey("u1", "");
  let s = applyDocumentOutcome(initialDocumentHistory(k), k, { kind: "loaded", documents: [doc(1)], hasMore: true, nextCursor: "C1" }, 0);
  assert.equal(olderDocumentsUsable(s, 0), true);
  assert.equal(olderDocumentsUsable({ ...s, status: "loading" }, 0), false, "not while a read runs");
  s = applyDocumentOutcome(s, k, { kind: "failed", status: 503, retryAfterS: 2 }, 1000);
  assert.equal(offersOlderDocuments(s), true, "still offered (same cursor) …");
  assert.equal(olderDocumentsUsable(s, 2999), false, "… but not usable before Retry-After: no refused click");
  assert.equal(olderDocumentsUsable(s, 3000), true, "usable once the delay is over");
  assert.equal(olderDocumentsUsable(applyDocumentOutcome(s, k, { kind: "signed_out" }, 0), 9e9), false, "a 401 after the error stays terminal");
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM =
  process.env.QA_CHROMIUM_PATH ||
  path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

const APP = `
import { createElement as h, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentManager } from "./components/app/forms";
const kind = new URLSearchParams(location.search).get("case");
const photoReview = kind.startsWith("photo");
const dossier = ${JSON.stringify(A)};
const TOTAL = kind === "empty" ? 0 : 137;
const pad = (n) => String(n).padStart(4, "0");
// Server truth, newest first; pairs share a created_at (tie broken by id DESC).
const all = Array.from({ length: TOTAL }, (_, n) => ({ id: "d-" + pad(n), intervention_id: null, owner_id: "u1", name: "doc " + n + ".pdf", mime_type: "application/pdf", created_at: new Date(Date.UTC(2026, 9, 1, 0, Math.floor(n / 2))).toISOString() }))
  .sort((x, y) => (x.created_at === y.created_at ? (x.id < y.id ? 1 : -1) : x.created_at < y.created_at ? 1 : -1));
window.calls = [];
let n503 = 0;
const fakeFetch = async (url, init) => {
  const u = new URL(url, location.origin);
  const cursor = u.searchParams.get("cursor"), limit = Number(u.searchParams.get("limit"));
  window.calls.push({ cursor, limit, credentials: init.credentials, cache: init.cache, at: Date.now() });
  const late = kind === "switch" && window.calls.length === 1;
  await new Promise((r) => setTimeout(r, late ? 400 : 20)); // the late reply ignores the abort on purpose
  if (kind === "401") return new Response("{}", { status: 401 });
  if (kind === "401late" && cursor) return new Response("{}", { status: 401 });
  if (kind === "404") return new Response("{}", { status: 404 });
  if (photoReview) {
    if (kind === "photo-forbidden" || u.searchParams.get("intervention_id") !== dossier) return new Response("{}", { status: 404 });
    const photos = [{ ...all[0], id: "photo-a", intervention_id: dossier, name: "Tableau.png", mime_type: "image/png" }, { ...all[1], intervention_id: dossier }];
    return Response.json({ documents: photos, page: { limit, has_more: false, next_cursor: null } });
  }
  if (kind === "503" && cursor && n503++ === 0) return new Response("{}", { status: 503, headers: { "retry-after": "2" } });
  const off = cursor ? Number(cursor.split(":")[1]) : 0;
  const rows = (late ? all.map((d) => ({ ...d, id: "late-" + d.id })) : all).slice(off, off + limit);
  const more = off + limit < all.length;
  return new Response(JSON.stringify({ documents: rows, page: { limit, has_more: more, next_cursor: more ? "c:" + (off + limit) : null } }), { status: 200 });
};
const workspace = all.slice(0, 5); // workspace preview duplicated by page 1
let generation = 1;
window.invalidatePhotoSession = () => { generation++; };
window.photoOpen = [];
window.photoDownloads = [];
window.open = (url) => { window.photoOpen.push(url); return null; };
const browserFetch = window.fetch;
window.fetch = async (url, init) => {
  if (!photoReview || !String(url).startsWith("/api/documents?id=")) return browserFetch(url, init);
  window.photoDownloads.push(String(url));
  if (window.photoDownloads.length === 1) return Response.json({ error: "Ce document est introuvable." }, { status: 404 });
  if (window.photoDownloads.length === 3) await new Promise((r) => { window.releasePhoto = r; });
  return Response.json({ url: "https://storage.invalid/photo?token=fixture" });
};
function App() {
  const [profile, setProfile] = useState("u1");
  window.switchIdentity = () => setProfile("u2");
  return h(DocumentManager, { documents: kind === "switch" && profile === "u2" ? [] : workspace, interventions: [], demo: kind === "demo", onRefresh: async () => {}, live: kind !== "demo", profileId: profile, fetchHistory: fakeFetch, ...(photoReview ? { interventionId: dossier, photoReview: { userId: () => profile, generation: () => generation } } : {}) });
}
createRoot(document.getElementById("app")).render(h(App));
`;

test("DocumentManager in Chromium: history, recovery and read-only photos scoped to one dossier", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
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
  type Call = { cursor: string | null; limit: number; credentials: string; cache: string; at: number };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Page = any;
  const open = async (kind: string) => {
    const page: Page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?case=${kind}`);
    return { page, errors };
  };
  const ids = (page: Page): Promise<string[]> => page.$$eval("[data-document-id]", (els: Element[]) => els.map((e) => e.getAttribute("data-document-id") as string));
  const calls = (page: Page): Promise<Call[]> => page.evaluate(() => (window as unknown as { calls: Call[] }).calls);
  const OLDER = "text=Charger les documents plus anciens";
  try {
    {
      const { page, errors } = await open("pages");
      await page.waitForSelector(OLDER);
      assert.equal((await ids(page)).length, 25);
      for (let n = 0; n < 12 && (await page.$(OLDER)); n++) {
        const before = (await calls(page)).length;
        await page.click(OLDER);
        await page.waitForFunction((k: number) => (window as unknown as { calls: Call[] }).calls.length > k && !document.querySelector("[data-document-history=loading]"), before);
      }
      const shown = await ids(page);
      assert.equal(shown.length, 137);
      assert.equal(new Set(shown).size, 137, "never a duplicate");
      assert.deepEqual(shown, [...shown].sort().reverse(), "newest first (created_at DESC, id DESC)");
      const c = await calls(page);
      assert.equal(c.length, 6);
      c.slice(1).forEach((call, i) => assert.equal(call.cursor, `c:${(i + 1) * 25}`));
      assert.ok(c.every((x) => x.limit === 25 && x.credentials === "same-origin" && x.cache === "no-store"));
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("503");
      await page.waitForSelector(OLDER);
      await page.click(OLDER);
      await page.waitForSelector("[data-document-history=error]");
      assert.equal((await ids(page)).length, 25, "shown documents kept");
      assert.equal(await page.$eval("[data-document-history=error] button", (b: HTMLButtonElement) => b.disabled), true, "Retry-After honoured");
      assert.equal(await page.$eval("[data-document-older]", (b: HTMLButtonElement) => b.disabled), true, "older-page button not a dead control during Retry-After");
      await page.waitForFunction(() => !(document.querySelector("[data-document-history=error] button") as HTMLButtonElement).disabled, undefined, { timeout: 4000 });
      assert.equal(await page.$eval("[data-document-older]", (b: HTMLButtonElement) => b.disabled), false, "usable again after the delay");
      await page.click("[data-document-history=error] button");
      await page.waitForFunction(() => document.querySelectorAll("[data-document-id]").length === 50);
      const c = await calls(page);
      assert.deepEqual(c.map((x) => x.cursor), [null, "c:25", "c:25"]);
      assert.ok(c[2].at - c[1].at >= 1900, "retry not before Retry-After");
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("404");
      await page.waitForSelector("[data-document-history=not_found]");
      assert.deepEqual(await ids(page), []);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("401");
      await page.waitForSelector("[data-document-history=signed_out]");
      await page.waitForTimeout(400);
      assert.equal((await calls(page)).length, 1);
      assert.equal(await page.$("text=Réessayer"), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("401late");
      await page.waitForSelector(OLDER);
      await page.click(OLDER);
      await page.waitForSelector("[data-document-history=signed_out]");
      assert.equal(await page.$(OLDER), null, "older-page button removed after the 401");
      assert.equal((await ids(page)).length, 25);
      await page.waitForTimeout(300);
      assert.equal((await calls(page)).length, 2);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("empty");
      await page.waitForSelector("text=Aucune pièce jointe pour le moment.");
      assert.equal(await page.$(OLDER), null);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("switch");
      await page.waitForTimeout(50);
      await page.evaluate(() => (window as unknown as { switchIdentity(): void }).switchIdentity());
      await page.waitForSelector(OLDER);
      await page.waitForTimeout(500); // u1's late reply has arrived by now
      const shown = await ids(page);
      assert.equal(shown.length, 25);
      assert.ok(shown.every((i) => !i.startsWith("late-")), "the previous identity's late reply is ignored");
      assert.deepEqual((await calls(page)).map((x) => x.cursor), [null, null]);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("demo");
      await page.waitForSelector("[data-document-id]");
      await page.waitForTimeout(200);
      assert.equal((await calls(page)).length, 0);
      assert.equal((await ids(page)).length, 5);
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("photos");
      const photo = page.getByRole("button", { name: "Ouvrir la photo Tableau.png" });
      await photo.waitFor();
      assert.deepEqual(await ids(page), ["photo-a"]);
      assert.equal(await page.locator("input[type=file]").count(), 0, "read-only review");
      await photo.click();
      await page.getByRole("alert").filter({ hasText: "Ce document est introuvable." }).waitFor();
      assert.deepEqual(await page.evaluate("window.photoOpen"), []);
      await photo.click();
      await page.waitForFunction("window.photoOpen.length === 1");
      await photo.click();
      await page.waitForFunction("typeof window.releasePhoto === 'function'");
      await page.evaluate("window.invalidatePhotoSession(); window.releasePhoto();");
      await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate("window.photoOpen"), ["https://storage.invalid/photo?token=fixture"]);
      assert.deepEqual(await page.evaluate("window.photoDownloads"), Array(3).fill("/api/documents?id=photo-a"));
      assert.deepEqual(errors, []);
      await page.close();
    }
    {
      const { page, errors } = await open("photo-forbidden");
      await page.waitForSelector("[data-document-history=not_found]");
      assert.deepEqual(await ids(page), []);
      assert.deepEqual(await page.evaluate("window.photoDownloads"), []);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
