// Contract §5 `quote-draft`: load / save / reload / 409 on stale version / send → the published
// quote_id is the one selected in the dossier; the draft is consumed (state 'sent').
import assert from "node:assert/strict";
import { newPage, login, openHash, api, capture, bodyText, expectVisible, sleep } from "../lib/browser.mjs";

const quoteRef = (id) => `DEV-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;

export const suite = {
  name: "quote-draft",
  description: "Real draft editor: save, reload, stale-version 409 with explicit reload/keep, send → exact quote selected",
  needsCredentials: true,
  plan: ["approved artisan", "client", "intervention assigned to the artisan"],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const artisan = await fixtures.createUser("artisan-devis", "artisan");
    const client = await fixtures.createUser("client-devis", "client");
    const job = await fixtures.createIntervention({ client, artisan, status: "assigned", description: "dossier pour brouillon de devis", category: "diagnostic" });
    const route = `/api/interventions/${job.id}/quote-draft`;

    await report.scenario(suite.name, "save → reload → stale 409 → keep mine → send publishes the exact quote", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login artisan", () => login(h, base, artisan, projectRef));
        const editor = () => h.page.locator('section[aria-labelledby="quote-draft-title"]');
        const label1 = () => editor().getByLabel("Prestation 1", { exact: true });
        const qty = (i) => editor().getByLabel("Quantité", { exact: true }).nth(i);
        const price = (i) => editor().getByLabel("Prix unitaire HT (€)", { exact: true }).nth(i);
        const tax = () => editor().getByLabel("Taux de TVA (%)", { exact: true });
        const status = () => editor().locator('[role="status"]');

        await s.step("mission detail shows the draft editor", async () => {
          await openHash(h.page, base, `mission/${job.id}`);
          await expectVisible(h.page.getByRole("heading", { name: "Établir le devis", exact: true }), "draft editor heading", { timeout: 45000 });
          const envelope = await api(h.page, route);
          assert.equal(envelope.status, 200, `GET quote-draft → ${envelope.status}`);
          assert.equal(envelope.body.version, 0);
          assert.equal(envelope.body.draft, null);
          return { version: envelope.body.version };
        });
        await s.step("fill two lines + VAT and save the draft", async () => {
          await label1().fill(cohort.name("Diagnostic").slice(0, 160));
          await qty(0).fill("1");
          await price(0).fill("120");
          await price(1).fill("80");
          await tax().selectOption("20");
          await editor().getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
          await expectVisible(status().filter({ hasText: /Brouillon enregistré le/ }), "saved status");
          const envelope = await api(h.page, route);
          assert.equal(envelope.body.version, 1);
          assert.equal(envelope.body.draft.lines.length, 2);
          assert.equal(envelope.body.draft.lines[0].unit_price_cents, 12000);
          assert.equal(envelope.body.draft.tax_rate, 20);
          await capture(h, out, "quote-draft-saved", s);
          return { version: envelope.body.version };
        });
        await s.step("full reload restores the saved lines from the server", async () => {
          await h.page.reload({ waitUntil: "domcontentloaded" });
          await expectVisible(h.page.getByRole("heading", { name: "Établir le devis", exact: true }), "editor after reload", { timeout: 45000 });
          await expectVisible(status().filter({ hasText: /Brouillon enregistré le/ }), "saved status after reload");
          assert.equal(await label1().inputValue(), cohort.name("Diagnostic").slice(0, 160));
          assert.equal(await price(0).inputValue(), "120");
          assert.equal(await tax().inputValue(), "20");
        });
        let concurrentVersion;
        await s.step("a concurrent save (other tab simulated) advances the server version", async () => {
          const envelope = (await api(h.page, route)).body;
          const saved = await api(h.page, route, {
            action: "save",
            expected_version: envelope.version,
            assignment_token: envelope.assignment_token,
            base_quote_id: envelope.current_quote_id,
            lines: [{ label: "Autre onglet", quantity: 1, unit_price_cents: 5000 }],
            tax_rate: 20,
          });
          assert.equal(saved.status, 200, `concurrent save → ${saved.status}`);
          concurrentVersion = saved.body.version;
          assert.equal(concurrentVersion, envelope.version + 1);
          return { version: concurrentVersion };
        });
        await s.step("saving the stale UI draft → conflict alert, typed lines kept, explicit reload", async () => {
          const typed = cohort.name("Diagnostic modifié").slice(0, 160);
          await label1().fill(typed);
          await editor().getByRole("button", { name: "Enregistrer le brouillon", exact: true }).click();
          const alert = editor().locator('[role="alert"]').filter({ hasText: /Brouillon modifié depuis votre dernière lecture/ });
          await expectVisible(alert, "409 conflict alert");
          assert.equal(await label1().inputValue(), typed, "typed label lost on conflict");
          assert.equal((await api(h.page, route)).body.version, concurrentVersion, "version changed without an explicit choice");
          await capture(h, out, "quote-draft-conflict", s);
          await editor().getByRole("button", { name: "Recharger le brouillon", exact: true }).click();
          await expectVisible(editor().getByRole("heading", { name: "Version enregistrée", exact: true }), "server version panel");
          await expectVisible(editor().getByRole("heading", { name: "Votre saisie", exact: true }), "typed version panel");
          assert.match(await editor().innerText(), /Autre onglet/, "server draft not shown in the comparison");
          await capture(h, out, "quote-draft-compare", s);
          await editor().getByRole("button", { name: "Conserver ma saisie", exact: true }).click();
          await expectVisible(status().filter({ hasText: /Brouillon enregistré le/ }), "saved after keep-mine");
          const envelope = (await api(h.page, route)).body;
          assert.equal(envelope.version, concurrentVersion + 1);
          assert.equal(envelope.draft.lines[0].label, typed);
          return { version: envelope.version };
        });
        let published;
        await s.step("send → one quote created, draft consumed, exact quote_id selected", async () => {
          await editor().getByRole("button", { name: "Envoyer le devis au client", exact: true }).click();
          const deadline = Date.now() + 30000;
          let quotes = [];
          while (Date.now() < deadline) {
            quotes = await db.select("quotes", { intervention_id: `eq.${job.id}` }, "id,status,total_cents,created_at");
            if (quotes.length) break;
            await sleep(300);
          }
          assert.equal(quotes.length, 1, `expected exactly one quote, found ${quotes.length}`);
          published = quotes[0];
          await fixtures.track("quotes", published.id);
          assert.equal(published.status, "sent");
          const drafts = await db.select("quote_drafts", { intervention_id: `eq.${job.id}` }, "state,version,published_quote_id");
          assert.equal(drafts.length, 1);
          assert.equal(drafts[0].state, "sent");
          assert.equal(drafts[0].published_quote_id, published.id);
          const jobRow = await db.select("interventions", { id: `eq.${job.id}` }, "status");
          assert.equal(jobRow[0].status, "quoted");
          await expectVisible(h.page.getByText(quoteRef(published.id), { exact: true }), `published quote reference ${quoteRef(published.id)}`, { timeout: 30000 });
          const versions = h.page.getByRole("group", { name: "Versions du devis" });
          let selected = null;
          if (await versions.count()) {
            const pressed = versions.getByRole("button", { pressed: true });
            selected = (await pressed.count()) ? await pressed.first().innerText() : null;
            if (selected !== null) assert.match(selected, new RegExp(quoteRef(published.id)), "another version is selected");
          }
          await capture(h, out, "quote-draft-published", s);
          return { quote: published.id, ref: quoteRef(published.id), total_cents: published.total_cents, draftState: drafts[0].state, selectedVersion: selected };
        });
        await s.step("repeating the old version is refused (409) without a second quote", async () => {
          const envelope = (await api(h.page, route)).body;
          const stale = await api(h.page, route, { action: "send", expected_version: Math.max(0, envelope.version - 1), assignment_token: envelope.assignment_token });
          assert.equal(stale.status, 409, `stale send → ${stale.status}`);
          assert.equal(await db.count("quotes", { intervention_id: `eq.${job.id}` }), 1);
          assert.ok(!(await bodyText(h.page)).includes("undefined"));
          return { status: stale.status, server: true };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
