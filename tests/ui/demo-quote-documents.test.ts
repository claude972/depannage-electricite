// DEMO-QUOTE-DOCS: the demo quote-documents overview is built from the dossier/quote ACTUALLY shown
// (demo workspace seed), never a constant dossier. Real anchor + real panel, SSR (no effects).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Anchor from "../../components/role/quote-documents-anchor";
import type * as DemoSeed from "../../components/app/demo";
import type * as Docs from "../../lib/features/quote-documents/demo";

const anchor = loadModule("components/role/quote-documents-anchor.tsx") as unknown as typeof Anchor;
const seed = (loadModule("components/app/demo.ts") as unknown as typeof DemoSeed).seed;
const docs = loadModule("lib/features/quote-documents/demo.ts") as unknown as typeof Docs;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const loads: unknown[] = [];
function session(mode: "demo" | "live", role: "client" | "artisan" = "client", data = seed()) {
  return {
    mode, role, data, profileId: "p1",
    capabilities: { quoteDocuments: "available" },
    features: { quoteDocuments: { load: async (t: unknown) => (loads.push(t), null), command: async () => null, documentHref: (id: string) => `/api/quote-documents/${id}` } },
    reprobeFeature: async () => {}, go: () => {},
  };
}
const render = (s: ReturnType<typeof session>, target: { quoteId: string } | { interventionId: string }) =>
  renderToStaticMarkup(createElement(anchor.QuoteDocumentsAnchor as never, { session: s, variant: s.role, target, authority: { canWrite: true } } as never));

test("quote-demo-1 (envoyé) : référence, montant et statut du devis affiché ; aucun avenant ni « Accepter l’avenant »", () => {
  const html = render(session("demo"), { quoteId: "quote-demo-1" });
  const t = text(html);
  assert.match(t, /Devis DEV-DEMO-1/);
  assert.match(t, /222,00\s€/);
  assert.doesNotMatch(t, /DEV-DEMO01|268,80|DEV-DEMO-4|192,00/, "never another dossier");
  assert.doesNotMatch(t, /Accepter l’avenant|AV-1-/);
  const o = docs.quoteDocumentsDemoFor("client", anchor.demoQuoteDocumentsSource(seed(), { quoteId: "quote-demo-1" }))!;
  assert.equal(o.intervention.id, "demo-001");
  assert.equal(JSON.stringify(o.quotes.map((q) => [q.id, q.reference, q.status, q.total_cents, q.amendments.length])), JSON.stringify([["quote-demo-1", "DEV-DEMO-1", "sent", 22200, 0]]));
  assert.ok(o.history.every((e) => e.quote_id === "quote-demo-1" && e.intervention_id === "demo-001" && e.action !== "amendment_proposed"));
  assert.ok(o.quotes[0].documents.every((d) => d.quote_id === "quote-demo-1" && d.reference === "DEV-DEMO-1"));
  assert.deepEqual(loads, [], "demo never calls the client");
});

test("quote-demo-4 (accepté, 192 €) : montants stockés, avenant cohérent propre à ce devis, acceptable par le client", () => {
  const t = text(render(session("demo"), { quoteId: "quote-demo-4" }));
  assert.match(t, /Devis DEV-DEMO-4/);
  assert.match(t, /192,00\s€/);
  assert.doesNotMatch(t, /268,80|DEV-DEMO01/);
  assert.match(t, /Accepter l’avenant/);
  assert.match(t, /AV-1-DEV-DEMO-4/);
  const o = docs.quoteDocumentsDemoFor("client", anchor.demoQuoteDocumentsSource(seed(), { quoteId: "quote-demo-4" }))!;
  const q = o.quotes[0];
  assert.equal(JSON.stringify([q.status, q.subtotal_cents, q.tax_rate, q.tax_cents, q.total_cents, q.accepted_at]), JSON.stringify(["accepted", 16000, 20, 3200, 19200, "2026-10-30T08:40:00Z"]));
  const a = q.amendments[0];
  assert.equal(a.base_quote_id, "quote-demo-4");
  assert.equal(a.subtotal_cents, a.lines.reduce((n, l) => n + l.quantity * l.unit_price_cents, 0));
  assert.equal(a.tax_cents, Math.round((a.subtotal_cents * q.tax_rate) / 100));
  assert.equal(a.total_cents, a.subtotal_cents + a.tax_cents);
  assert.ok(Date.parse(a.created_at) > Date.parse(q.accepted_at!));
  // Artisan sees the same quote, may withdraw, never accept.
  const art = text(render(session("demo", "artisan"), { quoteId: "quote-demo-4" }));
  assert.match(art, /Retirer la proposition/);
  assert.doesNotMatch(art, /Accepter l’avenant/);
  // A rejected quote never gets an amendment either.
  const data = seed();
  data.quotes = data.quotes.map((x) => (x.id === "quote-demo-4" ? { ...x, status: "rejected" } : x));
  assert.equal(docs.quoteDocumentsDemoFor("client", anchor.demoQuoteDocumentsSource(data, { quoteId: "quote-demo-4" }))!.quotes[0].amendments.length, 0);
});

test("contexte introuvable ⇒ état vide explicite, jamais les données d’un autre dossier", () => {
  for (const target of [{ quoteId: "quote-missing" }, { interventionId: "demo-missing" }]) {
    const html = render(session("demo"), target);
    assert.match(html, /data-quote-documents-demo="empty"/);
    assert.doesNotMatch(html, /DEV-|Accepter l’avenant/);
    assert.equal(anchor.demoQuoteDocumentsSource(seed(), target), null);
  }
  const noData = session("demo");
  (noData as { data: unknown }).data = null;
  assert.match(render(noData, { quoteId: "quote-demo-1" }), /data-quote-documents-demo="empty"/);
  assert.equal(docs.quoteDocumentsDemoFor("client", null), null);
});

test("mode réel : aucune donnée de démonstration ; démo mémoïsée", () => {
  assert.equal(anchor.demoQuoteDocuments(session("live") as never, { quoteId: "quote-demo-4" }), undefined);
  const html = render(session("live"), { quoteId: "quote-demo-4" });
  assert.doesNotMatch(html, /Données de démonstration|DEV-DEMO|data-quote-documents-demo/);
  const src = readFileSync("components/role/quote-documents-anchor.tsx", "utf8");
  assert.match(src, /const demo = useMemo\(\(\) => demoQuoteDocuments\(session, target\), \[session\.mode, session\.role, session\.data, targetKey\]\);/);
  assert.match(src, /demo=\{demo\}/);
  assert.doesNotMatch(src, /quoteDocumentsDemo\(/, "the constant dossier is no longer injected");
});
