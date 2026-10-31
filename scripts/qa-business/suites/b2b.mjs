// Suite `b2b` (contract §6, lot 017): real equipment through the UI with readback, stale version
// refused, maintenance/budget/ERP/SLA per the existing contracts, read-only member without write
// actions or POST, direct commands refused, revocation without stale facts, two organisations and
// two sites separated, error/retry state.
// Markup reference (b13b43a): components/role/enterprise-space.tsx (#site/<id>, section
// aria-labelledby="site-operations"), components/features/site-operations/*.tsx.
import assert from "node:assert/strict";
import { login, openHash, api, capture, bodyText, expectVisible, expectAbsentOrDisabled, postsTo, waitForApi, sleep, safeRoute, sessionAccessToken, noHorizontalOverflow } from "../../qa/lib/browser.mjs";
import { userRpc } from "../../qa/lib/supabase.mjs";

const OPS = 'section[aria-labelledby="site-operations"]';
const TABS = ["Équipements", "Maintenance", "Budget", "Grilles", "Délais", "Contrôles ERP", "Historique"];
const WRITE_CONTROLS = ["Ajouter un équipement", "Modifier", "Ajouter un plan", "Enregistrer une visite", "Ajouter un exercice", "Saisir", "Nouvelle grille", "Ajouter un calendrier", "Ajouter une règle", "Ouvrir un dossier de délai", "Nouveau contrôle", "Enregistrer"];
const isoToday = () => new Date().toISOString().slice(0, 10);
const isoPlusDays = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
/** PostgreSQL `date + 'N months'::interval` keeps the day when it exists, else the month's last day. */
export function addMonthsLikePostgres(isoDate, months) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const localDateTime = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const equipmentPayload = (name) => ({ name, category: "panel", criticality: "high", location: "", reference: "", installed_on: null, status: "in_service", notes: "" });

export const suite = {
  name: "b2b",
  description: "Site operations (017): UI-created equipment with readback, maintenance/budget/ERP/SLA, read-only member, direct refusals, revocation, separation, error/retry",
  needsCredentials: true,
  plan: [
    "owner (manager profile, owner of organisation A)",
    "read-only member (manager, scope selected, grant site A1 can_write=false)",
    "third party (manager profile, owner of organisation B)",
    "organisation A with sites A1 and A2 (erp), organisation B with site B1",
  ],
  async run(ctx) {
    /** Every application write probe checks the stop gate first. */
    const post = (page, route, body) => ctx.mutation(() => api(page, route, body));
    const { base, projectRef, fixtures, db, browser, cohort, out, report, redactor, credentials, timeoutMs } = ctx;
    const owner = await fixtures.createUser("owner", "manager");
    const reader = await fixtures.createUser("lecteur", "manager");
    const outsider = await fixtures.createUser("tiers-b2b", "manager");
    const orgA = await fixtures.createOrganization(owner, "Organisation A");
    const orgB = await fixtures.createOrganization(outsider, "Organisation B");
    const siteA1 = await fixtures.createSiteOfType(orgA, "Site A1", "erp");
    const siteA2 = await fixtures.createSiteOfType(orgA, "Site A2", "erp");
    const siteB1 = await fixtures.createSiteOfType(orgB, "Site B1", "erp");
    await fixtures.addMember(orgA, reader, "manager");
    await fixtures.setSiteScope(orgA, reader, "selected", [{ site_id: siteA1.id, can_write: false }]);
    const equipmentName = cohort.name("TGBT recette").slice(0, 160);
    const state = { equipmentId: null, version: null, planId: null, fiscalYearId: null, checklistId: null };

    const opsSection = (page) => page.locator(OPS);
    const openOps = async (page, site) => {
      await openHash(page, base, `site/${site.id}`);
      await expectVisible(opsSection(page).getByRole("heading", { name: "Opérations du site", exact: true }), "'Opérations du site' section");
    };
    const tab = async (page, name) => {
      const t = opsSection(page).getByRole("tab", { name, exact: true });
      await expectVisible(t, `tab '${name}'`);
      await t.click();
      await sleep(200);
    };
    const submitAndWait = async (page, buttonName) => {
      const wait = waitForApi(page, "/api/site-operations", { method: "POST" });
      await ctx.mutatingClick(opsSection(page).getByRole("button", { name: buttonName, exact: true }), wait); // gate checked right before the click; drain waits for click + response
      return (await wait).status();
    };

    await report.scenario(suite.name, "owner: equipment created through the UI, readback, edited to version 2, stale version refused by the server", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login owner", () => login(h, base, owner, projectRef));
        await s.step("site A1: operations section, empty equipment state, add form", async () => {
          await openOps(h.page, siteA1);
          await tab(h.page, "Équipements");
          await expectVisible(opsSection(h.page).getByRole("heading", { name: "Aucun équipement", exact: true }), "empty state before creation");
          await opsSection(h.page).getByRole("button", { name: "Ajouter un équipement", exact: true }).click();
          await expectVisible(opsSection(h.page).getByLabel("Désignation", { exact: true }), "'Désignation' field");
        });
        await s.step("submit: POST 200, success notice, card, readback version 1 + history event", async () => {
          const section = opsSection(h.page);
          await section.getByLabel("Désignation", { exact: true }).fill(equipmentName);
          await section.getByLabel("Catégorie", { exact: true }).selectOption("panel");
          await section.getByLabel("Criticité", { exact: true }).selectOption("high");
          await section.getByLabel("État", { exact: true }).selectOption("in_service");
          await section.getByLabel("Emplacement (facultatif)", { exact: true }).fill("Local technique QA");
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_equipment answered ${status}`);
          await expectVisible(section.getByText("Équipement ajouté.", { exact: true }), "success notice");
          await expectVisible(section.getByRole("list", { name: "Équipements" }).getByText(equipmentName, { exact: true }), "equipment card");
          const rows = await db.select("site_equipment", { site_id: `eq.${siteA1.id}` }, "id,name,category,criticality,status,location,version,created_by");
          assert.equal(rows.length, 1, "exactly one equipment row for A1");
          assert.deepEqual({ name: rows[0].name, category: rows[0].category, criticality: rows[0].criticality, status: rows[0].status, location: rows[0].location, version: rows[0].version, created_by: rows[0].created_by }, { name: equipmentName, category: "panel", criticality: "high", status: "in_service", location: "Local technique QA", version: 1, created_by: owner.id });
          state.equipmentId = rows[0].id;
          state.version = 1;
          const events = await db.select("site_operations_events", { entity_id: `eq.${rows[0].id}`, entity: "eq.equipment" }, "action,version,actor_id,site_id");
          assert.deepEqual(events, [{ action: "created", version: 1, actor_id: owner.id, site_id: siteA1.id }]);
          await capture(h, out, "b2b-owner-equipment-1280", s);
          return { equipment_id: rows[0].id };
        });
        await s.step("edit: status Dégradé → version 2, 'updated' event", async () => {
          const section = opsSection(h.page);
          await section.getByRole("button", { name: "Modifier", exact: true }).first().click();
          await section.getByLabel("État", { exact: true }).selectOption("degraded");
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200);
          await expectVisible(section.getByText("Équipement mis à jour.", { exact: true }), "update notice");
          const [row] = await db.select("site_equipment", { id: `eq.${state.equipmentId}` }, "status,version");
          assert.deepEqual(row, { status: "degraded", version: 2 });
          state.version = 2;
          const events = await db.select("site_operations_events", { entity_id: `eq.${state.equipmentId}` }, "action,version");
          assert.equal(events.filter((e) => e.action === "updated" && e.version === 2).length, 1);
        });
        await s.step("server: stale expected_version (1 while the row is 2) → 409, row unchanged", async () => {
          const r = await post(h.page, "/api/site-operations", { action: "save_equipment", site_id: siteA1.id, payload: { ...equipmentPayload(equipmentName), status: "retired" }, id: state.equipmentId, expected_version: 1 });
          assert.equal(r.status, 409, `stale version answered ${r.status}`);
          const [row] = await db.select("site_equipment", { id: `eq.${state.equipmentId}` }, "status,version");
          assert.deepEqual(row, { status: "degraded", version: 2 }, "row changed by a stale command");
          return { status: r.status, error: r.body?.error, note: "two-tab UI concurrency not exercised; refusal proven through the API" };
        });
        await s.step("separation: site A2 has no equipment, site B1 refused to the owner of A", async () => {
          const a2 = await api(h.page, `/api/site-operations?site_id=${siteA2.id}`);
          assert.equal(a2.status, 200);
          assert.deepEqual(a2.body?.snapshot?.equipment, [], "A1 equipment leaked into A2");
          const b1 = await api(h.page, `/api/site-operations?site_id=${siteB1.id}`);
          assert.equal(b1.status, 403, `site of organisation B answered ${b1.status} for the owner of A`);
          await openOps(h.page, siteA2);
          await tab(h.page, "Équipements");
          await expectVisible(opsSection(h.page).getByRole("heading", { name: "Aucun équipement", exact: true }), "A2 empty state");
          assert.ok(!(await bodyText(h.page)).includes(equipmentName), "A1 equipment name shown on A2");
          return { a2: a2.status, b1: b1.status };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "owner: maintenance plan and visit (next due computed from the configured periodicity only)", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login owner and open Maintenance", async () => {
          await login(h, base, owner, projectRef);
          await openOps(h.page, siteA1);
          await tab(h.page, "Maintenance");
        });
        await s.step("plan every 6 months with a due date → readback", async () => {
          const section = opsSection(h.page);
          await section.getByRole("button", { name: "Ajouter un plan", exact: true }).click();
          await section.getByLabel("Intitulé", { exact: true }).fill(cohort.name("vérification semestrielle").slice(0, 160));
          await section.getByLabel("Périodicité", { exact: true }).selectOption("months");
          await section.getByLabel("Valeur N", { exact: true }).fill("6");
          await section.getByLabel("Prochaine échéance (facultatif)", { exact: true }).fill(isoPlusDays(10));
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_maintenance_plan answered ${status}`);
          await expectVisible(section.getByText("Plan ajouté.", { exact: true }), "plan notice");
          const plans = await db.select("site_maintenance_plans", { site_id: `eq.${siteA1.id}` }, "id,frequency_kind,frequency_value,next_due_on,last_done_on,version");
          assert.equal(plans.length, 1);
          assert.deepEqual({ kind: plans[0].frequency_kind, value: plans[0].frequency_value, next: plans[0].next_due_on, last: plans[0].last_done_on }, { kind: "months", value: 6, next: isoPlusDays(10), last: null });
          state.planId = plans[0].id;
          return { plan_id: plans[0].id };
        });
        await s.step("visit recorded today → last_done_on today, next_due_on = today + 6 months (server), visits_total 1", async () => {
          const section = opsSection(h.page);
          await section.getByRole("button", { name: "Enregistrer une visite", exact: true }).click();
          await section.getByLabel("Date de la visite", { exact: true }).fill(isoToday());
          await section.getByLabel("Compte rendu (facultatif)", { exact: true }).fill(cohort.description("visite de recette"));
          const status = await submitAndWait(h.page, "Enregistrer la visite");
          assert.equal(status, 200, `record_maintenance_visit answered ${status}`);
          await expectVisible(section.getByText("Visite enregistrée.", { exact: true }), "visit notice");
          const [plan] = await db.select("site_maintenance_plans", { id: `eq.${state.planId}` }, "next_due_on,last_done_on,version");
          assert.equal(plan.last_done_on, isoToday());
          assert.equal(plan.next_due_on, addMonthsLikePostgres(isoToday(), 6), "next due recomputed from the configured periodicity");
          assert.equal(plan.version, 2);
          const report017 = await api(h.page, `/api/site-operations?site_id=${siteA1.id}`);
          const shown = report017.body?.snapshot?.maintenance_plans?.find((p) => p.id === state.planId);
          assert.equal(shown?.visits_total, 1);
          assert.equal(shown?.visits?.length, 1);
          return { next_due_on: plan.next_due_on };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "owner: fiscal year and budget line as entered; consumption from the server only", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login owner and open Budget", async () => {
          await login(h, base, owner, projectRef);
          await openOps(h.page, siteA1);
          await tab(h.page, "Budget");
        });
        await s.step("fiscal year of the current calendar year → readback", async () => {
          const section = opsSection(h.page);
          await section.getByRole("button", { name: "Ajouter un exercice", exact: true }).click();
          const year = isoToday().slice(0, 4);
          await section.getByLabel("Libellé", { exact: true }).fill(cohort.name(`exercice ${year}`).slice(0, 80));
          await section.getByLabel("Début", { exact: true }).fill(`${year}-01-01`);
          await section.getByLabel("Fin", { exact: true }).fill(`${year}-12-31`);
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_fiscal_year answered ${status}`);
          await expectVisible(section.getByText("Exercice ajouté.", { exact: true }), "fiscal year notice");
          const years = await db.select("organization_fiscal_years", { organization_id: `eq.${orgA.id}` }, "id,starts_on,ends_on,status");
          assert.equal(years.length, 1);
          assert.deepEqual({ s: years[0].starts_on, e: years[0].ends_on, status: years[0].status }, { s: `${year}-01-01`, e: `${year}-12-31`, status: "open" });
          state.fiscalYearId = years[0].id;
          return { fiscal_year_id: years[0].id };
        });
        await s.step("budget line Maintenance 1 234,50 € → amount_cents 123450, no invented consumption", async () => {
          const section = opsSection(h.page);
          // The « Maintenance » row of the lines table, then ITS « Saisir » button (no `.first()`).
          const maintenanceInput = section.getByRole("table").getByRole("row", { name: /^Maintenance\b/ }).getByRole("button", { name: "Saisir", exact: true });
          await expectVisible(maintenanceInput, "« Saisir » on the Maintenance row of the selected fiscal year", { timeout: 30000 });
          await maintenanceInput.click();
          await section.getByLabel("Montant (€)", { exact: true }).fill("1234,50");
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_budget_line answered ${status}`);
          await expectVisible(section.getByText("Ligne budgétaire enregistrée.", { exact: true }), "budget notice");
          const lines = await db.select("site_budget_lines", { site_id: `eq.${siteA1.id}` }, "category,amount_cents,fiscal_year_id,version");
          assert.deepEqual(lines, [{ category: "maintenance", amount_cents: 123450, fiscal_year_id: state.fiscalYearId, version: 1 }]);
          const text = await bodyText(h.page);
          assert.match(text, /1.234,50/, "budget total shown as entered");
          const r = await api(h.page, `/api/site-operations?site_id=${siteA1.id}`);
          const consumption = r.body?.snapshot?.budget_consumption?.find((c) => c.fiscal_year_id === state.fiscalYearId);
          assert.deepEqual({ accepted: consumption?.accepted_cents, paid: consumption?.paid_cents, n: consumption?.interventions }, { accepted: 0, paid: 0, n: 0 }, "consumption computed server-side on zero dossiers");
          assert.equal(r.body?.completeness?.budget?.configured, true);
          await capture(h, out, "b2b-owner-budget-1280", s);
          return { amount_cents: 123450 };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "owner: declarative ERP checklist with an open reserve; SLA rule without calendar stays not measurable", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login owner and open Contrôles ERP", async () => {
          await login(h, base, owner, projectRef);
          await openOps(h.page, siteA1);
          await tab(h.page, "Contrôles ERP");
        });
        await s.step("checklist with 2 points (ok, reserve) → readback nature=declarative, UI declarative wording, no certification wording", async () => {
          const section = opsSection(h.page);
          await expectVisible(section.getByRole("heading", { name: "Contrôles ERP — déclaratif", exact: true }), "declarative title");
          await section.getByRole("button", { name: "Nouveau contrôle", exact: true }).click();
          await section.getByLabel("Intitulé", { exact: true }).fill(cohort.name("contrôle éclairage de sécurité").slice(0, 160));
          await section.getByLabel("Statut", { exact: true }).selectOption("completed");
          await section.getByLabel("Point 1", { exact: true }).fill("Blocs autonomes testés (déclaration QA)");
          await section.getByLabel("Constat", { exact: true }).first().selectOption("ok");
          await section.getByRole("button", { name: "Ajouter un point", exact: true }).click();
          await section.getByLabel("Point 2", { exact: true }).fill("Pictogramme manquant (déclaration QA)");
          await section.getByLabel("Constat", { exact: true }).nth(1).selectOption("reserve");
          const status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_erp_checklist answered ${status}`);
          await expectVisible(section.getByText("Contrôle enregistré.", { exact: true }), "checklist notice");
          const lists = await db.select("site_erp_checklists", { site_id: `eq.${siteA1.id}` }, "id,nature,status,items");
          assert.equal(lists.length, 1);
          assert.equal(lists[0].nature, "declarative");
          assert.equal(lists[0].status, "completed");
          assert.deepEqual(lists[0].items.map((i) => i.state), ["ok", "reserve"]);
          state.checklistId = lists[0].id;
          const text = await section.innerText();
          assert.ok(text.includes("ne vaut pas certification réglementaire"), "declarative notice shown");
          assert.ok(text.includes("1 réserve ouverte"), "open reserve counted");
          assert.ok(!/certifi[ée]\b|conforme à la réglementation/i.test(text), "certification wording present");
          await capture(h, out, "b2b-owner-erp-1280", s);
          return { checklist_id: lists[0].id };
        });
        await s.step("SLA: rule without calendar (target 60 min) and a case → 'Non mesurable' with its reason; completeness counts it", async () => {
          await tab(h.page, "Délais");
          const section = opsSection(h.page);
          await section.getByRole("button", { name: "Ajouter une règle", exact: true }).click();
          await section.getByLabel("Nom", { exact: true }).fill(cohort.name("urgences").slice(0, 160));
          await section.getByLabel("Cible de réponse (minutes ouvrées, facultatif)", { exact: true }).fill("60");
          let status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_sla_policy answered ${status}`);
          await expectVisible(section.getByText("Règle enregistrée.", { exact: true }), "policy notice");
          await section.getByRole("button", { name: "Ouvrir un dossier de délai", exact: true }).click();
          await section.getByLabel("Ouverture", { exact: true }).fill(localDateTime(Date.now() - 3_600_000));
          status = await submitAndWait(h.page, "Enregistrer");
          assert.equal(status, 200, `save_sla_case answered ${status}`);
          await expectVisible(section.getByText("Dossier enregistré.", { exact: true }), "case notice");
          await expectVisible(section.getByText("Non mesurable", { exact: true }).first(), "'Non mesurable' tag");
          await expectVisible(section.getByText(/aucun calendrier ouvré n’est associé à la règle/), "not-measurable reason");
          const r = await api(h.page, `/api/site-operations?site_id=${siteA1.id}`);
          assert.equal(r.body?.completeness?.sla?.not_measurable, 1);
          assert.equal(r.body?.sla?.cases?.[0]?.response?.status, "not_measurable");
          assert.equal(r.body?.sla?.cases?.[0]?.response?.deadline_at, null, "no deadline invented");
          return { not_measurable: 1, note: "calendars, pauses and grids not exercised" };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "read-only member: facts visible, no write control on any tab, no POST, direct commands refused", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login read-only member", () => login(h, base, reader, projectRef));
        await s.step("site A1: operations readable, read-only block with the reason, owner's equipment listed", async () => {
          await openOps(h.page, siteA1);
          await tab(h.page, "Équipements");
          const section = opsSection(h.page);
          await expectVisible(section.getByRole("list", { name: "Équipements" }).getByText(equipmentName, { exact: true }), "owner's equipment visible to the reader");
          await expectVisible(section.getByText("Lecture seule", { exact: true }), "read-only block");
          const reasons = await section.getByText(/Vos droits d’écriture sont limités à certains sites\.|lecture seule/i).count();
          assert.ok(reasons >= 1, "read-only reason not shown");
          await capture(h, out, "b2b-reader-equipment-1280", s);
        });
        await s.step("every tab: no enabled write control", async () => {
          const seen = {};
          for (const name of TABS) {
            await tab(h.page, name);
            await sleep(300);
            for (const control of WRITE_CONTROLS) await expectAbsentOrDisabled(opsSection(h.page).getByRole("button", { name: control, exact: true }), `'${control}' on tab '${name}' for a read-only member`);
            seen[name] = true;
          }
          return seen;
        });
        await s.step("browser: no POST /api/* issued", () => {
          const posts = postsTo(h.network);
          assert.deepEqual(posts, [], `interface issued ${posts.length} write request(s): ${JSON.stringify(posts)}`);
          return { apiRequests: h.network.length };
        });
        await s.step("server: save_equipment / save_fiscal_year / save_erp_checklist refused (403) through the application route", async () => {
          const attempts = [
            ["save_equipment", { action: "save_equipment", site_id: siteA1.id, payload: equipmentPayload(cohort.name("refus attendu").slice(0, 160)) }],
            ["save_fiscal_year", { action: "save_fiscal_year", organization_id: orgA.id, payload: { label: "QA refus", starts_on: "2031-01-01", ends_on: "2031-12-31", status: "open" } }],
            ["save_erp_checklist", { action: "save_erp_checklist", site_id: siteA1.id, payload: { title: "QA refus", description: "", performed_on: null, performed_by_label: "", status: "draft", items: [] } }],
          ];
          const results = {};
          for (const [name, body] of attempts) {
            const r = await post(h.page, "/api/site-operations", body);
            results[name] = r.status;
            assert.equal(r.status, 403, `${name} answered ${r.status} for the read-only member`);
          }
          assert.equal(await db.count("site_equipment", { site_id: `eq.${siteA1.id}` }), 1, "equipment count changed");
          assert.equal(await db.count("organization_fiscal_years", { organization_id: `eq.${orgA.id}` }), 1, "fiscal years changed");
          assert.equal(await db.count("site_erp_checklists", { site_id: `eq.${siteA1.id}` }), 1, "checklists changed");
          return { server: true, ...results };
        });
        await s.step("server: direct RPC with the reader's own session refused", async () => {
          const key = credentials?.supabase?.publishableKey;
          if (!key) return { skipped: "no supabase.publishable_key in the credentials file: direct RPC probes not run (application-route probes were)" };
          const token = await sessionAccessToken(h.context, projectRef);
          assert.ok(token, "could not read the user's session token from the auth cookie");
          const conn = { url: credentials.supabase.url, publishableKey: key, accessToken: token, timeoutMs };
          // The gate is re-checked AFTER the token await, immediately before emission; the RPC is drained.
          const r = await ctx.mutation(() => userRpc(conn, "save_site_equipment", { p_site_id: siteA1.id, p_payload: equipmentPayload("QA refus RPC"), p_id: null, p_expected_version: null }));
          assert.ok(r.status >= 400 && r.status < 500, `RPC answered ${r.status}`);
          assert.equal(String(r.code), "42501", `RPC refused with ${r.code}`);
          assert.equal(await db.count("site_equipment", { site_id: `eq.${siteA1.id}` }), 1);
          return { server: true, rpc: r };
        });
        await s.step("revocation of the grant (service role) → GET 403, no stale fact in the page, workspace without A1, POST 403", async () => {
          await fixtures.revokeSiteGrant(orgA, reader, siteA1);
          const r = await api(h.page, `/api/site-operations?site_id=${siteA1.id}`);
          assert.equal(r.status, 403, `after revocation the site answered ${r.status}`);
          await openHash(h.page, base, `site/${siteA1.id}`);
          await sleep(1500);
          const text = await bodyText(h.page);
          assert.ok(!text.includes(equipmentName), "revoked member still sees the equipment name");
          const unavailable = await h.page.getByText("Données du site indisponibles", { exact: true }).count();
          const ws = await api(h.page, "/api/workspace");
          assert.equal(ws.status, 200);
          assert.ok(!(ws.body?.sites ?? []).some((x) => x.id === siteA1.id), "workspace still lists A1 after revocation");
          const refusedPost = await post(h.page, "/api/site-operations", { action: "save_equipment", site_id: siteA1.id, payload: equipmentPayload("QA refus après retrait") });
          assert.equal(refusedPost.status, 403);
          await capture(h, out, "b2b-reader-revoked-1280", s);
          return { get: r.status, post: refusedPost.status, unavailable_block_shown: unavailable > 0, note: unavailable > 0 ? "operations view shows the unavailable state with Réessayer" : "shell hides the site sheet after revocation (no stale content)" };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "third party (owner of organisation B): A1 refused, own site readable, no POST", async (s) => {
      const h = await ctx.openPage(s, {});
      try {
        await s.step("login third party", () => login(h, base, outsider, projectRef));
        await s.step("server: A1 refused (GET 403, POST 403), B1 readable (200)", async () => {
          const a1 = await api(h.page, `/api/site-operations?site_id=${siteA1.id}`);
          assert.equal(a1.status, 403);
          const refusedPost = await post(h.page, "/api/site-operations", { action: "save_equipment", site_id: siteA1.id, payload: equipmentPayload("QA refus inter-organisations") });
          assert.equal(refusedPost.status, 403);
          const b1 = await api(h.page, `/api/site-operations?site_id=${siteB1.id}`);
          assert.equal(b1.status, 200);
          assert.equal(b1.body?.snapshot?.site?.id, siteB1.id);
          assert.equal(await db.count("site_equipment", { site_id: `eq.${siteA1.id}` }), 1);
          return { a1: a1.status, post: refusedPost.status, b1: b1.status };
        });
        await s.step("UI: #site/<A1> shows nothing of A1; own site B1 shows its operations", async () => {
          await openHash(h.page, base, `site/${siteA1.id}`);
          await sleep(1500);
          const text = await bodyText(h.page);
          assert.ok(!text.includes(equipmentName) && !text.includes(siteA1.name), "A1 content visible to organisation B");
          await openOps(h.page, siteB1);
          await tab(h.page, "Équipements");
          await expectVisible(opsSection(h.page).getByRole("heading", { name: "Aucun équipement", exact: true }), "B1 empty state");
          await capture(h, out, "b2b-tiers-b1-1280", s);
        });
        await s.step("browser: no POST issued by the interface", () => {
          const posts = postsTo(h.network).filter((n) => n.status !== 403);
          assert.deepEqual(posts, [], `interface issued ${posts.length} write request(s)`);
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });

    await report.scenario(suite.name, "owner: error state on a 503 (browser interception) then retry restores the real data; 360 px capture", async (s) => {
      const h = await ctx.openPage(s, { width: 360, height: 780 });
      try {
        await s.step("login owner", () => login(h, base, owner, projectRef));
        await s.step("operations at 360 px without horizontal overflow", async () => {
          await openOps(h.page, siteA1);
          await tab(h.page, "Équipements");
          await expectVisible(opsSection(h.page).getByText(equipmentName, { exact: true }), "equipment at 360");
          await noHorizontalOverflow(h.page, 360);
          await capture(h, out, "b2b-owner-equipment-360", s);
        });
        await s.step("one intercepted 503 → 'Données du site indisponibles' + Réessayer; then real data again", async () => {
          let intercepted = 0;
          await safeRoute(h, s, (url) => url.pathname === "/api/site-operations", async (route) => {
            if (route.request().method() === "GET" && intercepted === 0) {
              intercepted++;
              await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "QA : indisponibilité simulée par interception navigateur." }) });
            } else await route.continue();
          }, "site-operations-503");
          await opsSection(h.page).getByRole("button", { name: "Actualiser", exact: true }).click();
          await expectVisible(h.page.locator('[data-blocker="site-operations-load"]'), "unavailable block after 503");
          await expectVisible(h.page.getByText("QA : indisponibilité simulée par interception navigateur.", { exact: true }), "server message rendered as-is");
          assert.ok(!(await opsSection(h.page).getByRole("list", { name: "Équipements" }).count()), "stale equipment list still rendered after a load failure");
          await capture(h, out, "b2b-owner-error-360", s);
          await h.page.unrouteAll({ behavior: "ignoreErrors" });
          await h.page.getByRole("button", { name: "Réessayer", exact: true }).click();
          await expectVisible(opsSection(h.page).getByRole("list", { name: "Équipements" }).getByText(equipmentName, { exact: true }), "equipment back after retry");
          return { intercepted, note: "unavailability simulated by browser interception, not by the backend" };
        });
        s.network(h.network);
      } finally {
        await h.close();
      }
    });
  },
};
