// Fixture registry: creates cohort data with the service client, tracks every created id in the
// manifest (rewritten after each creation, mode 0600) and collects ids the application created
// indirectly (dossiers, documents, tickets, quotes, approvals) for the cleanup plan.
//
// Stop gate (QA-003): every write goes through `guardWrites`, which refuses the call once the
// lifecycle raised the stop signal (StopRequestedError), and every creation helper is registered
// as in-flight so the lifecycle drains it (ids written to the manifest) BEFORE cleanup deletes.
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { emptyManifest } from "./cleanup.mjs";
import { newPassword } from "./cohort.mjs";
import { createStopGate } from "./lifecycle.mjs";

const TAX = 20;
export const WRITE_METHODS = ["insert", "upsert", "update", "delete", "rpc", "createAuthUser"];

/** Service client whose write methods check the stop gate before each call; reads are untouched. */
export function guardWrites(db, gate) {
  const guarded = Object.create(db);
  for (const method of WRITE_METHODS) {
    if (typeof db[method] !== "function") continue;
    guarded[method] = async (...args) => {
      gate.check();
      return db[method](...args);
    };
  }
  return guarded;
}

export class Fixtures {
  constructor({ db, cohort, manifestPath, context, redactor, gate = createStopGate() }) {
    this.gate = gate;
    this.db = guardWrites(db, gate);
    this.cohort = cohort;
    this.manifestPath = manifestPath;
    this.redactor = redactor;
    this.manifest = emptyManifest({ run_id: cohort.runId, ...context });
    this.users = [];
  }

  /** Runs one creation: refused once stopping, registered as in-flight until it settles. */
  creating(fn) {
    return this.gate.register(
      (async () => {
        this.gate.check();
        return fn();
      })(),
    );
  }

  /** Manifest tracking is never gated: an id created after the signal must still be deleted. */
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
  createUser(label, role, options = {}) {
    return this.creating(async () => {
      const email = this.cohort.email(label);
      const password = newPassword();
      this.redactor.add(password);
      const fullName = this.cohort.fullName(label);
      // The profile trigger reads user_metadata.role; admin is applied afterwards by service role.
      const metadataRole = role === "admin" ? "client" : role;
      const id = await this.db.createAuthUser({ email, password, fullName, role: metadataRole });
      await this.track("auth_users", id);
      await this.track("profiles", id);
      // Named in the manifest so a deletion refused by a last-super-admin guard is reported as such.
      if (role === "admin") await this.track("admin_profiles", id);
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
    });
  }

  createOrganization(owner, label) {
    return this.creating(async () => {
      const [org] = await this.db.insert("organizations", [{ name: this.cohort.name(label), owner_id: owner.id }]);
      await this.track("organizations", org.id);
      await this.db.insert("organization_members", [{ organization_id: org.id, user_id: owner.id, role: "owner" }]);
      return org;
    });
  }
  addMember(org, user, role) {
    return this.creating(async () => {
      await this.db.insert("organization_members", [{ organization_id: org.id, user_id: user.id, role }]);
    });
  }
  createSite(org, label, budgetCents = 10000) {
    return this.creating(async () => {
      const [site] = await this.db.insert("sites", [{ organization_id: org.id, name: this.cohort.name(label), type: "office", address: "Adresse technique QA, aucun déplacement", budget_cents: budgetCents }]);
      await this.track("sites", site.id);
      return site;
    });
  }
  /** Site scope for a member: scope 'selected' with grants [{site_id, can_write}]. */
  setSiteScope(org, user, scope, grants = []) {
    return this.creating(async () => {
      await this.db.upsert("organization_member_site_scopes", [{ organization_id: org.id, user_id: user.id, scope }], "organization_id,user_id");
      if (grants.length) await this.db.insert("organization_member_site_grants", grants.map((g) => ({ organization_id: org.id, user_id: user.id, site_id: g.site_id, can_write: Boolean(g.can_write) })));
    });
  }
  createIntervention({ client, artisan = null, site = null, status = "requested", description, createdAt, category = "outage", urgency = "scheduled", city }) {
    return this.creating(async () => {
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
    });
  }
  createInterventions(rows) {
    return this.creating(async () => {
      const prepared = rows.map((r) => ({ id: randomUUID(), ...r }));
      await this.track("interventions", ...prepared.map((r) => r.id));
      for (let i = 0; i < prepared.length; i += 50) await this.db.insert("interventions", prepared.slice(i, i + 50));
      return prepared;
    });
  }
  createQuote({ intervention, artisan, lines = [{ label: "QA prestation", quantity: 1, unit_price_cents: 10000 }], status = "sent" }) {
    return this.creating(async () => {
      const subtotal = lines.reduce((n, l) => n + l.quantity * l.unit_price_cents, 0);
      const tax = Math.round((subtotal * TAX) / 100);
      const id = randomUUID();
      await this.track("quotes", id);
      await this.db.insert("quotes", [{ id, intervention_id: intervention.id, artisan_id: artisan.id, lines, subtotal_cents: subtotal, tax_rate: TAX, tax_cents: tax, total_cents: subtotal + tax, status }]);
      return { id, total_cents: subtotal + tax };
    });
  }

  /**
   * Pending approval of a quote on a site. The DB trigger `quote_approval_queue`
   * (`queue_quote_approval`, migration 202610310002) already inserts `approvals(quote_id, site_id)`
   * when the quote's site has an enabled rule whose threshold the quote total exceeds, and
   * `approvals.quote_id` is UNIQUE: the row the trigger created is read back and reused. One is
   * inserted only when genuinely absent (rule disabled or threshold not exceeded). Either way the
   * id is recorded in the manifest (cleanup: `approvals` by id, then by site_id, before `quotes`).
   */
  ensureApproval({ quote, site }) {
    return this.creating(async () => {
      const existing = await this.db.select("approvals", { quote_id: `eq.${quote.id}` }, "*");
      if (existing.length > 1) throw new Error(`approvals: ${existing.length} rows for quote ${quote.id}, expected at most one (UNIQUE quote_id)`);
      let approval = existing[0] || null;
      let origin = "trigger";
      if (approval) {
        if (approval.site_id !== site.id) throw new Error(`approvals: the trigger queued quote ${quote.id} on site ${approval.site_id}, expected ${site.id}`);
        if (approval.status !== "pending") {
          [approval] = await this.db.update("approvals", { id: `eq.${approval.id}` }, { status: "pending", decided_by: null, decided_at: null, note: "" });
          origin = "trigger, reset to pending";
        }
      } else {
        [approval] = await this.db.insert("approvals", [{ quote_id: quote.id, site_id: site.id, status: "pending" }]);
        origin = "inserted";
      }
      await this.track("approvals", approval.id);
      return { ...approval, origin };
    });
  }
  /** Approval rule of a site (cleanup: approval_rules by site_id). */
  setApprovalRule(site, { thresholdCents = 0, requiredRole = "manager", enabled = true } = {}) {
    return this.creating(async () => {
      const [rule] = await this.db.upsert("approval_rules", [{ site_id: site.id, threshold_cents: thresholdCents, required_role: requiredRole, enabled }], "site_id");
      return rule;
    });
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
      const quoteIds = this.manifest.created.quotes;
      if (quoteIds.length) {
        // Approvals queued by the DB trigger for cohort quotes (also covered by site_id for cohort sites).
        const approvals = await this.db.select("approvals", { quote_id: `in.(${quoteIds.join(",")})` }, "id");
        await this.track("approvals", ...approvals.map((a) => a.id));
      }
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
