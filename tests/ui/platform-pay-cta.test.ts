// ROOT: the server charges the accepted quote + ALL accepted amendments. A dossier with a 120 €
// quote and a 30 € accepted amendment owes 150 €: no CTA may present 120 € (the base quote) as
// the amount to pay, and the client cache (possibly truncated) is never summed for a CTA.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";

const pay = loadModule("components/app/platform-pay.tsx") as Record<string, any>;
const quote = { id: "q", total_cents: 12000, accepted_total_cents: 15000 }; // 120 € + 30 € amendment

test("CTA carries no amount: never 120 € for a 150 € dossier, explanation shown before validation", () => {
  for (const demo of [false, true]) {
    const html = renderToString(createElement(pay.PlatformPayAction, { demo, busy: false, busyLabel: "…", onPay: () => {} })).replace(/<!-- -->/g, "");
    assert.doesNotMatch(html, /120|150|€/, "no amount at all on the CTA");
    assert.match(html, /data-pay-explain=""[^>]*>Le montant à régler comprend le devis accepté et tous les avenants acceptés/);
    assert.ok(html.indexOf("data-pay-explain") < html.indexOf("data-pay-cta"), "explanation precedes the button");
  }
  assert.match(renderToString(createElement(pay.PlatformPayAction, { demo: false, busy: false, busyLabel: "…", onPay: () => {} })), /Régler le devis et les avenants acceptés/);
  assert.equal(pay.PlatformPayAction.length, 1);
  assert.ok(quote.accepted_total_cents > quote.total_cents);
});

test("client and enterprise use the amount-free action; the base quote is never labelled payable", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  const ent = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(client, /<PlatformPayAction\s+demo=\{demo\}[\s\S]{0,200}?session\.checkout\(accepted\.id\)/);
  assert.match(ent, /<PlatformPayAction\s+demo=\{false\}[\s\S]{0,200}?session\.checkout\(acceptedQuote\.id\)/);
  // Enterprise: the server total (quote + amendments) when present; otherwise the base is labelled as such.
  assert.match(ent, /acceptedQuote\.accepted_total_cents !== undefined \?[\s\S]{0,200}?Devis et avenants acceptés \(calcul serveur\)[\s\S]{0,200}?: \([\s\S]{0,120}?Devis initial accepté/);
  assert.doesNotMatch(ent, /<span>Montant à régler<\/span>\s*<strong>\{money\(acceptedCommittedCents\(acceptedQuote\)\)\}/);
  const art = readFileSync("components/role/artisan-space.tsx", "utf8");
  assert.match(art, /`Devis initial accepté : \$\{money\(accepted\.total_cents\)\}`/);
});

test("no CTA anywhere in components shows a quote total as the payable amount", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk("components");
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /Régler avec Stripe \(|`(Régler|Payer|Simuler le règlement)[^`]*\$\{money\((accepted|acceptedQuote|quote)\.total_cents\)\}/, f);
  }
});
