import test from "node:test";
import assert from "node:assert/strict";
import { dbError } from "../lib/supabase/server";

test("acceptation avant approbation : la raison est dite (règle simple et circuit avancé)", () => {
  for (const [message, re] of [["Approval required", /approuvé par votre organisation/], ["Advanced approval required for exact quote", /circuit de votre organisation/]] as const)
    assert.throws(() => dbError({ code: "P0001", message }), (e: { status?: number; message: string }) => e.status === 409 && re.test(e.message) && !/Actualisez/.test(e.message));
  assert.throws(() => dbError({ code: "P0001", message: "Intervention changed during Checkout" }), /L’état du dossier a changé/);
});

test("refus métier connus : archivage avec interventions ouvertes et exercices qui se chevauchent", () => {
  for (const [message, re] of [["Site still has open interventions", /interventions en cours/], ["Fiscal years overlap", /chevauche/]] as const)
    assert.throws(() => dbError({ code: "P0001", message }), (e: { status?: number; message: string }) => e.status === 409 && re.test(e.message) && !/Actualisez/.test(e.message));
});
