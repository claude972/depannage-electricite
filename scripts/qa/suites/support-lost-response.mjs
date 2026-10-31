// Contract §5 `support-lost-response`: the creation reaches the server but the response is lost;
// the form keeps text + idempotency key across a remount and a full reload; the retry replays
// the SAME key and the server answers replayed:true — one ticket, no duplicate.
import assert from "node:assert/strict";
import { newPage, login, goHash, capture, bodyText, expectVisible, sleep } from "../lib/browser.mjs";

export const suite = {
  name: "support-lost-response",
  description: "Committed support creation with lost response → remount/reload keep the key → retry replays, no duplicate",
  needsCredentials: true,
  plan: ["client C"],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const c = await fixtures.createUser("support-c", "client");
    const subject = cohort.name("Réponse perdue").slice(0, 160);
    const message = `${cohort.marker} message synthétique de C, assez long pour la validation du formulaire.`;

    await report.scenario(suite.name, "lost response → same key replayed after remount and reload", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login C", () => login(h, base, c, projectRef));
        await s.step("open the form", async () => {
          await goHash(h.page, "support/new");
          await expectVisible(h.page.getByLabel("Sujet", { exact: true }), "support creation form");
        });
        const seen = [];
        let committed = null;
        await h.page.route(`${base}/api/support`, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const payload = route.request().postDataJSON();
          seen.push(payload?.request_id || null);
          if (seen.length === 1) {
            const response = await route.fetch(); // committed server-side
            committed = { status: response.status(), body: JSON.parse(await response.text()) };
            return route.abort("failed"); // ...but the browser never gets the answer
          }
          return route.continue();
        });
        await s.step("submit: committed server-side, response lost, text kept, error shown", async () => {
          await h.page.getByLabel("Sujet", { exact: true }).fill(subject);
          await h.page.getByLabel("Message", { exact: true }).fill(message);
          await h.page.getByRole("button", { name: "Envoyer la demande", exact: true }).click();
          const deadline = Date.now() + 30000;
          while (!committed && Date.now() < deadline) await sleep(100);
          assert.ok(committed?.body?.ticket?.id, "creation never committed");
          await fixtures.track("support_tickets", committed.body.ticket.id);
          await sleep(800);
          const text = await bodyText(h.page);
          assert.match(text, /interrompue|rechargez/i, "no 'connection interrupted, re-read' message shown");
          assert.equal(await h.page.getByLabel("Sujet", { exact: true }).inputValue(), subject, "typed subject lost");
          assert.equal(await h.page.evaluate(() => window.location.hash), "#support/new", "navigated despite the lost response");
          await capture(h, out, "support-lost-after-abort", s);
          return { requestId: seen[0], ticket: committed.body.ticket.id };
        });
        await s.step("remount (navigate away and back): form pre-filled", async () => {
          await goHash(h.page, "support");
          await sleep(800);
          await goHash(h.page, "support/new");
          await expectVisible(h.page.getByLabel("Sujet", { exact: true }), "support form after remount");
          assert.equal(await h.page.getByLabel("Sujet", { exact: true }).inputValue(), subject, "subject not restored after remount");
          assert.equal(await h.page.getByLabel("Message", { exact: true }).inputValue(), message, "message not restored after remount");
        });
        await s.step("full reload: form pre-filled again", async () => {
          await h.page.reload({ waitUntil: "domcontentloaded" });
          await expectVisible(h.page.getByLabel("Sujet", { exact: true }), "support form after reload", { timeout: 45000 });
          assert.equal(await h.page.getByLabel("Sujet", { exact: true }).inputValue(), subject, "subject not restored after reload");
          await capture(h, out, "support-lost-after-reload", s);
        });
        await s.step("retry replays the same key: replayed notice, navigation to the single ticket", async () => {
          await h.page.getByRole("button", { name: "Envoyer la demande", exact: true }).click();
          const deadline = Date.now() + 30000;
          let hash = "";
          while (Date.now() < deadline) {
            hash = await h.page.evaluate(() => window.location.hash);
            if (/^#support\/[0-9a-f-]{36}$/i.test(hash)) break;
            await sleep(150);
          }
          assert.match(hash, /^#support\/[0-9a-f-]{36}$/i, `no navigation to the ticket (hash ${hash})`);
          assert.equal(hash.slice("#support/".length), committed.body.ticket.id, "navigated to a different ticket");
          assert.equal(seen.length, 2, `expected 2 creation requests, saw ${seen.length}`);
          assert.equal(seen[1], seen[0], "retry used a different idempotency key");
          await sleep(500);
          assert.match(await bodyText(h.page), /déjà été enregistrée/, "replay notice missing");
          await capture(h, out, "support-lost-after-replay", s);
          return { requestId: seen[0], replayed: true };
        });
        await s.step("server: one ticket for C with the first key, one message, one event", async () => {
          const tickets = await db.select("support_tickets", { creator_id: `eq.${c.id}` }, "id,client_request_id,subject");
          assert.equal(tickets.length, 1, `duplicate tickets: ${tickets.length}`);
          assert.equal(tickets[0].client_request_id, seen[0]);
          assert.equal(tickets[0].subject, subject);
          assert.equal(await db.count("support_messages", { ticket_id: `eq.${tickets[0].id}` }), 1);
          assert.equal(await db.count("support_events", { ticket_id: `eq.${tickets[0].id}` }), 1);
          return { ticket: tickets[0].id, server: true };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
