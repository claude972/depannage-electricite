// Contract §5 `photos-recovery`: one upload refused before the server (definite), retry sends only
// that photo; then an upload whose response is lost (uncertain) → candidates → explicit confirm
// without re-sending. Never a duplicate dossier.
import assert from "node:assert/strict";
import { newPage, login, openHash, capture, expectVisible, sleep, safeRoute, routeFetch, PNG_1x1 } from "../lib/browser.mjs";

export const suite = {
  name: "photos-recovery",
  description: "Request with photos: definite refusal + targeted retry; lost response → uncertain → candidates → explicit confirm",
  needsCredentials: true,
  plan: ["client D"],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const d = await fixtures.createUser("photos-d", "client");

    async function createRequest(page, description, files) {
      await openHash(page, base, "new");
      await expectVisible(page.getByRole("textbox", { name: "Décrivez le problème", exact: true }), "request form");
      await page.getByRole("textbox", { name: "Décrivez le problème", exact: true }).fill(description);
      await page.getByLabel("Photos du problème (facultatif)", { exact: true }).setInputFiles(files.map((name) => ({ name, mimeType: "image/png", buffer: PNG_1x1 })));
      await page.getByRole("button", { name: "Continuer", exact: true }).click();
      await page.getByRole("textbox", { name: "Adresse d’intervention", exact: true }).fill("Adresse technique QA, aucun déplacement");
      await page.getByRole("textbox", { name: "Code postal", exact: true }).fill("97200");
      await page.getByRole("textbox", { name: "Ville", exact: true }).fill("TEST QA");
      await page.getByRole("button", { name: "Continuer", exact: true }).click();
      await page.getByRole("button", { name: "Enregistrer la demande", exact: true }).click();
    }
    const trackDocs = async (docs) => {
      await fixtures.track("documents", ...docs.map((x) => x.id));
      await fixtures.track("storage_paths", ...docs.map((x) => x.path));
    };

    await report.scenario(suite.name, "partial refusal keeps one dossier; retry sends only the refused photo", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      let uploads = 0;
      let refused = 0;
      try {
        await s.step("login D", () => login(h, base, d, projectRef));
        await safeRoute(h, s, `${base}/api/documents`, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          uploads++;
          if (uploads === 2) {
            refused++;
            return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "QA: refus certain avant envoi au serveur." }) });
          }
          return route.continue();
        }, "POST /api/documents (definite refusal)");
        await s.step("create a request with two photos, the second refused", async () => {
          await createRequest(h.page, cohort.description("demande photos refus partiel, texte de validation"), ["qa-first.png", "qa-second.png"]);
          await expectVisible(h.page.locator('.upload-queue li[data-status="failed"]'), "failed upload item");
          const created = h.network.filter((n) => n.method === "POST" && n.path === "/api/interventions").length;
          assert.equal(created, 1, `dossiers created: ${created}`);
          assert.equal(uploads, 2);
          assert.equal(refused, 1);
          assert.equal(await h.page.locator('.upload-queue li[data-status="done"]').count(), 1);
          const jobs = await db.select("interventions", { client_id: `eq.${d.id}` }, "id");
          assert.equal(jobs.length, 1);
          await fixtures.track("interventions", ...jobs.map((j) => j.id));
          const docs = await db.select("documents", { owner_id: `eq.${d.id}` }, "id,name,path");
          assert.deepEqual(docs.map((x) => x.name), ["qa-first.png"]);
          await trackDocs(docs);
          await capture(h, out, "photos-partial-failure", s);
          return { dossiers: 1, uploads, refused, stored: docs.length };
        });
        await s.step("retry re-sends only the refused photo", async () => {
          await h.page.getByRole("button", { name: "Réessayer les 1 photo refusée", exact: true }).click();
          await expectVisible(h.page.locator(".upload-queue").filter({ hasText: /Toutes les photos sont enregistrées/ }), "all stored message");
          assert.equal(uploads, 3, `upload requests: ${uploads}`);
          assert.equal(h.network.filter((n) => n.method === "POST" && n.path === "/api/interventions").length, 1, "a second dossier was created");
          const docs = await db.select("documents", { owner_id: `eq.${d.id}` }, "id,name,path");
          assert.equal(docs.length, 2);
          assert.equal(docs.filter((x) => x.name === "qa-first.png").length, 1);
          assert.equal(docs.filter((x) => x.name === "qa-second.png").length, 1);
          await trackDocs(docs);
          await capture(h, out, "photos-retry-success", s);
          return { uploads, stored: docs.length, firstNotResent: true };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "lost upload response → uncertain → candidate → explicit confirm, no resend", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      let uploads = 0;
      let storedBeforeAbort = 0;
      try {
        await s.step("login D", () => login(h, base, d, projectRef));
        await safeRoute(h, s, `${base}/api/documents`, async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          uploads++;
          const response = await routeFetch(route); // reaches the server and is stored
          if (response.status() === 201 || response.status() === 200) storedBeforeAbort++;
          return route.abort("failed"); // the browser never learns it
        }, "POST /api/documents (lost response)");
        await s.step("one photo, response lost → uncertain, no automatic resend", async () => {
          await createRequest(h.page, cohort.description("demande photo réponse perdue, texte de validation"), ["qa-uncertain.png"]);
          await expectVisible(h.page.locator('.upload-queue li[data-status="uncertain"]'), "uncertain upload item");
          assert.equal(uploads, 1);
          assert.equal(storedBeforeAbort, 1, "server did not store the photo");
          const jobs = await db.select("interventions", { client_id: `eq.${d.id}` }, "id");
          assert.equal(jobs.length, 2, `dossiers for D: ${jobs.length}`);
          await fixtures.track("interventions", ...jobs.map((j) => j.id));
          const docs = await db.select("documents", { owner_id: `eq.${d.id}`, name: "eq.qa-uncertain.png" }, "id,path");
          assert.equal(docs.length, 1);
          await trackDocs(docs);
          await capture(h, out, "photos-uncertain", s);
          return { uploads, serverStored: storedBeforeAbort };
        });
        await s.step("verify lists the same-name candidate; resend control present but not used", async () => {
          await h.page.getByRole("button", { name: /^Vérifier le dossier/ }).click();
          await expectVisible(h.page.getByRole("button", { name: "C’est bien cette photo", exact: true }), "candidate acknowledgement button");
          assert.equal(await h.page.locator('.upload-queue li[data-status="uncertain"]').count(), 1);
          assert.equal(uploads, 1, "verification re-sent the photo");
          const resend = await h.page.getByRole("button", { name: /^Renvoyer les photos incertaines/ }).count();
          assert.ok(resend >= 1, "explicit resend control missing");
          await capture(h, out, "photos-candidate", s);
          return { candidates: await h.page.getByRole("button", { name: "C’est bien cette photo", exact: true }).count(), resendControl: resend };
        });
        await s.step("explicit confirmation → done, no new request, no duplicate", async () => {
          await h.page.getByRole("button", { name: "C’est bien cette photo", exact: true }).first().click();
          await h.page.waitForFunction(() => !document.querySelector('.upload-queue li[data-status="uncertain"]'), null, { timeout: 15000 });
          assert.equal(uploads, 1, "confirmation triggered an upload");
          const docs = await db.select("documents", { owner_id: `eq.${d.id}` }, "id,name,path");
          assert.equal(docs.length, 3, `documents for D: ${docs.length}`);
          assert.equal(await db.count("interventions", { client_id: `eq.${d.id}` }), 2);
          await trackDocs(docs);
          await capture(h, out, "photos-acknowledged", s);
          return { uploads, stored: docs.length, dossiers: 2 };
        });
        await sleep(200);
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
