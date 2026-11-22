// QA batch 5 (web residual gaps): pure rules behind the fixes — specific refusals, references,
// honest function labels, saved postal codes, offer photos and equipment-side links.
import test from "node:test";
import assert from "node:assert/strict";
import { dbError } from "../lib/supabase/server";
import { quoteReference } from "../shared/order-reference";
import { quoteRef } from "../components/app/format";
import { invoiceDocumentInput } from "../lib/features/platform-operations/invoice-document";
import { financeConfig, invoiceFunctionLabel, refundFunctionLabel } from "../lib/features/platform-operations/config";
import { clearCoverageCache, codesToCheck, readNotCoveredCached, SAVED_CHECK_CAP } from "../components/features/coverage/model";
import { confirmsChoice, offerPhotoError, offerPhotosOpen, parseSharedIds, shareablePhotos } from "../components/features/offer-photos/model";
import { dossiersOfAsset, parseAssetLinksPage, type LinkRow } from "../components/features/site-asset-links/asset-links-model";

const refused = (run: () => void, status: number, re: RegExp) =>
  assert.throws(run, (e: { status?: number; message: string }) => e.status === status && re.test(e.message));

test("refus propres à une route : invitation indisponible, déjà membre, avis en double ; le reste garde le message général", () => {
  const invitation = { messages: { "Invitation unavailable": "Ce lien d’invitation n’est plus valable.", "Already a member": "Vous êtes déjà membre." } };
  refused(() => dbError({ code: "P0001", message: "Invitation unavailable" }, invitation), 409, /lien d’invitation/);
  refused(() => dbError({ code: "P0001", message: "Already a member" }, invitation), 409, /déjà membre/);
  refused(() => dbError({ code: "P0001", message: "Autre refus" }, invitation), 409, /L’état du dossier a changé/);
  refused(() => dbError({ code: "P0001", message: "toString" }, invitation), 409, /L’état du dossier a changé/);
  refused(() => dbError({ code: "23505" }, { duplicate: "Vous avez déjà laissé un avis pour cette intervention." }), 409, /déjà laissé un avis/);
  refused(() => dbError({ code: "23505" }), 409, /L’état du dossier a changé/);
  refused(() => dbError({ code: "42501" }, { duplicate: "x", messages: {} }), 403, /accès/);
  assert.doesNotThrow(() => dbError(null, invitation));
});

test("référence de devis : la facture PDF reprend celle de l’application (DEV- + 6 caractères)", () => {
  const id = "6cce6539-0000-4000-8000-000000000001";
  assert.equal(quoteReference(id), "DEV-6CCE65");
  assert.equal(quoteRef(id), quoteReference(id));
  assert.equal(quoteReference("quote-demo1"), "DEV-DEMO1");
  const row = { kind: "invoice", number: "F2026-000001", issued_at: "2026-11-21T10:00:00Z", currency: "eur", issuer: { legal_name: "A", siret: "1", address: "x" }, recipient: { name: "C", address: "y" }, lines: [{ label: "L", quantity: 1, unit_price_cents: 1000 }], subtotal_cents: 1000, tax_rate: 8.5, tax_cents: 85, total_cents: 1085, reason: "", quote_id: id, intervention_id: "10000000-0000-4000-8000-000000000001" };
  assert.equal(invoiceDocumentInput(row as never, null).quote_reference, "DEV-6CCE65");
});

test("fonctions activées : la ligne Factures suit l’état réel de Finance, sans affirmer sans lecture", () => {
  const capabilities = { support: false, support_reply: false, support_status: false, operators: false, audit: false, finance: true, reviews_moderation: false, refund_execution: false, invoice_rendering: true };
  const withIssuer = { capabilities, config: financeConfig({}, null, true) };
  const label = invoiceFunctionLabel(withIssuer, false);
  assert.match(label, /^Oui — factures de prestation émises manuellement depuis Finance \(PDF disponible\)/);
  assert.match(label, /émetteur plateforme configuré ; elles exigent aussi un taux de TVA sur la commission/);
  assert.match(invoiceFunctionLabel({ capabilities, config: financeConfig({}, null, false) }, false), /Factures de commission indisponibles : émetteur plateforme non configuré/);
  assert.match(invoiceFunctionLabel({ capabilities: { ...capabilities, finance: false }, config: financeConfig({}, null, false) }, false), /Non vérifiable/);
  assert.equal(invoiceFunctionLabel(null, false), "État non vérifié");
  assert.equal(invoiceFunctionLabel(null, true), "Oui");
  assert.match(refundFunctionLabel(withIssuer, false), /exécution du remboursement n’est pas activée/);
  assert.match(refundFunctionLabel({ ...withIssuer, capabilities: { ...capabilities, refund_execution: true } }, false), /^Oui/);
  for (const text of [label, refundFunctionLabel(withIssuer, false)]) assert.ok(!/^Non$/.test(text));
});

test("codes postaux enregistrés : vérification bornée, codes isolés d’abord, réponses vérifiées réutilisées", async () => {
  const many = Array.from({ length: 30 }, (_, i) => `972${String(i).padStart(2, "0")}`);
  const picked = codesToCheck([...many, "75001"]);
  assert.equal(picked.length, SAVED_CHECK_CAP);
  assert.equal(picked[0], "75001", "le code d’un autre département passe avant la limite");
  assert.deepEqual(codesToCheck(["97240", "75001"], ["97240"]), ["97240", "75001"]);
  assert.deepEqual(codesToCheck(["97240", "97240", "abc"], ["13001"]), ["97240"], "ni doublon, ni code retiré, ni saisie invalide");
  assert.deepEqual(codesToCheck(["97240"], [], 0), []);
  clearCoverageCache();
  let calls = 0, fail = false, clock = 1_000;
  const fetcher = (async (url: string) => {
    calls++;
    if (fail) return new Response("{}", { status: 503 });
    return Response.json({ status: String(url).includes("75001") ? "not_covered" : "covered", version: 1 });
  }) as unknown as typeof fetch;
  const now = () => clock;
  assert.deepEqual(await Promise.all([readNotCoveredCached(fetcher, "75001", now), readNotCoveredCached(fetcher, "75001", now)]), [true, true]);
  assert.equal(calls, 1, "une seule lecture pour deux demandes simultanées");
  assert.equal(await readNotCoveredCached(fetcher, "75001", now), true);
  assert.equal(await readNotCoveredCached(fetcher, "97240", now), false);
  assert.equal(await readNotCoveredCached(fetcher, "97240", now), false);
  assert.equal(calls, 2);
  clock += 6 * 60_000;
  assert.equal(await readNotCoveredCached(fetcher, "75001", now), true);
  assert.equal(calls, 3, "une réponse ancienne est relue");
  fail = true;
  assert.equal(await readNotCoveredCached(fetcher, "13001", now), false);
  fail = false;
  await readNotCoveredCached(fetcher, "13001", now);
  assert.equal(calls, 5, "un échec n’est jamais mémorisé");
  assert.equal(await readNotCoveredCached(fetcher, "abc", now), false);
  assert.equal(calls, 5);
  clearCoverageCache();
});

test("photos de la demande : partage offert au seul demandeur tant que la demande est ouverte, choix confirmé par le serveur", () => {
  const me = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002";
  const viewer = { id: me, role: "client", live: true };
  assert.equal(offerPhotosOpen({ status: "requested", artisan_id: null, client_id: me }, viewer), true);
  assert.equal(offerPhotosOpen({ status: "assigned", artisan_id: other, client_id: me }, viewer), false);
  assert.equal(offerPhotosOpen({ status: "requested", artisan_id: other, client_id: me }, viewer), false);
  assert.equal(offerPhotosOpen({ status: "requested", client_id: other }, viewer), false);
  assert.equal(offerPhotosOpen({ status: "requested", client_id: me }, { ...viewer, role: "manager" }), false);
  assert.equal(offerPhotosOpen({ status: "requested", client_id: me }, { ...viewer, live: false }), false);
  const docs = [{ id: "a", owner_id: me, mime_type: "image/jpeg" }, { id: "b", owner_id: other, mime_type: "image/png" }, { id: "c", owner_id: me, mime_type: "application/pdf" }, { id: "d", mime_type: "image/webp" }];
  assert.deepEqual(shareablePhotos(docs, me).map((d) => d.id), ["a"]);
  assert.deepEqual(shareablePhotos(docs, null), []);
  const id = "D0000000-0000-4000-8000-000000000001";
  assert.deepEqual(parseSharedIds({ items: [{ id }] }), [id.toLowerCase()]);
  assert.equal(parseSharedIds({ items: [{ id, path: "x" }] }), null);
  assert.equal(parseSharedIds({ items: Array.from({ length: 7 }, () => ({ id })) }), null);
  assert.equal(confirmsChoice({ shared: false }, false), true);
  assert.equal(confirmsChoice({ shared: true }, false), false);
  assert.equal(confirmsChoice(null, true), false);
  assert.match(offerPhotoError(409, false), /plus ouverte aux offres/);
  assert.match(offerPhotoError(422, true), /6 photos au plus/);
  assert.match(offerPhotoError(0, false), /n’a pas pu être vérifié/);
});

test("équipement : ses interventions liées, une ligne par dossier, lien actif d’abord, page d’un autre actif refusée", () => {
  const SITE = "50000000-0000-4000-8000-000000000001", EQ = "e0000000-0000-4000-8000-000000000001";
  const job = (n: number) => `20000000-0000-4000-8000-00000000000${n}`;
  const row = (n: number, j: number, over: Record<string, unknown> = {}) => ({
    id: `f0000000-0000-4000-8000-00000000000${n}`, site_id: SITE, intervention_id: job(j), kind: "equipment", asset_id: EQ, active: true, version: 1,
    created_at: `2026-11-0${n}T10:00:00.000Z`, updated_at: `2026-11-0${n}T10:00:00.000Z`, detached_at: null,
    intervention: { id: job(j), category: "outage", status: "paid", created_at: `2026-10-0${j}T08:00:00.000Z` }, asset_archived: false, ...over,
  });
  const body = (records: unknown[]) => ({ records, page: { limit: 50, has_more: false, next_cursor: null, complete: true }, permissions: { can_write: false }, site_archived: false, limits: { active_per_intervention: 50, history_per_intervention: 100 } });
  const detached = row(1, 1, { active: false, version: 2, updated_at: "2026-11-05T10:00:00.000Z", detached_at: "2026-11-05T10:00:00.000Z" });
  const page = parseAssetLinksPage(body([detached, row(2, 2), row(3, 3)]), SITE, "equipment", EQ, true);
  assert.ok(page);
  const list = dossiersOfAsset(page.records as LinkRow[]);
  assert.deepEqual(list.map((d) => [d.interventionId, d.active]), [[job(3), true], [job(2), true], [job(1), false]]);
  assert.equal(list[2].detachedAt, "2026-11-05T10:00:00.000Z");
  assert.equal(dossiersOfAsset([row(1, 1), row(2, 1, { updated_at: "2026-11-09T10:00:00.000Z" })] as LinkRow[]).length, 1);
  assert.equal(parseAssetLinksPage(body([row(1, 1, { asset_id: "e0000000-0000-4000-8000-000000000009" })]), SITE, "equipment", EQ, true), null);
  assert.equal(parseAssetLinksPage(body([row(1, 1)]), SITE, "area", EQ, true), null);
  assert.equal(parseAssetLinksPage(body([row(2, 1), row(1, 2)]), SITE, "equipment", EQ, true), null);
  assert.deepEqual(parseAssetLinksPage(body([]), SITE, "equipment", EQ, true)?.records, []);
});
