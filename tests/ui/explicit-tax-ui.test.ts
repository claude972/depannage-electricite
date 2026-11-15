// EXPLICIT-TAX (UI): every VAT selector starts with NO rate, options come only from lib/tax-rates,
// submit without an explicit supported rate is refused before any request, 2.1 / 8.5 reach the
// command payload as-is. Real exported functions + SSR of the real forms.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Tax from "../../components/app/tax-rate";
import type * as Forms from "../../components/app/forms";
import type * as Draft from "../../components/role/artisan-quote-draft";
import type * as Amend from "../../components/features/quote-documents/amendment-form";
import type * as Finance from "../../components/features/platform-operations/platform-finance-view";

const tax = loadModule("components/app/tax-rate.ts") as unknown as typeof Tax;
const forms = loadModule("components/app/forms.tsx") as unknown as typeof Forms;
const draft = loadModule("components/role/artisan-quote-draft.tsx") as unknown as typeof Draft;
const amend = loadModule("components/features/quote-documents/amendment-form.tsx") as unknown as typeof Amend;
const finance = loadModule("components/features/platform-operations/platform-finance-view.tsx") as unknown as typeof Finance;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const LINES = [{ label: "Diagnostic", quantity: 1, unit_price_cents: 10000 }];
const OPTIONS = /<option value="" selected="">Choisir un taux<\/option><option value="0">0 %<\/option><option value="2.1">2,1 %<\/option><option value="5.5">5,5 %<\/option><option value="8.5">8,5 %<\/option><option value="10">10 %<\/option><option value="20">20 %<\/option>/;

test("options : liste canonique uniquement, libellés fr-FR, saisie vide ou non prise en charge ⇒ null", () => {
  same(tax.TAX_RATE_OPTIONS, [["0", "0 %"], ["2.1", "2,1 %"], ["5.5", "5,5 %"], ["8.5", "8,5 %"], ["10", "10 %"], ["20", "20 %"]].map(([value, label]) => ({ value, label })));
  same(["", " ", "7", "19.6", "abc", "8,5"].map(tax.parseTaxRateInput), [null, null, null, null, null, null]);
  same(["0", "2.1", "8.5", "20"].map(tax.parseTaxRateInput), [0, 2.1, 8.5, 20]);
  assert.equal(tax.TAX_RATE_HINT, "Choisissez le taux applicable à votre opération.");
});

test("brouillon artisan : sans taux, enregistrable mais pas envoyable ; 2,1 / 8,5 débloquent l’envoi", () => {
  same(draft.publishBlockers(LINES, null), ["un taux de TVA"]);
  for (const r of [2.1, 8.5] as const) same(draft.publishBlockers(LINES, r), []);
  const src = readFileSync("components/role/artisan-quote-draft.tsx", "utf8");
  assert.match(src, /useState<TaxRate \| null>\(null\)/);
  assert.match(src, /if \(!envelope \|\| !publishable\) return;/, "send refused before any command");
  assert.match(src, /const publishable = saveValid && missing\.length === 0;/);
  assert.match(src, /lines: toSave,\n\s*tax_rate: taxRate,/, "save keeps a null rate as null");
  assert.match(src, /const toSave = override \?\? parsed;/, "saved lines are the typed lines unless the send path trims unused template lines");
});

test("devis direct (QuoteEditor) : aucun taux initial, envoi refusé sans taux, 2,1 / 8,5 dans la charge utile", () => {
  const html = renderToString(createElement(forms.QuoteEditor, { busy: false, demo: false, onSubmit: () => assert.fail("never submitted during render") }));
  assert.match(html, OPTIONS);
  assert.doesNotMatch(html, /value="20" selected/);
  const refused = forms.validateQuoteEditor(LINES, null);
  assert.ok(!refused.ok && refused.taxError === tax.TAX_RATE_REQUIRED);
  for (const r of [2.1, 8.5] as const) same(forms.validateQuoteEditor(LINES, r), { ok: true, payload: { lines: LINES, tax_rate: r } });
  const src = readFileSync("components/app/forms.tsx", "utf8");
  assert.match(src, /if \(!checked\.ok\) \{[\s\S]{0,120}return;\s*\}[\s\S]{0,60}onSubmit\(checked\.payload\);/, "onSubmit only with a validated payload");
});

test("avenant : aucun taux initial, soumission refusée sans taux explicite, délégation exacte au validateur partagé", () => {
  assert.equal(amend.initialAmendmentInput().taxRate, "");
  const html = renderToString(createElement(amend.AmendmentForm, { quoteReference: "D-1", busy: false, onCancel: () => {}, onSubmit: async () => assert.fail("never") }));
  assert.match(html, OPTIONS);
  const now = new Date("2026-11-07T10:00:00Z");
  const input = { ...amend.initialAmendmentInput(), lines: [{ label: "Prise", quantity: "2", price: "40" }], reason: "Ajout demandé" };
  const refused = amend.checkAmendment(input, now);
  assert.ok(!refused.ok && refused.errors.taxRate === tax.TAX_RATE_REQUIRED);
  assert.ok(!amend.checkAmendment({ ...input, taxRate: "7" }, now).ok);
  same(amend.checkAmendment({ ...input, taxRate: "20" }, now), { ok: true, value: { lines: [{ label: "Prise", quantity: 2, unit_price_cents: 4000 }], tax_rate: 20, reason: "Ajout demandé", valid_until: null } });
  // 2,1 / 8,5 : la garde UI les accepte ; le résultat est exactement celui du validateur partagé
  // (lib/features/quote-documents/panel-model, propriété backend) — aucun taux réécrit ici.
  const shared = loadModule("lib/features/quote-documents/panel-model.ts") as { validateAmendmentForm: (i: unknown, n: Date) => unknown };
  for (const r of ["2.1", "8.5"]) same(amend.checkAmendment({ ...input, taxRate: r }, now), shared.validateAmendmentForm({ ...input, taxRate: r }, now), r);
});

test("TVA sur commission : vide = non configuré (null), sinon uniquement la liste canonique", () => {
  same(finance.commissionVatRate(""), { ok: true, value: null });
  for (const r of [2.1, 8.5, 0, 20]) same(finance.commissionVatRate(String(r)), { ok: true, value: r });
  for (const bad of ["7", "19.6", "x"]) same(finance.commissionVatRate(bad), { ok: false });
  const src = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");
  assert.match(src, /<option value="">Non configuré<\/option>\{TAX_RATE_OPTIONS\.map/);
  assert.match(src, /commission_vat_rate: vat\.ok \? vat\.value : null/);
});

test("aucun taux par défaut ni liste en dur dans les composants touchés", () => {
  for (const f of ["components/role/artisan-quote-draft.tsx", "components/app/forms.tsx", "components/features/quote-documents/amendment-form.tsx", "components/features/platform-operations/platform-finance-view.tsx", "components/features/customer-invoices/invoices-model.ts", "components/app/tax-rate.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /useState\(20\)|taxRate: "20"|tax_rate: 20\b|0 \| 5\.5 \| 10 \| 20|"5\.5"|z\.literal\(5\.5\)|\[0, 5\.5, 10, 20\]/, f);
    assert.doesNotMatch(src, /useState<[^>]*>\((0|5\.5|10|20|2\.1|8\.5)\)/, f);
  }
});

test("demo send_quote: explicit supported rate required before any mutation, no coercion (null never becomes 0)", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync("components/courant-app.tsx", "utf8");
  const start = src.indexOf('if (name === "send_quote") {');
  const block = src.slice(start, src.indexOf("qs = [...qs, quote];", start));
  assert.doesNotMatch(src, /Number\(extra\?\.tax_rate\)/);
  const guard = block.indexOf("if (!isTaxRate(rate)) throw new Error(");
  assert.ok(guard > 0, "guard present");
  assert.ok(guard < block.indexOf("qs = qs.map("), "guard runs before the demo quotes are mutated");
  const { isTaxRate } = await import("../../lib/tax-rates");
  for (const bad of [null, undefined, "20", 0.2, 7, Number(null) === 0 ? "0" : 0]) assert.equal(isTaxRate(bad), false, String(bad));
  for (const ok of [0, 2.1, 5.5, 8.5, 10, 20]) assert.equal(isTaxRate(ok), true);
});
