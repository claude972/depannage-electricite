// Contract §5 `admin-old-dossiers`: >100 dossiers seeded; the server-paginated admin list reaches
// the oldest one page by page; opening it shows the detail read by id.
import assert from "node:assert/strict";
import { newPage, login, openHash, capture, expectVisible, sleep, waitForApi } from "../lib/browser.mjs";
import { adminPreflight } from "../lib/admin-preflight.mjs";

const shortId = (id) => `INT-${id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
const ROWS = 120;
const MAX_PAGES = 50;

export const suite = {
  name: "admin-old-dossiers",
  description: "Admin paginated dossier list (>100 rows) reaches an old dossier and opens its detail",
  needsCredentials: true,
  plan: ["admin-preflight: >= 1 real super admin (cohort excluded) or the suite is BLOCKED, nothing created", "cohort admin (profiles.role=admin set by service role, deleted at cleanup while the real super admin remains)", "client F", `${ROWS} interventions of F with distinct created_at`],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    // Migration 014 (last-super-admin guard): the QA admin may only be created when a REAL super
    // admin exists, otherwise its deletion at cleanup would be refused. Read-only count, cohort ids
    // excluded; no non-cohort account is ever read, modified, banned or deleted.
    const pre = await adminPreflight(db, fixtures.manifest);
    if (!pre.ok) {
      await report.blocked(suite.name, "admin-preflight", `${pre.reason} (real admins counted: ${pre.realAdmins})`);
      return;
    }
    await report.scenario(suite.name, "admin-preflight: at least one real super admin exists (cohort excluded), QA admin deletable at cleanup", async (s) => {
      await s.step("count real super admins (service key, HEAD count, cohort excluded)", async () => ({ server: true, realAdmins: pre.realAdmins }));
    });
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
          // The <label> wraps its text and the <select>: role + accessible name (QA-004).
          const pageSize = h.page.getByRole("combobox", { name: "Dossiers par page", exact: true });
          await expectVisible(pageSize, "page size control");
          const response = waitForApi(h.page, "/api/admin/interventions", { query: "limit=100" });
          await pageSize.selectOption("100");
          await response;
          await expectVisible(h.page.getByRole("row").nth(1), "first data row");
          const info = await h.page.locator('[role="status"]').filter({ hasText: /dossiers? correspondants?/ }).first().innerText();
          const total = Number((info.match(/(\d[\d\s ]*)\s+dossiers?/) || [])[1]?.replace(/[\s ]/g, ""));
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
            const response = waitForApi(h.page, "/api/admin/interventions", { query: "cursor=" });
            await next.click();
            await response;
            await expectVisible(h.page.getByRole("row").nth(1), "rows of the next page");
            pages++;
          }
          assert.fail(`row ${ref} not reached within ${MAX_PAGES} pages`);
        });
        await s.step("open the old dossier: detail read by id shows its description", async () => {
          const row = h.page.getByRole("row", { name: new RegExp(ref) }).first();
          await capture(h, out, "admin-dossiers-old-row", s);
          const detail = waitForApi(h.page, "/api/admin/interventions", { query: `id=${oldest.id}` });
          await row.getByRole("button", { name: "Ouvrir", exact: true }).click();
          const response = await detail;
          assert.equal(response.status(), 200, `detail → ${response.status()}`);
          await expectVisible(h.page.getByText(/OLDEST dossier de pagination/), "old dossier description in the detail");
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
