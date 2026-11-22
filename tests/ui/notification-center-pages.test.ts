import { fileURLToPath as localSourcePath } from "node:url";
// Notification centre MOUNTED in Chromium (real React root, <StrictMode>, fake client with held
// replies): a « Toutes » continuation held by the network is dropped after switching to « Non lues »
// (rows, cursor, loading, error), one continuation in flight, reload fence, and a confirmed mark
// applied to the CURRENT rows. The fake server refuses a cursor of the other filter (like the 422).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(localSourcePath(import.meta.url)), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NotificationCenter } from "./components/features/notifications/notification-center";
const w = window;
// Wait at least ms, then until React has stopped committing (no DOM mutation for 60 ms, cap 4 s):
// fixed sleeps alone failed under full-suite CPU load. Held replies never resolve on their own,
// so in-flight states stay observable.
const tick = (ms) => new Promise((done) => setTimeout(() => {
  let last = performance.now();
  const seen = new MutationObserver(() => { last = performance.now(); });
  seen.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  const end = last + 4000;
  const poll = () => { const now = performance.now(); if (now - last >= 60 || now >= end) { seen.disconnect(); done(); } else setTimeout(poll, 20); };
  setTimeout(poll, 20);
}, ms));
const AT = "2026-11-07T10:00:00.000Z";
// 60 rows, newest first; even index unread. « Toutes »: 25 + 25 + 10. « Non lues »: 25 + 5.
const ROWS = Array.from({ length: 60 }, (_, i) => ({ id: "n" + String(i + 1).padStart(2, "0"), kind: "quote_received", title: "Notif " + (i + 1), body: "Corps " + (i + 1), intervention_id: null, organization_id: null, site_id: null, payload: {}, read_at: i % 2 === 0 ? null : AT, created_at: new Date(Date.parse(AT) - i * 60000).toISOString() }));
function setup() {
  const calls = { list: [], mark: [], refused: [] };
  const hold = {}, waiting = {}, lie = {};
  const read = new Set(), unreadAgain = new Set();
  const isUnread = (n) => (read.has(n.id) ? false : unreadAgain.has(n.id) ? true : !n.read_at);
  const answer = (unread, cursor) => {
    const name = unread ? "unread" : "all";
    if (cursor && cursor.split(":")[0] !== name) { calls.refused.push(cursor); throw new Error("422 : curseur d’un autre filtre."); }
    const rows = ROWS.map((n) => ({ ...n, read_at: isUnread(n) ? null : n.read_at ?? AT })).filter((n) => !unread || !n.read_at);
    const start = cursor ? Number(cursor.split(":")[1]) : 0;
    const page = rows.slice(start, start + 25);
    const more = start + 25 < rows.length;
    return { notifications: page, page: { limit: 25, total: rows.length, has_more: more, next_cursor: more ? name + ":" + (start + 25) : null }, unread_count: ROWS.filter(isUnread).length, filters: { unread } };
  };
  const served = (unread, cursor) => { const a = answer(unread, cursor); const key = (unread ? "unread" : "all") + "|" + (cursor ?? ""); return lie[key] ? { ...a, filters: { unread: !unread } } : a; };
  // A hold applies to the NEXT call of that key only. A list reply is computed when the server
  // receives the GET (its data predates later marks); a mark receipt when it is released.
  const gate = (key, make, atCall) => {
    if (!hold[key]) return Promise.resolve().then(make);
    delete hold[key];
    let snap = null;
    if (atCall) { try { snap = { v: make() }; } catch (e) { snap = { e }; } }
    return new Promise((resolve, reject) => { waiting[key] = { resolve: () => { try { if (snap) { if (snap.e) throw snap.e; resolve(snap.v); } else resolve(make()); } catch (e) { reject(e); } }, reject }; });
  };
  const release = async (key, failure) => { delete hold[key]; const p = waiting[key]; delete waiting[key]; if (p) { if (failure) p.reject(new Error(failure)); else p.resolve(); } await tick(200); return !!p; };
  const client = {
    list: (q) => { const key = (q.unread ? "unread" : "all") + "|" + (q.cursor ?? ""); calls.list.push(key); return gate(key, () => served(q.unread, q.cursor), true); },
    summary: async () => null,
    mark: (cmd) => { calls.mark.push(cmd); return gate("mark", () => { if (cmd.action === "mark_unread") { for (const id of cmd.ids) read.delete(id); ROWS.forEach((n) => { if (cmd.ids.includes(n.id)) unreadAgain.add(n.id); }); } else for (const id of cmd.ids ?? ROWS.map((n) => n.id)) { read.add(id); unreadAgain.delete(id); } return { ok: true, result: { updated: (cmd.ids ?? []).length, unread_count: ROWS.filter(isUnread).length } }; }); },
    loadPreferences: async () => null,
    savePreferences: async () => null,
  };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h(NotificationCenter, { state: "available", unavailableMessage: "", scope: { userId: "u1", role: "client", authority: { canWrite: true } }, client, context: { generation: () => 0, userId: () => "u1" } })));
  const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith(text));
  const press = async (text, wait = 150) => { const b = button(text); if (b && !b.disabled) b.click(); await tick(wait); return !!b; };
  const rows = () => [...div.querySelectorAll("article")].map((a) => ({ label: a.getAttribute("aria-label"), unread: /non lue$/.test(a.getAttribute("aria-label")) }));
  const more = () => { const b = div.querySelector("[class*=more] button"); return b ? { text: b.textContent, disabled: b.disabled } : null; };
  const view = () => ({ rows: rows().length, readRows: rows().filter((r) => !r.unread).length, loader: /Chargement des notifications/.test(div.textContent), alerts: [...div.querySelectorAll("[role=alert]")].map((e) => e.textContent), more: more() });
  const count = (key) => calls.list.filter((k) => k === key).length;
  return { div, calls, hold, lie, release, press, button, view, count, rows };
}
w.scenarios = {
  async repro() {
    const t = setup();
    await tick(250);
    const first = t.view();
    t.hold["all|all:25"] = true;
    await t.press("Afficher les suivantes", 50);
    await t.press("Non lues", 250);
    const unreadPage = t.view();
    const released = await t.release("all|all:25");
    const afterLate = t.view();
    await t.press("Afficher les suivantes", 250);
    return { first, unreadPage, released, afterLate, next: t.view(), list: t.calls.list.filter((k) => k.includes(":")), refused: t.calls.refused };
  },
  async doubleClick() {
    const t = setup();
    await tick(250);
    const b = t.button("Afficher les suivantes");
    b.click(); b.click();
    await tick(250);
    return { reads: t.count("all|all:25"), view: t.view() };
  },
  async lateFailure() {
    const t = setup();
    await tick(250);
    t.hold["all|all:25"] = true;
    await t.press("Afficher les suivantes", 50);
    t.hold["unread|"] = true;
    await t.press("Non lues", 100);
    await t.release("all|all:25", "Le serveur ne répond pas.");
    const whileFirst = t.view();
    await t.release("unread|");
    // Then an older « Toutes » continuation fails late while the « Non lues » one is in flight.
    await t.press("Toutes", 250);
    t.hold["all|all:25"] = true;
    await t.press("Afficher les suivantes", 50);
    await t.press("Non lues", 250);
    t.hold["unread|unread:25"] = true;
    await t.press("Afficher les suivantes", 50);
    const ownMore = t.view().more;
    await t.release("all|all:25", "Ancienne erreur.");
    const whileOwnMore = t.view();
    await t.release("unread|unread:25");
    return { whileFirst, ownMore, whileOwnMore, final: t.view() };
  },
  async markAfterChange() {
    const t = setup();
    await tick(250);
    t.hold.mark = true;
    await t.press("Marquer comme lue", 50);
    await t.press("Afficher les suivantes", 250);
    const before = t.view();
    await t.release("mark");
    await tick(100);
    const after = t.view();
    const first = t.rows()[0];
    return { before, after, first, marks: t.calls.mark.length };
  },
  async firstRender() {
    // Every commit from the click on is recorded (MutationObserver), the new page 1 being held:
    // the old rows must never be rendered under the new filter / after the reload.
    const t = setup();
    await tick(250);
    const watch = () => {
      const seen = [];
      const o = new MutationObserver(() => seen.push({ rows: t.div.querySelectorAll("article").length, more: !!t.div.querySelector("[class*=more] button") }));
      o.observe(t.div, { childList: true, subtree: true, attributes: true, characterData: true });
      return () => { o.disconnect(); return seen; };
    };
    t.hold["unread|"] = true;
    let stop = watch();
    t.button("Non lues").click();
    await tick(100);
    const filter = { commits: stop(), view: t.view() };
    await t.release("unread|");
    t.hold["unread|"] = true;
    stop = watch();
    t.div.querySelector('[aria-label="Recharger les notifications"]').click();
    await tick(100);
    const reload = { commits: stop(), view: t.view() };
    await t.release("unread|");
    return { filter, reload, after: t.view() };
  },
  async mismatch() {
    const t = setup();
    t.lie["all|"] = true;
    await tick(250);
    const head = t.view();
    delete t.lie["all|"];
    await t.press("Réessayer", 250);
    const retried = t.view();
    t.lie["all|all:25"] = true;
    await t.press("Afficher les suivantes", 250);
    const more = t.view();
    delete t.lie["all|all:25"];
    await t.press("Afficher les suivantes", 250);
    return { head, retried, more, next: t.view(), cursors: t.calls.list.filter((k) => k.includes(":")) };
  },
  async markAll() {
    const t = setup();
    await tick(250);
    t.hold["all|all:25"] = true;
    await t.press("Afficher les suivantes", 50);
    const heads = t.count("all|");
    await t.press("Tout marquer lu", 300);
    const reread = t.count("all|") - heads;
    const released = await t.release("all|all:25");
    return { reread, released, view: t.view(), marks: t.calls.mark.map((m) => m.action) };
  },
  async markLock() {
    // Bulk receipt held; a single mark (or a second bulk) must send no POST until it lands.
    const t = setup();
    await tick(250);
    t.hold.mark = true;
    await t.press("Tout marquer lu", 100);
    const singles = [...t.div.querySelectorAll("article button")].filter((b) => /Marquer comme/.test(b.textContent));
    const locked = { disabled: singles.every((b) => b.disabled), bulk: t.button("Marquage…")?.disabled ?? null, waiting: [...t.div.querySelectorAll("button")].filter((b) => b.textContent.includes("Marquage")).length };
    singles[1].disabled = false; singles[1].click(); // even a forced click is refused by the lock
    await tick(100);
    const postsWhileHeld = t.calls.mark.length;
    await t.release("mark");
    await tick(200);
    const afterReceipt = { posts: t.calls.mark.length, enabled: [...t.div.querySelectorAll("article button")].filter((b) => /Marquer comme/.test(b.textContent)).some((b) => !b.disabled) };
    await t.press("Marquer comme non lue", 250);
    return { locked, postsWhileHeld, afterReceipt, posts: t.calls.mark.map((m) => m.action), view: t.view() };
  },
  async causalHead() {
    const t = setup();
    await tick(250);
    const counter = () => { const x = t.button("Non lues")?.textContent ?? ""; return x.includes("(") ? x.split("(")[1].split(")")[0] : null; };
    // Single mark with no read in flight: applied locally, no page-1 re-read.
    const heads0 = t.count("all|");
    await t.press("Marquer comme lue", 250);
    const single = { reread: t.count("all|") - heads0, counter: counter(), rows: t.view().rows };
    // Bulk mark: its causal head GET is held; a single mark is then confirmed first.
    t.hold["all|"] = true;
    await t.press("Tout marquer lu", 250);
    const heads1 = t.count("all|");
    await t.press("Marquer comme non lue", 250);
    const fresh = t.count("all|") - heads1;
    const beforeLate = { counter: counter(), first: t.rows()[0] };
    const released = await t.release("all|");
    await tick(150);
    return { single, fresh, beforeLate, released, counter: counter(), first: t.rows()[0], unreadRows: t.rows().filter((r) => r.unread).length, rows: t.view().rows, marks: t.calls.mark.map((m) => m.action) };
  },
  async reloadFence() {
    const t = setup();
    await tick(250);
    t.hold["all|all:25"] = true;
    await t.press("Afficher les suivantes", 50);
    const reload = t.div.querySelector('[aria-label="Recharger les notifications"]');
    reload.click();
    await tick(250);
    const reloaded = t.view();
    await t.release("all|all:25");
    const afterLate = t.view();
    await t.press("Afficher les suivantes", 250);
    return { reloaded, afterLate, next: t.view(), reads: t.count("all|all:25"), refused: t.calls.refused };
  },
};
`;

test("centre de notifications monté (Chromium, StrictMode) : la suite du bon filtre, clôtures des réponses tardives, marquage sur la liste courante", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => {
    if (rq.url !== "/") requests.push(String(rq.url));
    rs.setHeader("content-type", "text/html");
    rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2" id="app"></div><script>${js}</script>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const run = (name: string) => page.evaluate((n: string) => (window as unknown as { scenarios: Record<string, () => Promise<unknown>> }).scenarios[n](), name);
    type View = { rows: number; readRows: number; loader: boolean; alerts: string[]; more: { text: string; disabled: boolean } | null };

    const r = (await run("repro")) as { first: View; unreadPage: View; released: boolean; afterLate: View; next: View; list: string[]; refused: string[] };
    same([r.first.rows, r.first.readRows], [25, 12], "« Toutes » page 1 mixes read and unread rows");
    same([r.unreadPage.rows, r.unreadPage.readRows], [25, 0], "« Non lues » page 1");
    same([r.released, r.afterLate.rows, r.afterLate.readRows, r.afterLate.alerts, r.afterLate.more], [true, 25, 0, [], { text: "Afficher les suivantes", disabled: false }], "the late « Toutes » page 2 touches nothing");
    same([r.next.rows, r.next.readRows, r.refused], [30, 0, []], "the next GET uses the « Non lues » cursor (no 422)");
    same(r.list, ["all|all:25", "unread|unread:25"], "cursors sent, in order");

    const d = (await run("doubleClick")) as { reads: number; view: View };
    same([d.reads, d.view.rows], [1, 50], "double click ⇒ one GET, no duplicated row");

    const f = (await run("lateFailure")) as { whileFirst: View; ownMore: { text: string; disabled: boolean } | null; whileOwnMore: View; final: View };
    same([f.whileFirst.loader, f.whileFirst.alerts, f.whileFirst.rows], [true, [], 0], "a late failure of « Toutes » neither ends the « Non lues » loading nor shows its error");
    same(f.ownMore, { text: "Chargement…", disabled: true }, "the « Non lues » continuation is in flight");
    same([f.whileOwnMore.more, f.whileOwnMore.alerts], [{ text: "Chargement…", disabled: true }, []], "a late catch / finally does not clear the new filter's loading");
    same([f.final.rows, f.final.readRows, f.final.alerts], [30, 0, []], "the « Non lues » continuation lands");

    const m = (await run("markAfterChange")) as { before: View; after: View; first: { label: string; unread: boolean }; marks: number };
    same([m.before.rows, m.after.rows, m.first.unread, m.marks, m.after.alerts], [50, 50, false, 1, []], "a mark confirmed after page 2 applies to the current 50 rows; the old 25-row list is not restored");

    const l = (await run("reloadFence")) as { reloaded: View; afterLate: View; next: View; reads: number; refused: string[] };
    same([l.reloaded.rows, l.afterLate.rows, l.afterLate.more, l.next.rows, l.reads, l.refused], [25, 25, { text: "Afficher les suivantes", disabled: false }, 50, 2, []], "reload fences the pending page; the next continuation is read again once");
    type C = { commits: { rows: number; more: boolean }[]; view: View };
    const fr = (await run("firstRender")) as { filter: C; reload: C; after: View };
    for (const [name, c] of [["filter", fr.filter], ["reload", fr.reload]] as const) {
      assert.ok(c.commits.length > 0, name + ": commits observed");
      same(c.commits.filter((x) => x.rows > 0 || x.more), [], name + " click ⇒ no old row nor cursor in any commit");
      same([c.view.rows, c.view.more, c.view.loader], [0, null, true], name + ": loading, page 1 held");
    }
    same([fr.after.rows, fr.after.readRows], [25, 0], "then the fresh page 1");

    const mm = (await run("mismatch")) as { head: View; retried: View; more: View; next: View; cursors: string[] };
    same([mm.head.rows, mm.head.alerts.length, mm.head.more], [0, 1, null], "page 1 for another filter ⇒ rejected, no rows, no cursor");
    same(mm.retried.rows, 25, "Réessayer reads a valid page 1");
    same([mm.more.rows, mm.more.alerts.length], [25, 1], "continuation for another filter ⇒ rejected, nothing appended");
    same([mm.next.rows, mm.cursors], [50, ["all|all:25", "all|all:25"]], "the valid cursor was kept, not the rejected reply's");

    const ma = (await run("markAll")) as { reread: number; released: boolean; view: View; marks: string[] };
    same([ma.marks, ma.reread, ma.released, ma.view.rows, ma.view.readRows], [["mark_all_read"], 1, true, 25, 25], "mark-all during a held page ⇒ head re-read, the late page is dropped");
    const lk = (await run("markLock")) as { locked: { disabled: boolean; bulk: boolean | null; waiting: number }; postsWhileHeld: number; afterReceipt: { posts: number; enabled: boolean }; posts: string[]; view: View };
    same(lk.locked, { disabled: true, bulk: true, waiting: 1 }, "every mark button disabled, waiting label only on the running bulk");
    same(lk.postsWhileHeld, 1, "a second mark while the first receipt is held sends no POST");
    same([lk.afterReceipt, lk.posts], [{ posts: 1, enabled: true }, ["mark_all_read", "mark_unread"]], "after the receipt, the next action is possible again");
    type CH = { single: { reread: number; counter: string | null; rows: number }; fresh: number; beforeLate: { counter: string | null; first: { unread: boolean } }; released: boolean; counter: string | null; first: { label: string; unread: boolean }; unreadRows: number; rows: number; marks: string[] };
    const ch = (await run("causalHead")) as CH;
    same(ch.single, { reread: 0, counter: "29", rows: 25 }, "single mark, no read in flight ⇒ applied locally, no page-1 re-read");
    same([ch.marks, ch.fresh], [["mark_read", "mark_all_read", "mark_unread"], 1], "a single mark confirmed while the post-bulk head GET is held ⇒ one fresh causal head GET");
    same([ch.released, ch.counter, ch.first.unread, ch.unreadRows, ch.rows], [true, "1", true, 1, 25], "the old GET is ignored: counter 1, the re-marked row stays unread");
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});
