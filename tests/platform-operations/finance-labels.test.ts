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
