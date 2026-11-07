// FIN-05 / ENT-16 customer invoices leaf — REAL exported functions + SSR (fake API, no network):
// strict list/detail parse, honest page counts, exact amounts, customer PDF routes only, cursor
// reset on filter change and stale replies dropped, read-only, demo without calls, wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { loadModule } from "../documents/harness";
import type * as Model from "../../components/features/customer-invoices/invoices-model";

const m = loadModule("components/features/customer-invoices/invoices-model.ts") as unknown as typeof Model;
const panel = loadModule("components/features/customer-invoices/customer-invoices-panel.tsx") as Record<string, any>;
const same = (a: unknown, b: unknown, msg = "") => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const text = (html: string) => html.replaceAll("<!-- -->", "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const ID = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOB = "20000000-0000-4000-8000-000000000001", QUOTE = "30000000-0000-4000-8000-000000000001", PAY = "40000000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const summary = (n: number, over: Record<string, unknown> = {}) => ({ id: ID(n), kind: "invoice", basis: "service", number: `F-2026-${n}`, issuer_name: "Élec Martin SARL", recipient_name: "Camille Durand", intervention_id: JOB, quote_id: QUOTE, related_invoice_id: null, total_cents: 24000, tax_cents: 4000, currency: "eur", issued_at: "2026-11-05T10:00:00.000Z", document_state: "issued", version: { basis: "immutable_register_snapshot", sha256: SHA }, links: m.invoiceLinks(ID(n)), ...over });
const FILTERS = { basis: "service" as const };
const echo = (f: Model.InvoiceFilters = FILTERS) => m.normalizeFilters(f);
const list = (rows: unknown[], over: Record<string, unknown> = {}, f: Model.InvoiceFilters = FILTERS) => ({ invoices: rows, page: { limit: 25, total: rows.length, remaining: rows.length, has_more: false, next_cursor: null, complete: true }, filters: echo(f), captured_at: "2026-11-07T10:00:00.000Z", ...over });
const res = (status: number, body: unknown = null) => ({ status, body, retryAfter: null });
const row = (over: Record<string, unknown> = {}) => ({ id: ID(1), kind: "invoice", basis: "service", number: "F-2026-1", issuer_key: "artisan:x", issuer: { legal_name: "Élec Martin SARL", address: "1 rue A", siret: "12345678901234" }, recipient: { name: "Camille Durand", address: "2 rue B" }, payment_id: PAY, quote_id: QUOTE, intervention_id: JOB, related_invoice_id: null, lines: [{ label: "Diagnostic", quantity: 1, unit_price_cents: 12000 }, { label: "Disjoncteur", quantity: 2, unit_price_cents: 4000 }], subtotal_cents: 20000, tax_rate: 20, tax_cents: 4000, total_cents: 24000, currency: "eur", reason: "", issued_at: "2026-11-05T10:00:00.000Z", ...over });
const detail = (over: Record<string, unknown> = {}) => ({ invoice: row(), document: { any: true }, version: { basis: "immutable_register_snapshot", sha256: SHA }, links: m.invoiceLinks(ID(1)), related_invoice: null, credit_notes: [summary(2, { kind: "credit_note", related_invoice_id: ID(1), total_cents: 6000, tax_cents: 1000, number: "A-2026-2" })], credit_notes_page: { total: 1, complete: true }, ...over });

test("liste stricte : contrat exact ; liens opérateur, filtres non renvoyés, comptes incohérents, état « payé » ⇒ null", () => {
  assert.ok(m.parseInvoiceList(list([summary(1)]), FILTERS, 25, true));
  const bad = [
    null, {}, { ...list([summary(1)]), extra: 1 },
    list([summary(1, { links: { detail: `/api/invoices/${ID(1)}`, open: `/api/platform-operations/finance/invoices/${ID(1)}/pdf?inline=1`, download: `/api/invoices/${ID(1)}/pdf` } })]),
    list([summary(1, { document_state: "paid" })]), list([summary(1, { payment_status: "paid" })]), list([summary(1, { total_cents: 1.5 })]), list([summary(1, { currency: "usd" })]),
    list([summary(1, { kind: "credit_note" })]), // avoir sans facture liée
    list([summary(1, { basis: "platform_commission" })]), // hors filtre
    list([summary(1)], { filters: echo({}) }),
    list([summary(1)], { page: { limit: 25, total: 3, remaining: 1, has_more: false, next_cursor: null, complete: true } }), // 1re page : remaining ≠ total
    list([summary(1)], { page: { limit: 25, total: 1, remaining: 1, has_more: true, next_cursor: "c", complete: false } }),
    list([summary(1), summary(1)], { page: { limit: 25, total: 2, remaining: 2, has_more: false, next_cursor: null, complete: true } }),
  ];
  for (const b of bad) assert.equal(m.parseInvoiceList(b, FILTERS, 25, true), null, JSON.stringify(b).slice(0, 140));
  // Malformé / 503 ⇒ erreur + Réessayer (jamais une liste vide) ; 401/403/404 ⇒ refus honnête.
  for (const r of [res(503), res(200, { invoices: [] }), res(m.INVOICES_TIMEOUT), res(0)]) assert.equal(m.applyInvoiceList(m.INVOICES_INITIAL, r, FILTERS, 25, false).phase, "error");
  for (const status of [401, 403, 404]) assert.equal(m.applyInvoiceList(m.INVOICES_INITIAL, res(status), FILTERS, 25, false).phase, "denied");
  const err = renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: m.applyInvoiceList(m.INVOICES_INITIAL, res(503), FILTERS, 25, false) }));
  assert.match(err, /data-invoices-error="error"/);
  assert.match(err, />Réessayer</);
  assert.match(text(renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: m.applyInvoiceList(m.INVOICES_INITIAL, res(200, list([])), FILTERS, 25, false) }))), /Aucune facture émise\./);
});

test("affichage : montants exacts tels qu’enregistrés, facture vs avoir libellés, PDF uniquement via /api/invoices/:id/pdf, aucune action", () => {
  same([m.formatEuros(24000), m.formatEuros(1), m.formatEuros(123456789)].map((s) => s.replace(/\s/g, " ")), ["240,00 €", "0,01 €", "1 234 567,89 €"]);
  assert.equal(m.formatRate(5.5), "5,5 %");
  const s = m.applyInvoiceList(m.INVOICES_INITIAL, res(200, list([summary(1), summary(2, { kind: "credit_note", related_invoice_id: ID(1), number: "A-2026-2", total_cents: 6000, tax_cents: 1000 })], { page: { limit: 25, total: 2, remaining: 2, has_more: false, next_cursor: null, complete: true } })), FILTERS, 25, false);
  const html = renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: s }));
  const t = text(html).replace(/\s/g, " ");
  assert.match(t, /Facture F-2026-1 Prestation/);
  assert.match(t, /Avoir A-2026-2/);
  assert.match(t, /Total TTC 240,00 €/);
  assert.match(t, /Montant de l’avoir TTC 60,00 €/);
  assert.match(t, /L’émission d’une facture ou d’un avoir n’indique pas l’état du paiement\./);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replace(/&amp;/g, "&"));
  assert.ok(hrefs.length === 4 && hrefs.every((h) => /^\/api\/invoices\/[0-9a-f-]{36}\/pdf(\?inline=1)?$/.test(h)), hrefs.join(" "));
  assert.doesNotMatch(html, /platform-operations|payé|Réglé|Émettre|Rembourser|<form/);
  assert.match(t, /Fin de la liste\./); // dernière page : jamais présentée comme un total
});

test("détail strict : lignes et totaux enregistrés, facture liée / avoirs, empreinte ; incohérences ⇒ erreur", () => {
  assert.ok(m.parseInvoiceDetail(detail(), ID(1)));
  for (const b of [detail({ invoice: row({ subtotal_cents: 19999, total_cents: 23999 }) }), detail({ invoice: row({ tax_cents: 3999 }) }), detail({ links: { detail: "x", open: "y", download: "z" } }), detail({ related_invoice: summary(3) }), detail({ credit_notes_page: { total: 2, complete: true } }), detail({ credit_notes: [summary(2, { kind: "credit_note", related_invoice_id: ID(7) })] }), detail({ invoice: row({ id: ID(5) }) })])
    assert.equal(m.parseInvoiceDetail(b, ID(1)), null);
  let s = m.applyInvoiceList(m.INVOICES_INITIAL, res(200, list([summary(1)])), FILTERS, 25, false);
  s = m.applyInvoiceDetail({ ...s, detail: { id: ID(1), phase: "loading", data: null, error: "" } }, ID(1), res(200, detail()));
  const t = text(renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: s }))).replace(/\s/g, " ");
  for (const part of ["Diagnostic", "Disjoncteur", "Total HT 200,00 €", "TVA (20 %) 40,00 €", "Total TTC 240,00 €", "A-2026-2 · 60,00 € TTC", SHA]) assert.ok(t.includes(part), part);
  const credit = m.applyInvoiceDetail(s, ID(2), res(200, detail({ invoice: row({ id: ID(2), kind: "credit_note", related_invoice_id: ID(1), number: "A-2026-2", lines: [{ label: "Remise", quantity: 1, unit_price_cents: 5000 }], subtotal_cents: 5000, tax_cents: 1000, total_cents: 6000, reason: "Geste commercial" }), links: m.invoiceLinks(ID(2)), related_invoice: summary(1), credit_notes: [], credit_notes_page: { total: 0, complete: true } })));
  assert.equal(credit.detail?.phase, "ready");
  for (const status of [401, 404]) assert.equal(m.applyInvoiceDetail(s, ID(1), res(status)).detail?.phase, "denied");
  assert.equal(m.applyInvoiceDetail(s, ID(1), res(503)).detail?.phase, "error");
});

test("pages : « N sur total » tant qu’il en reste, curseur tel quel, dédoublonnage, total du 1er appel seulement", async () => {
  const cursor = "eyJ2IjoxfQ";
  const rows = Array.from({ length: 25 }, (_, i) => summary(i + 1, { issued_at: `2026-11-${String(28 - i).padStart(2, "0")}T10:00:00.000Z` }));
  const asked: (string | null)[] = [];
  const replies = [res(200, list(rows, { page: { limit: 25, total: 27, remaining: 27, has_more: true, next_cursor: cursor, complete: false } })), res(200, list([summary(25), summary(26)], { page: { limit: 25, total: 27, remaining: 2, has_more: false, next_cursor: null, complete: false } }))];
  let s: Model.InvoicesState = { ...m.INVOICES_INITIAL };
  const ctrl = m.createInvoicesController({ api: () => ({ list: async (_f, _l, c) => (asked.push(c), replies.shift()!), detail: async () => res(503) }), get: () => s, set: (n) => (s = n) });
  await ctrl.load(FILTERS);
  assert.match(text(renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: s }))), /25 document\(s\) affiché\(s\) sur 27\./);
  await ctrl.more();
  same(asked, [null, cursor]);
  same([s.invoices.length, s.total, s.page?.has_more], [26, 27, false]);
  const urls: string[] = [];
  await m.createInvoicesApi((async (u: string) => (urls.push(u), new Response("{}", { status: 200 }))) as unknown as typeof fetch).list({ organization_id: "50000000-0000-4000-8000-000000000001", basis: "service", kind: "invoice" }, 25, cursor);
  same(urls, [`/api/invoices?organization_id=50000000-0000-4000-8000-000000000001&kind=invoice&basis=service&limit=25&cursor=${cursor}`]);
});

test("filtres / identité : changement de type ⇒ page 1, réponse de l’ancien filtre ignorée ; génération/UID changés ⇒ ignorée ; démo sans appel", async () => {
  let resolveOld!: (r: Model.InvoicesResult) => void;
  const calls: Model.InvoiceFilters[] = [];
  const replies: (Model.InvoicesResult | Promise<Model.InvoicesResult>)[] = [new Promise((r) => (resolveOld = r)), res(200, list([summary(9, { kind: "credit_note", related_invoice_id: ID(1) })], {}, { basis: "service", kind: "credit_note" }))];
  let s: Model.InvoicesState = { ...m.INVOICES_INITIAL };
  let uid = "u1";
  const ctrl = m.createInvoicesController({ api: () => ({ list: async (f) => (calls.push(f), replies.shift()!), detail: async () => res(503) }), context: { generation: () => 0, userId: () => uid }, get: () => s, set: (n) => (s = n) });
  const old = ctrl.load(FILTERS);
  await ctrl.load({ basis: "service", kind: "credit_note" });
  resolveOld(res(200, list([summary(1)])));
  assert.equal(await old, false);
  same([s.invoices.map((i) => i.id), calls.length], [[ID(9)], 2]);
  // Identité changée pendant l’attente ⇒ réponse ignorée.
  let resolve!: (r: Model.InvoicesResult) => void;
  const c2 = m.createInvoicesController({ api: () => ({ list: () => new Promise((r) => (resolve = r)), detail: async () => res(503) }), context: { generation: () => 0, userId: () => uid }, get: () => s, set: (n) => (s = n) });
  const p = c2.load(FILTERS);
  uid = "u2";
  resolve(res(200, list([summary(4)])));
  assert.equal(await p, false);
  // Démo : note honnête, aucun appel.
  let demoCalls = 0;
  let d: Model.InvoicesState = { ...m.INVOICES_INITIAL };
  const c3 = m.createInvoicesController({ api: () => ({ list: async () => (demoCalls++, res(200)), detail: async () => (demoCalls++, res(200)) }), get: () => d, set: (n) => (d = n), demo: true });
  await c3.load(FILTERS);
  await c3.openDetail(ID(1));
  same([d.phase, demoCalls], ["demo", 0]);
  assert.match(text(renderToString(createElement(panel.CustomerInvoicesPanel, { filters: FILTERS, initial: d, demo: true }))), /En démonstration, aucune facture n’est émise/);
  assert.match(readFileSync("components/features/customer-invoices/customer-invoices-panel.tsx", "utf8"), /<Panel key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{filtersKey\(props\.filters\)\}`\} \{\.\.\.props\} \/>/);
});

test("câblage : client = factures de prestation, artisan = commissions qui lui sont adressées ; pas d’enterprise-space", () => {
  assert.match(readFileSync("components/role/client-space.tsx", "utf8"), /<CustomerInvoicesPanel filters=\{\{ basis: "service" \}\} context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} \/>/);
  assert.match(readFileSync("components/role/artisan-space.tsx", "utf8"), /<CustomerInvoicesPanel filters=\{\{ basis: "platform_commission" \}\} context=\{session\.mutationContext\} demo=\{session\.mode === "demo"\} title="Factures de commission de la plateforme" \/>/);
});

test("ROOT : détail A ouvert → load d’un autre type → A répond tard ⇒ le détail reste null", async () => {
  let s: Model.InvoicesState = { ...m.INVOICES_INITIAL };
  let resolveDetail: (v: ReturnType<typeof res>) => void = () => {};
  const lists = [res(200, list([summary(1)])), res(200, list([], {}, { ...FILTERS, kind: "credit_note" }))];
  const ctrl = m.createInvoicesController({
    api: () => ({ list: async () => lists.shift()!, detail: () => new Promise((r) => (resolveDetail = r)) }),
    context: { generation: () => 0, userId: () => "u" },
    get: () => s,
    set: (n) => (s = n),
  });
  await ctrl.load(FILTERS);
  const opening = ctrl.openDetail(ID(1)); // A pending
  assert.equal(s.detail?.id, ID(1));
  await ctrl.load({ ...FILTERS, kind: "credit_note" }); // filter change
  assert.equal(s.detail, null);
  resolveDetail(res(200, detail()));
  assert.equal(await opening, false, "late A reply dropped");
  assert.equal(s.detail, null, "A never reappears after the filter change");
});

test("ROOT : clé du panneau = uid + génération + mode + filtres (vidage immédiat à uid constant)", () => {
  const src = readFileSync("components/features/customer-invoices/customer-invoices-panel.tsx", "utf8");
  assert.match(src, /key=\{`\$\{ctx\.userId\(\) \?\? "-"\}\|\$\{ctx\.generation\(\)\}\|\$\{props\.demo \? "demo" : "live"\}\|\$\{filtersKey\(props\.filters\)\}`\}/);
  const model = readFileSync("components/features/customer-invoices/invoices-model.ts", "utf8");
  assert.match(model, /load\(filters\?: InvoiceFilters\) \{\s+detailSeq\+\+;/);
});

test("factures du dossier : client et entreprise filtrent par intervention_id, seulement terminé/réglé", () => {
  const client = readFileSync("components/role/client-space.tsx", "utf8");
  assert.match(client, /\(i\.status === "completed" \|\| i\.status === "paid"\) && \(\s*<CustomerInvoicesPanel title="Factures et avoirs de ce dossier" filters=\{\{ intervention_id: i\.id, basis: "service" \}\} context=\{session\.mutationContext\} demo=\{demo\} \/>/);
  const ent = readFileSync("components/role/enterprise-space.tsx", "utf8");
  assert.match(ent, /\(intervention\.status === "completed" \|\| intervention\.status === "paid"\) && \(\s*<CustomerInvoicesPanel\s+title="Factures et avoirs de ce dossier"\s+filters=\{\{ intervention_id: intervention\.id, basis: "service", \.\.\.\(c\.organization \? \{ organization_id: c\.organization\.id \} : \{\}\) \}\}/);
  // The real filter key differs per dossier: two dossiers never share a panel (cursor/detail).
  assert.notEqual(m.filtersKey({ intervention_id: JOB, basis: "service" }), m.filtersKey({ intervention_id: QUOTE, basis: "service" }));
});
