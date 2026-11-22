// SYS-09 — execution of an APPROVED data erasure request, at application level.
//
// The request table (data_request_private.requests) only accepts execution_state = 'not_started' and
// is not writable from here, so the execution is recorded in the immutable platform journal:
// platform_audit, action `account_erasure_executed`, target = the request's support ticket, details =
// { request_id, account_id, steps, kept }. A request is « executed » when such a row exists.
//
// What is erased or anonymised (personal data of a « particulier » account):
//   profile identity and phone · saved addresses · free text written by the account (dossier
//   descriptions and addresses of dossiers without any payment, messages, support messages and
//   subjects, review text, warranty descriptions) · booking drafts · notifications and preferences ·
//   photos and files of dossiers without payment · the sign-in identity (e-mail replaced, account
//   disabled, sessions revoked).
// What is KEPT, because accounting and tax rules require it: payments, invoices and credit notes,
// accepted quotes, and the dossiers that gave rise to a payment (with their documents). The audit
// journals are kept too (they hold identifiers and action codes, no free text).
//
// Every step is attempted independently and reported: a step that the database refuses is listed as
// « non effectué » with its reason, never silently skipped. The sign-in identity is disabled last.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const ERASURE_ACTION = "account_erasure_executed";
export const ERASURE_TARGET_KIND = "support_ticket";
export const ERASED_TEXT = "Contenu effacé à la demande du titulaire du compte.";
export const ERASED_NAME = "Compte effacé";
export const CONFIRMATION_WORD = "EFFACER";
/** Dossier statuses that are closed for good: an erasure never runs over work in progress. */
const TERMINAL_STATUSES = ["paid", "cancelled"];

export type StepStatus = "done" | "kept" | "failed" | "none";
export type ErasureStep = { key: string; label: string; status: StepStatus; count: number; detail?: string };
export type ErasureExecution = { request_id: string; executed_at: string; executed_by: string | null; steps: ErasureStep[] };
export type ErasurePlan = {
  account_role: string;
  eligible: boolean;
  /** Why the execution is refused for now (empty when eligible). */
  blockers: string[];
  counts: { addresses: number; interventions_open: number; interventions_kept: number; interventions_erasable: number };
};

type Db = SupabaseClient;
const count = (value: number | null | undefined) => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** Executions already recorded for these tickets, keyed by request id. Throws when the journal is unreadable. */
export async function readExecutions(admin: Db, ticketIds: string[]): Promise<Map<string, ErasureExecution>> {
  const found = new Map<string, ErasureExecution>();
  if (!ticketIds.length) return found;
  const result = await admin.from("platform_audit").select("actor_id,target_id,details,created_at")
    .eq("action", ERASURE_ACTION).eq("target_kind", ERASURE_TARGET_KIND).in("target_id", ticketIds).order("id", { ascending: true }).limit(1000);
  if (result.error || !Array.isArray(result.data)) throw new Error("erasure journal unavailable");
  for (const row of result.data) {
    const details = (row.details ?? {}) as { request_id?: unknown; steps?: unknown };
    if (typeof details.request_id !== "string" || found.has(details.request_id)) continue;
    found.set(details.request_id, { request_id: details.request_id, executed_at: row.created_at as string, executed_by: (row.actor_id as string | null) ?? null, steps: Array.isArray(details.steps) ? (details.steps as ErasureStep[]) : [] });
  }
  return found;
}

/** Dossiers of the account that carry a financial record (kept) — any quote accepted or any payment. */
async function financialInterventionIds(admin: Db, interventionIds: string[]): Promise<Set<string>> {
  const kept = new Set<string>();
  if (!interventionIds.length) return kept;
  const quotes = await admin.from("quotes").select("id,intervention_id,status").in("intervention_id", interventionIds).limit(5000);
  if (quotes.error) throw new Error("quotes unavailable");
  const quoteToIntervention = new Map<string, string>();
  for (const quote of quotes.data ?? []) {
    quoteToIntervention.set(quote.id as string, quote.intervention_id as string);
    if (quote.status === "accepted") kept.add(quote.intervention_id as string);
  }
  if (quoteToIntervention.size) {
    const payments = await admin.from("payments").select("quote_id").in("quote_id", [...quoteToIntervention.keys()]).limit(5000);
    if (payments.error) throw new Error("payments unavailable");
    for (const payment of payments.data ?? []) { const id = quoteToIntervention.get(payment.quote_id as string); if (id) kept.add(id); }
  }
  const invoices = await admin.from("platform_invoices").select("intervention_id").in("intervention_id", interventionIds).limit(5000);
  if (invoices.error) throw new Error("invoices unavailable");
  for (const invoice of invoices.data ?? []) if (typeof invoice.intervention_id === "string") kept.add(invoice.intervention_id);
  return kept;
}

type Scope = { role: string; interventions: { id: string; status: string }[]; kept: Set<string>; activeAddresses: { id: string; version: number }[]; archivedAddresses: number };
async function readScope(admin: Db, accountId: string): Promise<Scope | null> {
  const profile = await admin.from("profiles").select("id,role").eq("id", accountId).maybeSingle();
  if (profile.error) throw new Error("profile unavailable");
  if (!profile.data) return null;
  const [interventions, addresses] = await Promise.all([
    admin.from("interventions").select("id,status").eq("client_id", accountId).limit(5000),
    admin.from("client_addresses").select("id,version,archived_at").eq("user_id", accountId).limit(500),
  ]);
  if (interventions.error || addresses.error) throw new Error("account scope unavailable");
  const rows = (interventions.data ?? []) as { id: string; status: string }[];
  return {
    role: profile.data.role as string,
    interventions: rows,
    kept: await financialInterventionIds(admin, rows.map(row => row.id)),
    activeAddresses: (addresses.data ?? []).filter(row => row.archived_at === null).map(row => ({ id: row.id as string, version: row.version as number })),
    archivedAddresses: (addresses.data ?? []).filter(row => row.archived_at !== null).length,
  };
}

function planOf(scope: Scope, accountId: string, actorId: string): ErasurePlan {
  const open = scope.interventions.filter(row => !TERMINAL_STATUSES.includes(row.status));
  const blockers: string[] = [];
  if (accountId === actorId) blockers.push("Vous ne pouvez pas exécuter l’effacement de votre propre compte.");
  if (scope.role !== "client") blockers.push("L’exécution depuis l’application couvre les comptes particuliers. Pour un artisan, un gestionnaire ou un administrateur, les obligations professionnelles (missions, factures, pièces) imposent un traitement manuel.");
  if (open.length) blockers.push(`${open.length} dossier${open.length > 1 ? "s" : ""} de ce compte ${open.length > 1 ? "sont" : "est"} encore en cours ou non réglé${open.length > 1 ? "s" : ""} : clôturez ou annulez d’abord ${open.length > 1 ? "ces dossiers" : "ce dossier"}.`);
  const kept = scope.interventions.filter(row => scope.kept.has(row.id)).length;
  return { account_role: scope.role, eligible: blockers.length === 0, blockers, counts: { addresses: scope.activeAddresses.length + scope.archivedAddresses, interventions_open: open.length, interventions_kept: kept, interventions_erasable: scope.interventions.length - kept - open.filter(row => !scope.kept.has(row.id)).length } };
}

export async function erasurePlan(admin: Db, accountId: string, actorId: string): Promise<ErasurePlan | null> {
  const scope = await readScope(admin, accountId);
  return scope ? planOf(scope, accountId, actorId) : null;
}

/** A short-lived session of the account itself, obtained by the server from the auth administration
 *  API. It exists only to run the account's own commands that no other role may run (saved addresses
 *  are writable by their owner alone) and to revoke every session of the account. */
async function accountSession(admin: Db, accountId: string): Promise<Db | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const account = await admin.auth.admin.getUserById(accountId);
  const email = account.data.user?.email;
  if (account.error || !email) return null;
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const token = link.data?.properties?.hashed_token;
  if (link.error || !token) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const session = await client.auth.verifyOtp({ token_hash: token, type: "magiclink" });
  if (session.error || !session.data.session) return null;
  return client;
}

export type ExecutionOutcome =
  | { kind: "executed"; execution: ErasureExecution; replayed: boolean }
  | { kind: "refused"; status: 404 | 409; message: string; blockers?: string[] };

export async function executeErasure(admin: Db, input: { requestId: string; ticketId: string; accountId: string; actorId: string }): Promise<ExecutionOutcome> {
  const already = (await readExecutions(admin, [input.ticketId])).get(input.requestId);
  if (already) return { kind: "executed", execution: already, replayed: true };
  const scope = await readScope(admin, input.accountId);
  if (!scope) return { kind: "refused", status: 404, message: "Le compte visé par cette demande est introuvable." };
  const plan = planOf(scope, input.accountId, input.actorId);
  if (!plan.eligible) return { kind: "refused", status: 409, message: plan.blockers[0], blockers: plan.blockers };

  const steps: ErasureStep[] = [];
  const run = async (key: string, label: string, work: () => Promise<{ count: number; status?: StepStatus; detail?: string }>) => {
    try {
      const result = await work();
      steps.push({ key, label, count: result.count, status: result.status ?? (result.count > 0 ? "done" : "none"), ...(result.detail ? { detail: result.detail } : {}) });
    } catch (error) {
      steps.push({ key, label, count: 0, status: "failed", detail: error instanceof Error ? error.message.slice(0, 200) : "refus de la base" });
    }
  };
  const must = <T extends { error: { message?: string } | null }>(result: T): T => { if (result.error) throw new Error(result.error.message ?? "refus de la base"); return result; };
  const erasable = scope.interventions.filter(row => !scope.kept.has(row.id)).map(row => row.id);
  const keptIds = scope.interventions.filter(row => scope.kept.has(row.id)).map(row => row.id);

  // 1. Saved addresses: only their owner may write them, so they are overwritten then archived under
  //    a session of the account obtained by the server.
  const self = scope.activeAddresses.length ? await accountSession(admin, input.accountId).catch(() => null) : null;
  await run("addresses", "Adresses enregistrées", async () => {
    if (!scope.activeAddresses.length) return { count: 0 };
    if (!self) throw new Error("session du compte indisponible : adresses non effacées");
    let done = 0;
    for (const address of scope.activeAddresses) {
      const saved = must(await self.rpc("write_client_address", { p_id: address.id, p_command_id: randomUUID(), p_expected_version: address.version, p_action: "save", p_values: { label: "Adresse effacée", first_name: "Effacé", last_name: "Effacé", address: "Adresse effacée", postal_code: "00000", city: "Effacé", country_code: "FR", latitude: null, longitude: null, geo_source: null, is_preferred: false } }));
      must(await self.rpc("write_client_address", { p_id: address.id, p_command_id: randomUUID(), p_expected_version: (saved.data as { version: number }).version, p_action: "archive", p_values: null }));
      done++;
    }
    return { count: done };
  });
  if (scope.archivedAddresses) steps.push({ key: "addresses_archived", label: "Adresses déjà archivées avant la demande", status: "failed", count: scope.archivedAddresses, detail: "non modifiables : la base n’autorise aucune écriture sur une adresse archivée" });

  // 2. Free text written by the account.
  await run("interventions", "Descriptions et adresses des dossiers sans paiement", async () => {
    if (!erasable.length) return { count: 0 };
    const updated = must(await admin.from("interventions").update({ description: ERASED_TEXT, address: "Adresse effacée" }).in("id", erasable).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("messages", "Messages écrits dans les dossiers", async () => {
    const updated = must(await admin.from("messages").update({ body: ERASED_TEXT }).eq("author_id", input.accountId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("support_messages", "Messages adressés à l’assistance", async () => {
    const updated = must(await admin.from("support_messages").update({ body: ERASED_TEXT }).eq("author_id", input.accountId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("support_tickets", "Sujets des demandes d’assistance", async () => {
    const updated = must(await admin.from("support_tickets").update({ subject: "Demande d’un compte effacé" }).eq("creator_id", input.accountId).neq("id", input.ticketId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("reviews", "Texte des avis déposés", async () => {
    const updated = must(await admin.from("reviews").update({ body: ERASED_TEXT }).eq("author_id", input.accountId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("warranty_cases", "Descriptions des demandes de garantie", async () => {
    const updated = must(await admin.from("warranty_cases").update({ description: ERASED_TEXT }).eq("client_id", input.accountId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });

  // 3. Booking drafts and precise locations.
  await run("booking_locations", "Positions et consignes d’accès des réservations", async () => {
    const removed = must(await admin.from("booking_locations").delete().eq("actor_id", input.accountId).select("request_id"));
    return { count: removed.data?.length ?? 0 };
  });
  await run("request_keys", "Brouillons de demandes conservés par le serveur", async () => {
    const updated = must(await admin.from("intervention_request_keys").update({ payload: {} }).eq("actor_id", input.accountId).select("request_id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("phone_bookings", "Demandes de réservation par téléphone (coordonnées)", async () => {
    const updated = must(await admin.from("phone_booking_requests").update({ payload: {}, contact: {} }).eq("actor_id", input.accountId).select("request_id"));
    return { count: updated.data?.length ?? 0 };
  });

  // 4. Notifications, preferences, reminders.
  await run("notifications", "Notifications reçues", async () => {
    const removed = must(await admin.from("notifications").delete().eq("recipient_id", input.accountId).select("id"));
    return { count: removed.data?.length ?? 0 };
  });
  await run("notification_preferences", "Préférences de notification", async () => {
    const removed = must(await admin.from("notification_preferences").delete().eq("user_id", input.accountId).select("user_id"));
    return { count: removed.data?.length ?? 0 };
  });

  // 5. Files: those of dossiers without payment, and files attached to no dossier.
  await run("documents", "Photos et fichiers des dossiers sans paiement", async () => {
    const owned = must(await admin.from("documents").select("id,path,intervention_id").eq("owner_id", input.accountId).limit(2000));
    const targets = ((owned.data ?? []) as { id: string; path: string; intervention_id: string | null }[]).filter(doc => !doc.intervention_id || !scope.kept.has(doc.intervention_id));
    if (!targets.length) return { count: 0 };
    const removed = must(await admin.from("documents").delete().in("id", targets.map(doc => doc.id)).select("id"));
    const removedIds = new Set((removed.data ?? []).map(doc => doc.id as string));
    const paths = targets.filter(doc => removedIds.has(doc.id)).map(doc => doc.path).filter(path => typeof path === "string" && path.length > 0);
    if (paths.length) {
      const purged = await admin.storage.from("intervention-documents").remove(paths);
      if (purged.error) throw new Error(`${removedIds.size} référence(s) supprimée(s), mais le stockage a refusé la suppression des fichiers`);
    }
    if (removedIds.size < targets.length) throw new Error(`${targets.length - removedIds.size} fichier(s) non supprimé(s) par la base`);
    return { count: removedIds.size };
  });

  // 6. What is kept, stated as such.
  steps.push({ key: "kept_financial", label: "Dossiers ayant donné lieu à un devis accepté, un paiement ou une facture (conservés avec leurs documents)", status: "kept", count: keptIds.length });

  // 7. Profile identity, then the sign-in identity (last: nothing else can fail after it).
  await run("profile", "Identité et téléphone du profil", async () => {
    const updated = must(await admin.from("profiles").update({ full_name: ERASED_NAME, first_name: null, last_name: null, phone: "" }).eq("id", input.accountId).select("id"));
    return { count: updated.data?.length ?? 0 };
  });
  await run("sessions", "Sessions ouvertes du compte", async () => {
    const session = self ?? (await accountSession(admin, input.accountId).catch(() => null));
    if (!session) throw new Error("session du compte indisponible : les sessions expirent d’elles-mêmes, la connexion est désactivée");
    const out = await session.auth.signOut({ scope: "global" });
    if (out.error) throw new Error(out.error.message);
    return { count: 1 };
  });
  await run("sign_in", "Identité de connexion (adresse e-mail remplacée, compte désactivé)", async () => {
    // The sign-up metadata repeats the name: an empty object would be ignored by the auth service,
    // so every existing key is explicitly blanked.
    const current = await admin.auth.admin.getUserById(input.accountId);
    if (current.error || !current.data.user) throw new Error(current.error?.message ?? "compte de connexion introuvable");
    const blanked = Object.fromEntries(Object.keys(current.data.user.user_metadata ?? {}).map(key => [key, null]));
    const updated = await admin.auth.admin.updateUserById(input.accountId, {
      email: `compte-efface-${input.accountId}@effacement.invalid`, email_confirm: true, phone: "", password: randomBytes(32).toString("base64url"),
      user_metadata: blanked, ban_duration: "876000h",
    });
    if (updated.error) throw new Error(updated.error.message);
    const left = Object.values(updated.data.user?.user_metadata ?? {}).filter(value => value !== null && value !== "" && typeof value !== "boolean").length;
    if (left) throw new Error("connexion désactivée, mais les métadonnées d’inscription n’ont pas pu être vidées");
    return { count: 1 };
  });

  // A second administrator may have finished in the meantime: one journal row per request.
  const concurrent = (await readExecutions(admin, [input.ticketId])).get(input.requestId);
  if (concurrent) return { kind: "executed", execution: concurrent, replayed: true };
  const written = await admin.from("platform_audit").insert({ actor_id: input.actorId, action: ERASURE_ACTION, target_kind: ERASURE_TARGET_KIND, target_id: input.ticketId, details: { request_id: input.requestId, account_id: input.accountId, steps } }).select("created_at").single();
  if (written.error) throw new Error("erasure journal write failed");
  return { kind: "executed", execution: { request_id: input.requestId, executed_at: written.data.created_at as string, executed_by: input.actorId, steps }, replayed: false };
}
