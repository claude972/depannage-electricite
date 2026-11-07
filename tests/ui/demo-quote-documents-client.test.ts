// Demo feature client for quote documents: whatever calls quoteDocuments.load in demo (reload,
// prefetch, a future caller) must never receive another dossier's data (the DEV-DEMO01 seed with
// its AV-1-DEV-DEMO01 amendment). The demo overview of a shown dossier is built by the anchor from
// the demo workspace (quoteDocumentsDemoFor); an unresolvable target is an explicit empty state.
import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "../documents/harness";
import type * as Features from "../../components/app/features";

const f = loadModule("components/app/features.ts") as unknown as typeof Features;

test("démo : quoteDocuments.load ne renvoie jamais le dossier de démonstration constant d’un autre devis", async () => {
  for (const role of ["client", "artisan", "manager"] as const) {
    const clients = f.createDemoFeatureClients(role);
    for (const target of [{ quoteId: "b07bef4e-8d64-46ce-89b0-c92867bf96df" }, { interventionId: "482bfab1-cbce-4799-bfff-db7b7e76280a" }, { quoteId: "quote-demo-4" }]) {
      const overview = await clients.quoteDocuments.load(target as never);
      assert.equal(overview, null, `${role} ${JSON.stringify(target)}: explicit empty, never another dossier`);
      assert.doesNotMatch(JSON.stringify(overview), /DEV-DEMO01|AV-1-DEV-DEMO01|demo-quote-1/);
    }
  }
});
