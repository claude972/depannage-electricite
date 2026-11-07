// Payment after the intervention on the platform: GET /api/payments/link contract (ROOT 21cd76d).
// Real leaf functions + SSR of the real view; injected API only (no network, no provider).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Leaf from "../../components/role/payment-link";

const m = loadModule("components/role/payment-link.tsx") as unknown as typeof Leaf;
const ID = "20000000-0000-4000-8000-0000000000ab";
const ORIGIN = "https://app.example.test";
const reply = (reason: string, extra: Record<string, unknown> = {}) => ({ url: `/#detail/${ID}`, available: true, payment_available: false, reason, ...extra });
const ready = (reason: string) => ({ phase: "ready", link: m.parsePaymentLink(reply(reason), ID) });
const noop = () => {};
const view = (load: unknown, viewer: "client" | "artisan", props: Record<string, unknown> = {}) =>
  renderToString(createElement(m.PaymentLinkView as never, { load, viewer, amountCents: 15000, origin: ORIGIN, onReload: noop, ...props } as never));

test("parser: exact relative follow-up of THIS dossier only; every contract reason; garbage null", () => {
  for (const reason of ["not_completed", "already_settled", "configuration_required", "checkout_required"]) assert.equal(m.parsePaymentLink(reply(reason), ID)?.reason, reason);
  for (const bad of [null, [], {}, reply("paid"), reply("checkout_required", { available: false }), reply("checkout_required", { payment_available: "no" }),
    reply("checkout_required", { url: "https://checkout.stripe.com/c/pay/x" }), reply("checkout_required", { url: "/#detail/20000000-0000-4000-8000-000000000999" }), reply("checkout_required", { url: `//evil.test/#detail/${ID}` })])
    assert.equal(m.parsePaymentLink(bad, ID), null, JSON.stringify(bad));
});

test("share URL: resolved against this page origin only", () => {
  const link = m.parsePaymentLink(reply("checkout_required"), ID)!;
  assert.equal(m.shareUrl(link, ORIGIN), `${ORIGIN}/#detail/${ID}`);
  for (const bad of ["", "javascript:alert(1)", "https://app.example.test/path", "notaurl"]) assert.equal(m.shareUrl(link, bad), null, bad);
});

test("load: 401/403/404 hidden; 503/network/malformed error; GET with the encoded id only", async () => {
  for (const status of [401, 403, 404]) assert.equal((await m.loadPaymentLink({ get: async () => ({ status, body: null }) }, ID)).phase, "hidden");
  for (const r of [{ status: 503, body: null }, { status: 0, body: null }, { status: 200, body: { url: "/" } }]) assert.equal((await m.loadPaymentLink({ get: async () => r }, ID)).phase, "error");
  assert.equal((await m.loadPaymentLink({ get: async () => { throw new Error("x"); } }, ID)).phase, "error");
  const asked: string[] = [];
  const out = await m.loadPaymentLink({ get: async (id) => { asked.push(id); return { status: 200, body: reply("checkout_required") }; } }, ID);
  assert.equal(out.phase, "ready");
  assert.deepEqual(asked, [ID]);
  const code = readFileSync("components/role/payment-link.tsx", "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /method: "POST"|payments\/checkout|checkout\.stripe\.com/, "the leaf never starts a Checkout itself");
  assert.match(code, /method: "GET"/);
});

test("client: pay action only for checkout_required with the server amount; honest states otherwise", () => {
  const pay = view(ready("checkout_required"), "client", { onPay: noop });
  assert.match(pay, /data-payment-pay=""[^>]*>Payer 150,00\s€ sur la plateforme/);
  assert.match(pay, /jamais sur la seule redirection/);
  assert.match(view(ready("checkout_required"), "client", { onPay: noop, busy: true }), /disabled=""[^>]*data-payment-pay=""[^>]*>Veuillez patienter/);
  // No quote callback ⇒ no dead button.
  assert.doesNotMatch(view(ready("checkout_required"), "client"), /<button/);
  for (const [reason, text] of [["configuration_required", /pas encore activé sur ce service/], ["not_completed", /une fois l’intervention terminée/], ["already_settled", /est réglé sur la plateforme/]] as const) {
    const html = view(ready(reason), "client", { onPay: noop });
    assert.match(html, text);
    assert.doesNotMatch(html, /<button/, `${reason}: never a pay button`);
  }
});

test("artisan: follow-up link + copy only, never a pay/Checkout action; QR explicitly unavailable", () => {
  for (const reason of ["checkout_required", "configuration_required"]) {
    const html = view(ready(reason), "artisan", { onPay: noop });
    assert.match(html, new RegExp(`data-payment-link-url="">${ORIGIN.replace(/\./g, "\\.")}/#detail/${ID}<`));
    assert.match(html, /data-payment-link-copy=""[^>]*>Copier le lien de suivi/);
    assert.doesNotMatch(html, /data-payment-pay|Payer /, "no payment initiated by or for the artisan");
    assert.match(html, /data-payment-qr="unavailable"/);
    assert.doesNotMatch(html, /<svg|<canvas|<img/, "no fake QR");
  }
  assert.match(view(ready("configuration_required"), "artisan"), /le client ne peut pas encore régler/);
  assert.equal(view({ phase: "hidden" }, "artisan"), "");
  assert.match(view({ phase: "error" }, "artisan"), /data-payment-link-reload=""[^>]*>Réessayer/);
  assert.match(view({ phase: "loading" }, "client"), /data-payment-link="loading"/);
});

test("artisan PaymentPanel mounts only the read-only link leaf; client passes its own Checkout", () => {
  const artisan = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(artisan, /<PaymentLinkPanel key=\{`\$\{session\.profileId\}\|\$\{i\.id\}`\} interventionId=\{i\.id\} viewer="artisan" amountCents=\{null\} \/>/);
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /onPay=\{!demo && accepted && i\.status === "completed" \? \(\) => void session\.checkout\(accepted\.id\) : undefined\}/);
});
