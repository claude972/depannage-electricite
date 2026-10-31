// Contract §5 `admin-old-dossiers`: >100 dossiers seeded; the server-paginated admin list reaches
// the oldest one page by page; opening it shows the detail read by id.
import assert from "node:assert/strict";
import { newPage, login, openHash, capture, expectVisible, sleep } from "../lib/browser.mjs";

const shortId = (id) => `INT-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
const ROWS = 120;
const MAX_PAGES = 50;

export const suite = {
  name: "admin-old-dossiers",
  description: "Admin paginated dossier list (>100 rows) reaches an old dossier and opens its detail",
  needsCredentials: true,
  plan: ["cohort admin (profiles.role=admin set by service role, deleted at cleanup)", "client F", `${ROWS} interventions of F with distinct created_at`],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const admin = await fixtures.createUser("admin-listes", "admin");
    const f = await fixtures.createUser("client-listes", "client");
    const now = Date.now();
    const rows = Array.from({ length: ROWS }, (_, i) => ({
      client_id: f.id,
      category: i % 2 ? "panel" : "outage",
      description: cohort.description(i === ROWS - 1 ? "OLDEST dossier de pagination" : `dossier de pagination ${i}`),
      address: "Adresse technique QA, aucun déplacement",
      postal_code: "97200",
      city: cohort.name("Ville").slice(0, 120),
      urgency: "scheduled",
      estimate_min_cents: 10000,
      estimate_max_cents: 20000,
      status: i % 3 ? "requested" : "cancelled",
      created_at: new Date(now - (i + 1) * 1000 - 86400000).toISOString(), // distinct, all older than live traffic
    }));
    const seeded = await fixtures.createInterventions(rows);
    const oldest = seeded[ROWS - 1];

    await report.scenario(suite.name, "paginate with 100 per page until the oldest seeded dossier, open its detail", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login cohort admin", () => login(h, base, admin, projectRef));
        await s.step("open the server-paginated dossier list, 100 per page", async () => {
          await openHash(h.page, base, "admin-interventions");
          await expectVisible(h.page.getByLabel("Dossiers par page", { exact: true }), "page size control", { timeout: 45000 });
          const response = h.page.waitForResponse((r) => r.url().includes("/api/admin/interventions?") && r.request().method() === "GET", { timeout: 30000 });
          await h.page.getByLabel("Dossiers par page", { exact: true }).selectOption("100");
          await response;
          await expectVisible(h.page.getByRole("row").nth(1), "first data row", { timeout: 30000 });
          const info = await h.page.locator('[role="status"]').filter({ hasText: /dossiers? correspondants?/ }).first().innerText();
          const total = Number((info.match(/(\d[\d\s ]*)\s+dossiers?/) || [])[1]?.replace(/[\s ]/g, ""));
          assert.ok(Number.isFinite(total) && total >= ROWS, `displayed total ${total} < ${ROWS} (text: ${info})`);
          await capture(h, out, "admin-dossiers-page-1", s);
          return { total };
        });
        const ref = shortId(oldest.id);
        let pages = 1;
        await s.step(`press Suivant until the row ${ref} appears (bound ${MAX_PAGES} pages)`, async () => {
          while (pages <= MAX_PAGES) {
            const row = h.page.getByRole("row", { name: new RegExp(ref) });
            if (await row.count()) return { pages, ref };
            const next = h.page.getByRole("button", { name: "Suivant", exact: true });
            assert.ok(await next.count(), "no Suivant control");
            assert.ok(await next.isEnabled(), `Suivant disabled after ${pages} page(s) without reaching ${ref}`);
            const response = h.page.waitForResponse((r) => r.url().includes("/api/admin/interventions?") && r.request().method() === "GET", { timeout: 30000 });
            await next.click();
            await response;
            await expectVisible(h.page.getByRole("row").nth(1), "rows of the next page", { timeout: 30000 });
            pages++;
          }
          assert.fail(`row ${ref} not reached within ${MAX_PAGES} pages`);
        });
        await s.step("open the old dossier: detail read by id shows its description", async () => {
          const row = h.page.getByRole("row", { name: new RegExp(ref) }).first();
          await capture(h, out, "admin-dossiers-old-row", s);
          const detail = h.page.waitForResponse((r) => r.url().includes(`/api/admin/interventions?id=${oldest.id}`), { timeout: 30000 });
          await row.getByRole("button", { name: "Ouvrir", exact: true }).click();
          const response = await detail;
          assert.equal(response.status(), 200, `detail → ${response.status()}`);
          await expectVisible(h.page.getByText(/OLDEST dossier de pagination/), "old dossier description in the detail", { timeout: 30000 });
          await sleep(300);
          await capture(h, out, "admin-dossiers-old-detail", s);
          return { id: oldest.id, ref, pages };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
