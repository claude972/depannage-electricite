// Contract §5 `viewer-site-grants`: viewer and site-scoped manager never see write controls and
// the interface never issues a POST the server would refuse (403 never requested); the owner
// sees the controls. A direct server probe from the viewer's page confirms the 403 fail-closed.
import assert from "node:assert/strict";
import { newPage, login, openHash, goHash, api, capture, bodyText, expectVisible, expectAbsentOrDisabled, postsTo, sleep } from "../lib/browser.mjs";

const OWNER_ONLY = ["Accès aux sites", "Retirer", "Transférer la propriété"];

export const suite = {
  name: "viewer-site-grants",
  description: "Viewer and scoped manager: write controls hidden, no POST issued; owner sees controls",
  needsCredentials: true,
  plan: ["owner (manager profile)", "scoped manager (selected: site A, write)", "viewer", "organization with sites A and B", "one dossier per site"],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor } = ctx;
    const owner = await fixtures.createUser("owner", "manager");
    const scoped = await fixtures.createUser("manager-site-a", "manager");
    const viewer = await fixtures.createUser("viewer", "manager");
    const org = await fixtures.createOrganization(owner, "Organisation");
    const siteA = await fixtures.createSite(org, "Site A");
    const siteB = await fixtures.createSite(org, "Site B");
    await fixtures.addMember(org, scoped, "manager");
    await fixtures.addMember(org, viewer, "viewer");
    await fixtures.setSiteScope(org, scoped, "selected", [{ site_id: siteA.id, can_write: true }]);
    const jobA = await fixtures.createIntervention({ client: owner, site: siteA, description: "dossier du site A", status: "requested" });
    const jobB = await fixtures.createIntervention({ client: owner, site: siteB, description: "dossier du site B", status: "requested" });
    const budgetSection = (page) => page.locator('section[aria-labelledby="site-budget"]');
    const enabledControls = async (locator) => {
      const controls = locator.locator("button, input, select, textarea");
      let enabled = 0;
      for (let i = 0; i < (await controls.count()); i++) if ((await controls.nth(i).isVisible()) && (await controls.nth(i).isEnabled())) enabled++;
      return enabled;
    };

    await report.scenario(suite.name, "viewer: read-only everywhere, no POST issued, server 403 on direct probe", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login viewer", () => login(h, base, viewer, projectRef));
        await s.step("members: role badge Lecture, no owner controls", async () => {
          await goHash(h.page, "members");
          await expectVisible(h.page.getByText(/Votre rôle : Lecture/), "membership badge 'Lecture'", { timeout: 30000 });
          await sleep(1000);
          for (const name of OWNER_ONLY) await expectAbsentOrDisabled(h.page.getByRole("button", { name, exact: true }), `'${name}' for a viewer`);
          await capture(h, out, "viewer-members", s);
        });
        await s.step("site A: no request creation, budget editor unavailable", async () => {
          await goHash(h.page, `site/${siteA.id}`);
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "site budget section", { timeout: 30000 });
          await sleep(800);
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' for a viewer");
          const enabled = await enabledControls(budgetSection(h.page));
          assert.equal(enabled, 0, `viewer has ${enabled} enabled budget control(s)`);
          await capture(h, out, "viewer-site-a", s);
        });
        await s.step("sites and dossier A readable, still no write control", async () => {
          await goHash(h.page, "sites");
          await expectVisible(h.page.getByRole("heading", { name: siteA.name, exact: true }), "site A card", { timeout: 30000 });
          await sleep(800);
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' on sites for a viewer");
          await goHash(h.page, `detail/${jobA.id}`);
          await expectVisible(h.page.getByText(jobA.description, { exact: false }), "dossier A description", { timeout: 30000 });
          await capture(h, out, "viewer-dossier-a", s);
        });
        await s.step("browser: no POST /api/* was issued during the viewer navigation", async () => {
          const posts = postsTo(h.network);
          assert.deepEqual(posts, [], `interface issued ${posts.length} write request(s): ${JSON.stringify(posts)}`);
          return { apiRequests: h.network.length };
        });
        await s.step("server probe: set_site_budget from the viewer's page → 403, budget unchanged", async () => {
          const r = await api(h.page, "/api/professional", { action: "set_site_budget", site_id: siteA.id, budget_cents: 20000 });
          assert.equal(r.status, 403, `server answered ${r.status}`);
          const [site] = await db.select("sites", { id: `eq.${siteA.id}` }, "budget_cents");
          assert.equal(site.budget_cents, 10000);
          return { status: r.status, server: true };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "scoped manager (site A write): site B and its dossier invisible, no POST issued", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login scoped manager", () => login(h, base, scoped, projectRef));
        await s.step("sites: only A listed, creation offered on A", async () => {
          await goHash(h.page, "sites");
          await expectVisible(h.page.getByRole("heading", { name: siteA.name, exact: true }), "site A", { timeout: 30000 });
          await sleep(800);
          const text = await bodyText(h.page);
          assert.ok(!text.includes(siteB.name), "site B visible to a manager scoped to A");
          assert.equal(await h.page.getByRole("heading", { name: siteB.name, exact: true }).count(), 0, "site B card rendered for a manager scoped to A");
          await expectVisible(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' on site A for a writing manager");
          await capture(h, out, "scoped-sites", s);
        });
        await s.step("members: own scope shown, no owner controls", async () => {
          await goHash(h.page, "members");
          await expectVisible(h.page.getByRole("heading", { name: "Votre accès", exact: true }), "own access section", { timeout: 30000 });
          await sleep(800);
          for (const name of OWNER_ONLY) await expectAbsentOrDisabled(h.page.getByRole("button", { name, exact: true }), `'${name}' for a scoped manager`);
          assert.ok(!(await bodyText(h.page)).includes(siteB.name), "site B named in the members view");
          await capture(h, out, "scoped-members", s);
        });
        await s.step("dossier B not shown, dossier A shown", async () => {
          await goHash(h.page, `detail/${jobB.id}`);
          await sleep(1500);
          assert.ok(!(await bodyText(h.page)).includes(jobB.description), "dossier B content visible to the scoped manager");
          await capture(h, out, "scoped-dossier-b", s);
          await goHash(h.page, `detail/${jobA.id}`);
          await expectVisible(h.page.getByText(jobA.description, { exact: false }), "dossier A description", { timeout: 30000 });
        });
        await s.step("server: workspace limited to site A and its dossier", async () => {
          const ws = await api(h.page, "/api/workspace");
          assert.equal(ws.status, 200);
          assert.deepEqual(ws.body.sites.map((x) => x.id), [siteA.id]);
          const jobs = ws.body.interventions.map((x) => x.id);
          assert.ok(jobs.includes(jobA.id) && !jobs.includes(jobB.id), `workspace dossiers: ${JSON.stringify(jobs)}`);
          return { sites: 1, server: true };
        });
        await s.step("browser: no POST /api/* issued", async () => {
          const posts = postsTo(h.network);
          assert.deepEqual(posts, [], `interface issued write request(s): ${JSON.stringify(posts)}`);
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "owner: member access controls and budget editor available", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login owner", () => login(h, base, owner, projectRef));
        await s.step("members: owner badge, 'Accès aux sites' and 'Retirer' offered for other members", async () => {
          await openHash(h.page, base, "members");
          await expectVisible(h.page.getByText(/Votre rôle : Propriétaire/), "owner badge", { timeout: 45000 });
          await expectVisible(h.page.getByRole("button", { name: "Accès aux sites", exact: true }), "'Accès aux sites' control", { timeout: 30000 });
          await expectVisible(h.page.getByRole("button", { name: "Retirer", exact: true }), "'Retirer' control");
          await capture(h, out, "owner-members", s);
          return { accessControls: await h.page.getByRole("button", { name: "Accès aux sites", exact: true }).count() };
        });
        await s.step("site B: budget editor and request creation available", async () => {
          await goHash(h.page, `site/${siteB.id}`);
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "budget section", { timeout: 30000 });
          await sleep(800);
          const enabled = await enabledControls(budgetSection(h.page));
          assert.ok(enabled >= 1, "owner has no enabled budget control");
          await expectVisible(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' for the owner");
          await capture(h, out, "owner-site-b", s);
          return { budgetControls: enabled };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
