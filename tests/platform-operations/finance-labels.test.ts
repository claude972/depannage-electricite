// Finance view wording: a ledger « payment_settled » entry may come from an on-site declaration,
// so it is « Règlement enregistré », never « Encaissement confirmé »; provider-proven kinds unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("components/features/platform-operations/platform-finance-view.tsx", "utf8");

test("payment_settled ⇒ « Règlement enregistré »; commission_withheld / refund_settled unchanged", () => {
  assert.match(src, /payment_settled: "Règlement enregistré"/);
  assert.match(src, /commission_withheld: "Commission prélevée \(confirmée\)"/);
  assert.match(src, /refund_settled: "Remboursement confirmé"/);
  assert.doesNotMatch(src, /Encaissement confirmé|Encaissements au ledger|Rapprocher les paiements confirmés/);
});

test("the register/payment strips say on-site declarations are not bank proofs", () => {
  assert.match(src, /label="Règlements au registre"/);
  assert.match(src, /Le registre peut inclure des déclarations sur place, qui ne sont pas une preuve bancaire\./);
  assert.match(src, /label="Paiements réglés"[\s\S]{0,160}déclarés reçus sur place par l’artisan \(pas une preuve bancaire\)/);
});

test("026 readiness codes are translated (no raw code, no « facture prête »), unknown code stays blocking", () => {
  for (const [code, fr] of [
    ["payment_total_mismatch", "montant du règlement incohérent"],
    ["amendment_snapshot_mismatch", "versions des avenants à vérifier"],
    ["invoice_mixed_tax_rates", "plusieurs taux de TVA"],
    ["invoice_lines_limit", "trop de lignes pour ce document"],
    ["invoice_tax_rounding_mismatch", "arrondi de TVA à vérifier"],
    ["amendment_invalid", "avenant non exploitable"],
  ])
    assert.match(src, new RegExp(`${code}: "${fr}`), code);
  assert.match(src, /MISSING_LABEL\[m\] \?\? MISSING_FALLBACK/);
  assert.doesNotMatch(src, /MISSING_LABEL\[m\] \?\? m\b/, "never a raw code");
  assert.match(src, /<strong>Émission impossible<\/strong>/, "the block stays visible");
  assert.doesNotMatch(src, /facture prête/i);
});
