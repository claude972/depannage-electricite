// Mounted test (real React root, StrictMode, local Chromium) of the explicit operator relink of a paid
// platform Checkout: « Relancer le rattachement (lectures Stripe)… » in Finance › Preuves
// (CheckoutRelinkSection, migration 20261119120000). Proves: nothing without write rights; nothing sent
// before the confirmation; exactly one POST (synchronous guard, even on a double confirmation); the
// receipt is shown only when it matches the payment AND the command; 503 / lost answer ⇒ the SAME
// command id on retry; 401/403 or a refusal ⇒ a new id next time; a late answer is never shown after a
// change of user, session generation (even without re-render) or payment, and the request is aborted.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const skip = available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const USER = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const PAY = "50000000-0000-4000-8000-000000000001";
const PAY2 = "50000000-0000-4000-8000-000000000002";

const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { CheckoutRelinkSection, FinanceProofsTab } from "./components/features/finance-proofs/proofs-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
// Controllable fetcher: each POST is recorded and waits for an explicit answer (or an abort).
w.posts = []; w.pending = [];
const fetcher = (url, init) => new Promise((resolve, reject) => {
  const entry = { url, body: JSON.parse(init.body), aborted: false, resolve, reject };
  w.posts.push(entry); w.pending.push(entry);
  init.signal.addEventListener("abort", () => { entry.aborted = true; reject(new DOMException("aborted", "AbortError")); });
});
const reply = (status, body) => { const e = w.pending.shift(); e.resolve(new Response(body === undefined ? "" : JSON.stringify(body), { status })); return tick(80); };
const lose = () => { const e = w.pending.shift(); e.reject(new TypeError("network")); return tick(80); };
const receipt = (cmd, over = {}) => ({ payment_id: "${PAY}", state: "linked", review_reason: null, commission: "recorded", rematched: ["evt_1A", "evt_3B"], command_id: cmd, ...over });
w.ids = 0;
const newId = () => "c0000000-0000-4000-8000-" + String(++w.ids).padStart(12, "0");
let ident = { uid: "${USER}", gen: 0 };
const ctx = { userId: () => ident.uid, generation: () => ident.gen };
let root, host, props;
const mount = (p) => {
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  props = { paymentId: "${PAY}", canWrite: true, context: ctx, relinkFetcher: fetcher, newId, ...p };
  flushSync(() => root.render(h(StrictMode, null, h(CheckoutRelinkSection, props))));
};
const rerender = (p) => { props = { ...props, ...p }; flushSync(() => root.render(h(StrictMode, null, h(CheckoutRelinkSection, props)))); };
const reset = () => { root && root.unmount(); host && host.remove(); w.posts = []; w.pending = []; w.ids = 0; ident = { uid: "${USER}", gen: 0 }; };
const q = (s) => host.querySelector(s);
const open = async () => { q("[data-checkout-relink-open]").click(); await tick(30); };
const confirm = async () => { q("[data-checkout-relink-confirm]").click(); await tick(30); };
const view = () => ({ result: q("[data-checkout-relink-result]")?.getAttribute("data-checkout-relink-result") ?? null, text: q("[data-checkout-relink]")?.textContent ?? "", alert: q("[role=alert]")?.textContent ?? null, busy: q("[data-checkout-relink]")?.getAttribute("aria-busy") ?? null, openDisabled: q("[data-checkout-relink-open]")?.disabled ?? null });

w.scenarios = {
  async readOnly() {
    reset(); mount({ canWrite: false }); await tick(50);
    return { section: !!q("[data-checkout-relink]"), posts: w.posts.length };
  },
  async success() {
    reset(); mount(); await tick(50);
    const before = view();
    await open();
    const confirmShown = !!q("[data-checkout-relink-confirm]"), postsBeforeConfirm = w.posts.length;
    // Double confirmation in the same frame: the synchronous ref lets only one request through.
    const btn = q("[data-checkout-relink-confirm]"); btn.click(); btn.click(); await tick(30);
    const during = view();
    const sent = w.posts.map((p) => ({ url: p.url, body: p.body }));
    await reply(200, receipt(sent[0].body.command_id));
    return { before, confirmShown, postsBeforeConfirm, during, sent, after: view() };
  },
  async retrySame() {
    reset(); mount(); await tick(50);
    await open(); await confirm(); await reply(503, { error: "x" });
    const after503 = view();
    await open(); await confirm(); await lose();
    const afterLost = view();
    await open(); await confirm();
    const ids = w.posts.map((p) => p.body.command_id);
    await reply(200, receipt(ids[2]));
    return { after503, afterLost, ids, final: view() };
  },
  async refusals() {
    reset(); mount(); await tick(50);
    await open(); await confirm(); await reply(403, { error: "Droits finance insuffisants." });
    const forbidden = view();
    await open(); await confirm(); await reply(409, { error: "Le rapprochement n’est pas complet. Réessayez ; si le problème persiste, examinez les références Stripe." });
    const conflict = view();
    await open(); await confirm();
    const ids = w.posts.map((p) => p.body.command_id);
    // Receipt for another payment, then for another command: never shown, same command kept.
    await reply(200, receipt(ids[2], { payment_id: "${PAY2}" }));
    const wrongPayment = view();
    await open(); await confirm();
    await reply(200, receipt("c0000000-0000-4000-8000-0000000000ff"));
    const wrongCommand = view();
    return { forbidden, conflict, wrongPayment, wrongCommand, ids: w.posts.map((p) => p.body.command_id) };
  },
  async lateAfterUser() {
    reset(); mount(); await tick(50);
    await open(); await confirm();
    const first = w.posts[0];
    ident = { uid: "${OTHER}", gen: 0 }; rerender({}); await tick(30);
    const aborted = first.aborted;
    const e = w.pending.shift(); e.resolve(new Response(JSON.stringify(receipt(first.body.command_id)), { status: 200 })); await tick(80);
    return { aborted, after: view(), canStart: !!q("[data-checkout-relink-open]") && !q("[data-checkout-relink-open]").disabled };
  },
  async lateAfterGenerationNoRender() {
    reset(); mount(); await tick(50);
    await open(); await confirm();
    const first = w.posts[0];
    // The session generation changes with NO re-render: the live identity is re-read on the answer.
    ident = { uid: "${USER}", gen: 1 };
    await reply(200, receipt(first.body.command_id));
    const hidden = view();
    ident = { uid: "${USER}", gen: 0 }; rerender({}); await tick(30);
    return { hidden, backToOld: view() };
  },
  async lateAfterPayment() {
    reset(); mount(); await tick(50);
    await open(); await confirm();
    const first = w.posts[0];
    rerender({ paymentId: "${PAY2}" }); await tick(30);
    const aborted = first.aborted;
    await open(); await confirm();
    const second = w.posts[1];
    first.resolve(new Response(JSON.stringify(receipt(first.body.command_id)), { status: 200 })); await tick(80);
    const afterLate = view();
    w.pending = w.pending.filter((p) => p !== first);
    await reply(200, receipt(second.body.command_id, { payment_id: "${PAY2}", commission: "existing", rematched: [] }));
    return { aborted, afterLate, distinct: first.body.command_id !== second.body.command_id, url2: second.url, final: view() };
  },
  async inTab() {
    reset();
    host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
    const api = { read: async () => ({ status: 200, body: { proof: null, dispute_observations: [], next_after: null } }), qualify: async () => ({ status: 503, body: null }) };
    const map = new Map();
    const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
    flushSync(() => root.render(h(StrictMode, null, h(FinanceProofsTab, { demo: false, canRead: true, canWrite: true, context: ctx, api, store, newId, relinkFetcher: fetcher }))));
    await tick(50);
    const hiddenBefore = !q("[data-checkout-relink]");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const el = q("[data-proofs-payment]"); setter.call(el, "${PAY.toUpperCase()}"); el.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(30); q("[data-proofs-open]").click(); await tick(200);
    return { hiddenBefore, shown: !!q("[data-checkout-relink]"), posts: w.posts.length };
  },
};
`;

async function serve() {
  const b = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = b.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + b.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
  const server: Server = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><body class="ui-v2"><script>${js}</script></body>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}/` };
}
type View = { result: string | null; text: string; alert: string | null; busy: string | null; openDisabled: boolean | null };
const NOT_CONFIRMED = /Le rattachement n’est pas confirmé\. Réessayez : la même commande sera renvoyée\./;

test("bouton de rattachement monté (Chromium, StrictMode) : confirmation, 1 seul POST, reçu exact, même commande après 503/perte, nouvelle après refus, réponses tardives jamais affichées", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(base);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const run = (name: string) => page.evaluate((n: string) => (window as any).scenarios[n](), name);

    const ro = await run("readOnly");
    assert.deepEqual(ro, { section: false, posts: 0 }, "no write right: no button, no call");

    const s = await run("success");
    assert.equal(s.before.openDisabled, false);
    assert.equal(s.confirmShown, true);
    assert.equal(s.postsBeforeConfirm, 0, "nothing sent before the confirmation");
    assert.equal(s.sent.length, 1, "double confirmation ⇒ exactly one POST");
    assert.equal(s.sent[0].url, `/api/platform-operations/payments/${PAY}/checkout-link`);
    assert.deepEqual(Object.keys(s.sent[0].body), ["command_id"]);
    assert.equal(s.during.busy, "true");
    assert.equal(s.during.openDisabled, true);
    assert.match(s.during.text, /Rattachement en cours…/);
    assert.equal(s.after.result, "linked");
    assert.match(s.after.text, /Rattaché : transfert et commission relus chez Stripe[\s\S]*commission inscrite au registre ; observations réassociées : 2\./);
    assert.match(s.after.text, /Lectures seulement : aucun paiement, transfert, remboursement ni facture\./);
    assert.equal(s.after.busy, null);
    assert.equal(s.after.alert, null);

    const r = await run("retrySame");
    assert.match(r.after503.alert ?? "", NOT_CONFIRMED);
    assert.match(r.afterLost.alert ?? "", NOT_CONFIRMED);
    assert.equal(new Set(r.ids).size, 1, "503 then lost answer ⇒ the same command id is sent again");
    assert.equal(r.final.result, "linked");

    const f = await run("refusals");
    assert.equal(f.forbidden.alert, "Accès refusé par le serveur : droits finance en lecture et en écriture requis.");
    assert.equal(f.forbidden.result, null);
    assert.match(f.conflict.alert ?? "", /Le rapprochement n’est pas complet\. Réessayez ; si le problème persiste, examinez les références Stripe\./);
    assert.equal(f.wrongPayment.result, null, "receipt for another payment never shown");
    assert.match(f.wrongPayment.alert ?? "", NOT_CONFIRMED);
    assert.equal(f.wrongCommand.result, null, "receipt for another command never shown");
    const [a, b, c, d] = f.ids as string[];
    assert.ok(a !== b && b !== c, "after 403 and after a refusal, a new command id");
    assert.equal(c, d, "an unverifiable receipt keeps the same command for the retry");

    const u = await run("lateAfterUser");
    assert.equal(u.aborted, true, "user change aborts the request");
    assert.equal((u.after as View).result, null);
    assert.equal((u.after as View).alert, null);
    assert.equal((u.after as View).busy, null);
    assert.equal(u.canStart, true);

    const g = await run("lateAfterGenerationNoRender");
    assert.equal((g.hidden as View).result, null, "generation changed without re-render: answer dropped");
    assert.equal((g.backToOld as View).result, null);

    const p = await run("lateAfterPayment");
    assert.equal(p.aborted, true, "payment change aborts the request");
    assert.equal((p.afterLate as View).result, null, "late answer of the first payment never shown");
    assert.equal(p.distinct, true);
    assert.equal(p.url2, `/api/platform-operations/payments/${PAY2}/checkout-link`);
    assert.equal((p.final as View).result, "linked");
    assert.match((p.final as View).text, /commission déjà inscrite \(aucun doublon\) ; observations réassociées : 0\./);

    const t = await run("inTab");
    assert.deepEqual(t, { hiddenBefore: true, shown: true, posts: 0 }, "Finance › Preuves shows the section for a valid id, nothing sent");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});

test("bouton de rattachement monté : 360 px clair/sombre, cibles ≥ 44 px, aucun débordement, confirmation lisible", { skip }, async () => {
  const { server, base } = await serve();
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true });
  try {
    for (const theme of ["light", "dark"]) {
      const page = await (await browser.newContext({ viewport: { width: 360, height: 800 }, colorScheme: theme })).newPage();
      await page.goto(base);
      await page.evaluate((t: string) => document.documentElement.setAttribute("data-ui-theme", t), theme);
      // Real clicks through Playwright on the real « Preuves » tab.
      await page.evaluate(`window.scenarios.inTab()`);
      await page.getByRole("button", { name: "Relancer le rattachement (lectures Stripe)…" }).click();
      const group = page.getByRole("group", { name: "Confirmer le rattachement" });
      assert.match(await group.innerText(), /Une reprise ou un remboursement constaté laisse la situation « à examiner »/);
      const layout = (await page.evaluate(`(() => ({ sw: document.documentElement.scrollWidth, small: [...document.querySelectorAll("[data-checkout-relink] button")].filter((e) => { const r = e.getBoundingClientRect(); return r.height > 0 && (r.height < 43.5 || r.width < 43.5); }).map((e) => e.textContent.trim()) }))()`)) as { sw: number; small: string[] };
      assert.equal(layout.sw, 360, theme);
      assert.deepEqual(layout.small, [], theme);
      await page.getByRole("button", { name: "Lancer le rattachement" }).click();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = await page.evaluate(() => (window as any).posts.length);
      assert.equal(count, 1, theme);
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
