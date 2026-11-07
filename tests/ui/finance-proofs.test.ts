// FIN-06 finance proofs UI. Real model/controller (fake api) + Chromium mounts of the real panels
// (« Preuves » tab and payout proof section) + real app demo of the platform finance tab.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadModule } from "../documents/harness";
import { withApp, skip as appSkip } from "./real-app-harness";
import type * as Model from "../../components/features/finance-proofs/model";

const m = loadModule("components/features/finance-proofs/model.ts") as unknown as typeof Model;
const priv = loadModule("components/app/private-storage.ts") as { PRIVATE_STORAGE_PREFIXES: readonly string[] };
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const USER = "10000000-0000-4000-8000-000000000001";
const PAY = "50000000-0000-4000-8000-000000000001";
const U = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CID = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const res = (status: number, body: unknown = null) => ({ status, body });
const source = { payment_id: PAY, checkout_id: U(1), quote_id: U(2), intervention_id: U(3), session_id: "cs_test_1", amount_cents: 12000, fee_cents: 1200, destination_account: "acct_1", currency: "eur", paid_at: "2026-11-01T10:00:00Z" };
const proof = { payment_intent_id: "pi_1", charge_id: "ch_1", charge_created: 1_793_000_000, session_created: 1_792_999_000, intent_created: 1_792_999_500, payment_id: PAY, live: false, source, verified_at: "2026-11-02T10:00:00Z" };
const obs = (n: number, over: Record<string, unknown> = {}) => ({ event_id: `evt_${String(n).padStart(4, "0")}`, observation_version: 1, dispute_id: "du_1", observed_status: "needs_response", disputed_amount_cents: 5000, currency: "eur", observed_at: "2026-11-03T10:00:00Z", ...over });
const chargePage = (over: Record<string, unknown> = {}) => ({ proof, dispute_observations: [obs(1)], next_after: null, ...over });
const feeQ = (over: Record<string, unknown> = {}) => ({ event_id: "evt_fee1", payment_id: PAY, source: { payment_id: PAY, event_id: "evt_fee1", live: false, fee_id: "fee_1", charge_id: "ch_1", connected_charge_id: "ch_conn", destination_account: "acct_1", amount_cents: 1200, currency: "eur", observation_fingerprint: "a".repeat(64), observation_created: "2026-11-02T10:00:00Z" }, provider_amount_refunded_cents: 0, provider_refunded: false, fee_created: 1_793_000_100, provider_observed_at: "2026-11-04T10:00:00Z", qualified_at: "2026-11-04T10:00:01Z", ...over });
const line = (id: string, over: Record<string, unknown> = {}) => ({ id, amount_cents: 1100, fee_cents: 100, net_cents: 1000, currency: "eur", type: "payment", source_id: "py_1", created: 1_793_000_000, available_on: 1_793_100_000, status: "available", allocation: "unallocated", ...over });
const payoutQ = (over: Record<string, unknown> = {}) => ({
  event_id: "evt_po1",
  source: { event_id: "evt_po1", account_id: "acct_9", artisan_id: U(9), payout_id: "po_1", live: false, amount_cents: 1000, currency: "eur", observation_fingerprint: "b".repeat(64), observation_created: "2026-11-05T10:00:00Z" },
  proof: { payout_id: "po_1", live: false, currency: "eur", amount_cents: 1000, status: "paid", automatic: true, reconciliation_status: "completed", payout_created: 1_793_000_500, debit: line("txn_debit", { amount_cents: -1000, fee_cents: 0, net_cents: -1000, type: "payout", source_id: "po_1" }), components: [line("txn_c1")], own_debit_included: false, page_count: 1, listed_count: 1, net_components_cents: 1000, provider_observed_at: "2026-11-06T10:00:00Z", bank_receipt_confirmed: false },
  qualified_at: "2026-11-06T10:00:01Z",
  ...over,
});

test("charge : lecture stricte + invariants du handler (paiement, commission < montant, curseur, litiges ≤ capture)", () => {
  assert.ok(m.parseChargePage(chargePage(), PAY, null));
  assert.ok(m.parseChargePage({ proof: null, dispute_observations: [], next_after: null }, PAY, null));
  const fifty = Array.from({ length: 50 }, (_, i) => obs(i + 1));
  assert.ok(m.parseChargePage(chargePage({ dispute_observations: fifty, next_after: "evt_0050" }), PAY, null));
  for (const [bad, after] of [
    [{ ...chargePage(), extra: 1 }, null],
    [{ proof: null, dispute_observations: [obs(1)], next_after: null }, null],
    [chargePage({ proof: { ...proof, payment_id: U(7) } }), null],
    [chargePage({ proof: { ...proof, source: { ...source, fee_cents: 12000 } } }), null],
    [chargePage({ proof: { ...proof, source: { ...source, currency: "usd" } } }), null],
    [chargePage({ dispute_observations: [obs(2), obs(1)] }), null],
    [chargePage({ dispute_observations: [obs(1)] }), "evt_0001"],
    [chargePage({ dispute_observations: [obs(1, { disputed_amount_cents: 13000 })] }), null],
    [chargePage({ next_after: "evt_0001" }), null],
    [chargePage({ dispute_observations: fifty, next_after: "evt_0049" }), null],
    [chargePage({ proof: { ...proof, card_last4: "4242" } }), null],
  ] as [unknown, string | null][])
    assert.equal(m.parseChargePage(bad, PAY, after), null, JSON.stringify(bad).slice(0, 100));
});

test("commission et versement : lecture stricte ; remboursé cohérent ; versement cohérent ; réception bancaire jamais confirmée", () => {
  assert.ok(m.parseFeeReply({ qualification: feeQ() }, PAY, "evt_fee1"));
  assert.ok(m.parseFeeReply({ qualification: feeQ({ provider_amount_refunded_cents: null }) }, PAY, "evt_fee1"));
  assert.ok(m.parseFeeReply({ qualification: feeQ({ provider_amount_refunded_cents: 1200, provider_refunded: true }) }, PAY, "evt_fee1"));
  for (const bad of [feeQ({ provider_amount_refunded_cents: 1300 }), feeQ({ provider_amount_refunded_cents: 1200, provider_refunded: false }), feeQ({ provider_amount_refunded_cents: 100, provider_refunded: true }), feeQ({ event_id: "evt_other" }), feeQ({ extra: 1 })])
    assert.equal(m.parseFeeReply({ qualification: bad }, PAY, "evt_fee1"), null, JSON.stringify(bad).slice(0, 80));
  assert.ok(m.parsePayoutReply({ qualification: payoutQ() }, "evt_po1"));
  assert.ok(m.parsePayoutReply({ qualification: null }, "evt_po1"));
  const p = payoutQ().proof;
  for (const bad of [
    payoutQ({ proof: { ...p, bank_receipt_confirmed: true } }),
    payoutQ({ proof: { ...p, net_components_cents: 999 } }),
    payoutQ({ proof: { ...p, components: [line("txn_c1", { net_cents: 900 })] } }),
    payoutQ({ proof: { ...p, components: [line("txn_c1", { allocation: "dossier" })] } }),
    payoutQ({ event_id: "evt_other" }),
  ])
    assert.equal(m.parsePayoutReply({ qualification: bad }, "evt_po1"), null, JSON.stringify(bad).slice(0, 80));
  same([m.pathOf({ kind: "charge", paymentId: PAY, after: "evt_0050" }), m.pathOf({ kind: "charge", paymentId: PAY, after: "evt_0050" }, true), m.pathOf({ kind: "fee", paymentId: PAY, eventId: "evt_fee1" }), m.pathOf({ kind: "payout", eventId: "evt_po1" })], [`/api/platform-operations/payments/${PAY}/charge-proof?after=evt_0050`, `/api/platform-operations/payments/${PAY}/charge-proof`, `/api/platform-operations/payments/${PAY}/charge-proof/fees/evt_fee1`, "/api/platform-operations/stripe-observations/evt_po1/payout-proof"]);
  assert.ok(priv.PRIVATE_STORAGE_PREFIXES.some((x) => m.pendingKey(USER, 0, { kind: "payout", eventId: "evt_po1" }).startsWith(x)));
});

test("formulations : jamais « reçu en banque » ni « versé sur votre compte » ; périmètres explicites", () => {
  const all = JSON.stringify(m.COPY) + readFileSync("components/features/finance-proofs/proofs-panel.tsx", "utf8");
  assert.doesNotMatch(all, /reçu en banque|reçus en banque|versé sur votre compte|versés sur votre compte|fonds reçus|crédité sur votre compte/i);
  assert.match(m.COPY.chargeScope, /N’atteste pas : un solde disponible, un montant net restant/);
  assert.match(m.COPY.payoutScope, /N’atteste pas : une réception des fonds par la banque \(non confirmée\)/);
  assert.match(m.COPY.feeScope, /Ne pas additionner/);
  assert.match(m.COPY.qualifyExplain, /désactivée par défaut côté serveur/);
  const fv = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
  assert.match(fv, /\{ id: "proofs", label: "Preuves" \}/);
  assert.match(fv, /\(t\.id !== "proofs" \|\| demo \|\| me\.data\?\.super_admin \|\| me\.data\?\.scopes\.includes\("finance_read"\)\)/);
  assert.match(fv, /<FinanceProofsTab demo=\{Boolean\(demo\)\} canRead=\{me\.data\.super_admin \|\| me\.data\.scopes\.includes\("finance_read"\)\} canWrite=\{scope\.authority\.canWrite && !demo && \(me\.data\.super_admin \|\| \(me\.data\.scopes\.includes\("finance_read"\) && me\.data\.scopes\.includes\("finance_write"\)\)\)\}/);
  const rp = readFileSync("components/features/finance-reconciliation/reconciliation-panel.tsx", "utf8");
  assert.match(rp, /\{d\.record\.event\.family === "payout" && <PayoutProofSection eventId=\{id\} canWrite=\{canWrite\}/, "payout proof only in the detail of a payout observation");
});

function memStore() {
  const map = new Map<string, string>();
  return { map, store: { get: (k: string) => map.get(k) ?? null, set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) } as Model.Store };
}
function harness({ target = { kind: "charge", paymentId: PAY, after: null } as Model.Target, reads = [] as (Model.Result | Promise<Model.Result>)[], posts = [] as (Model.Result | Promise<Model.Result>)[], store = memStore().store as Model.Store | null, ids = [CID(1), CID(2)], ctx = { uid: USER as string | null, gen: 0 } } = {}) {
  const calls: { kind: string; path: string; cmd?: string; stored?: string | null }[] = [];
  let drawn = 0;
  let s: Model.ProofState = m.PROOF_INITIAL;
  const context = { generation: () => ctx.gen, userId: () => ctx.uid };
  const c = m.createProofController({
    target,
    api: () => ({ read: async (t) => (calls.push({ kind: "GET", path: m.pathOf(t) }), reads.shift() ?? res(200, chargePage())), qualify: async (t, cmd) => (calls.push({ kind: "POST", path: m.pathOf(t, true), cmd, stored: store?.get(m.pendingKey(ctx.uid, ctx.gen, t)) ?? null }), posts.shift() ?? res(503)) }),
    store: () => store,
    newId: () => (drawn++, ids.shift() ?? null),
    context,
    set: (n) => (s = n),
  });
  return { c, calls, ctx, context, get: () => s, drawn: () => drawn, key: () => m.viewKey(context, target) };
}

test("lecture sans appel fournisseur ; qualification : clic + droits + clé, commande écrite et relue AVANT le POST, même UUID après réponse perdue / 503 (désactivée), 409 relecture sans rejeu, 401/403 effacement, identité changée", async () => {
  const mem = memStore();
  const h = harness({ store: mem.store, posts: [res(503), res(m.PROOF_TIMEOUT), res(200, chargePage())] });
  await h.c.load();
  same([h.calls.map((x) => x.kind), h.get().phase], [["GET"], "ready"], "load = one GET, never a POST");
  same([await h.c.qualify(false, h.key()), await h.c.qualify(true, "other"), h.drawn()], [false, false, 0], "no finance_write / other key ⇒ no id, no POST");
  same(await h.c.qualify(true, h.key()), false);
  const post = h.calls.find((x) => x.kind === "POST")!;
  same([post.path, post.cmd, JSON.parse(post.stored!).command_id], [`/api/platform-operations/payments/${PAY}/charge-proof`, CID(1), CID(1)], "persisted before the POST");
  same([h.get().error, h.get().pending], [m.COPY.disabled, CID(1)], "503 ⇒ honest « désactivée ou indisponible », same command kept");
  same(await h.c.qualify(true, h.key()), false, "no new command while one is uncertain");
  await h.c.retry(h.key());
  same([h.get().error, h.get().pending], [m.COPY.retry, CID(1)]);
  same(await h.c.retry(h.key()), true);
  same([h.calls.filter((x) => x.kind === "POST").map((x) => x.cmd), h.get().notice, h.get().pending, mem.map.size], [[CID(1), CID(1), CID(1)], m.COPY.qualified, null, 0], "same UUID across retries; cleared after success");
  const restored = harness({ store: (() => { const x = memStore(); x.map.set(m.pendingKey(USER, 0, { kind: "charge", paymentId: PAY, after: null }), JSON.stringify({ uid: USER, gen: 0, target: `charge:${PAY}`, command_id: CID(7) })); return x.store; })() });
  restored.c.restorePending();
  await restored.c.load();
  same([restored.get().pending, restored.calls.map((x) => x.kind)], [CID(7), ["GET"]], "restored, never sent by itself");
  const conflict = harness({ posts: [res(409)] });
  await conflict.c.load(); await conflict.c.qualify(true, conflict.key());
  same([conflict.get().error, conflict.get().pending, conflict.calls.map((x) => x.kind)], [m.COPY.conflict, null, ["GET", "POST", "GET"]]);
  same(await conflict.c.retry(conflict.key()), false, "409 ⇒ nothing to replay");
  for (const st of [401, 403]) {
    const mm = memStore();
    const f = harness({ store: mm.store, posts: [res(st)] });
    await f.c.load(); await f.c.qualify(true, f.key());
    same([f.get().phase, f.get().data, mm.map.size], ["forbidden", null, 0], String(st));
  }
  let release!: (r: Model.Result) => void;
  const g = harness({ posts: [new Promise((r) => (release = r))] });
  await g.c.load();
  const p = g.c.qualify(true, g.key());
  g.ctx.gen = 1;
  release(res(200, chargePage()));
  same([await p, g.get().notice], [false, ""], "identity changed ⇒ never applied");
  const payout = harness({ target: { kind: "payout", eventId: "evt_po1" }, reads: [res(200, { qualification: null }), res(200, { qualification: payoutQ() })], posts: [res(409)] });
  await payout.c.load();
  same(payout.calls[0].path, "/api/platform-operations/stripe-observations/evt_po1/payout-proof");
  const k = m.viewKey(payout.context, { kind: "payout", eventId: "evt_po1" });
  same([m.viewOf(payout.get(), k).phase, m.viewOf(payout.get(), m.viewKey(payout.context, { kind: "payout", eventId: "evt_po2" })).data], ["ready", null], "another target ⇒ never this proof");
});

const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const ENTRY = `
import { createElement as h, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FinanceProofsTab, PayoutProofSection } from "./components/features/finance-proofs/proofs-panel";
const w = window;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const charge = ${JSON.stringify(chargePage())};
const fee = ${JSON.stringify({ qualification: feeQ() })};
const payout = ${JSON.stringify({ qualification: payoutQ() })};
w.run = async () => {
  const calls = [];
  let postCount = 0;
  const api = {
    read: async (t) => (calls.push("GET:" + t.kind), { status: 200, body: t.kind === "charge" ? charge : t.kind === "fee" ? fee : payout }),
    qualify: async (t, cmd) => { calls.push("POST:" + t.kind + ":" + cmd); postCount++; return postCount === 1 ? { status: 503, body: null } : { status: 200, body: charge }; },
  };
  const map = new Map();
  const store = () => ({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v), remove: (k) => map.delete(k) });
  const ctx = { userId: () => "${USER}", generation: () => 0 };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(StrictMode, null, h("div", null, h(FinanceProofsTab, { demo: false, canRead: true, canWrite: true, context: ctx, api, store, newId: () => crypto.randomUUID() }), h(PayoutProofSection, { eventId: "evt_po1", canWrite: false, context: ctx, api, store }))));
  await tick(300);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const set = (sel, v) => { const el = div.querySelector(sel); setter.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
  div.querySelector("[data-proofs-open]").click(); await tick(50);
  const invalidShown = div.querySelectorAll("[aria-invalid=true]").length;
  set("[data-proofs-payment]", "${PAY}"); set("[data-proofs-event]", "evt_fee1"); await tick(50);
  div.querySelector("[data-proofs-open]").click(); await tick(400);
  const afterOpen = calls.slice();
  const text = div.textContent;
  const qualifyButtons = div.querySelectorAll("[data-proof-qualify-open]").length;
  div.querySelector("[data-proof='charge'] [data-proof-qualify-open]").click(); await tick(50);
  const postsBeforeConfirm = calls.filter((c) => c.startsWith("POST")).length;
  div.querySelector("[data-proof='charge'] [data-proof-qualify-confirm]").click(); await tick(300);
  const disabledMsg = div.querySelector("[data-proof='charge'] [data-proof-error]")?.textContent ?? null;
  const storedDuring = [...map.values()];
  div.querySelector("[data-proof='charge'] [data-proof-retry]").click(); await tick(300);
  const notice = div.querySelector("[data-proof='charge'] [data-proof-notice]")?.textContent ?? null;
  const heights = [...div.querySelectorAll("button, input, summary")].map((b) => Math.round(b.getBoundingClientRect().height)).filter((x) => x > 0);
  return { invalidShown, afterOpen, text, qualifyButtons, postsBeforeConfirm, disabledMsg, storedDuring, posts: calls.filter((c) => c.startsWith("POST")), notice, stored: [...map.values()], heights, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
};
`;
for (const width of [390, 1280])
  test(`panneaux montés (Chromium ${width} px, StrictMode) : lectures seules, périmètres, payout jamais « reçu », qualification au clic confirmé, 503 désactivé ⇒ même UUID`, { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
    const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
    const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
    const css = readFileSync(path.join(ROOT, "app/globals.css"), "utf8") + "\n" + out.outputFiles.filter((f) => f.path.endsWith(".css")).map((f) => f.text).join("\n");
    const server: Server = createServer((_rq, rs) => { rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><meta name="viewport" content="width=device-width"><style>${css}</style><div class="ui-v2"></div><script>${js}</script>`); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
    const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
    try {
      const page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
      const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as Record<string, any>;
      assert.ok(r.invalidShown >= 1, "invalid payment id ⇒ field error, no read");
      assert.ok(r.afterOpen.every((c: string) => c.startsWith("GET:")) && r.afterOpen.includes("GET:charge") && r.afterOpen.includes("GET:fee") && r.afterOpen.includes("GET:payout"), JSON.stringify(r.afterOpen));
      assert.match(r.text, /N’atteste pas : un solde disponible, un montant net restant/);
      assert.match(r.text, /« paid » le .* — réception bancaire non confirmée/);
      assert.match(r.text, /non attribuée/);
      assert.doesNotMatch(r.text, /reçu en banque|versé sur votre compte/i);
      same(r.qualifyButtons, 2, "charge + fee for a writer; the read-only payout section has none");
      same(r.postsBeforeConfirm, 0, "opening the confirmation posts nothing");
      assert.match(r.disabledMsg, /désactivée ou indisponible côté serveur/);
      same([r.storedDuring.length, JSON.parse(r.storedDuring[0]).command_id], [1, r.posts[0].split(":")[2]], "the uncertain command is persisted (key prefix checked in unit tests)");
      same(r.posts.length, 2);
      same(r.posts[0], r.posts[1], "the retry sends the SAME command_id");
      assert.match(r.notice, /Qualification enregistrée/);
      same(r.stored, [], "command cleared after success");
      assert.ok(r.heights.every((x: number) => x >= 44), `targets ${r.heights.join(",")}`);
      assert.ok(r.overflow <= 0, `${r.overflow}px`);
      same(errors, []);
    } finally {
      await browser.close();
      server.close();
    }
  });

test("app réelle : finance plateforme (démo) — onglet « Preuves », note honnête, aucun /api", { skip: appSkip }, async () => {
  await withApp(async (open) => {
    for (const width of [390, 1280]) {
      const { page, errors, api } = await open("admin-platform-finance", width);
      api.length = 0;
      await page.getByRole("tab", { name: "Preuves" }).click();
      const panel = page.locator('[data-finance-proofs="demo"]');
      await panel.waitFor();
      assert.match(await panel.innerText(), /aucune preuve n’est lue ni qualifiée/);
      const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      assert.ok(overflow <= 0, `${width}: ${overflow}px`);
      same([api, errors], [[], []], String(width));
      await page.context().close();
    }
  });
});
