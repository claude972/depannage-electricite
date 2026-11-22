// B2B/admin provenance: bank-confirmed vs declared received on site, labelled; never an invented 0.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { paidBreakdown } from "../../components/role/admin-lists";

const base = { paid_service_cents: 45000, currency: "eur", platform_revenue_cents: null, note: "n." };

test("admin KPI breakdown only when BOTH server fields are real numbers (absent/demo ⇒ none, never 0)", () => {
  assert.equal(paidBreakdown({ financial: base }), null);
  assert.equal(paidBreakdown({ financial: { ...base, bank_paid_service_cents: 30000 } as never }), null);
  assert.equal(paidBreakdown({ financial: { ...base, bank_paid_service_cents: 30000, on_site_declared_cents: "x" } as never }), null);
  assert.equal(paidBreakdown({ financial: { ...base, bank_paid_service_cents: -1, on_site_declared_cents: 0 } as never }), null);
  const text = paidBreakdown({ financial: { ...base, bank_paid_service_cents: 30000, on_site_declared_cents: 15000 } as never })!;
  assert.match(text, /confirmés par la banque/);
  assert.match(text, /déclarés reçus sur place/);
});

test("enterprise: « Réglé » keeps the total (bank + declared) and identifies the declared part; no « Stripe confirmé » label", () => {
  const src = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(src, /const declared = sum\(paidRows\.filter\(\(p\) => isDeclaredOnSite\(p\)\)\.map\(\(p\) => p\.total_cents\)\);/);
  assert.match(src, /dont déclaré reçu sur place/);
  assert.match(src, /dont \{money\(r\.declared\)\} déclarés reçus sur place/);
  assert.doesNotMatch(src, /Réglé \(Stripe confirmé\)/);
});
