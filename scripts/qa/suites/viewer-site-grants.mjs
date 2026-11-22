// Contract §5 `viewer-site-grants`: viewer, read-grant manager (site visible, can_write=false)
// and write-grant manager never see write controls outside their rights and the interface never
// issues a POST the server would refuse (403 never requested); the owner sees the controls.
// Server probes from the restricted user's own session confirm the 403 fail-closed: application
// routes always, direct Supabase RPC when a publishable key is configured (QA-002).
// Markup reference: components/role/enterprise-space.tsx on claude/web-pwa-design (M13 sites
// table, M4/M66 interventions table); the sites view has no card and no per-site heading.
import assert from "node:assert/strict";
import { newPage, login, openHash, goHash, api, capture, bodyText, expectVisible, expectAbsentOrDisabled, postsTo, sessionAccessToken, sleep } from "../lib/browser.mjs";
import { userRpc } from "../lib/supabase.mjs";

const OWNER_ONLY = ["Accès aux sites", "Retirer", "Transférer la propriété"];
const SCOPED_REASON = "Vos droits d’écriture sont limités à certains sites.";
const VIEWER_REASON = "Votre rôle est en lecture seule dans cette organisation.";

export const suite = {
  name: "viewer-site-grants",
  description: "Viewer, read-grant and write-grant managers: write controls hidden, no POST issued, server 403 on direct commands; owner sees controls",
  needsCredentials: true,
  plan: [
    "owner (manager profile)",
    "write-grant manager (selected: site A, can_write=true)",
    "read-grant manager (selected: site A, can_write=false)",
    "viewer",
    "approved artisan",
    "organization with sites A and B, approval rule on A",
    "dossier A (quoted, one sent quote, pending approval queued by the DB trigger and reused) and dossier B",
  ],
  async run(ctx) {
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor, credentials, timeoutMs } = ctx;
    const owner = await fixtures.createUser("owner", "manager");
    const writer = await fixtures.createUser("manager-site-a-write", "manager");
    const reader = await fixtures.createUser("manager-site-a-read", "manager");
    const viewer = await fixtures.createUser("viewer", "manager");
    const artisan = await fixtures.createUser("artisan-sites", "artisan");
    const org = await fixtures.createOrganization(owner, "Organisation");
    const siteA = await fixtures.createSite(org, "Site A");
    const siteB = await fixtures.createSite(org, "Site B");
    await fixtures.addMember(org, writer, "manager");
    await fixtures.addMember(org, reader, "manager");
    await fixtures.addMember(org, viewer, "viewer");
    await fixtures.setSiteScope(org, writer, "selected", [{ site_id: siteA.id, can_write: true }]);
    await fixtures.setSiteScope(org, reader, "selected", [{ site_id: siteA.id, can_write: false }]);
    const rule = await fixtures.setApprovalRule(siteA, { thresholdCents: 0, requiredRole: "manager", enabled: true });
    const jobA = await fixtures.createIntervention({ client: owner, artisan, site: siteA, description: "dossier du site A", status: "quoted" });
    const jobB = await fixtures.createIntervention({ client: owner, site: siteB, description: "dossier du site B", status: "requested" });
    const quoteA = await fixtures.createQuote({ intervention: jobA, artisan });
    // The rule on A is enabled with threshold 0: inserting the quote fires the DB trigger
    // `quote_approval_queue`, which already queues the approval (UNIQUE quote_id). Reuse it.
    const approval = await fixtures.ensureApproval({ quote: quoteA, site: siteA });
    assert.equal(approval.status, "pending", `approval ${approval.id} is ${approval.status}, expected pending`);

    const budgetSection = (page) => page.locator('section[aria-labelledby="site-budget"]');
    const ruleSection = (page) => page.locator('section[aria-labelledby="site-rule"]');
    // M13 « Mes sites » is a TABLE (enterprise-space.tsx, section `sites-table-title`): one row per
    // site, whose first cell is a `rowOpen` button named "<site name> <type> · <address>" (icons are
    // aria-hidden). A site is located by its row / open button, never by a heading or a card.
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sitesTable = (page) => page.locator('section[aria-labelledby="sites-table-title"]');
    const siteRow = (page, site) => sitesTable(page).getByRole("row", { name: new RegExp(escapeRe(site.name)) });
    const siteOpen = (page, site) => sitesTable(page).getByRole("button", { name: new RegExp(`^${escapeRe(site.name)}\\b`) });
    const siteSheetHeading = (page, site) => page.getByRole("heading", { level: 1, name: new RegExp(escapeRe(site.name)) });
    const expectSiteListed = async (page, site, label) => {
      await expectVisible(siteRow(page, site), `${label} row in the sites table`);
      await expectVisible(siteOpen(page, site), `${label} open button in its row`);
    };
    const expectSiteAbsent = async (page, site, who) => {
      assert.equal(await siteRow(page, site).count(), 0, `${site.name} row rendered for ${who}`);
      assert.equal(await siteOpen(page, site).count(), 0, `${site.name} open button rendered for ${who}`);
    };
    const enabledControls = async (locator) => {
      const controls = locator.locator("button, input, select, textarea");
      let enabled = 0;
      for (let i = 0; i < (await controls.count()); i++) if ((await controls.nth(i).isVisible()) && (await controls.nth(i).isEnabled())) enabled++;
      return enabled;
    };
    const assertUnchanged = async () => {
      const [site] = await db.select("sites", { id: `eq.${siteA.id}` }, "budget_cents");
      assert.equal(site.budget_cents, 10000, "site A budget changed");
      const [r] = await db.select("approval_rules", { site_id: `eq.${siteA.id}` }, "threshold_cents,required_role,enabled");
      assert.deepEqual(r, { threshold_cents: rule.threshold_cents, required_role: rule.required_role, enabled: rule.enabled }, "approval rule changed");
      const [a] = await db.select("approvals", { id: `eq.${approval.id}` }, "status,decided_by");
      assert.equal(a.status, "pending", "approval decided");
      assert.equal(a.decided_by, null);
    };
    /** Application-route commands the restricted user must be refused (403). */
    const probeAppRoutes = async (page, user) => {
      const attempts = [
        ["set_site_budget", "/api/professional", { action: "set_site_budget", site_id: siteA.id, budget_cents: 20000 }],
        ["set_approval_rule", "/api/professional", { action: "set_approval_rule", site_id: siteA.id, threshold_cents: 50000, required_role: "owner", enabled: false }],
        ["decide_approval", "/api/professional", { action: "decide_approval", approval_id: approval.id, decision: "approved", note: "QA refus attendu" }],
        ["create_intervention", "/api/interventions", { category: "outage", description: cohort.description("création refusée attendue sur le site A"), address: "Adresse technique QA, aucun déplacement", postal_code: "97200", city: "TEST QA", urgency: "scheduled", site_id: siteA.id }],
      ];
      const results = {};
      for (const [name, route, body] of attempts) {
        const r = await api(page, route, body);
        results[name] = { status: r.status, error: typeof r.body?.error === "string" ? r.body.error.slice(0, 120) : null };
        assert.equal(r.status, 403, `${name} via ${route} answered ${r.status} for ${user.label} (expected 403)`);
      }
      await assertUnchanged();
      assert.equal(await db.count("interventions", { client_id: `eq.${user.id}` }), 0, "a dossier was created for the restricted user");
      return results;
    };
    /** Direct Supabase RPC with the user's own session token (only when a publishable key is configured). */
    const probeDirectRpc = async (handle, user) => {
      const key = credentials?.supabase?.publishableKey;
      if (!key) return { skipped: "no supabase.publishable_key in the credentials file: direct RPC probes not run (application-route probes were)" };
      const token = await sessionAccessToken(handle.context, projectRef);
      assert.ok(token, "could not read the user's session token from the auth cookie");
      const conn = { url: credentials.supabase.url, publishableKey: key, accessToken: token, timeoutMs };
      const calls = [
        ["set_site_budget", { p_site_id: siteA.id, p_budget_cents: 20000 }],
        ["set_approval_rule", { p_site_id: siteA.id, p_threshold_cents: 50000, p_required_role: "owner", p_enabled: false }],
        ["decide_approval", { p_approval_id: approval.id, p_decision: "approved", p_note: "QA refus attendu" }],
        ["create_intervention", { p_category: "outage", p_description: cohort.description("création RPC refusée attendue"), p_address: "Adresse technique QA, aucun déplacement", p_postal_code: "97200", p_city: "TEST QA", p_urgency: "scheduled", p_site_id: siteA.id }],
      ];
      const results = {};
      for (const [name, args] of calls) {
        const r = await userRpc(conn, name, args);
        results[name] = r;
        assert.ok(r.status >= 400 && r.status < 500, `RPC ${name} as ${user.label} answered ${r.status} (expected a 4xx refusal)`);
        assert.ok(["42501", "P0001"].includes(String(r.code)), `RPC ${name} refused with unexpected code ${r.code}`);
      }
      await assertUnchanged();
      assert.equal(await db.count("interventions", { client_id: `eq.${user.id}` }), 0, "a dossier was created through RPC for the restricted user");
      return results;
    };
    const noPosts = (h) => {
      const posts = postsTo(h.network);
      assert.deepEqual(posts, [], `interface issued ${posts.length} write request(s): ${JSON.stringify(posts)}`);
      return { apiRequests: h.network.length };
    };

    await report.scenario(suite.name, "viewer: read-only everywhere, no POST issued, server 403 on direct commands", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login viewer", () => login(h, base, viewer, projectRef));
        await s.step("members: role badge Lecture, no owner controls", async () => {
          await goHash(h.page, "members");
          await expectVisible(h.page.getByText(/Votre rôle : Lecture/), "membership badge 'Lecture'");
          await sleep(1000);
          for (const name of OWNER_ONLY) await expectAbsentOrDisabled(h.page.getByRole("button", { name, exact: true }), `'${name}' for a viewer`);
          await capture(h, out, "viewer-members", s);
        });
        await s.step("site A: no request creation, budget editor and rule configuration unavailable, viewer reason shown", async () => {
          await goHash(h.page, `site/${siteA.id}`);
          await expectVisible(siteSheetHeading(h.page, siteA), "site A sheet heading");
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "site budget section");
          await sleep(800);
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' for a viewer");
          assert.equal(await enabledControls(budgetSection(h.page)), 0, "viewer has an enabled budget control");
          await expectAbsentOrDisabled(ruleSection(h.page).getByRole("button", { name: "Configurer la règle", exact: true }), "'Configurer la règle' for a viewer");
          await expectVisible(h.page.getByText(VIEWER_REASON, { exact: true }), "viewer read-only reason");
          await capture(h, out, "viewer-site-a", s);
        });
        await s.step("approval: decision reserved, no Approuver/Refuser", async () => {
          await goHash(h.page, `approval/${approval.id}`);
          await expectVisible(h.page.getByText("Décision réservée", { exact: true }), "'Décision réservée' for a viewer");
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Approuver", exact: true }), "'Approuver' for a viewer");
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Refuser", exact: true }), "'Refuser' for a viewer");
          await capture(h, out, "viewer-approval", s);
        });
        await s.step("sites table (A and B listed) and dossier A readable, still no write control", async () => {
          await goHash(h.page, "sites");
          await expectSiteListed(h.page, siteA, "site A");
          await expectSiteListed(h.page, siteB, "site B");
          await sleep(800);
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' on sites for a viewer");
          await goHash(h.page, `detail/${jobA.id}`);
          await expectVisible(h.page.getByText(jobA.description, { exact: false }), "dossier A description");
          await capture(h, out, "viewer-dossier-a", s);
        });
        await s.step("browser: no POST /api/* was issued during the viewer navigation", () => noPosts(h));
        await s.step("server: application-route commands refused (403), state unchanged", async () => ({ server: true, ...(await probeAppRoutes(h.page, viewer)) }));
        await s.step("server: direct RPC with the viewer's own session refused", async () => ({ server: true, ...(await probeDirectRpc(h, viewer)) }));
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "read-grant manager (site A visible, can_write=false): write controls hidden with the reason, server 403 on direct commands", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login read-grant manager", () => login(h, base, reader, projectRef));
        await s.step("sites table: A listed and read-only, B absent", async () => {
          await goHash(h.page, "sites");
          await expectSiteListed(h.page, siteA, "site A");
          await sleep(800);
          await expectSiteAbsent(h.page, siteB, "a manager scoped to A");
          assert.ok(!(await bodyText(h.page)).includes(siteB.name), "site B named somewhere on the sites view for a manager scoped to A");
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' for a read-grant manager");
          await capture(h, out, "reader-sites", s);
        });
        await s.step("site A: new request, budget editor and rule configuration hidden with the scoped read-only reason", async () => {
          await goHash(h.page, `site/${siteA.id}`);
          await expectVisible(siteSheetHeading(h.page, siteA), "site A sheet heading");
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "site budget section");
          await sleep(800);
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' for a read-grant manager");
          assert.equal(await enabledControls(budgetSection(h.page)), 0, "read-grant manager has an enabled budget control");
          await expectAbsentOrDisabled(ruleSection(h.page).getByRole("button", { name: "Configurer la règle", exact: true }), "'Configurer la règle' for a read-grant manager");
          const reasons = await h.page.getByText(SCOPED_REASON, { exact: true }).count();
          assert.ok(reasons >= 1, `read-only reason '${SCOPED_REASON}' not shown`);
          await capture(h, out, "reader-site-a", s);
          return { readOnlyReasons: reasons };
        });
        await s.step("approval on site A: decision reserved with the scoped reason, no Approuver/Refuser", async () => {
          await goHash(h.page, `approval/${approval.id}`);
          await expectVisible(h.page.getByText("Décision réservée", { exact: true }), "'Décision réservée' for a read-grant manager");
          await expectVisible(h.page.getByText(SCOPED_REASON, { exact: true }), "scoped read-only reason on the approval");
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Approuver", exact: true }), "'Approuver' for a read-grant manager");
          await expectAbsentOrDisabled(h.page.getByRole("button", { name: "Refuser", exact: true }), "'Refuser' for a read-grant manager");
          await capture(h, out, "reader-approval", s);
        });
        await s.step("members: own scope shown, no owner controls", async () => {
          await goHash(h.page, "members");
          await expectVisible(h.page.getByRole("heading", { name: "Votre accès", exact: true }), "own access section");
          await sleep(800);
          for (const name of OWNER_ONLY) await expectAbsentOrDisabled(h.page.getByRole("button", { name, exact: true }), `'${name}' for a read-grant manager`);
          await capture(h, out, "reader-members", s);
        });
        await s.step("server: workspace limited to site A, dossier B absent", async () => {
          const ws = await api(h.page, "/api/workspace");
          assert.equal(ws.status, 200);
          assert.deepEqual(ws.body.sites.map((x) => x.id), [siteA.id]);
          const jobs = ws.body.interventions.map((x) => x.id);
          assert.ok(jobs.includes(jobA.id) && !jobs.includes(jobB.id), `workspace dossiers: ${JSON.stringify(jobs)}`);
          return { server: true, sites: 1 };
        });
        await s.step("browser: no POST /api/* issued", () => noPosts(h));
        await s.step("server: set_site_budget / set_approval_rule / decide_approval / create_intervention on site A refused (403) via application routes", async () => ({ server: true, ...(await probeAppRoutes(h.page, reader)) }));
        await s.step("server: the same commands refused through direct RPC with the reader's own session", async () => ({ server: true, ...(await probeDirectRpc(h, reader)) }));
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "write-grant manager (site A write): site B and its dossier invisible, creation offered on A, no POST issued", async (s) => {
      const h = await newPage(browser, { baseUrl: base, redactor });
      try {
        await s.step("login write-grant manager", () => login(h, base, writer, projectRef));
        await s.step("sites table: only A listed, creation offered on A", async () => {
          await goHash(h.page, "sites");
          await expectSiteListed(h.page, siteA, "site A");
          await sleep(800);
          assert.ok(!(await bodyText(h.page)).includes(siteB.name), "site B visible to a manager scoped to A");
          await expectSiteAbsent(h.page, siteB, "a manager scoped to A");
          await expectVisible(h.page.getByRole("button", { name: "Nouvelle demande", exact: true }), "'Nouvelle demande' on site A for a writing manager");
          await capture(h, out, "writer-sites", s);
        });
        await s.step("site A: budget editor and rule configuration available", async () => {
          await goHash(h.page, `site/${siteA.id}`);
          await expectVisible(siteSheetHeading(h.page, siteA), "site A sheet heading");
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "budget section");
          await sleep(800);
          const enabled = await enabledControls(budgetSection(h.page));
          assert.ok(enabled >= 1, "write-grant manager has no enabled budget control");
          await expectVisible(ruleSection(h.page).getByRole("button", { name: "Configurer la règle", exact: true }), "'Configurer la règle' for a write-grant manager");
          await capture(h, out, "writer-site-a", s);
          return { budgetControls: enabled };
        });
        await s.step("members: own scope shown, no owner controls", async () => {
          await goHash(h.page, "members");
          await expectVisible(h.page.getByRole("heading", { name: "Votre accès", exact: true }), "own access section");
          await sleep(800);
          for (const name of OWNER_ONLY) await expectAbsentOrDisabled(h.page.getByRole("button", { name, exact: true }), `'${name}' for a scoped manager`);
          assert.ok(!(await bodyText(h.page)).includes(siteB.name), "site B named in the members view");
          await capture(h, out, "writer-members", s);
        });
        await s.step("dossier B not shown, dossier A shown", async () => {
          await goHash(h.page, `detail/${jobB.id}`);
          await sleep(1500);
          assert.ok(!(await bodyText(h.page)).includes(jobB.description), "dossier B content visible to the scoped manager");
          await capture(h, out, "writer-dossier-b", s);
          await goHash(h.page, `detail/${jobA.id}`);
          await expectVisible(h.page.getByText(jobA.description, { exact: false }), "dossier A description");
        });
        await s.step("server: workspace limited to site A and its dossier", async () => {
          const ws = await api(h.page, "/api/workspace");
          assert.equal(ws.status, 200);
          assert.deepEqual(ws.body.sites.map((x) => x.id), [siteA.id]);
          const jobs = ws.body.interventions.map((x) => x.id);
          assert.ok(jobs.includes(jobA.id) && !jobs.includes(jobB.id), `workspace dossiers: ${JSON.stringify(jobs)}`);
          return { server: true, sites: 1 };
        });
        await s.step("browser: no POST /api/* issued", () => noPosts(h));
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
          await expectVisible(h.page.getByText(/Votre rôle : Propriétaire/), "owner badge");
          await expectVisible(h.page.getByRole("button", { name: "Accès aux sites", exact: true }), "'Accès aux sites' control");
          await expectVisible(h.page.getByRole("button", { name: "Retirer", exact: true }), "'Retirer' control");
          await capture(h, out, "owner-members", s);
          return { accessControls: await h.page.getByRole("button", { name: "Accès aux sites", exact: true }).count() };
        });
        await s.step("sites table: A and B listed for the owner, B opens from its row", async () => {
          await goHash(h.page, "sites");
          await expectSiteListed(h.page, siteA, "site A");
          await expectSiteListed(h.page, siteB, "site B");
          await siteOpen(h.page, siteB).click();
          await expectVisible(siteSheetHeading(h.page, siteB), "site B sheet heading after opening its row");
        });
        await s.step("site B: budget editor and request creation available", async () => {
          await goHash(h.page, `site/${siteB.id}`);
          await expectVisible(siteSheetHeading(h.page, siteB), "site B sheet heading");
          await expectVisible(h.page.getByRole("heading", { name: "Budget", exact: true }), "budget section");
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
