// PAY-QR: the payment-link QR is generated LOCALLY (qrcode-generator) from the exact share URL and
// decodes (jsqr, dev only) to exactly that URL. Real leaf functions + SSR of the real view; the SVG
// actually rendered is rasterized to RGBA here (no canvas package) and decoded.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import qrcode from "qrcode-generator";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import jsQR from "jsqr";
import { loadModule } from "../documents/harness";
import type * as Leaf from "../../components/role/payment-link";

const m = loadModule("components/role/payment-link.tsx") as unknown as typeof Leaf;
const ID = "20000000-0000-4000-8000-0000000000ab";
const ORIGIN = "https://app.example.test";
const URL_OK = `${ORIGIN}/#detail/${ID}`;
const reply = (reason: string) => ({ url: `/#detail/${ID}`, available: true, payment_available: false, reason });
const ready = (reason: string) => ({ phase: "ready", link: m.parsePaymentLink(reply(reason), ID) });
const noop = () => {};
const view = (load: unknown, viewer: "client" | "artisan", props: Record<string, unknown> = {}) =>
  renderToString(createElement(m.PaymentLinkView as never, { load, viewer, amountCents: 15000, origin: ORIGIN, onReload: noop, ...props } as never));

/** Rasterize the rendered SVG (viewBox size + path of 1×1 module squares) to RGBA, 4 px per module. */
function decodeRendered(html: string): string | null {
  const size = Number(/data-payment-qr-size="(\d+)"/.exec(html)?.[1]);
  const d = /<path[^>]* d="([^"]+)"/.exec(html)?.[1];
  assert.ok(size > 0 && d, "an SVG QR is rendered");
  assert.match(html, new RegExp(`viewBox="0 0 ${size} ${size}"`));
  const px = 4, w = size * px;
  const rgba = new Uint8ClampedArray(w * w * 4).fill(255);
  const cells = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)];
  assert.equal(cells.map((c) => c[0]).join(""), d, "path is only module squares");
  for (const [, xs, ys] of cells)
    for (let y = +ys * px; y < (+ys + 1) * px; y++)
      for (let x = +xs * px; x < (+xs + 1) * px; x++) rgba.set([0, 0, 0, 255], (y * w + x) * 4);
  return jsQR(rgba, w, w, { inversionAttempts: "dontInvert" })?.data ?? null;
}

test("artisan view: the rendered QR decodes to EXACTLY origin + /#detail/<UUID>, URL visible and labelled", () => {
  for (const reason of ["checkout_required", "configuration_required"]) {
    const html = view(ready(reason), "artisan");
    assert.equal(decodeRendered(html), URL_OK);
    assert.match(html, new RegExp(`aria-label="QR code du lien de suivi : ${URL_OK.replace(/[./]/g, "\\$&")}"`));
    assert.match(html, new RegExp(`data-payment-link-url="">${URL_OK.replace(/[./]/g, "\\$&")}<`), "URL text visible next to the QR");
    assert.doesNotMatch(html, /<canvas|<img|href=|token|utm_|data:image/i);
    assert.doesNotMatch(html, /data-payment-pay|Payer |payé|réglé/i, "artisan read-only, never declared paid");
  }
  // Type number auto (0), error correction M: same matrix as the library itself, nothing added.
  const lib = qrcode(0, "M");
  lib.addData(URL_OK, "Byte");
  lib.make();
  const n = lib.getModuleCount();
  assert.equal(JSON.stringify(m.qrMatrix(URL_OK)), JSON.stringify(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => lib.isDark(r, c)))));
  assert.equal(n, 37, "version 5 (auto) for this 69-byte URL at level M");
});

test("no QR unless the share URL is valid: foreign/absolute/relative/tracking/invalid origin ⇒ no SVG", () => {
  for (const bad of [`/#detail/${ID}`, `https://evil.test/#detail/${ID}/x`, `${URL_OK}?token=x`, `${URL_OK}&utm_source=a`, `javascript:alert(1)//#detail/${ID}`, `https://app.example.test/path/#detail/${ID}`, `${ORIGIN}/#detail/not-a-uuid-not-a-uuid-not-a-uuid-xxxx`, "https://checkout.stripe.com/c/pay/x"])
    assert.equal(m.qrMatrix(bad), null, bad);
  for (const origin of ["", "notaurl", "https://app.example.test/path", "javascript:alert(1)"]) {
    const html = view(ready("checkout_required"), "artisan", { origin });
    assert.doesNotMatch(html, /<svg|data-payment-qr/, origin);
    assert.match(html, /role="alert"/);
  }
  // The parser already refuses any absolute / foreign url from the server ⇒ error state, no QR.
  assert.equal(m.parsePaymentLink({ ...reply("checkout_required"), url: `https://evil.test/#detail/${ID}` }, ID), null);
  for (const load of [{ phase: "error" }, { phase: "loading" }, { phase: "hidden" }, ready("not_completed"), ready("already_settled")])
    assert.doesNotMatch(view(load, "artisan"), /<svg/, JSON.stringify(load));
  // Client: no QR, only its explicit pay action (never auto-opened).
  assert.doesNotMatch(view(ready("checkout_required"), "client", { onPay: noop }), /<svg|data-payment-qr/);
});

test("copy: exact URL written; refusal or missing clipboard ⇒ false (URL stays visible)", async () => {
  const written: string[] = [];
  assert.equal(await m.copyShareUrl(URL_OK, { writeText: async (t) => void written.push(t) }), true);
  assert.deepEqual(written, [URL_OK]);
  assert.equal(await m.copyShareUrl(URL_OK, { writeText: async () => { throw new Error("denied"); } }), false);
  assert.equal(await m.copyShareUrl(URL_OK, undefined), false);
  assert.match(view(ready("checkout_required"), "artisan"), /data-payment-link-copy=""[^>]*>Copier le lien de suivi/);
});

test("the leaf only ever issues GET /api/payments/link; demo issues nothing; no Checkout / POST in code", async () => {
  const calls: { url: string; method: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: string, init: RequestInit) => (calls.push({ url: String(u), method: String(init?.method) }), new Response(JSON.stringify(reply("checkout_required")), { status: 200 }))) as typeof fetch;
  try {
    // Real Node globals (fetch, AbortController): load through Node itself, CSS modules stubbed.
    const extensions = (Module as unknown as { _extensions: Record<string, (mod: { exports: unknown }) => void> })._extensions;
    extensions[".css"] ??= (mod) => {
      mod.exports = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? false : String(k)) });
    };
    const real = createRequire(import.meta.url)("../../components/role/payment-link.tsx") as typeof Leaf;
    const out = await real.resolvePaymentLink(real.createPaymentLinkApi(), ID, false);
    assert.equal(out.phase, "ready");
    let demoCalls = 0;
    assert.deepEqual(await real.resolvePaymentLink({ get: async () => (demoCalls++, { status: 200, body: reply("checkout_required") }) }, ID, true), { phase: "demo" });
    assert.equal(demoCalls, 0, "demo: no route call");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(calls, [{ url: `/api/payments/link?intervention_id=${ID}`, method: "GET" }]);
  const demo = view({ phase: "demo" }, "artisan");
  assert.match(demo, /data-payment-link="demo"/);
  assert.doesNotMatch(demo, /<svg|<button/);
  const code = readFileSync("components/role/payment-link.tsx", "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /POST|payments\/checkout|checkout\.stripe|window\.open|location\.(assign|href\s*=)|createDataURL|createImgTag/);
  const css = readFileSync("components/role/payment-link.module.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb|hsl/i, "tokens only");
  assert.match(css, /\.quiet \{\s*fill: var\(--ui-on-primary\);/);
  assert.match(css, /\.modules \{\s*fill: var\(--ui-on-advice\);/);
});
