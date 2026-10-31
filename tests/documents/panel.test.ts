import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "./harness";
import { quoteDocumentsDemo } from "../../lib/features/quote-documents/demo";
import type { QuoteDocumentsClient, QuoteDocumentsOverview, QuoteDocumentsScope } from "../../lib/features/quote-documents/types";
type QuoteDocumentsPanelPropsLike = {
  state: "unknown" | "available" | "missing" | "unavailable";
  unavailableMessage?: string;
  scope: QuoteDocumentsScope;
  client: QuoteDocumentsClient;
  demo?: { overview: QuoteDocumentsOverview };
  onNavigate?: (view: string, param?: string) => void;
  target: { interventionId: string } | { quoteId: string };
  variant: "artisan" | "client" | "enterprise";
};

// Server rendering of the leaf: effects do not run, so `client` must never be called here and the
// demo seeds must be visible synchronously. Interactive flows are covered by panel-model tests.
const { QuoteDocumentsPanel } = loadModule("components/features/quote-documents/quote-documents-panel.tsx") as { QuoteDocumentsPanel: (props: QuoteDocumentsPanelPropsLike) => unknown };
function fakeClient() {
  const calls: string[] = [];
  const client: QuoteDocumentsClient = {
    load: async () => {
      calls.push("load");
      return null;
    },
    command: async () => {
      calls.push("command");
      return null;
    },
    documentHref: (id, inline) => `/api/quote-documents/${id}${inline ? "?inline=1" : ""}`,
  };
  return { client, calls };
}
const scope = (role: QuoteDocumentsScope["role"], canWrite = true, reason?: string): QuoteDocumentsScope => ({ userId: "u1", role, authority: { canWrite, reason } });
const render = (props: Partial<QuoteDocumentsPanelPropsLike>) => {
  const { client, calls } = fakeClient();
  const html = renderToStaticMarkup(createElement(QuoteDocumentsPanel as never, { state: "available", scope: scope("artisan"), client, target: { interventionId: "i1" }, variant: "artisan", ...props } as never));
  return { html, calls, client };
};

test("state ≠ available renders the honest unavailable block with the lead's message and never calls the client", () => {
  for (const state of ["unknown", "missing", "unavailable"] as const) {
    const { html, calls } = render({ state, unavailableMessage: state === "missing" ? "Fonction non activée." : undefined });
    assert.match(html, /class="unavailable"/);
    assert.match(html, /data-blocker="quote-documents-contract"/);
    if (state === "missing") assert.match(html, /Fonction non activée\./);
    assert.doesNotMatch(html, /<button/);
    assert.deepEqual(calls, []);
    assert.doesNotMatch(html, /api\/|rpc|quote_documents/);
  }
});
test("demo seeds render synchronously, labelled, with disabled downloads and role-appropriate controls", () => {
  const artisan = render({ demo: { overview: quoteDocumentsDemo("artisan") }, scope: scope("artisan") });
  assert.deepEqual(artisan.calls, [], "demo never touches the client");
  assert.match(artisan.html, /Données de démonstration/);
  assert.match(artisan.html, /DEV-DEMO01/);
  assert.match(artisan.html, /Téléchargement indisponible en démonstration/);
  assert.doesNotMatch(artisan.html, /href="\/api\/quote-documents/);
  assert.match(artisan.html, /Retirer la proposition/, "artisan may withdraw the proposed demo amendment");
  assert.doesNotMatch(artisan.html, /Accepter l’avenant/);
  const client = render({ demo: { overview: quoteDocumentsDemo("client") }, scope: scope("client"), variant: "client" });
  assert.match(client.html, /Accepter l’avenant/);
  assert.doesNotMatch(client.html, /Retirer la proposition/);
  assert.match(client.html, /Valable jusqu’au 05\/11\/2026 inclus/);
  assert.match(client.html, /Historique \(4\)/);
  assert.match(client.html, /ne sont pas encore reliés au paiement en ligne/);
});
test("canWrite=false hides every write control, shows the reason, and keeps downloads of existing documents", () => {
  const overview = quoteDocumentsDemo("client");
  const { html } = render({ demo: { overview }, scope: scope("client", false, "Votre rôle sur ce site est en lecture seule."), variant: "enterprise" });
  assert.match(html, /Votre rôle sur ce site est en lecture seule\./);
  for (const control of ["Accepter l’avenant", "Refuser", "Générer le PDF", "Mettre à jour le PDF", "Proposer un avenant", "Enregistrer la validité", "Retirer la proposition"]) assert.doesNotMatch(html, new RegExp(control), control);
  assert.match(html, /Téléchargement indisponible en démonstration/, "existing documents are still listed");
  const live = render({ demo: undefined, scope: scope("client", false) });
  assert.deepEqual(live.calls, [], "SSR never loads; the effect runs in the browser only");
  assert.match(live.html, /lecture seule/i);
});
test("server permissions alone gate controls even when the lead allows writing", () => {
  const overview = quoteDocumentsDemo("client");
  overview.quotes[0].permissions = { can_set_terms: false, can_generate: false, can_propose: false };
  overview.quotes[0].amendments[0].permissions = { can_decide: false, can_withdraw: false, can_generate: false };
  const { html } = render({ demo: { overview }, scope: scope("client") });
  for (const control of ["Accepter l’avenant", "Générer le PDF", "Mettre à jour le PDF", "Proposer un avenant", "Enregistrer la validité", "Retirer la proposition"]) assert.doesNotMatch(html, new RegExp(control), control);
  assert.match(html, /Devis DEV-DEMO01/);
});
test("an empty dossier and an incomplete issuer are stated explicitly", () => {
  const empty = quoteDocumentsDemo("client");
  empty.quotes = [];
  empty.history = [];
  assert.match(render({ demo: { overview: empty } }).html, /Aucun devis pour ce dossier/);
  const incomplete = quoteDocumentsDemo("artisan");
  incomplete.issuer = { ready: false, missing: ["siret", "address"] };
  const html = render({ demo: { overview: incomplete }, scope: scope("artisan"), onNavigate: () => undefined }).html;
  assert.match(html, /dossier professionnel est incomplet \(SIRET, adresse\)/);
  assert.match(html, /data-blocker="issuer-incomplete"/);
  assert.match(html, /Compléter mon dossier/);
  assert.doesNotMatch(html, /artisan_profiles|QD001/);
});
