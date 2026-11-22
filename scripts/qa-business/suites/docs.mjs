// Suite `docs` (contract §6, lot 015): real validity, real private PDF downloads, quote acceptance
// through the existing client flow, amendment prepared/accepted without any payment action,
// third party and former artisan refused, expired quote refused server-side.
// Markup reference (b13b43a): components/features/quote-documents/*.tsx, components/role/
// artisan-space.tsx (#mission/<id> → WorkDossier → QuotePanel), client-space.tsx (#detail/<id> →
// « Consulter le devis » / « Voir le devis » → QuoteView #quote/<quoteId>, documents panel and « Accepter le devis »).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { login, openHash, api, capture, bodyText, expectVisible, expectAbsentOrDisabled, postsTo, waitForApi, sleep, noHorizontalOverflow } from "../../qa/lib/browser.mjs";
import { AppDefect } from "../../qa/lib/report.mjs";
import { euroDigits, expectedEtag, inspectPdf, quoteReference } from "../lib/pdf.mjs";
import { assertNoUiWrites, settledBaseline } from "../lib/network.mjs";
import { acceptedStatusShown, isId, scenarioWhen, snapshotValidUntil } from "../lib/prerequisites.mjs";

const PANEL = 'section[aria-labelledby="quote-documents-title"]';
const isoPlusDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** Downloads a private document with the browser identity (cookies of the context). Never follows the overview JSON. */
async function download(handle, out, name, href, expect, s) {
  const response = await handle.context.request.get(href, { maxRedirects: 0 });
  const headers = response.headers();
  const bytes = Buffer.from(await response.body().catch(() => Buffer.alloc(0)));
  const verdict = inspectPdf(bytes, { status: response.status(), contentType: headers["content-type"], contentLength: headers["content-length"], expect });
  verdict.disposition = headers["content-disposition"] ?? null;
  verdict.etag = headers["etag"] ?? null;
  verdict.cache = headers["cache-control"] ?? null;
  if (verdict.ok) {
    const file = path.join(out, `${name}.pdf`);
    await writeFile(file, bytes, { mode: 0o600 });
    s.evidence(file, "download");
  }
  return verdict;
}

/**
 * Client path to the documents panel, as a user does it: the dossier (#detail/<id>) then the real
 * « Consulter le devis » (quoted) or « Voir le devis » (accepted) button, which must land on
 * QuoteView for the EXACT quote version (#quote/<quoteId>). A different version is a FAIL.
 */
async function openClientQuote(page, base, job, quote) {
  await openHash(page, base, `detail/${job.id}`);
  const button = page.getByRole("button", { name: /^(Consulter le devis|Voir le devis)$/ }).first();
  await expectVisible(button, "« Consulter le devis » / « Voir le devis » on the client dossier");
  await button.click();
  await page.waitForFunction((id) => window.location.hash === `#quote/${id}`, quote.id, { timeout: 15000 }).catch(() => null);
  const hash = await page.evaluate(() => window.location.hash);
  assert.equal(hash, `#quote/${quote.id}`, `the client button opened ${hash}, expected the exact quote version`);
  return page.locator('section[aria-label="Documents du devis et avenants"]');
}
const noPayments = (h) => assert.deepEqual(h.network.filter((n) => n.path.startsWith("/api/payments")), [], "a payment route was called");

export const suite = {
  name: "docs",
  description: "Quote documents (015): validity, private PDF, acceptance, amendment without payment, third party / former artisan / expired quote refused",
  needsCredentials: true,
  plan: [
    "client, artisan (complete issuer dossier), replacement artisan, third party (client profile)",
    "dossier D1 quoted + quote Q1 sent (1 line 100,00 € HT, TVA 20 % → 120,00 € TTC)",
    "dossier D2 quoted + quote Q2 sent + quote_terms.valid_until = yesterday (synthetic, service role, labelled QA)",
  ],
  async run(ctx) {
    /** Every application write probe checks the stop gate first. */
    const post = (page, route, body) => ctx.mutation(() => api(page, route, body));
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const client = await fixtures.createUser("client", "client");
    const artisan = await fixtures.createUser("artisan", "artisan");
    const artisan2 = await fixtures.createUser("artisan-remplacant", "artisan");
    const tiers = await fixtures.createUser("tiers", "client");
    const d1 = await fixtures.createIntervention({ client, artisan, description: "dossier technique D1 (documents)", status: "quoted", category: "panel" });
    const q1 = await fixtures.createQuote({ intervention: d1, artisan });
    const d2 = await fixtures.createIntervention({ client, artisan, description: "dossier technique D2 (validité dépassée)", status: "quoted", category: "panel" });
    const q2 = await fixtures.createQuote({ intervention: d2, artisan });
    const expired = await fixtures.setQuoteTermsInThePast({ quote: q2, artisan });
    const ref1 = quoteReference(q1.id);
    const validUntil = isoPlusDays(30);
    const state = { documentId: null, etag: null, bytes: 0, amendmentId: null };

    await report.scenario(suite.name, "artisan: explicit validity through the UI, past date refused without POST", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login artisan", () => login(h, base, artisan, projectRef));
        await s.step("open the mission and the documents panel", async () => {
          await openHash(h.page, base, `mission/${d1.id}`);
          await expectVisible(h.page.locator(PANEL).getByRole("heading", { name: "Documents, validité et avenants du devis", exact: true }), "artisan documents panel title");
          await expectVisible(h.page.locator(PANEL).getByRole("heading", { name: `Devis ${ref1}`, exact: true }), `quote card ${ref1}`);
          await expectVisible(h.page.locator(PANEL).getByText("Validité non renseignée par l’émetteur", { exact: true }), "validity unspecified before the artisan sets it");
        });
        await s.step("past date refused near the field, no request sent", async () => {
          const before = h.network.length;
          await h.page.locator(PANEL).getByLabel("Valable jusqu’au (inclus)", { exact: true }).fill(isoPlusDays(-2));
          await h.page.locator(PANEL).getByRole("button", { name: "Enregistrer la validité", exact: true }).click();
          await expectVisible(h.page.locator(PANEL).getByText("La date de validité ne peut pas être déjà passée.", { exact: true }), "field error for a past date");
          assert.deepEqual(postsTo(h.network.slice(before)), [], "a POST was sent for a refused past date");
        });
        await s.step("valid date saved: POST 200, label updated, quote_terms readback", async () => {
          await h.page.locator(PANEL).getByLabel("Valable jusqu’au (inclus)", { exact: true }).fill(validUntil);
          const wait = waitForApi(h.page, "/api/quote-documents", { method: "POST" });
          await ctx.mutatingClick(h.page.locator(PANEL).getByRole("button", { name: "Enregistrer la validité", exact: true }), wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 200);
          await expectVisible(h.page.locator(PANEL).getByText(/^Valable jusqu’au .* inclus$/), "validity label with the saved date");
          const [terms] = await db.select("quote_terms", { quote_id: `eq.${q1.id}` }, "valid_until,set_by");
          assert.equal(terms?.valid_until, validUntil, "quote_terms readback");
          assert.equal(terms?.set_by, artisan.id);
          const events = await db.select("quote_document_events", { quote_id: `eq.${q1.id}`, action: "eq.terms_set" }, "id");
          assert.equal(events.length, 1, "one terms_set event");
          return { valid_until: validUntil };
        });
        await s.step("capture 1280", () => capture(h, out, "docs-artisan-validity-1280", s));
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "artisan: real PDF of the quote, private download, idempotent regeneration", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login artisan", () => login(h, base, artisan, projectRef));
        await s.step("generate: POST 201, one document revision 1", async () => {
          await openHash(h.page, base, `mission/${d1.id}`);
          const button = h.page.locator(PANEL).getByRole("button", { name: "Générer le PDF du devis", exact: true });
          await expectVisible(button, "'Générer le PDF du devis'");
          const wait = waitForApi(h.page, "/api/quote-documents", { method: "POST" });
          await ctx.mutatingClick(button, wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 201, "first generation must create (201)");
          const docs = await db.select("quote_documents", { quote_id: `eq.${q1.id}`, amendment_id: "is.null" }, "id,kind,revision,reference,snapshot_sha256,snapshot");
          assert.equal(docs.length, 1, "exactly one quote document");
          assert.equal(docs[0].kind, "quote");
          assert.equal(docs[0].revision, 1);
          assert.equal(docs[0].reference, ref1, "document reference");
          assert.equal(docs[0].snapshot?.quote?.total_cents, q1.total_cents, "snapshot carries the exact quote total");
          // 015 quote_document_snapshot / snapshot.ts: validity lives under snapshot.quote.terms.
          assert.equal(snapshotValidUntil(docs[0].snapshot), validUntil, "snapshot carries the explicit validity");
          state.documentId = docs[0].id;
          state.etag = expectedEtag(docs[0]);
          return { document_id: docs[0].id, revision: 1 };
        });
        await s.step("private download: 200 application/pdf, non-empty, reference and TTC amount in the bytes", async () => {
          const link = h.page.locator(PANEL).getByRole("link", { name: "Télécharger", exact: true }).first();
          await expectVisible(link, "'Télécharger' link");
          const href = await link.getAttribute("href");
          assert.equal(href, `/api/quote-documents/${state.documentId}`, "download href is the private route");
          const verdict = await download(h, out, "docs-quote-r1", `${base}${href}`, ["DEVIS", ref1, euroDigits(q1.total_cents), "Total TTC"], s);
          assert.ok(verdict.ok, `PDF verdict: ${JSON.stringify(verdict)}`);
          assert.equal(verdict.etag, state.etag, "ETag reflects snapshot fingerprint and revision");
          assert.match(String(verdict.disposition), /^attachment; filename="/);
          assert.equal(verdict.cache, "private, no-store");
          state.bytes = verdict.bytes;
          const downloads = await db.select("quote_document_events", { document_id: `eq.${state.documentId}`, action: "eq.document_downloaded" }, "actor_id");
          assert.equal(downloads.length, 1, "one download event");
          assert.equal(downloads[0].actor_id, artisan.id);
          return verdict;
        });
        await s.step("second generation: 200 created=false, still one revision", async () => {
          const r = await post(h.page, "/api/quote-documents", { action: "generate", quote_id: q1.id, amendment_id: null });
          assert.equal(r.status, 200);
          assert.equal(r.body?.created, false);
          assert.equal(await db.count("quote_documents", { quote_id: `eq.${q1.id}` }), 1);
          return { created: r.body?.created };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await scenarioWhen(report, suite.name, "client: reads the right version and amounts, downloads the same PDF, may request generation, no issuer control, no POST", { quote_document_id: isId(state.documentId), quote_document_etag: Boolean(state.etag), artisan_download_size: state.bytes > 0 }, async (s) => {
      const h = await ctx.openPage(s, { width: 360, height: 780 });
      try {
        await s.step("login client", () => login(h, base, client, projectRef));
        const readingWindow = await settledBaseline(h, { driverMutations: 0, origin: base });
        await s.step("documents section of the dossier", async () => {
          const section = await openClientQuote(h.page, base, d1, q1);
          await expectVisible(section.getByRole("heading", { name: "Document du devis et avenants", exact: true }), "client documents title");
          await expectVisible(section.getByRole("heading", { name: `Devis ${ref1}`, exact: true }), "quote card");
          await expectVisible(section.getByText(`${euroDigits(q1.total_cents)}`, { exact: false }).first(), "TTC amount");
          await expectVisible(section.getByText(/^Valable jusqu’au .* inclus$/), "validity shown to the client");
          await sleep(500);
          await expectAbsentOrDisabled(section.getByRole("button", { name: "Enregistrer la validité", exact: true }), "'Enregistrer la validité' for the client");
          // Approved contract (CLAUDE_ADV_DOCUMENTS_CONTRACT, generate_quote_document: « artisan auteur,
          // owns_intervention ou admin »; owns_intervention = client or site manager with write): the
          // requesting client MAY request the canonical server PDF; issuer/validity edits stay artisan-only.
          await expectVisible(section.getByRole("button", { name: /^(Générer le PDF du devis|Mettre à jour le PDF du devis)$/ }), "generation offered to the requesting client (approved contract)");
          const overview = await api(h.page, `/api/quote-documents?quote_id=${q1.id}`);
          assert.equal(overview.status, 200);
          const perms = overview.body?.quotes?.[0]?.permissions;
          assert.deepEqual({ can_generate: perms?.can_generate, can_set_terms: perms?.can_set_terms, can_propose: perms?.can_propose }, { can_generate: true, can_set_terms: false, can_propose: false }, "client: generation yes, issuer validity and amendment no");
          await expectAbsentOrDisabled(section.getByRole("button", { name: "Proposer un avenant", exact: true }), "'Proposer un avenant' for the client");
        });
        await s.step("client download: same bytes and ETag as the artisan's", async () => {
          const verdict = await download(h, out, "docs-quote-r1-client", `${base}/api/quote-documents/${state.documentId}`, [ref1, euroDigits(q1.total_cents)], s);
          assert.ok(verdict.ok, `PDF verdict: ${JSON.stringify(verdict)}`);
          assert.equal(verdict.etag, state.etag);
          assert.equal(verdict.bytes, state.bytes, "same document size for the client");
          return verdict;
        });
        await s.step("no horizontal overflow at 360 and capture", async () => {
          await noHorizontalOverflow(h.page, 360);
          await capture(h, out, "docs-client-360", s);
        });
        await s.step("browser: no write during the client's reading", () => assertNoUiWrites(h, readingWindow));
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "client accepts the quote (existing flow), artisan prepares an amendment, client accepts it: distinct from any payment", async (s) => {
      const hc = await ctx.openPage(s, {});
      const ha = await ctx.openPage(s, {});
      try {
        await s.step("login client and artisan", async () => {
          await login(hc, base, client, projectRef);
          await login(ha, base, artisan, projectRef);
        });
        await s.step("client: 'Accepter le devis' on QuoteView → actions 200, quote accepted, no payment route", async () => {
          await openClientQuote(hc.page, base, d1, q1);
          const button = hc.page.getByRole("button", { name: "Accepter le devis", exact: true });
          await expectVisible(button, "'Accepter le devis'");
          const wait = waitForApi(hc.page, `/api/interventions/${d1.id}/actions`, { method: "POST" });
          await ctx.mutatingClick(button, wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 200, "accept_quote answered " + response.status());
          const [quote] = await db.select("quotes", { id: `eq.${q1.id}` }, "status,accepted_at");
          assert.equal(quote.status, "accepted");
          assert.ok(quote.accepted_at);
          const [job] = await db.select("interventions", { id: `eq.${d1.id}` }, "status");
          assert.equal(job.status, "accepted");
          noPayments(hc);
          return { quote_status: quote.status };
        });
        await s.step("artisan: amendment proposed through the form (2 × 25,00 € HT, TVA 20 %) → 201, server-computed totals", async () => {
          await openHash(ha.page, base, `mission/${d1.id}`);
          const panel = ha.page.locator(PANEL);
          const open = panel.getByRole("button", { name: "Proposer un avenant", exact: true });
          await expectVisible(open, "'Proposer un avenant'");
          await open.click();
          await expectVisible(panel.getByText(`Proposer un avenant au devis ${ref1}`, { exact: true }), "amendment form legend");
          await panel.getByLabel("Prestation 1", { exact: true }).fill(cohort.name("complément").slice(0, 160));
          await panel.getByLabel("Quantité", { exact: true }).fill("2");
          await panel.getByLabel("Prix unitaire HT (€)", { exact: true }).fill("25");
          await panel.getByLabel("TVA", { exact: true }).selectOption("20");
          await panel.getByLabel("Motif de l’avenant", { exact: true }).fill(cohort.description("avenant de recette : prestation complémentaire"));
          const wait = waitForApi(ha.page, "/api/quote-amendments", { method: "POST" });
          await ctx.mutatingClick(panel.getByRole("button", { name: "Proposer l’avenant", exact: true }), wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 201, "propose answered " + response.status());
          const amendments = await db.select("quote_amendments", { base_quote_id: `eq.${q1.id}` }, "id,version,status,subtotal_cents,tax_rate,tax_cents,total_cents,artisan_id");
          assert.equal(amendments.length, 1);
          assert.deepEqual({ version: amendments[0].version, status: amendments[0].status, subtotal_cents: amendments[0].subtotal_cents, tax_cents: amendments[0].tax_cents, total_cents: amendments[0].total_cents }, { version: 1, status: "proposed", subtotal_cents: 5000, tax_cents: 1000, total_cents: 6000 }, "server arithmetic");
          state.amendmentId = amendments[0].id;
          await expectVisible(panel.getByText(`Avenant n° 1 — ${quoteReference(q1.id, 1)}`, { exact: true }), "amendment card");
          await expectVisible(panel.getByText("Proposé, en attente de décision", { exact: true }), "proposed status");
          return { amendment_id: state.amendmentId };
        });
        await s.step("client: accept the amendment with confirmation → 200, status accepted, nothing paid, no payment route", async () => {
          const section = await openClientQuote(hc.page, base, d1, q1);
          const accept = section.getByRole("button", { name: "Accepter l’avenant", exact: true });
          await expectVisible(accept, "'Accepter l’avenant' for the client");
          await accept.click();
          const confirm = section.getByRole("button", { name: "Confirmer l’acceptation", exact: true });
          await expectVisible(confirm, "'Confirmer l’acceptation'");
          const wait = waitForApi(hc.page, "/api/quote-amendments", { method: "POST" });
          await ctx.mutatingClick(confirm, wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 200, "accept answered " + response.status());
          const [am] = await db.select("quote_amendments", { id: `eq.${state.amendmentId}` }, "status,decided_by,decided_at");
          assert.equal(am.status, "accepted");
          assert.equal(am.decided_by, client.id);
          assert.ok(am.decided_at);
          const audit = await db.select("audit_log", { intervention_id: `eq.${d1.id}`, action: "eq.amendment_accepted" }, "id");
          assert.equal(audit.length, 1, "audit_log amendment_accepted");
          noPayments(hc);
          assert.equal(await db.count("payments", { quote_id: `eq.${q1.id}` }), 0, "acceptance creates no payment");
          const text = await bodyText(hc.page);
          assert.ok(text.includes("Le règlement sur la plateforme porte sur le devis accepté et ses avenants acceptés."), "the panel explains the future payment basis");
          assert.ok(!/avenant[^\n]*pay[ée]/i.test(text), "no wording presents the amendment as paid");
          await capture(hc, out, "docs-client-amendment-accepted-1280", s);
          return { status: am.status };
        });
        await s.step("server: a second acceptance of the same amendment is refused (409)", async () => {
          const r = await post(hc.page, "/api/quote-amendments", { action: "accept", amendment_id: state.amendmentId });
          assert.equal(r.status, 409, `second acceptance answered ${r.status}`);
          return { status: r.status, error: r.body?.error };
        });
        await s.step("artisan: amendment PDF generated and privately downloaded (AVENANT N° 1, 60,00)", async () => {
          await openHash(ha.page, base, `mission/${d1.id}`);
          const panel = ha.page.locator(PANEL);
          const button = panel.getByRole("button", { name: "Générer le PDF de l’avenant", exact: true });
          await expectVisible(button, "'Générer le PDF de l’avenant'");
          const wait = waitForApi(ha.page, "/api/quote-documents", { method: "POST" });
          await ctx.mutatingClick(button, wait); // gate checked right before the click; drain waits for click + response
          assert.equal((await wait).status(), 201);
          const docs = await db.select("quote_documents", { amendment_id: `eq.${state.amendmentId}` }, "id,kind,revision,reference,snapshot_sha256");
          assert.equal(docs.length, 1);
          assert.equal(docs[0].kind, "amendment");
          assert.equal(docs[0].revision, 1);
          const verdict = await download(ha, out, "docs-amendment-r1", `${base}/api/quote-documents/${docs[0].id}`, [`AVENANT N° 1 AU DEVIS ${ref1}`, docs[0].reference, euroDigits(6000)], s);
          assert.ok(verdict.ok, `PDF verdict: ${JSON.stringify(verdict)}`);
          assert.equal(verdict.etag, expectedEtag(docs[0]));
          return verdict;
        });
        s.network([...hc.network, ...ha.network]);
      } finally {
        await hc.close();
        await ha.close();
      }
    });

    await scenarioWhen(report, suite.name, "third party: overview 403, download 404, dossier not shown, no POST", { quote_document_id: isId(state.documentId) }, async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login third party", () => login(h, base, tiers, projectRef));
        const beforeProbes = h.network.length;
        let window = null;
        await s.step("server refusals from the third party's session", async () => {
          const overview = await api(h.page, `/api/quote-documents?intervention_id=${d1.id}`);
          assert.equal(overview.status, 403, `overview answered ${overview.status}`);
          const byQuote = await api(h.page, `/api/quote-documents?quote_id=${q1.id}`);
          assert.ok([403, 404].includes(byQuote.status), `overview by quote answered ${byQuote.status}`);
          const download = await h.context.request.get(`${base}/api/quote-documents/${state.documentId}`);
          assert.equal(download.status(), 404, `download answered ${download.status()} (no existence oracle)`);
          const generate = await post(h.page, "/api/quote-documents", { action: "generate", quote_id: q1.id, amendment_id: null });
          assert.equal(generate.status, 403);
          const events = await db.select("quote_document_events", { intervention_id: `eq.${d1.id}`, actor_id: `eq.${tiers.id}` }, "id");
          assert.equal(events.length, 0, "no event recorded for the third party");
          // UI window starts here: the single driver POST (generate, 403) is before the baseline.
          window = await settledBaseline(h, { since: beforeProbes, driverMutations: 1, origin: base });
          return { overview: overview.status, download: download.status(), generate: generate.status, ui_window_from: window.index };
        });
        await s.step("UI: the dossier content is not visible to the third party", async () => {
          await openHash(h.page, base, `detail/${d1.id}`);
          await sleep(1500);
          const text = await bodyText(h.page);
          assert.ok(!text.includes(d1.description), "dossier description visible to a third party");
          assert.ok(!text.includes(ref1), "quote reference visible to a third party");
          await openHash(h.page, base, `quote/${q1.id}`);
          await sleep(1500);
          const quoteText = await bodyText(h.page);
          assert.ok(!quoteText.includes(ref1) && !quoteText.includes(euroDigits(q1.total_cents)), "QuoteView of D1 rendered content for a third party");
          assert.equal(await h.page.locator('section[aria-label="Documents du devis et avenants"]').count(), 0, "documents panel rendered for a third party");
          await capture(h, out, "docs-tiers-1280", s);
        });
        await s.step("browser: no write issued by the interface during the UI navigation (window after the driver probes)", () => assertNoUiWrites(h, window));
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await scenarioWhen(report, suite.name, "former artisan after reassignment (synthetic, service role): overview 403, download 404, generate/propose 403", { quote_document_id: isId(state.documentId) }, async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login the original artisan, then reassign D1 to the replacement (service role, labelled QA)", async () => {
          await login(h, base, artisan, projectRef);
          const result = await fixtures.reassignIntervention({ intervention: d1, artisan: artisan2 });
          return result;
        });
        await s.step("former artisan refused everywhere; no new revision or event", async () => {
          const before = await db.count("quote_document_events", { intervention_id: `eq.${d1.id}` });
          const beforeDocuments = await db.count("quote_documents", { quote_id: `eq.${q1.id}` });
          assert.ok(beforeDocuments > 0, "at least one existing document is required");
          const overview = await api(h.page, `/api/quote-documents?intervention_id=${d1.id}`);
          assert.equal(overview.status, 403, `overview answered ${overview.status}`);
          const download = await h.context.request.get(`${base}/api/quote-documents/${state.documentId}`);
          assert.equal(download.status(), 404, `download answered ${download.status()}`);
          const generate = await post(h.page, "/api/quote-documents", { action: "generate", quote_id: q1.id, amendment_id: null });
          assert.equal(generate.status, 403);
          const propose = await post(h.page, "/api/quote-amendments", { action: "propose", base_quote_id: q1.id, lines: [{ label: "QA refus attendu", quantity: 1, unit_price_cents: 100 }], tax_rate: 20, reason: cohort.description("refus attendu"), valid_until: null });
          assert.equal(propose.status, 403);
          assert.equal(await db.count("quote_document_events", { intervention_id: `eq.${d1.id}` }), before, "no event added by the former artisan");
          assert.equal(await db.count("quote_documents", { quote_id: `eq.${q1.id}` }), beforeDocuments, "no new document");
          return { overview: overview.status, download: download.status(), generate: generate.status, propose: propose.status, synthetic: "QA: état simulé par service_role, non produit par le circuit utilisateur" };
        });
        await s.step("replacement artisan: overview readable, but not the issuer of Q1 (can_generate=false)", async () => {
          const h2 = await ctx.openPage(s, {});
          try {
            await login(h2, base, artisan2, projectRef);
            const overview = await api(h2.page, `/api/quote-documents?intervention_id=${d1.id}`);
            assert.equal(overview.status, 200);
            const quote = overview.body?.quotes?.find((q) => q.id === q1.id);
            assert.ok(quote, "Q1 in the replacement's overview");
            assert.equal(quote.permissions.can_generate, false, "replacement is not the issuer");
            assert.equal(quote.permissions.can_propose, false);
            return { can_generate: quote.permissions.can_generate };
          } finally {
            await h2.close();
          }
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "expired quote (synthetic validity in the past): client sees the expiry and the server refuses acceptance (409)", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login client", () => login(h, base, client, projectRef));
        await s.step("UI: validity expired and acceptance impossible stated", async () => {
          const section = await openClientQuote(h.page, base, d2, q2);
          await expectVisible(section.getByText(/^Validité dépassée depuis le /), "expired validity label");
          await expectVisible(section.getByText("Ce devis ne peut plus être accepté : sa validité est dépassée. L’artisan peut en envoyer une nouvelle version.", { exact: true }), "expiry explanation");
          await capture(h, out, "docs-client-expired-1280", s);
          return { synthetic: expired.synthetic, valid_until: expired.valid_until };
        });
        await s.step("'Accepter le devis' (circuit exposed) → server 409, quote still sent, dossier still quoted", async () => {
          const button = h.page.getByRole("button", { name: "Accepter le devis", exact: true });
          if (!(await button.count())) throw new AppDefect("'Accepter le devis' not exposed on an expired sent quote: the server-side refusal could not be exercised through the UI");
          const wait = waitForApi(h.page, `/api/interventions/${d2.id}/actions`, { method: "POST" });
          await ctx.mutatingClick(button, wait); // gate checked right before the click; drain waits for click + response
          const response = await wait;
          assert.equal(response.status(), 409, `accept_quote on an expired quote answered ${response.status()}`);
          await sleep(500);
          const [quote] = await db.select("quotes", { id: `eq.${q2.id}` }, "status");
          assert.equal(quote.status, "sent", "expired quote must stay 'sent'");
          const [job] = await db.select("interventions", { id: `eq.${d2.id}` }, "status");
          assert.equal(job.status, "quoted");
          await expectVisible(h.page.locator('.alert.error[role="alert"]').first(), "server refusal rendered as the shell error alert");
          // Status elements only (contract §16): QuoteView state note and the quote card status tag.
          const readStatus = async () => {
            const formNotes = await h.page.locator("p.form-note").allInnerTexts();
            const card = h.page.locator(`article[aria-labelledby="quote-${q2.id}"]`);
            const statusTags = await card.locator(".tag").allInnerTexts();
            return { formNotes, statusTags };
          };
          const afterClick = await readStatus();
          assert.equal(acceptedStatusShown(afterClick), false, `accepted status shown after the refusal: ${JSON.stringify(afterClick)}`);
          // Re-read through the real navigation (server data): still awaiting decision, still acceptable-looking button.
          const section = await openClientQuote(h.page, base, d2, q2);
          await expectVisible(section.locator(`article[aria-labelledby="quote-${q2.id}"]`).getByText("En attente de décision", { exact: true }), "quote card status after re-read");
          const reread = await readStatus();
          assert.equal(acceptedStatusShown(reread), false, `accepted status shown after re-read: ${JSON.stringify(reread)}`);
          return { status: response.status(), quote_status: quote.status, status_elements: reread };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
