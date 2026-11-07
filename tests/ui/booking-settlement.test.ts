// Card-hold settlement leaf (docs/GUEST_SETTLEMENT_CONTRACT.md, frozen DTO): strict parse, honest
// copy per server status, explicit confirmation before the POST, single flight, generation/uid
// guard, retry of the same request. Pure tests + ONE single-process Chromium mount (fake API, no
// network, no provider).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";
import { ROOT, loadModule } from "../documents/harness";
import { money } from "../../components/app/format";
import type * as Settlement from "../../components/role/booking-settlement";

const st = loadModule("components/role/booking-settlement.tsx") as unknown as typeof Settlement;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const ID = "20000000-0000-4000-8000-000000000001";
const dto = (over: Record<string, unknown> = {}) => ({ method: "card_hold", status: "not_started", amount_cents: 24000, currency: "eur", available: true, ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const M = money(24000);
const render = (initial: Settlement.SettlementState) => renderToString(createElement(st.BookingSettlement as never, { interventionId: ID, initial } as never));
const ready = (over: Record<string, unknown> = {}, extra: Partial<Settlement.SettlementState> = {}): Settlement.SettlementState => ({ ...st.SETTLEMENT_INITIAL, phase: "ready", dto: st.parseSettlement(dto(over)), ...extra });

test("analyse stricte : seul le DTO gelé est accepté ; le reste ⇒ null (jamais « not_started »)", () => {
  same(st.parseSettlement(dto()), dto());
  same(st.parseSettlement(dto({ amount_cents: null, available: false, reason: "configuration_required" })), dto({ amount_cents: null, available: false, reason: "configuration_required" }));
  for (const bad of [null, {}, dto({ method: "on_site" }), dto({ status: "unknown" }), dto({ currency: "usd" }), dto({ amount_cents: -1 }), dto({ amount_cents: 1.5 }), dto({ amount_cents: "240" }), dto({ available: "yes" }), dto({ reason: 3 })]) assert.equal(st.parseSettlement(bad), null, JSON.stringify(bad));
  // Montant : entier sûr STRICTEMENT positif ; null seulement avant tout règlement.
  for (const status of ["not_started", "processing", "needs_review"]) assert.ok(st.parseSettlement(dto({ status, amount_cents: null })), status);
  for (const status of ["paid", "captured_transfer_pending"]) assert.equal(st.parseSettlement(dto({ status, amount_cents: null })), null, status);
  // 503 ou forme inattendue au chargement ⇒ erreur + Réessayer.
  for (const r of [res(503), res(200, { status: "not_started" }), res(st.SETTLEMENT_TIMEOUT), res(0)]) {
    const s = st.applyStatus(st.SETTLEMENT_INITIAL, r);
    same([s.phase, s.dto, s.retry], ["error", null, "load"]);
  }
  assert.equal(st.applyStatus(st.SETTLEMENT_INITIAL, res(404)).phase, "unavailable");
});

test("textes par statut serveur : honnêtes, montant du serveur uniquement, jamais « payé » ni identifiant Stripe", () => {
  same(st.present(st.parseSettlement(dto())!), { text: `Régler ${M}`, action: "pay" });
  same(st.present(st.parseSettlement(dto({ amount_cents: null }))!), { text: "Montant en cours de vérification.", action: null });
  same(st.present(st.parseSettlement(dto({ available: false, reason: "configuration_required" }))!), { text: "Le règlement par carte n’est pas encore disponible.", action: null });
  same(st.present(st.parseSettlement(dto({ status: "processing" }))!), { text: "Prélèvement en cours de vérification.", action: "resume" });
  same(st.present(st.parseSettlement(dto({ status: "processing", available: false }))!), { text: "Prélèvement en cours de vérification.", action: "refresh" });
  same(st.present(st.parseSettlement(dto({ status: "captured_transfer_pending" }))!), { text: `Montant prélevé (${M}). Finalisation du versement à l’artisan en cours.`, action: "resume" });
  same(st.present(st.parseSettlement(dto({ status: "captured_transfer_pending", available: false }))!), { text: `Montant prélevé (${M}). Finalisation du versement à l’artisan en cours.`, action: null });
  same(st.present(st.parseSettlement(dto({ status: "paid" }))!), { text: `Réglé (${M}).`, action: null });
  same(st.present(st.parseSettlement(dto({ status: "needs_review" }))!), { text: "Votre règlement est en cours de vérification par notre équipe.", action: null });
  // SSR : configuration absente ⇒ aucun bouton ; jamais de lien Checkout.
  const off = render(ready({ available: false, reason: "configuration_required", amount_cents: null }));
  assert.doesNotMatch(off, /<button|href=/);
  assert.match(text(off), /Le règlement par carte n’est pas encore disponible\./);
  const pending = render(ready({ status: "captured_transfer_pending" }));
  assert.doesNotMatch(text(pending), /non payé|\bpayé\b/i);
  assert.match(render(ready({ status: "processing" })), /data-settlement-refresh="">Actualiser</);
  const src = readFileSync(path.join(ROOT, "components/role/booking-settlement.tsx"), "utf8");
  assert.doesNotMatch(src, /checkout\.stripe|stripe\.com|session_id|pi_|cs_|acct_|href=/i);
});

test("confirmation explicite avant le POST ; double clic ⇒ 1 POST ; le corps ne porte que l’intervention", async () => {
  const bodies: unknown[] = [];
  let resolve!: (r: Settlement.SettlementResult) => void;
  const api = st.createSettlementApi((async (url: string, init: RequestInit) => {
    if (init.method === "POST") bodies.push(JSON.parse(String(init.body)));
    return new Promise((r) => (resolve = (x) => r(new Response(JSON.stringify(x.body), { status: x.status })))) as Promise<Response>;
  }) as unknown as typeof fetch);
  let s = ready();
  const ctrl = st.createSettlementController({ api: () => api, interventionId: ID, get: () => s, set: (n) => (s = n) });
  assert.equal(await ctrl.capture(), false); // pas de POST sans confirmation
  same(bodies, []);
  assert.match(render(s), /data-settlement-pay="">Régler /);
  ctrl.confirm(true);
  const html = render(s);
  assert.match(text(html), new RegExp(`Régler ${M.replace(/\s/g, "\\s")} : ce montant sera prélevé sur votre empreinte bancaire\\.`));
  assert.match(html, /data-settlement-capture="">Je confirme le prélèvement de /);
  const first = ctrl.capture();
  assert.equal(await ctrl.capture(), false);
  await new Promise((r) => setTimeout(r, 0));
  resolve(res(200, dto({ status: "captured_transfer_pending" })));
  await first;
  same(bodies, [{ intervention_id: ID }]);
  same([s.dto?.status, s.confirming, s.busy], ["captured_transfer_pending", false, false]);
});

test("garde : génération ou UID changés pendant l’attente ⇒ réponse ignorée ; démontage ⇒ ignorée", async () => {
  for (const change of ["generation", "user", "unmount"] as const) {
    let gen = 1;
    let user: string | null = "user-a";
    let resolve!: (r: Settlement.SettlementResult) => void;
    const api: Settlement.SettlementApi = { status: async () => res(200, dto()), capture: () => new Promise((r) => (resolve = r)) };
    let s = ready({}, { confirming: true });
    const ctrl = st.createSettlementController({ api: () => api, interventionId: ID, context: { generation: () => gen, userId: () => user }, get: () => s, set: (n) => (s = n) });
    const p = ctrl.capture();
    if (change === "generation") gen = 2;
    else if (change === "user") user = "user-b";
    else ctrl.detach();
    resolve(res(200, dto({ status: "paid" })));
    assert.equal(await p, false, change);
    assert.equal(s.dto?.status, "not_started", change);
  }
});

test("503 puis Réessayer ⇒ même requête (même intervention, même corps) ; 409/422 ⇒ Actualiser ; 404 ⇒ indisponible", async () => {
  const bodies: string[] = [];
  const replies = [res(503), res(200, dto({ status: "captured_transfer_pending" }))];
  const api: Settlement.SettlementApi = { status: async () => res(200, dto()), capture: async (id) => (bodies.push(JSON.stringify({ intervention_id: id })), replies.shift()!) };
  let s = ready({}, { confirming: true });
  const ctrl = st.createSettlementController({ api: () => api, interventionId: ID, get: () => s, set: (n) => (s = n) });
  await ctrl.capture();
  same([s.retry, s.error, s.dto?.status], ["capture", st.SETTLEMENT_COPY.captureFailed, "not_started"]);
  assert.match(render(s), /data-settlement-capture="">Réessayer</);
  await ctrl.capture();
  same(bodies, [JSON.stringify({ intervention_id: ID }), JSON.stringify({ intervention_id: ID })]);
  assert.equal(s.dto?.status, "captured_transfer_pending");
  for (const code of [409, 422]) {
    const c = st.applyCapture(ready({}, { confirming: true }), res(code));
    same([c.retry, c.error, c.confirming], ["refresh", st.SETTLEMENT_COPY.conflict, false]);
  }
  assert.equal(st.applyCapture(ready({}, { confirming: true }), res(404)).phase, "unavailable");
  assert.equal(st.applyCapture(ready({}, { confirming: true }), res(st.SETTLEMENT_TIMEOUT)).error, st.SETTLEMENT_COPY.timeout);
});

test("requêtes exactes : GET statut / POST capture same-origin no-store ; délai ⇒ statut synthétique", async () => {
  const seen: [string, RequestInit][] = [];
  const api = st.createSettlementApi((async (u: string, i: RequestInit) => (seen.push([u, i]), new Response("{}", { status: 200 }))) as unknown as typeof fetch);
  await api.status(ID);
  await api.capture(ID);
  same(seen.map(([u, i]) => [u, i.method, i.credentials, i.cache]), [[`/api/bookings/settlement/status?intervention_id=${ID}`, "GET", "same-origin", "no-store"], ["/api/bookings/settlement/capture", "POST", "same-origin", "no-store"]]);
  const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
  assert.equal((await st.createSettlementApi(never, { timeoutMs: 20 }).status(ID)).status, st.SETTLEMENT_TIMEOUT);
});

test("reprise : processing / captured_transfer_pending + disponible ⇒ « Reprendre la finalisation » ⇒ même POST {intervention_id} ⇒ réglé", async () => {
  for (const status of ["processing", "captured_transfer_pending"] as const) {
    const html = render(ready({ status }));
    assert.match(html, /data-settlement-resume="">Reprendre la finalisation</, status);
    assert.match(text(html), /Cela poursuit la même opération, sans nouveau prélèvement\./);
    assert.match(html, /data-settlement-refresh="">Actualiser</, status); // GET en secondaire
    assert.doesNotMatch(text(html), /Régler à nouveau|Je confirme le prélèvement/);
    const bodies: unknown[] = [];
    const replies = [res(503), res(200, dto({ status: "paid" }))];
    const api = st.createSettlementApi((async (_u: string, init: RequestInit) => {
      if (init.method === "POST") bodies.push(JSON.parse(String(init.body)));
      const r = replies.shift()!;
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch);
    let s = ready({ status });
    const ctrl = st.createSettlementController({ api: () => api, interventionId: ID, get: () => s, set: (n) => (s = n) });
    const first = ctrl.capture();
    assert.equal(await ctrl.capture(), false); // vol unique
    await first;
    same([s.retry, s.dto?.status], ["capture", status]);
    assert.match(render(s), /data-settlement-resume="">Réessayer</);
    await ctrl.capture(); // Réessayer : corps identique
    same(bodies, [{ intervention_id: ID }, { intervention_id: ID }]); // aucun montant envoyé
    same([s.dto?.status, s.error], ["paid", ""]);
    assert.match(text(render(s)), new RegExp(`Réglé \\(${M.replace(/\s/g, "\\s")}\\)\\.`));
  }
  // Indisponible ⇒ aucun bouton de reprise, aucun POST.
  for (const status of ["processing", "captured_transfer_pending"] as const) {
    const off = render(ready({ status, available: false }));
    assert.doesNotMatch(off, /data-settlement-resume/);
    let posts = 0;
    let s = ready({ status, available: false });
    const ctrl = st.createSettlementController({ api: () => ({ status: async () => res(200, dto()), capture: async () => (posts++, res(200, dto({ status: "paid" }))) }), interventionId: ID, get: () => s, set: (n) => (s = n) });
    assert.equal(await ctrl.capture(), false);
    assert.equal(posts, 0);
  }
  const src = readFileSync(path.join(ROOT, "components/role/booking-settlement.tsx"), "utf8");
  assert.doesNotMatch(src, /Régler à nouveau/);
});

test("onSettled : une seule fois sur « paid » (POST et Actualiser), jamais sur d’autres statuts ni réponse périmée ; ancien texte absent", async () => {
  // POST → paid
  let calls = 0;
  let s = ready({ status: "captured_transfer_pending" });
  const post = st.createSettlementController({ api: () => ({ status: async () => res(200, dto({ status: "paid" })), capture: async () => res(200, dto({ status: "paid" })) }), interventionId: ID, get: () => s, set: (n) => (s = n), onSettled: () => calls++ });
  await post.capture();
  await post.load(); // déjà réglé : pas de second appel
  assert.equal(calls, 1);
  // Actualiser (GET) → paid
  let g = 0;
  let s2 = ready({ status: "processing" });
  const get = st.createSettlementController({ api: () => ({ status: async () => res(200, dto({ status: "paid" })), capture: async () => res(503) }), interventionId: ID, get: () => s2, set: (n) => (s2 = n), onSettled: () => g++ });
  await get.load();
  assert.equal(g, 1);
  // Autres statuts : jamais.
  for (const next of ["processing", "captured_transfer_pending", "needs_review"]) {
    let n = 0;
    let s3 = ready({ status: "processing" });
    const c = st.createSettlementController({ api: () => ({ status: async () => res(200, dto({ status: next })), capture: async () => res(200, dto({ status: next })) }), interventionId: ID, get: () => s3, set: (x) => (s3 = x), onSettled: () => n++ });
    await c.capture();
    await c.load();
    assert.equal(n, 0, next);
  }
  let first = 0;
  let s4 = { ...st.SETTLEMENT_INITIAL };
  const firstCtrl = st.createSettlementController({ api: () => ({ status: async () => res(200, dto({ status: "paid" })), capture: async () => res(503) }), interventionId: ID, get: () => s4, set: (x) => (s4 = x), onSettled: () => first++ });
  await firstCtrl.load(); // premier chargement déjà « paid » : le parent peut être en retard ⇒ une fois
  await firstCtrl.load(); // jamais répété
  assert.equal(first, 1);
  // Génération / UID changés pendant l’attente : réponse ignorée, aucun appel.
  for (const change of ["generation", "user"] as const) {
    let gen = 1;
    let user: string | null = "user-a";
    let resolve!: (r: Settlement.SettlementResult) => void;
    let n = 0;
    let s5 = ready({ status: "captured_transfer_pending" });
    const c = st.createSettlementController({ api: () => ({ status: async () => res(200, dto()), capture: () => new Promise((r) => (resolve = r)) }), interventionId: ID, context: { generation: () => gen, userId: () => user }, get: () => s5, set: (x) => (s5 = x), onSettled: () => n++ });
    const p = c.capture();
    if (change === "generation") gen = 2;
    else user = "user-b";
    resolve(res(200, dto({ status: "paid" })));
    await p;
    assert.equal(n, 0, change);
  }
  // Texte honnête après 503 : aucune affirmation que rien ne s’est passé ; Actualiser + Réessayer.
  assert.equal(st.SETTLEMENT_COPY.captureFailed, "Statut non confirmé. Vérifiez à nouveau ou reprenez la même demande.");
  const failed = render(st.applyCapture(ready({}, { confirming: true }), res(503)));
  assert.match(failed, /data-settlement-capture="">Réessayer</);
  assert.match(failed, /data-settlement-refresh="">Actualiser</);
  const src = readFileSync(path.join(ROOT, "components/role/booking-settlement.tsx"), "utf8");
  assert.doesNotMatch(src, /Rien n’a été modifié/);
});

test("réponse malformée (montant 0 / -1 / 1,5 / 2^53 / null sur paid / statut inconnu) ⇒ erreur + Réessayer, 0 POST, 0 onSettled", async () => {
  const malformed = [
    dto({ amount_cents: 0 }),
    dto({ amount_cents: -1 }),
    dto({ amount_cents: 1.5 }),
    dto({ amount_cents: 2 ** 53 }),
    dto({ status: "paid", amount_cents: null }),
    dto({ status: "captured_transfer_pending", amount_cents: null }),
    dto({ status: "refunded" }),
    dto({ status: "paid", amount_cents: 0 }),
  ];
  for (const body of malformed) {
    assert.equal(st.parseSettlement(body), null, JSON.stringify(body));
    // Chargement : erreur + Réessayer, jamais un état ; aucun POST possible ensuite.
    let posts = 0;
    let settled = 0;
    let s = { ...st.SETTLEMENT_INITIAL };
    const ctrl = st.createSettlementController({ api: () => ({ status: async () => res(200, body), capture: async () => (posts++, res(200, dto({ status: "paid" }))) }), interventionId: ID, get: () => s, set: (n) => (s = n), onSettled: () => settled++ });
    await ctrl.load();
    same([s.phase, s.dto, s.retry], ["error", null, "load"], JSON.stringify(body));
    assert.match(render(s), /data-settlement-refresh="">Réessayer</);
    assert.equal(await ctrl.capture(), false);
    same([posts, settled], [0, 0], JSON.stringify(body));
    // Réponse POST malformée : statut non confirmé, Réessayer la même requête ; jamais « paid ».
    let s2 = ready({ status: "captured_transfer_pending" });
    let settled2 = 0;
    const c2 = st.createSettlementController({ api: () => ({ status: async () => res(503), capture: async () => res(200, body) }), interventionId: ID, get: () => s2, set: (n) => (s2 = n), onSettled: () => settled2++ });
    await c2.capture();
    same([s2.dto?.status, s2.retry, s2.error, settled2], ["captured_transfer_pending", "capture", st.SETTLEMENT_COPY.captureFailed, 0], JSON.stringify(body));
  }
});

// ---- Montage réel (Chromium, un seul processus) ------------------------------------------------
const PW = process.env.QA_PLAYWRIGHT_PATH || "/Users/claudebrafa/rea/node_modules/playwright-core";
const CHROMIUM = process.env.QA_CHROMIUM_PATH || path.join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell");
const available = existsSync(path.join(PW, "index.mjs")) && existsSync(CHROMIUM);
const ENTRY = `
import { createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { BookingSettlement } from "./components/role/booking-settlement";
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (predicate) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error("Settlement UI state timed out"); await tick(10); }
};
const DTO = ${JSON.stringify(dto())};
window.run = async () => {
  const posts = [];
  const replies = [{ status: 503, body: null, retryAfter: 2 }, { status: 200, body: { ...DTO, status: "captured_transfer_pending" }, retryAfter: null }, { status: 200, body: { ...DTO, status: "paid" }, retryAfter: null }];
  const api = { status: async () => ({ status: 200, body: DTO, retryAfter: null }), capture: async (id) => (posts.push(id), await tick(30), replies.shift()) };
  const div = document.createElement("div"); document.body.appendChild(div);
  createRoot(div).render(h(BookingSettlement, { interventionId: "${ID}", api }));
  await waitFor(() => div.querySelector("[data-settlement-pay]"));
  const steps = [];
  div.querySelector("[data-settlement-pay]").click(); await waitFor(() => div.querySelector("[data-settlement-capture]"));
  steps.push(div.textContent);
  const confirm = div.querySelector("[data-settlement-capture]");
  confirm.click(); confirm.click(); // double clic, même tick
  await waitFor(() => div.textContent.includes("Réessayer"));
  steps.push(div.textContent);
  div.querySelector("[data-settlement-capture]").click(); // Réessayer
  await waitFor(() => div.querySelector("[data-settlement-resume]"));
  steps.push(div.textContent);
  const resume = div.querySelector("[data-settlement-resume]");
  steps.push(resume ? resume.textContent : "");
  resume.click(); resume.click(); // reprise, double clic
  await waitFor(() => div.textContent.includes("Réglé ("));
  steps.push(div.textContent);
  return { posts, steps, buttons: div.querySelectorAll("button").length };
};
`;

test("monté (Chromium) : confirmer → 503 → Réessayer → prélevé, versement en cours → Reprendre → réglé ; un POST par action ; aucun réseau", { skip: available ? false : "local Playwright/Chromium not found (SKIPPED, never PASS)" }, async () => {
  const out = await build({ absWorkingDir: ROOT, stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx" }, bundle: true, write: false, outdir: "out", platform: "browser", format: "iife", jsx: "automatic", loader: { ".css": "local-css" }, define: { "process.env.NODE_ENV": '"development"' }, logLevel: "error" });
  const js = out.outputFiles.find((f) => f.path.endsWith(".js"))!.text;
  const requests: string[] = [];
  const server: Server = createServer((rq, rs) => { if (rq.url !== "/") requests.push(String(rq.url)); rs.setHeader("content-type", "text/html"); rs.end(`<!doctype html><script>${js}</script>`); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const pw = await import(pathToFileURL(path.join(PW, "index.mjs")).href);
  const browser = await pw.chromium.launch({ executablePath: CHROMIUM, headless: true, args: ["--single-process"] });
  try {
    const page = await (await browser.newContext()).newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const r = (await page.evaluate(() => (window as unknown as { run: () => Promise<unknown> }).run())) as { posts: string[]; steps: string[]; buttons: number };
    same(r.posts, [ID, ID, ID]); // confirmer (double clic) + Réessayer + Reprendre (double clic) : même intervention
    assert.ok(r.steps[0].includes("ce montant sera prélevé sur votre empreinte bancaire"));
    assert.ok(r.steps[1].includes("Statut non confirmé. Vérifiez à nouveau ou reprenez la même demande.") && r.steps[1].includes("Réessayer"));
    assert.ok(r.steps[2].includes("Finalisation du versement à l’artisan en cours."));
    assert.equal(r.steps[3], "Reprendre la finalisation");
    assert.ok(r.steps[4].includes("Réglé ("));
    assert.ok(!r.steps.join(" ").includes("Régler à nouveau"));
    assert.equal(r.buttons, 0);
    same(errors, []);
    same(requests.filter((u) => u.startsWith("/api/")), []);
  } finally {
    await browser.close();
    server.close();
  }
});
