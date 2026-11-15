import test from "node:test";
import assert from "node:assert/strict";
import { checkoutDbError, CHECKOUT_REFUSALS } from "../lib/features/payments/checkout";

test("checkout : un compte de règlement artisan non prêt est expliqué tel quel (pas « actualisez »)", () => {
  assert.throws(() => checkoutDbError({ code: "P0001", message: "Recipient account not ready" }), (e: { status?: number; message: string }) => {
    assert.equal(e.status, 409);
    assert.match(e.message, /compte de règlement de l’artisan/);
    assert.match(e.message, /Rien n’a été débité/);
    assert.doesNotMatch(e.message, /Actualisez/);
    return true;
  });
});

test("checkout : chaque refus connu a un message dédié ; un P0001 inconnu garde le message générique", () => {
  for (const reason of Object.keys(CHECKOUT_REFUSALS))
    assert.throws(() => checkoutDbError({ code: "P0001", message: reason }), (e: { message: string }) => e.message === CHECKOUT_REFUSALS[reason]);
  assert.throws(() => checkoutDbError({ code: "P0001", message: "Checkout snapshot changed" }), /L’état du dossier a changé/);
  assert.doesNotThrow(() => checkoutDbError(null));
});
