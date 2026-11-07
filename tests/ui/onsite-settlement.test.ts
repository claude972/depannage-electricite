// After-intervention payment leaf (historical code « on_site »), PLATFORM-ONLY decision: read-only,
// no declaration control for any viewer, payment link/action only from the contract leaf (no QR),
// historical declarations stay worded as declarations (never bank payments), strict DTO parse,
// 404 renders nothing, stale replies ignored. Pure / SSR tests (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Onsite from "../../components/role/onsite-settlement";

const m = loadModule("components/role/onsite-settlement.tsx") as unknown as typeof Onsite;
const ID = "20000000-0000-4000-8000-000000000001";
// Contract due shape: can_declare false, available false, reason platform_only.
const DUE = { method: "on_site", status: "due_on_site", amount_cents: 18000, currency: "eur", can_declare: false, available: false, reason: "platform_only" };
const DECLARED = { method: "on_site_declared", status: "declared_received", amount_cents: 18000, currency: "eur", can_declare: false, available: false };
const BANK = /carte bancaire confirm|pay[ée] par carte|virement reçu|prélevé/i;
const noop = () => {};
const view = (load: unknown, viewer: "client" | "artisan") => renderToString(createElement(m.OnsiteView as never, { load, viewer, onReload: noop } as never));
const ready = (settlement: unknown) => ({ phase: "ready", settlement: m.parseOnsiteSettlement(settlement) });

test("parser: contract due (platform_only) and historical declared parse; garbage is null", () => {
  assert.equal(m.parseOnsiteSettlement(DUE)?.status, "due_on_site");
  assert.equal(m.parseOnsiteSettlement({ ...DUE, amount_cents: null })?.amount_cents, null);
  assert.equal(m.parseOnsiteSettlement(DECLARED)?.status, "declared_received");
  for (const bad of [null, [], {}, { ...DUE, amount_cents: 0 }, { ...DUE, currency: "usd" }, { ...DECLARED, amount_cents: null }, { ...DUE, status: "paid" }])
    assert.equal(m.parseOnsiteSettlement(bad), null, JSON.stringify(bad));
});

test("due: client and artisan both see platform-only wording, NO declaration control; the payment slot comes only from the contract leaf", () => {
  for (const viewer of ["client", "artisan"] as const) {
    const html = view(ready(DUE), viewer);
    assert.match(html, /sur la plateforme/);
    assert.doesNotMatch(html, /seront proposés ici dès que le paiement en ligne sera activé/, "no static promise any more");
    assert.doesNotMatch(html, /QR code/, "no QR promised");
    assert.doesNotMatch(html, /<button/, `${viewer}: no button without the contract leaf (no declaration, no fake pay link)`);
    assert.doesNotMatch(html, /Déclarer|Je confirme avoir reçu|data-onsite-declare|data-onsite-confirm/);
    // The due state hands the server amount to the payment slot (PaymentLinkPanel in OnsiteSettlement).
    let seen: unknown = undefined;
    const slotted = renderToString(createElement(m.OnsiteView as never, { load: ready(DUE), viewer, onReload: noop, payment: (due: { amount_cents: number | null }) => { seen = due.amount_cents; return createElement("i", { "data-slot": "" }); } } as never));
    assert.match(slotted, /data-slot=""/);
    assert.equal(seen, 18000);
  }
  assert.match(view(ready(DUE), "client"), /Ne payez jamais l’artisan directement/);
  assert.match(view(ready(DUE), "artisan"), /n’acceptez ni espèces, ni terminal ou virement personnel/);
  const src = readFileSync("components/role/onsite-settlement.tsx", "utf8");
  assert.match(src, /<PaymentLinkPanel interventionId=\{interventionId\} viewer=\{viewer\} amountCents=\{due\.amount_cents\} onPay=\{viewer === "client" \? onPay : undefined\}/, "artisan never receives the pay callback");
});

test("historical declaration: shown as a past declaration, never as a bank payment", () => {
  const html = view(ready(DECLARED), "client");
  assert.match(html, /Ancienne déclaration de l’artisan/);
  assert.match(html, /Ce n’est pas un paiement bancaire/);
  assert.doesNotMatch(html, BANK);
});

test("load: 404/401/403 ⇒ hidden; 503 / malformed ⇒ error with Réessayer; GET only", async () => {
  for (const status of [404, 401, 403]) assert.equal((await m.loadOnsite({ get: async () => ({ status, body: null }) }, ID)).kind, "hidden");
  assert.equal((await m.loadOnsite({ get: async () => ({ status: 503, body: null }) }, ID)).kind, "error");
  assert.equal((await m.loadOnsite({ get: async () => ({ status: 200, body: { nope: 1 } }) }, ID)).kind, "error");
  assert.match(view({ phase: "error" }, "client"), /data-onsite-reload=""[^>]*>Réessayer/);
  const src = readFileSync("components/role/onsite-settlement.tsx", "utf8");
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /method: "POST"|\bpost\(|declareOnsite/, "no declaration request in the client code");
});

test("wiring: no artisan mount of the leaf; artisan payment text is platform-only", () => {
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.doesNotMatch(artisan, /<OnsiteSettlement/);
  assert.doesNotMatch(artisan, /déclarez le montant reçu/);
  assert.match(artisan, /N’acceptez aucun paiement direct/);
});
