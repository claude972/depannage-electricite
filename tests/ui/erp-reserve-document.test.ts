// E67 (UI): optional private document of the SAME site linked to a lifted ERP reserve, mounted in
// Chromium (real React root, StrictMode, real ErpPanel/useSubmit). Only `context.run` and
// window.fetch are injected. Expected: the lift stays possible without a document (no key sent);
// the picker reads GET /api/sites/<site>/documents?state=current lazily, paged (cursor), with
// loading / empty / error + retry; opening goes through the same route ?id=; a failed save (409)
// keeps the choice and resends the identical body; reserve_document_id is sent only when chosen or
// to clear an existing link; a changed finding or date clears the choice; a reply for another
// identity is dropped; another site's piece is never shown.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { erpChecklistPayload } from "../../lib/features/site-operations/schemas";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const SITE = "22222222-2222-4222-8222-222222222222";
const DOC_A = "d0000000-0000-4000-8000-00000000000a";
const DOC_B = "d0000000-0000-4000-8000-00000000000b";
const DOC_X = "d0000000-0000-4000-8000-0000000000ff";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErpPanel } from "./components/features/site-operations/erp-panel";
import { demoReport } from "./lib/features/site-operations/demo";
const w = window;
const SITE = ${JSON.stringify(SITE)};
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = (id, name, site = SITE) => ({ id, site_id: site, name, mime_type: "application/pdf", kind: "compliance", created_at: "2026-09-26T10:00:00.000Z", version: 1, revision: 1, replaces_id: null, replaced_at: null, archived_at: null });
const page = (documents, next = null) => ({ documents, page: { limit: 25, has_more: next !== null, next_cursor: next } });
w.doc = doc; w.page = page;
function report(linked) {
  const r = demoReport();
  const c = r.snapshot.erp_checklists[0];
  if (linked) c.items = [c.items[0], { ...c.items[1], reserve_resolved_on: "2026-09-25", reserve_document_id: linked }];
  return r;
}
function setup({ linked = null, identity = true } = {}) {
  const calls = [], requests = [], replies = [], opened = [];
  let held = null;
  const queue = [];
  w.fetch = async (url) => {
    requests.push(String(url));
    const next = replies.shift() ?? { status: 503, body: { error: "x" } };
    const r = next === "hold" ? await new Promise((res) => { held = res; }) : next;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  };
  w.open = (url) => { opened.push(url); return null; };
  const run = (cmd) => { calls.push(JSON.parse(JSON.stringify(cmd))); return Promise.resolve(queue.shift() ?? { status: "done", result: { action: cmd.action, result: null } }); };
  const ident = { uid: "u1", gen: 1 };
  const makeContext = () => ({ report: report(linked), canWrite: true, canWriteOrganization: true, readOnlyReason: null, busy: false, run,
    interventionSearch: identity ? { context: { generation: () => ident.gen, userId: () => ident.uid } } : undefined });
  const div = document.createElement("div"); document.body.appendChild(div);
  const root = createRoot(div);
  const render = (ctx) => root.render(h(StrictMode, null, h(ErpPanel, { context: ctx })));
  const ctx = makeContext();
  render(ctx);
  const form = () => div.querySelector("form");
  const button = (text) => [...div.querySelectorAll("button")].find((b) => b.textContent.trim() === text);
  const setValue = (el, value) => {
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  };
  const field = (label) => [...form().querySelectorAll("label")].filter((x) => x.textContent.trim() === label).map((x) => document.getElementById(x.htmlFor));
  const picker = () => div.querySelector("[data-reserve-doc='1']");
  const text = () => picker()?.innerText ?? "";
  const release = async (r) => { const f = held; held = null; f?.(r); await tick(200); };
  const rerenderWith = (patch) => { Object.assign(ident, patch); render({ ...ctx }); };
  return { div, calls, requests, replies, queue, opened, form, button, setValue, field, picker, text, release, rerenderWith };
}
const item2 = (body) => body.payload.items.find((i) => i.key === "demo-2");
w.scenarios = {
  async withoutDocument() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    const before = t.text();
    t.setValue(t.field("Réserve levée le")[1], "2026-09-25");
    await tick(100);
    t.form().requestSubmit();
    await tick(250);
    const it = item2(t.calls[0]);
    return { before, hasKey: Object.prototype.hasOwnProperty.call(it, "reserve_document_id"), it, body: t.calls[0], requests: t.requests, open: !!t.form() };
  },
  async chooseConflictRetry() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Réserve levée le")[1], "2026-09-25");
    await tick(100);
    const lazy = t.requests.length;
    t.replies.push("hold");
    t.button("Choisir un document du site").click();
    await tick(100);
    const loading = t.text();
    await t.release({ status: 200, body: page([doc(${JSON.stringify(DOC_A)}, "Plan TGBT")], "c1") });
    const first = t.text();
    t.replies.push({ status: 200, body: page([doc(${JSON.stringify(DOC_B)}, "PV de levée")]) });
    t.button("Afficher plus").click();
    await tick(200);
    const second = t.text();
    t.picker().querySelector("[data-reserve-doc-choice='${DOC_B}']").click();
    await tick(100);
    const chosen = t.text();
    t.queue.push({ status: "failed", message: "Le contrôle a été modifié entre-temps." });
    t.form().requestSubmit();
    await tick(250);
    const afterFail = { open: !!t.form(), text: t.text(), alert: t.div.querySelector("form [role=alert]")?.textContent ?? null };
    t.form().requestSubmit();
    await tick(250);
    return { lazy, loading, first, second, chosen, afterFail, bodies: t.calls, requests: t.requests, open: !!t.form() };
  },
  async existingLink() {
    const t = setup({ linked: ${JSON.stringify(DOC_X)} });
    await tick(150);
    const card = t.div.querySelector("ul[aria-label^='Points de']").innerText;
    t.replies.push({ status: 200, body: { url: "https://storage.example/signed" } });
    t.div.querySelector("[data-reserve-doc-open='${DOC_X}']").click();
    await tick(200);
    t.replies.push({ status: 403, body: { error: "Refusé" } });
    t.div.querySelector("[data-reserve-doc-open='${DOC_X}']").click();
    await tick(200);
    const openAlert = t.div.querySelector("ul[aria-label^='Points de'] [role=alert]")?.textContent ?? null;
    t.button("Modifier").click();
    await tick(150);
    const editing = t.text();
    t.form().requestSubmit(); // unchanged: the existing link is sent as is
    await tick(250);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Réserve levée le")[1], "2026-09-27"); // date changed ⇒ choice cleared
    await tick(100);
    const cleared = t.text();
    t.form().requestSubmit();
    await tick(250);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Constat")[1], "ok"); // finding changed ⇒ link cleared
    await tick(100);
    const pickerAfterOk = !!t.picker();
    t.form().requestSubmit();
    await tick(250);
    return { card, opened: t.opened, openAlert, editing, cleared, pickerAfterOk, items: t.calls.map(item2), requests: t.requests };
  },
  async errorEmptyForeign() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Réserve levée le")[1], "2026-09-25");
    await tick(100);
    t.replies.push({ status: 503, body: { error: "x" } });
    t.button("Choisir un document du site").click();
    await tick(200);
    const error = t.text();
    t.replies.push({ status: 200, body: page([doc(${JSON.stringify(DOC_A)}, "Pièce d’un autre site", "99999999-9999-4999-8999-999999999999")]) });
    t.button("Réessayer").click();
    await tick(200);
    const foreign = t.text();
    t.replies.push({ status: 200, body: page([]) });
    t.button("Réessayer").click();
    await tick(200);
    const emptyText = t.text();
    t.form().requestSubmit();
    await tick(250);
    return { error, foreign, emptyText, body: t.calls[0] };
  },
  async identityChange() {
    const t = setup();
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Réserve levée le")[1], "2026-09-25");
    await tick(100);
    t.replies.push("hold");
    t.button("Choisir un document du site").click();
    await tick(100);
    t.replies.push({ status: 200, body: page([doc(${JSON.stringify(DOC_B)}, "Pièce relue")]) });
    t.rerenderWith({ gen: 2 }); // new identity generation while the first read is pending
    await tick(200);
    await t.release({ status: 200, body: page([doc(${JSON.stringify(DOC_A)}, "Réponse périmée")]) });
    return { text: t.text(), requests: t.requests.length };
  },
  async demoNoIdentity() {
    const t = setup({ identity: false });
    await tick(150);
    t.button("Modifier").click();
    await tick(150);
    t.setValue(t.field("Réserve levée le")[1], "2026-09-25");
    await tick(100);
    return { text: t.text(), chooser: !!t.button("Choisir un document du site"), requests: t.requests };
  },
};
`;

test("E67 · document facultatif de levée de réserve (Chromium, StrictMode, fetch injecté)", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_rq, rs) => {
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
    const list = `/api/sites/${SITE}/documents?state=current`;
    type Item = { key: string; state: string; reserve_resolved_on: string | null; reserve_document_id?: string | null };
    type Body = { payload: { items: Item[] } };

    const wo = (await run("withoutDocument")) as { before: string; hasKey: boolean; it: Item; body: Body; requests: string[]; open: boolean };
    assert.match(wo.before, /Saisissez la date de levée/, "no lift date ⇒ no document offered");
    same([wo.hasKey, wo.it.reserve_resolved_on, wo.open], [false, "2026-09-25", false], "lift without document: saved, key absent");
    assert.ok(erpChecklistPayload.safeParse(wo.body.payload).success, "payload accepted by the existing validator");
    same(wo.requests, [], "nothing is read until the picker is opened");

    const cc = (await run("chooseConflictRetry")) as { lazy: number; loading: string; first: string; second: string; chosen: string; afterFail: { open: boolean; text: string; alert: string | null }; bodies: Body[]; requests: string[]; open: boolean };
    same(cc.lazy, 0);
    assert.match(cc.loading, /Chargement des documents du site/);
    assert.match(cc.first, /Plan TGBT/);
    assert.match(cc.second, /Plan TGBT[\s\S]*PV de levée/, "second page appended");
    assert.match(cc.chosen, /Document lié : PV de levée/);
    assert.equal(cc.afterFail.open, true);
    assert.match(cc.afterFail.text, /Document lié : PV de levée/, "409 ⇒ choice kept");
    assert.match(cc.afterFail.alert ?? "", /modifié entre-temps/);
    same(cc.bodies.length, 2);
    same(cc.bodies[1], cc.bodies[0], "retry sends the identical body");
    same(cc.bodies[0].payload.items.find((i) => i.key === "demo-2")!.reserve_document_id, DOC_B);
    assert.ok(!("reserve_document_id" in cc.bodies[0].payload.items.find((i) => i.key === "demo-1")!), "untouched item: no key");
    same(cc.requests, [list, `${list}&cursor=c1`], "only this site's current pieces, paged");
    same(cc.open, false);

    const el = (await run("existingLink")) as { card: string; opened: string[]; openAlert: string | null; editing: string; cleared: string; pickerAfterOk: boolean; items: Item[]; requests: string[] };
    assert.match(el.card, /Document de levée lié/);
    same(el.opened, ["https://storage.example/signed"], "opened through the signed private URL");
    assert.match(el.openAlert ?? "", /n’a pas pu être ouvert/, "refused opening shown");
    same(el.requests.slice(0, 2), [`/api/sites/${SITE}/documents?id=${DOC_X}`, `/api/sites/${SITE}/documents?id=${DOC_X}`]);
    assert.match(el.editing, /Document lié : Document privé du site/);
    assert.doesNotMatch(el.cleared, /Document lié/, "date changed ⇒ choice cleared");
    same(el.pickerAfterOk, false);
    same(el.items.map((i) => [i.state, i.reserve_document_id]), [["reserve", DOC_X], ["reserve", null], ["ok", null]], "kept link sent; cleared link sent as null");

    const ef = (await run("errorEmptyForeign")) as { error: string; foreign: string; emptyText: string; body: Body };
    assert.match(ef.error, /n’ont pas pu être chargés/);
    assert.doesNotMatch(ef.foreign, /autre site/, "another site's piece is never shown");
    assert.match(ef.foreign, /n’ont pas pu être chargés/);
    assert.match(ef.emptyText, /Aucun document actuel sur ce site/);
    assert.ok(!("reserve_document_id" in ef.body.payload.items.find((i) => i.key === "demo-2")!), "empty list: lift saved without document");

    const ic = (await run("identityChange")) as { text: string; requests: number };
    assert.doesNotMatch(ic.text, /Réponse périmée/, "late reply of the former identity dropped");
    assert.match(ic.text, /Pièce relue/, "re-read for the new identity");
    same(ic.requests, 2);

    const dm = (await run("demoNoIdentity")) as { text: string; chooser: boolean; requests: string[] };
    same([dm.chooser, dm.requests], [false, []], "no identity ⇒ nothing read, no chooser");
    same(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
