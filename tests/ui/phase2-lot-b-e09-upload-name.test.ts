// E09 (registre phase 2) — CLI-02 : relecture d’une photo après perte de la réponse. Le serveur
// enregistre un nom fait d’espaces sous le nom de secours « document » ; la vérification du dossier
// comparait le nom brut ⇒ zéro candidat. Attendu : la vérification applique la même normalisation
// que le serveur (lib/shared/document-policy, documentNameFor) ⇒ le document est proposé.
// Vraie fonction de rapprochement exécutée dans Chromium avec un vrai File (aucun réseau).
import test from "node:test";
import assert from "node:assert/strict";
import { PRELUDE, skip, withScenarios } from "./phase2-lot-b-harness";

const ENTRY = `
import { reconcileUncertain } from "./components/app/uploads";
${PRELUDE}
const J = "d0000000-0000-4000-8000-000000000001";
window.scenarios = {
  async e09() {
    const file = new File([new Uint8Array([137, 80, 78, 71])], "   ", { type: "image/png" });
    const queue = { interventionId: J, startedAt: "2026-11-08T10:00:00.000Z", items: [{ key: "k1", file, status: "uncertain" }] };
    const docs = [
      { id: "f1000000-0000-4000-8000-000000000001", intervention_id: J, name: "document", mime_type: "image/png", created_at: "2026-11-08T10:00:01.000Z" },
      { id: "f1000000-0000-4000-8000-000000000002", intervention_id: "d0000000-0000-4000-8000-000000000002", name: "document", mime_type: "image/png", created_at: "2026-11-08T10:00:02.000Z" },
    ];
    const named = { ...queue, items: [{ key: "k2", file: new File([new Uint8Array([1])], "photo.png", { type: "image/png" }), status: "uncertain" }] };
    return {
      blank: reconcileUncertain(queue, docs).items[0].candidates?.map((c) => c.id) ?? [],
      named: reconcileUncertain(named, docs).items[0].candidates?.map((c) => c.id) ?? [],
    };
  },
};
`;

test("E09 · nom fait d’espaces ⇒ le document « document » du même dossier est proposé ; autres noms inchangés", { skip }, async () => {
  await withScenarios(ENTRY, async (run, { errors }) => {
    const r = await run("e09");
    assert.deepEqual(r.blank, ["f1000000-0000-4000-8000-000000000001"], "candidat du même dossier seulement");
    assert.deepEqual(r.named, [], "un nom réel ne correspond pas à « document »");
    assert.deepEqual(errors, []);
  });
});
