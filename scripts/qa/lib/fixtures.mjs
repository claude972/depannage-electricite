// Fixture registry: creates cohort data with the service client, tracks every created id in the
// manifest (rewritten after each creation, mode 0600) and collects ids the application created
// indirectly (dossiers, documents, tickets, quotes) for the cleanup plan.
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { emptyManifest } from "./cleanup.mjs";
import { newPassword } from "./cohort.mjs";

const TAX = 20;

export class Fixtures {
  constructor({ db, cohort, manifestPath, context, redactor }) {
    this.db = db;
    this.cohort = cohort;
    this.manifestPath = manifestPath;
    this.redactor = redactor;
    this.manifest = emptyManifest({ run_id: cohort.runId, ...context });
    this.users = [];
  }

  async track(key, ...ids) {
    const list = this.manifest.created[key] || (this.manifest.created[key] = []);
    for (const id of ids) if (id && !list.includes(id)) list.push(id);
    await this.save();
  }
  async save() {
    this.manifest.updated_at = new Date().toISOString();
    await writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2) + "\n", { mode: 0o600 });
  }

  /** Creates a confirmed Auth user + profile role. Password generated here, never persisted. */
  async createUser(label, role, options = {}) {
    const email = this.cohort.email(label);
    const password = newPassword();
    this.redactor.add(password);
    const fullName = this.cohort.fullName(label);
    // The profile trigger reads user_metadata.role; admin is applied afterwards by service role.
    const metadataRole = role === "admin" ? "client" : role;
    const id = await this.db.createAuthUser({ email, password, fullName, role: metadataRole });
    await this.track("auth_users", id);
    await this.track("profiles", id);
    const patch = { role, full_name: fullName };
    if (role === "artisan") patch.artisan_approved = options.approved !== false;
    let updated = await this.db.update("profiles", { id: `eq.${id}` }, patch);
    if (!updated.length) {
      // The profile row comes from the auth trigger; give it a moment, then fail loudly.
      await new Promise((resolve) => setTimeout(resolve, 500));
      updated = await this.db.update("profiles", { id: `eq.${id}` }, patch);
      if (!updated.length) throw new Error(`profile row missing for the new auth user ${label}: the profile trigger did not run`);
    }
    if (role === "artisan") {
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
  }

  async createOrganization(owner, label) {
    const [org] = await this.db.insert("organizations", [{ name: this.cohort.name(label), owner_id: owner.id }]);
    await this.track("organizations", org.id);
    await this.db.insert("organization_members", [{ organization_id: org.id, user_id: owner.id, role: "owner" }]);
    return org;
  }
  async addMember(org, user, role) {
    await this.db.insert("organization_members", [{ organization_id: org.id, user_id: user.id, role }]);
  }
  async createSite(org, label, budgetCents = 10000) {
    const [site] = await this.db.insert("sites", [{ organization_id: org.id, name: this.cohort.name(label), type: "office", address: "Adresse technique QA, aucun déplacement", budget_cents: budgetCents }]);
    await this.track("sites", site.id);
    return site;
  }
  /** Site scope for a member: scope 'selected' with grants [{site_id, can_write}]. */
  async setSiteScope(org, user, scope, grants = []) {
    await this.db.upsert("organization_member_site_scopes", [{ organization_id: org.id, user_id: user.id, scope }], "organization_id,user_id");
    if (grants.length) await this.db.insert("organization_member_site_grants", grants.map((g) => ({ organization_id: org.id, user_id: user.id, site_id: g.site_id, can_write: Boolean(g.can_write) })));
  }
  async createIntervention({ client, artisan = null, site = null, status = "requested", description, createdAt, category = "outage", urgency = "scheduled", city }) {
    const id = randomUUID();
    await this.track("interventions", id);
    const row = {
      id,
      client_id: client.id,
      artisan_id: artisan ? artisan.id : null,
      site_id: site ? site.id : null,
      category,
      description: this.cohort.description(description || "demande synthétique"),
      address: "Adresse technique QA, aucun déplacement",
      postal_code: "97200",
      city: city || this.cohort.name("Ville").slice(0, 120),
      urgency,
      estimate_min_cents: 10000,
      estimate_max_cents: 20000,
      status,
    };
    if (createdAt) row.created_at = createdAt;
    await this.db.insert("interventions", [row]);
    return { id, ...row };
  }
  async createInterventions(rows) {
    const prepared = rows.map((r) => ({ id: randomUUID(), ...r }));
    await this.track("interventions", ...prepared.map((r) => r.id));
    for (let i = 0; i < prepared.length; i += 50) await this.db.insert("interventions", prepared.slice(i, i + 50));
    return prepared;
  }
  async createQuote({ intervention, artisan, lines = [{ label: "QA prestation", quantity: 1, unit_price_cents: 10000 }], status = "sent" }) {
    const subtotal = lines.reduce((n, l) => n + l.quantity * l.unit_price_cents, 0);
    const tax = Math.round((subtotal * TAX) / 100);
    const id = randomUUID();
    await this.track("quotes", id);
    await this.db.insert("quotes", [{ id, intervention_id: intervention.id, artisan_id: artisan.id, lines, subtotal_cents: subtotal, tax_rate: TAX, tax_cents: tax, total_cents: subtotal + tax, status }]);
    return { id, total_cents: subtotal + tax };
  }

  /** Reads what the application created on behalf of cohort users and adds it to the manifest. */
  async collectIndirect() {
    const userIds = this.manifest.created.profiles;
    if (!userIds.length) return;
    const inUsers = `in.(${userIds.join(",")})`;
    const jobs = await this.db.select("interventions", { client_id: inUsers }, "id");
    await this.track("interventions", ...jobs.map((j) => j.id));
    const jobIds = this.manifest.created.interventions;
    const inJobs = jobIds.length ? `in.(${jobIds.join(",")})` : null;
    const docs = [
      ...(await this.db.select("documents", { owner_id: inUsers }, "id,path")),
      ...(inJobs ? await this.db.select("documents", { intervention_id: inJobs }, "id,path") : []),
    ];
    await this.track("documents", ...docs.map((d) => d.id));
    await this.track("storage_paths", ...docs.map((d) => d.path));
    const tickets = await this.db.select("support_tickets", { creator_id: inUsers }, "id");
    await this.track("support_tickets", ...tickets.map((t) => t.id));
    if (inJobs) {
      const quotes = await this.db.select("quotes", { intervention_id: inJobs }, "id");
      await this.track("quotes", ...quotes.map((q) => q.id));
    }
    const orgs = await this.db.select("organizations", { owner_id: inUsers }, "id");
    await this.track("organizations", ...orgs.map((o) => o.id));
    const orgIds = this.manifest.created.organizations;
    if (orgIds.length) {
      const sites = await this.db.select("sites", { organization_id: `in.(${orgIds.join(",")})` }, "id");
      await this.track("sites", ...sites.map((s) => s.id));
    }
  }
}
