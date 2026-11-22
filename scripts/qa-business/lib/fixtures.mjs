// Fixtures of QA-DOCUMENTS-B2B-004 on top of the existing registry (scripts/qa/lib/fixtures.mjs,
// read-only): durable intents BEFORE Auth creation (pre-generated id written to the manifest, then
// `POST admin/users` with that id), a complete artisan issuer dossier, quote validity set in the
// past by the service role (explicitly labelled synthetic state), and the indirect collection of
// every row the application creates in migrations 015/016/017 for cohort dossiers and sites.
import { randomUUID } from "node:crypto";
import { Fixtures } from "../../qa/lib/fixtures.mjs";
import { newPassword } from "../../qa/lib/cohort.mjs";
import { emptyManifest } from "./cleanup.mjs";

export const QA_SYNTHETIC_LABEL = "QA: état simulé par service_role, non produit par le circuit utilisateur";

export class BusinessFixtures extends Fixtures {
  constructor(options) {
    super(options);
    this.auth = options.auth; // createAdminAuth(): createUser({id,…}), getUser(id)
    this.manifest = emptyManifest({ run_id: options.cohort.runId, ...options.context });
  }

  /** Intent written and persisted BEFORE the Auth call; status resolved afterwards. */
  async intend(label, email) {
    const intent = { id: randomUUID(), label, email, status: "pending", created_at: new Date().toISOString() };
    this.manifest.intents.push(intent);
    await this.save();
    return intent;
  }
  async resolveIntent(intent, serverId) {
    intent.status = "resolved";
    intent.server_id = serverId;
    intent.resolved_at = new Date().toISOString();
    await this.save();
  }

  /**
   * Confirmed Auth user + profile. The id is generated here and recorded as an intent first, so a
   * crash between the Auth call and the manifest update still leaves a recoverable record.
   */
  createUser(label, role, options = {}) {
    return this.creating(async () => {
      const email = this.cohort.email(label);
      const password = newPassword();
      this.redactor.add(password);
      const fullName = this.cohort.fullName(label);
      const intent = await this.intend(label, email);
      // The profile trigger reads user_metadata.role; admin is never created by this lot.
      if (role === "admin") throw new Error("QA-DOCUMENTS-B2B-004 never creates an administrator");
      this.gate.check();
      const serverId = await this.auth.createUser({ id: intent.id, email, password, fullName, role });
      const id = serverId;
      await this.track("auth_users", id);
      await this.track("profiles", id);
      await this.resolveIntent(intent, serverId);
      const patch = { role, full_name: fullName };
      if (role === "artisan") patch.artisan_approved = options.approved !== false;
      let updated = await this.db.update("profiles", { id: `eq.${id}` }, patch);
      if (!updated.length) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        updated = await this.db.update("profiles", { id: `eq.${id}` }, patch);
        if (!updated.length) throw new Error(`profile row missing for the new auth user ${label}: the profile trigger did not run`);
      }
      if (role === "artisan") {
        // Complete issuer dossier: quote_document_issuer (015) requires company_name, a 14-digit
        // siret, an address of 5+ characters and the account full_name; nothing else is invented.
        await this.db.upsert(
          "artisan_profiles",
          [{
            user_id: id,
            company_name: this.cohort.name(`${label} SARL`),
            siret: "12345678901234",
            legal_status: "QA fixture",
            employee_count: 1,
            address: "Adresse technique QA, aucun déplacement",
            postal_codes: ["97200"],
            categories: ["outage", "diagnostic"],
            available: true,
            application_status: options.approved === false ? "draft" : "approved",
            submitted_at: new Date().toISOString(),
          }],
          "user_id",
        );
      }
      const user = { id, email, password, fullName, role, label };
      this.users.push(user);
      return user;
    });
  }

  /** Site of a given type (017 scenarios use `erp`); cleanup by id. */
  createSiteOfType(org, label, type = "erp", budgetCents = 0) {
    return this.creating(async () => {
      const id = randomUUID();
      await this.track("sites", id);
      const [site] = await this.db.insert("sites", [{ id, organization_id: org.id, name: this.cohort.name(label), type, address: "Adresse technique QA, aucun déplacement", budget_cents: budgetCents }]);
      return site;
    });
  }

  /**
   * Synthetic expired validity: the API and the RPC refuse a past date, so only elapsed time
   * produces this state. Inserted by the service role and labelled; reported as simulated.
   */
  setQuoteTermsInThePast({ quote, artisan, daysAgo = 1 }) {
    return this.creating(async () => {
      const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
      await this.db.upsert("quote_terms", [{ quote_id: quote.id, valid_until: date, set_by: artisan.id }], "quote_id");
      return { quote_id: quote.id, valid_until: date, synthetic: QA_SYNTHETIC_LABEL };
    });
  }

  /** Reassignment of a dossier to another artisan by the service role (labelled synthetic state). */
  reassignIntervention({ intervention, artisan }) {
    return this.creating(async () => {
      const [row] = await this.db.update("interventions", { id: `eq.${intervention.id}` }, { artisan_id: artisan.id });
      return { intervention_id: row?.id ?? intervention.id, artisan_id: artisan.id, synthetic: QA_SYNTHETIC_LABEL };
    });
  }

  /** Removes one site grant (revocation by the owner, performed by the service role). */
  revokeSiteGrant(org, user, site) {
    return this.creating(async () => {
      await this.db.delete("organization_member_site_grants", { organization_id: `eq.${org.id}`, user_id: `eq.${user.id}`, site_id: `eq.${site.id}` });
      const remaining = await this.db.count("organization_member_site_grants", { organization_id: `eq.${org.id}`, user_id: `eq.${user.id}`, site_id: `eq.${site.id}` });
      if (remaining !== 0) throw new Error("site grant still present after revocation");
    });
  }

  /** Existing collection plus 015/017 rows created by the application for cohort dossiers/sites. */
  async collectIndirect() {
    await super.collectIndirect();
    const jobIds = this.manifest.created.interventions;
    if (jobIds.length) {
      const inJobs = `in.(${jobIds.join(",")})`;
      const amendments = await this.db.select("quote_amendments", { intervention_id: inJobs }, "id");
      await this.track("quote_amendments", ...amendments.map((a) => a.id));
      const documents = await this.db.select("quote_documents", { intervention_id: inJobs }, "id");
      await this.track("quote_documents", ...documents.map((d) => d.id));
    }
    // 017 rows are deleted by site_id / organization_id of the cohort: nothing else to list, but the
    // counts are recorded for the pilot's independent readback.
    const siteIds = this.manifest.created.sites;
    if (siteIds.length) {
      const inSites = `in.(${siteIds.join(",")})`;
      const counts = {};
      for (const table of ["site_equipment", "site_maintenance_plans", "site_maintenance_visits", "site_budget_lines", "site_sla_policies", "site_sla_cases", "site_erp_checklists"])
        counts[table] = await this.db.count(table, { site_id: inSites });
      this.manifest.site_operations_counts = counts;
      await this.save();
    }
  }
}
