// Contract §5 `support-stale-a-b`: A's support creation is committed server-side while its
// response is held; A logs out and B logs in (same document); the late response must neither
// navigate nor notify B, and B's list stays empty. Server readback: exactly one ticket of A.
import assert from "node:assert/strict";
import { newPage, login, logout, goHash, api, capture, bodyText, expectVisible, sleep, safeRoute, routeFetch, pollUntil } from "../lib/browser.mjs";

export const suite = {
  name: "support-stale-a-b",
  description: "Late support-creation response after identity change A→B: no navigation, no notice for B",
  needsCredentials: true,
  plan: ["client A", "client B"],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const a = await fixtures.createUser("support-a", "client");
    const b = await fixtures.createUser("support-b", "client");
    const subject = cohort.name("Sujet A").slice(0, 160);
    const message = `${cohort.marker} message synthétique de A, assez long pour la validation du formulaire.`;

    await report.scenario(suite.name, "held creation response of A is ignored once B is the identity", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      let release = () => {};
      try {
        await s.step("login A through the form", () => login(h, base, a, projectRef));
        await s.step("open the new assistance request form", async () => {
          await goHash(h.page, "support/new");
          await expectVisible(h.page.getByRole("textbox", { name: "Sujet", exact: true }), "support creation form (Sujet)");
        });
        const held = new Promise((resolve) => (release = resolve));
        let committed = null;
        await safeRoute(h, s, `${base}/api/support`, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          const response = await routeFetch(route); // sent now, with A's cookies: the server commits as A
          const text = await response.text();
          committed = { status: response.status(), body: safeJson(text) };
          await held; // the browser only sees the answer after B is logged in
          await route.fulfill({ status: response.status(), headers: { "content-type": "application/json", "cache-control": "private, no-store" }, body: text });
        }, "POST /api/support (held)");
        await s.step("A submits; the server commits the ticket while the response is held", async () => {
          await h.page.getByRole("textbox", { name: "Sujet", exact: true }).fill(subject);
          await h.page.getByRole("textbox", { name: "Message", exact: true }).fill(message);
          await h.page.getByRole("button", { name: "Envoyer la demande", exact: true }).click();
          await pollUntil(() => committed);
          assert.ok(committed, "the creation request never reached the server (or the route handler failed)");
          assert.equal(committed.status, 200, `server answered ${committed.status}`);
          assert.ok(committed.body?.ticket?.id, "server did not return a ticket");
          await fixtures.track("support_tickets", committed.body.ticket.id);
          return { status: committed.status, ticket: committed.body.ticket.id, replayed: committed.body.replayed };
        });
        await s.step("A logs out with the real control while the response is pending", () => logout(h.page));
        await s.step("B logs in through the form in the same document", () => login(h, base, b, projectRef, { sameDocument: true }));
        await s.step("the held response is delivered: B is not navigated nor notified", async () => {
          release();
          await sleep(2500);
          const hash = await h.page.evaluate(() => window.location.hash);
          assert.ok(!/^#support\//.test(hash), `B was navigated to ${hash}`);
          const text = await bodyText(h.page);
          assert.ok(!text.includes("Demande d’assistance enregistrée"), "success notice shown to B");
          assert.ok(!text.includes("déjà été enregistrée"), "replay notice shown to B");
          assert.ok(!text.includes(subject), "A's subject visible to B");
          const pending = await h.page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("courant-support-pending-")));
          assert.deepEqual(pending, [], "A's pending support content survived the identity change");
          await capture(h, out, "support-stale-b-after-release", s);
          return { hash };
        });
        await s.step("B's assistance list is empty (browser + API as B)", async () => {
          await goHash(h.page, "support");
          await sleep(1500);
          const list = await api(h.page, "/api/support?limit=25");
          assert.equal(list.status, 200);
          assert.equal(list.body.page.total, 0, "B sees tickets");
          assert.ok(!(await bodyText(h.page)).includes(subject));
          await capture(h, out, "support-stale-b-list", s);
          return { total: list.body.page.total };
        });
        await s.step("server: exactly one ticket of A, one message, one event", async () => {
          const tickets = await db.select("support_tickets", { creator_id: `eq.${a.id}` }, "id,subject,version");
          assert.equal(tickets.length, 1);
          assert.equal(tickets[0].subject, subject);
          assert.equal(tickets[0].id, committed.body.ticket.id);
          assert.equal(await db.count("support_messages", { ticket_id: `eq.${tickets[0].id}` }), 1);
          assert.equal(await db.count("support_events", { ticket_id: `eq.${tickets[0].id}` }), 1);
          assert.equal(await db.count("support_tickets", { creator_id: `eq.${b.id}` }), 0);
          return { ticket: tickets[0].id, server: true };
        });
        s.network(h.network);
      } finally {
        release(); // never leave a route handler awaiting forever
        await h.close();
      }
    });
  },
};

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
