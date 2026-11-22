// Pure helpers for the cloud gateway QA harness (scripts/qa-gateway/run.mjs).
// Erasable TypeScript only: Node 24 strips the types when run.mjs imports this file,
// and tsx/node:test exercise it directly. No Node or DOM-specific imports.

export type Credentials = {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
};
export type Args = {
  functionUrl: string;
  project: string;
  credentials: string;
  out: string;
  dryRun: boolean;
  cleanupManifest: string;
  suite: Suite;
  lease: string;
  noOtherWriter: boolean;
  batchResult: string;
  observation: string;
  help: boolean;
};
export const SUITES = ["", "expiry-prepare", "expiry-verify", "revoke-prepare", "revoke-live"] as const;
export type Suite = (typeof SUITES)[number];
export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    functionUrl: "",
    project: "",
    credentials: "",
    out: "",
    dryRun: false,
    cleanupManifest: "",
    suite: "",
    lease: "",
    noOtherWriter: false,
    batchResult: "",
    observation: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const take = (): string => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--"))
        throw new UsageError(`${token} attend une valeur.`);
      i++;
      return value;
    };
    if (token === "--function-url") args.functionUrl = take();
    else if (token === "--project") args.project = take();
    else if (token === "--credentials") args.credentials = take();
    else if (token === "--out") args.out = take();
    else if (token === "--cleanup-manifest") args.cleanupManifest = take();
    else if (token === "--suite") {
      const value = take();
      if (!(SUITES as readonly string[]).includes(value) || value === "") throw new UsageError("--suite attend expiry-prepare, expiry-verify, revoke-prepare ou revoke-live.");
      args.suite = value as Suite;
    } else if (token === "--lease") args.lease = take();
    else if (token === "--no-other-writer") args.noOtherWriter = true;
    else if (token === "--batch-result") args.batchResult = take();
    else if (token === "--observation") args.observation = take();
    else if (token === "--dry-run") args.dryRun = true;
    else if (token === "--help" || token === "-h") args.help = true;
    else throw new UsageError(`Option inconnue : ${token}`);
  }
  if (args.help) return args;
  const required: (keyof Args)[] = args.cleanupManifest
    ? ["project", "credentials", "out"]
    : ["functionUrl", "project", "credentials", "out"];
  for (const key of required)
    if (!args[key]) throw new UsageError(`Option obligatoire manquante : --${kebab(key)}`);
  if (args.cleanupManifest && args.dryRun)
    throw new UsageError("--cleanup-manifest et --dry-run sont exclusifs.");
  if (args.suite && args.cleanupManifest) throw new UsageError("--suite et --cleanup-manifest sont exclusifs.");
  if (args.suite === "expiry-verify" && !args.lease) throw new UsageError("--suite expiry-verify exige --lease <lease.json>.");
  if (args.suite === "revoke-live" && !args.lease) throw new UsageError("--suite revoke-live exige --lease <revoke.json de revoke-prepare>.");
  if (args.suite === "revoke-live" && (!args.batchResult || !args.observation)) throw new UsageError("--suite revoke-live exige --batch-result <fichier> et --observation <fichier>.");
  if ((args.suite === "revoke-prepare" || args.suite === "revoke-live") && !args.noOtherWriter) throw new UsageError("--suite revoke-* exige --no-other-writer (coché par le pilote après vérification).");
  if (args.dryRun && args.suite !== "" && args.suite !== "expiry-prepare" && args.suite !== "revoke-prepare") throw new UsageError("--dry-run ne s’applique qu’aux phases prepare.");
  if (args.lease && args.suite !== "expiry-verify" && args.suite !== "revoke-live") throw new UsageError("--lease n’a de sens qu’avec --suite expiry-verify ou revoke-live.");
  if ((args.batchResult || args.observation) && args.suite !== "revoke-live") throw new UsageError("--batch-result/--observation n’ont de sens qu’avec --suite revoke-live.");
  if (!/^[a-z0-9]{20}$/.test(args.project))
    throw new UsageError("--project doit être la référence du projet (20 caractères).");
  if (args.functionUrl && !/^https:\/\//.test(args.functionUrl))
    throw new UsageError("--function-url doit être une URL https.");
  return args;
}
function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

export function normalizeCredentials(raw: unknown): Credentials {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new UsageError("Le fichier d’identifiants doit être un objet JSON.");
  const r = raw as Record<string, unknown>;
  const url = str(r.url ?? r.supabase_url ?? r.SUPABASE_URL).replace(/\/$/, "");
  const publishableKey = str(
    r.publishable_key ?? r.anon_key ?? r.SUPABASE_PUBLISHABLE_KEY ?? r.SUPABASE_ANON_KEY,
  );
  const serviceRoleKey = str(
    r.service_role_key ?? r.secret_key ?? r.SUPABASE_SERVICE_ROLE_KEY ?? r.SUPABASE_SECRET_KEY,
  );
  if (!url || !publishableKey || !serviceRoleKey)
    throw new UsageError(
      "Identifiants incomplets : url, publishable_key et service_role_key sont requis.",
    );
  if (!projectRef(url) || new URL(url).pathname !== "/")
    throw new UsageError("url doit être https://<ref>.supabase.co");
  return { url, publishableKey, serviceRoleKey };
}
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// https://<ref>.supabase.co or https://<ref>.functions.supabase.co -> <ref>
export function projectRef(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    const match = /^([a-z0-9]{20})(?:\.functions)?\.supabase\.(?:co|in|red)$/.exec(parsed.hostname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
export function assertCredentialsProject(project: string, credentialsUrl: string): void {
  const fromCredentials = projectRef(credentialsUrl);
  if (fromCredentials !== project)
    throw new UsageError(
      `Refus : --project ${project} ne correspond pas au projet des identifiants (${fromCredentials ?? "inconnu"}).`,
    );
}
export function assertFunctionProject(project: string, functionUrl: string): void {
  const fromFunction = projectRef(functionUrl);
  if (fromFunction !== project)
    throw new UsageError(
      `Refus : --function-url ne cible pas le projet ${project} (${fromFunction ?? "hôte inconnu"}).`,
    );
  const parsed = new URL(functionUrl);
  const viaGateway = /^\/functions\/v1\/native-document-upload\/?$/.test(parsed.pathname);
  const viaFunctionsHost = /\.functions\.supabase\./.test(parsed.hostname) && /^\/native-document-upload\/?$/.test(parsed.pathname);
  if (!viaGateway && !viaFunctionsHost)
    throw new UsageError("--function-url doit pointer sur la fonction native-document-upload.");
}

export function runId(now: Date, randomBytes: Uint8Array): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "t").toLowerCase();
  const suffix = Array.from(randomBytes.slice(0, 3), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${stamp}${suffix}`;
}
export const COHORT_ROLES = ["client", "artisan", "manager", "viewer", "third"] as const;
export type CohortRole = (typeof COHORT_ROLES)[number];
export function cohortEmail(run: string, role: CohortRole): string {
  return `qa-gw-${run}-${role}@example.invalid`;
}
export function cohortProfileRole(role: CohortRole): "client" | "artisan" | "manager" {
  if (role === "artisan") return "artisan";
  if (role === "manager" || role === "viewer") return "manager";
  return "client";
}
export function cohortPassword(randomBytes: Uint8Array): string {
  if (randomBytes.length < 24) throw new UsageError("mot de passe : 24 octets aléatoires requis");
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 24; i++) out += alphabet[randomBytes[i] % alphabet.length];
  return `${out}!Qa9`;
}
// Seeded dossiers: the urgency enum is urgent | scheduled (migration 001).
export const SEED_URGENCY = "scheduled";

// Replaces every secret, JWT-like token, bearer value and password in any text.
export function makeRedactor(secrets: string[]): (text: string) => string {
  const known = secrets.filter((s) => typeof s === "string" && s.length >= 8);
  return (text: string) => {
    let out = String(text);
    for (const secret of known) out = out.split(secret).join("[REDACTED]");
    out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_JWT]");
    out = out.replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]");
    out = out.replace(/("?(?:password|access_token|refresh_token|apikey|service_role_key|publishable_key|anon_key|secret_key)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"');
    out = out.replace(/(sb_(?:secret|publishable)_)[A-Za-z0-9_-]+/g, "$1[REDACTED]");
    return out;
  };
}

export type Created = {
  documentIds: string[];
  objectPaths: string[];
  interventionIds: string[];
  organizationIds: string[];
  siteIds: string[];
  userIds: string[];
};
export type CreatedKind = keyof Created;
export type CleanupStep =
  | { kind: "storage"; label: string; paths: string[] }
  | { kind: "rest"; label: string; table: string; filter: string }
  | { kind: "auth"; label: string; userId: string };
export function emptyCreated(): Created {
  return { documentIds: [], objectPaths: [], interventionIds: [], organizationIds: [], siteIds: [], userIds: [] };
}
const inList = (ids: string[]) => `in.(${ids.join(",")})`;
// Foreign-key order: objects -> document children -> documents -> intervention children ->
// interventions -> organisation/site children -> sites -> organisations -> profile children
// (action_limits.actor_id, audit/professional audit actors, artisan tables) -> Auth users
// (which cascade public.profiles).
export function cleanupPlan(created: Created): CleanupStep[] {
  const steps: CleanupStep[] = [];
  const rest = (table: string, column: string, ids: string[]) => {
    if (ids.length === 0) return;
    steps.push({ kind: "rest", label: `${table} par ${column}`, table, filter: `${column}=${inList(ids)}` });
  };
  if (created.objectPaths.length) steps.push({ kind: "storage", label: "objets Storage de la cohorte", paths: [...created.objectPaths] });
  rest("artisan_credentials", "document_id", created.documentIds);
  rest("documents", "id", created.documentIds);
  for (const table of ["audit_log", "messages", "intervention_operation_events", "intervention_appointments", "intervention_reports", "mission_declines", "quote_drafts", "warranty_cases", "reviews", "quotes", "support_tickets"])
    rest(table, "intervention_id", created.interventionIds);
  rest("documents", "intervention_id", created.interventionIds);
  rest("interventions", "id", created.interventionIds);
  for (const table of ["organization_member_site_grants", "organization_member_site_scopes", "organization_members", "organization_membership_events", "organization_invitations", "professional_audit", "contracts"])
    rest(table, "organization_id", created.organizationIds);
  for (const table of ["approvals", "approval_rules", "compliance_records"]) rest(table, "site_id", created.siteIds);
  rest("sites", "id", created.siteIds);
  rest("organizations", "id", created.organizationIds);
  rest("audit_log", "actor_id", created.userIds);
  rest("professional_audit", "actor_id", created.userIds);
  rest("action_limits", "actor_id", created.userIds);
  rest("artisan_credentials", "user_id", created.userIds);
  rest("artisan_profiles", "user_id", created.userIds);
  rest("documents", "owner_id", created.userIds);
  rest("interventions", "client_id", created.userIds);
  for (const userId of created.userIds) steps.push({ kind: "auth", label: `utilisateur Auth ${userId}`, userId });
  return steps;
}

// Durable manifest of everything the run created, rewritten after each creation and again by the
// cleanup discovery (merged cohort rows/objects, plus every read that stayed unknown).
export type Unknown = { scope: string; detail: string };
export type ManifestExpiry = { userId: string; email: string; issuer: string; claimExp: number; tokenSha256: string };
export type ManifestRevoke = { ownerId: string; managerId: string; orgId: string; siteId: string; dossierId: string; ownerEmail: string; managerEmail: string; tokenSha256: string };
export type ManifestExtra = { suite?: "expiry" | "revoke"; leaseEndsAt?: string; expiry?: ManifestExpiry; revoke?: ManifestRevoke };
export type Manifest = { version: 1; runId: string; project: string; updatedAt: string; created: Created; unknown: Unknown[] } & ManifestExtra;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;
export function manifestJson(runId: string, project: string, created: Created, now: Date, unknown: Unknown[] = [], extra: ManifestExtra = {}): string {
  const manifest: Manifest = { version: 1, runId, project, updatedAt: now.toISOString(), created, unknown, ...extra };
  return JSON.stringify(manifest, null, 2);
}
export function parseManifest(raw: unknown, project: string): Manifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("Manifeste invalide.");
  const m = raw as Record<string, unknown>;
  if (m.version !== 1 || typeof m.runId !== "string" || typeof m.project !== "string") throw new UsageError("Manifeste invalide (version/runId/project).");
  if (m.project !== project) throw new UsageError(`Refus : le manifeste appartient au projet ${m.project}, pas ${project}.`);
  const c = m.created;
  if (!c || typeof c !== "object" || Array.isArray(c)) throw new UsageError("Manifeste invalide (created).");
  const created = emptyCreated();
  for (const key of Object.keys(created) as CreatedKind[]) {
    const list = (c as Record<string, unknown>)[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) throw new UsageError(`Manifeste invalide (${key}).`);
    for (const value of list) {
      if (typeof value !== "string" || !(key === "objectPaths" ? OBJECT_PATH : UUID).test(value))
        throw new UsageError(`Manifeste invalide : ${key} contient une valeur inattendue.`);
      created[key].push(value);
    }
  }
  const unknown: Unknown[] = [];
  if (m.unknown !== undefined) {
    if (!Array.isArray(m.unknown)) throw new UsageError("Manifeste invalide (unknown).");
    for (const item of m.unknown) {
      const u = item as Record<string, unknown> | null;
      if (!u || typeof u !== "object" || typeof u.scope !== "string" || typeof u.detail !== "string")
        throw new UsageError("Manifeste invalide : unknown contient une valeur inattendue.");
      unknown.push({ scope: u.scope, detail: u.detail });
    }
  }
  const out: Manifest = { version: 1, runId: m.runId, project: m.project, updatedAt: String(m.updatedAt ?? ""), created, unknown };
  if (m.suite !== undefined) {
    if (m.suite !== "expiry" && m.suite !== "revoke") throw new UsageError("Manifeste invalide (suite).");
    out.suite = m.suite;
  }
  if (m.revoke !== undefined) {
    const r = m.revoke as Record<string, unknown> | null;
    if (!r || typeof r !== "object") throw new UsageError("Manifeste invalide (revoke).");
    for (const key of ["ownerId", "managerId", "orgId", "siteId", "dossierId"]) if (typeof r[key] !== "string" || !UUID.test(r[key] as string)) throw new UsageError(`Manifeste invalide (revoke.${key}).`);
    if (typeof r.ownerEmail !== "string" || typeof r.managerEmail !== "string" || typeof r.tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(r.tokenSha256)) throw new UsageError("Manifeste invalide (revoke).");
    out.revoke = { ownerId: r.ownerId as string, managerId: r.managerId as string, orgId: r.orgId as string, siteId: r.siteId as string, dossierId: r.dossierId as string, ownerEmail: r.ownerEmail, managerEmail: r.managerEmail, tokenSha256: r.tokenSha256 };
  }
  if (m.leaseEndsAt !== undefined) {
    if (typeof m.leaseEndsAt !== "string") throw new UsageError("Manifeste invalide (leaseEndsAt).");
    out.leaseEndsAt = m.leaseEndsAt;
  }
  if (m.expiry !== undefined) {
    const e = m.expiry as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || typeof e.userId !== "string" || !UUID.test(e.userId) || typeof e.email !== "string" || typeof e.issuer !== "string" || typeof e.claimExp !== "number" || typeof e.tokenSha256 !== "string" || !/^[0-9a-f]{64}$/.test(e.tokenSha256))
      throw new UsageError("Manifeste invalide (expiry).");
    out.expiry = { userId: e.userId, email: e.email, issuer: e.issuer, claimExp: e.claimExp, tokenSha256: e.tokenSha256 };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Cohort discovery and cleanup (GW-HARNESS-003). Pure orchestration over an injected client so
// node:test can drive it with fakes; run.mjs provides the fetch-backed client.
//
// Discovery lists the `documents` rows of the cohort (by owner ids and by intervention ids held
// in the durable manifest) and every Storage object under each cohort owner prefix `<uid>/`,
// with explicit pagination. Every read that fails, truncates or cannot be confirmed is an
// `Unknown`; the caller must never claim a clean cleanup while one exists.
// ---------------------------------------------------------------------------------------------
// `malformed`: entries the client could not read as T (e.g. a Storage row without `name`).
// They are never dropped silently: discovery records each one as an unknown.
export type Page<T> = { ok: true; items: T[]; total: number | null; detail: string; malformed?: string[] } | { ok: false; detail: string };
// Storage list API body -> names + malformed descriptions. Any row that is not an object with
// a string `name` is malformed (an unknown shape), never "absent".
export function parseStorageListing(json: unknown): { items: string[]; malformed: string[] } {
  const items: string[] = [];
  const malformed: string[] = [];
  if (!Array.isArray(json)) return { items, malformed: ["réponse de listage non tabulaire"] };
  json.forEach((row, index) => {
    const r = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
    if (r && typeof r.name === "string" && r.name.length > 0) items.push(r.name);
    else malformed.push(`entrée ${index} sans name (${r ? `clés ${Object.keys(r).slice(0, 5).join(",") || "aucune"}` : typeof row})`);
  });
  return { items, malformed };
}
export type DocumentRow = { id?: unknown; owner_id?: unknown; intervention_id?: unknown; path?: unknown };
export type ListObjectsOptions = { limit: number; offset: number; search?: string };
export type CleanupClient = {
  // PostgREST read of `documents` with `Prefer: count=exact` and `Range: from-to` (inclusive);
  // `total` comes from Content-Range and must be exact (null = unknown).
  listDocuments(filter: string, from: number, to: number): Promise<Page<DocumentRow>>;
  // Storage list API under `<prefix>/`; names are relative to the prefix; stable name order.
  listObjects(prefix: string, options: ListObjectsOptions): Promise<Page<string>>;
  deleteObjects(paths: string[]): Promise<{ status: number; detail: string }>;
  deleteRows(table: string, filter: string): Promise<{ status: number; detail: string }>;
  countRows(table: string, filter: string): Promise<number | null>;
  deleteUser(userId: string): Promise<{ status: number }>;
  // 0 = gone, 1 = still there, null = unknown.
  userRemaining(userId: string): Promise<0 | 1 | null>;
};
export type Discovery = {
  created: Created;
  added: { documentIds: string[]; objectPaths: string[] };
  unknown: Unknown[];
  complete: boolean;
};
export type DiscoveryOptions = { pageSize?: number; maxPages?: number };
const inFilter = (column: string, ids: string[]) => `${column}=${inList(ids)}`;
function cloneCreated(created: Created): Created {
  const out = emptyCreated();
  for (const key of Object.keys(out) as CreatedKind[]) out[key] = [...created[key]];
  return out;
}
export async function discoverCohort(client: Pick<CleanupClient, "listDocuments" | "listObjects">, created: Created, options: DiscoveryOptions = {}): Promise<Discovery> {
  const pageSize = Math.max(1, options.pageSize ?? 1000);
  const maxPages = Math.max(1, options.maxPages ?? 100);
  const merged = cloneCreated(created);
  const added = { documentIds: [] as string[], objectPaths: [] as string[] };
  const unknown: Unknown[] = [];
  const addDocument = (id: string) => {
    if (merged.documentIds.includes(id)) return;
    merged.documentIds.push(id);
    added.documentIds.push(id);
  };
  const addObject = (p: string) => {
    if (merged.objectPaths.includes(p)) return;
    merged.objectPaths.push(p);
    added.objectPaths.push(p);
  };
  const scanRows = async (scope: string, filter: string) => {
    let from = 0;
    for (let pageIndex = 0; ; pageIndex++) {
      if (pageIndex >= maxPages) {
        unknown.push({ scope, detail: `pagination tronquée après ${maxPages} page(s) de ${pageSize}` });
        return;
      }
      let page: Page<DocumentRow>;
      try {
        page = await client.listDocuments(filter, from, from + pageSize - 1);
      } catch (error) {
        page = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      if (!page.ok) {
        unknown.push({ scope, detail: `lecture en erreur : ${page.detail}` });
        return;
      }
      if (page.total === null) {
        unknown.push({ scope, detail: "compte exact indisponible (Content-Range)" });
        return;
      }
      for (const row of page.items) {
        const id = typeof row?.id === "string" && UUID.test(row.id) ? row.id : null;
        if (!id) {
          unknown.push({ scope, detail: "ligne documents sans id UUID" });
          continue;
        }
        addDocument(id);
        const p = typeof row.path === "string" ? row.path : "";
        if (OBJECT_PATH.test(p)) addObject(p);
        else unknown.push({ scope: `documents ${id}`, detail: "chemin Storage hors convention <uid>/<id> : objet non identifiable" });
      }
      from += page.items.length;
      if (from >= page.total) return;
      if (page.items.length === 0) {
        unknown.push({ scope, detail: `page vide avant le total annoncé (${from}/${page.total})` });
        return;
      }
    }
  };
  const scanObjects = async (userId: string) => {
    const scope = `Storage ${userId}/`;
    let offset = 0;
    for (let pageIndex = 0; ; pageIndex++) {
      if (pageIndex >= maxPages) {
        unknown.push({ scope, detail: `pagination tronquée après ${maxPages} page(s) de ${pageSize}` });
        return;
      }
      let page: Page<string>;
      try {
        page = await client.listObjects(userId, { limit: pageSize, offset });
      } catch (error) {
        page = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      if (!page.ok) {
        unknown.push({ scope, detail: `listage en erreur : ${page.detail}` });
        return;
      }
      for (const name of page.items) {
        const p = `${userId}/${name}`;
        if (OBJECT_PATH.test(p)) addObject(p);
        else unknown.push({ scope, detail: `objet hors convention <uid>/<id> (${String(name).slice(0, 40)}) : suppression manuelle requise` });
      }
      for (const m of page.malformed ?? []) unknown.push({ scope, detail: `forme inattendue dans le listage : ${m}` });
      const received = page.items.length + (page.malformed?.length ?? 0);
      if (received < pageSize) return;
      offset += received;
    }
  };
  if (merged.userIds.length) await scanRows("documents par owner_id", inFilter("owner_id", merged.userIds));
  if (merged.interventionIds.length) await scanRows("documents par intervention_id", inFilter("intervention_id", merged.interventionIds));
  for (const userId of merged.userIds) await scanObjects(userId);
  return { created: merged, added, unknown, complete: unknown.length === 0 };
}

export type CleanupEntry = { label: string; ok: boolean; remaining: number | null; detail: string };
export type CleanupHooks = {
  // Called once with the merged manifest BEFORE any deletion (must persist atomically).
  saveManifest(created: Created, unknown: Unknown[]): Promise<void>;
  note(status: StepStatus, step: string, detail: string): Promise<void>;
  step(entry: CleanupEntry, leftover: string | null): Promise<void>;
};
export type CleanupOutcome = { created: Created; discovery: Discovery; entries: CleanupEntry[]; leftovers: string[]; clean: boolean };
export function cleanupRerunMessage(manifestPath: string): string {
  return `aucune suppression effectuée ; relancer « --cleanup-manifest ${manifestPath} » quand les lectures répondent`;
}
export function unknownLeftover(u: Unknown): string {
  return `inconnu : ${u.scope} — ${u.detail}`;
}
// Late reconciliation after an aborted/timed-out phase: a request that timed out or was aborted
// does not prove the remote side did not settle. Discovery is repeated with exponential backoff
// (baseDelayMs, x2 each attempt, at most `attempts`) until one complete pass finds nothing new;
// read errors retry inside the window; exhausting it forbids deletion and the clean verdict.
export type ReconcileOptions = { attempts: number; baseDelayMs: number; sleep: (ms: number) => Promise<void> };
export type CleanupOptions = DiscoveryOptions & { manifestPath?: string; reconcile?: ReconcileOptions };
const safeDiscover = async (client: CleanupClient, created: Created, options: DiscoveryOptions): Promise<Discovery> => {
  try {
    return await discoverCohort(client, created, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { created: cloneCreated(created), added: { documentIds: [], objectPaths: [] }, unknown: [{ scope: "découverte de cohorte", detail }], complete: false };
  }
};
const describeUnknown = (unknown: Unknown[]) => `${unknown.length} lecture(s) inconnue(s) : ${unknown.map((u) => `${u.scope} (${u.detail})`).join(" ; ")}`;
const addedCounts = (d: Discovery) => `${d.added.documentIds.length} ligne(s) documents et ${d.added.objectPaths.length} objet(s) Storage ajoutés au manifeste`;
// Guaranteed minimum wait before any deletion after an abnormal end (sum of all backoffs).
export function reconcileWindowMs(reconcile: Pick<ReconcileOptions, "attempts" | "baseDelayMs">): number {
  return reconcile.baseDelayMs * (2 ** Math.max(1, reconcile.attempts) - 1);
}
// Current presence of every KNOWN manifest item: documents rows by id (paginated, exact count)
// and Storage objects by exact path (prefix listing with search). A reappearance after the
// deletion pass is reported; any read that cannot confirm absence is unknown.
export type Presence = { present: { documentIds: string[]; objectPaths: string[] }; unknown: Unknown[] };
export async function verifyKnownAbsent(client: Pick<CleanupClient, "listDocuments" | "listObjects">, created: Created, options: DiscoveryOptions = {}): Promise<Presence> {
  const pageSize = Math.max(1, options.pageSize ?? 1000);
  const present = { documentIds: [] as string[], objectPaths: [] as string[] };
  const unknown: Unknown[] = [];
  const chunk = 50;
  for (let i = 0; i < created.documentIds.length; i += chunk) {
    const ids = created.documentIds.slice(i, i + chunk);
    const scope = `documents par id (${ids.length})`;
    let from = 0;
    for (;;) {
      let page: Page<DocumentRow>;
      try {
        page = await client.listDocuments(inFilter("id", ids), from, from + pageSize - 1);
      } catch (error) {
        page = { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
      if (!page.ok) {
        unknown.push({ scope, detail: `lecture en erreur : ${page.detail}` });
        break;
      }
      if (page.total === null) {
        unknown.push({ scope, detail: "compte exact indisponible (Content-Range)" });
        break;
      }
      for (const row of page.items) {
        const id = typeof row?.id === "string" ? row.id : null;
        if (id && ids.includes(id)) present.documentIds.push(id);
        else unknown.push({ scope, detail: "ligne inattendue dans la relecture par id" });
      }
      from += page.items.length;
      if (from >= page.total) break;
      if (page.items.length === 0) {
        unknown.push({ scope, detail: `page vide avant le total annoncé (${from}/${page.total})` });
        break;
      }
    }
  }
  for (const p of created.objectPaths) {
    const [prefix, name] = p.split("/");
    let listing: Page<string>;
    try {
      listing = await client.listObjects(prefix, { limit: 1000, offset: 0, search: name });
    } catch (error) {
      listing = { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
    if (!listing.ok) unknown.push({ scope: `Storage ${p}`, detail: `listage en erreur : ${listing.detail}` });
    else if (listing.malformed?.length) unknown.push({ scope: `Storage ${p}`, detail: `forme inattendue dans le listage : ${listing.malformed[0]}` });
    else if (listing.items.includes(name)) present.objectPaths.push(p);
  }
  return { present, unknown };
}
// Always: discover -> persist merged manifest -> (only if every read is known, and stable after
// the reconcile window when one is requested) delete in FK order, Storage objects first -> final
// re-discovery when reconciling. A single unknown read forbids any deletion and the clean verdict.
export async function runCleanup(client: CleanupClient, created: Created, hooks: CleanupHooks, options: CleanupOptions = {}): Promise<CleanupOutcome> {
  const rerun = cleanupRerunMessage(options.manifestPath ?? "<manifest.json>");
  let discovery = await safeDiscover(client, created, options);
  await hooks.saveManifest(discovery.created, discovery.unknown);
  const entries: CleanupEntry[] = [];
  const leftovers: string[] = [];
  const failWithout = async (step: string, detail: string, unknown: Unknown[]): Promise<CleanupOutcome> => {
    for (const u of unknown) leftovers.push(unknownLeftover(u));
    await hooks.note("fail", step, `${detail} — ${rerun}`);
    return { created: discovery.created, discovery, entries, leftovers, clean: false };
  };
  if (!discovery.complete) return failWithout("découverte de cohorte incomplète avant nettoyage", `${addedCounts(discovery)} ; ${describeUnknown(discovery.unknown)}`, discovery.unknown);
  await hooks.note("pass", "découverte de cohorte avant nettoyage", `${addedCounts(discovery)} ; lectures complètes`);
  const reconcile = options.reconcile;
  if (reconcile) {
    // The full backoff window is always observed before any deletion: a timeout stays uncertain,
    // so an early "nothing new" pass never shortens it. The last pass must be complete and add
    // nothing; the window is sum(baseDelayMs * 2^(i-1)) = baseDelayMs * (2^attempts - 1).
    const attempts = Math.max(1, reconcile.attempts);
    const windowMs = reconcileWindowMs(reconcile);
    let lastUnknown: Unknown[] = [];
    let lastAdded = 0;
    let found = { documentIds: 0, objectPaths: 0 };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await reconcile.sleep(reconcile.baseDelayMs * 2 ** (attempt - 1));
      const again = await safeDiscover(client, discovery.created, options);
      if (!again.complete) {
        lastUnknown = again.unknown;
        await hooks.note("info", `réconciliation tardive ${attempt}/${attempts} : lecture inconnue${attempt < attempts ? ", nouvelle tentative" : ""}`, describeUnknown(again.unknown));
        continue;
      }
      lastUnknown = [];
      lastAdded = again.added.documentIds.length + again.added.objectPaths.length;
      if (lastAdded === 0) {
        await hooks.note("info", `réconciliation tardive ${attempt}/${attempts} : rien de nouveau`, `${found.documentIds} ligne(s) et ${found.objectPaths} objet(s) réglés tardivement ajoutés au manifeste jusqu’ici`);
        continue;
      }
      found = { documentIds: found.documentIds + again.added.documentIds.length, objectPaths: found.objectPaths + again.added.objectPaths.length };
      discovery = { created: again.created, added: { documentIds: [...discovery.added.documentIds, ...again.added.documentIds], objectPaths: [...discovery.added.objectPaths, ...again.added.objectPaths] }, unknown: [], complete: true };
      await hooks.saveManifest(discovery.created, []);
      await hooks.note("info", `réconciliation tardive ${attempt}/${attempts} : règlement tardif détecté`, addedCounts(again));
    }
    if (lastUnknown.length || lastAdded > 0) {
      const unknown: Unknown[] = lastUnknown.length ? lastUnknown : [{ scope: "réconciliation tardive", detail: `cohorte non stabilisée : règlement tardif encore trouvé à la dernière passe ${attempts}/${attempts} (fenêtre ${windowMs} ms)` }];
      discovery = { ...discovery, unknown, complete: false };
      await hooks.saveManifest(discovery.created, unknown);
      return failWithout("réconciliation tardive incomplète avant nettoyage", describeUnknown(unknown), unknown);
    }
    await hooks.note("pass", `réconciliation tardive : fenêtre complète observée avant toute suppression (${attempts} passes, ${windowMs} ms de replis)`, `${found.documentIds} ligne(s) et ${found.objectPaths} objet(s) réglés tardivement ajoutés au manifeste ; dernière passe complète sans nouveauté`);
  }
  for (const step of cleanupPlan(discovery.created)) {
    const entry: CleanupEntry = { label: step.label, ok: false, remaining: null, detail: "" };
    let leftover: string | null = null;
    try {
      if (step.kind === "storage") {
        const r = await client.deleteObjects(step.paths);
        let remaining = 0;
        let readbackFailed = false;
        for (const p of step.paths) {
          const [prefix, name] = p.split("/");
          const listing = await client.listObjects(prefix, { limit: 1000, offset: 0, search: name });
          if (!listing.ok || listing.malformed?.length) readbackFailed = true;
          else if (listing.items.includes(name)) remaining++;
        }
        entry.remaining = readbackFailed ? null : remaining;
        entry.ok = r.status < 300 && !readbackFailed && remaining === 0;
        entry.detail = `HTTP ${r.status}${readbackFailed ? " ; relecture Storage en erreur" : ""}`;
        if (!entry.ok) leftover = `objets Storage : ${readbackFailed ? "relecture impossible" : `${remaining} restant(s)`}`;
      } else if (step.kind === "rest") {
        const r = await client.deleteRows(step.table, step.filter);
        const remaining = await client.countRows(step.table, step.filter);
        entry.remaining = remaining;
        entry.ok = r.status < 300 && remaining === 0;
        entry.detail = `HTTP ${r.status}${r.status >= 300 ? ` ${r.detail}` : ""}${remaining === null ? " ; relecture en erreur" : ""}`;
        if (!entry.ok) leftover = `${step.table} (${step.filter}) : ${remaining ?? "relecture impossible"}`;
      } else {
        const r = await client.deleteUser(step.userId);
        const remaining = await client.userRemaining(step.userId);
        entry.remaining = remaining;
        entry.ok = r.status < 300 && remaining === 0;
        entry.detail = `HTTP ${r.status}, relecture ${remaining === null ? "en erreur" : remaining === 0 ? "absent" : "présent"}`;
        if (!entry.ok) leftover = `auth user ${step.userId}`;
      }
    } catch (error) {
      entry.detail = error instanceof Error ? error.message : String(error);
      leftover = step.label;
    }
    entries.push(entry);
    if (leftover) leftovers.push(leftover);
    await hooks.step(entry, leftover);
  }
  if (reconcile) {
    // Final reconciliation: (a) every KNOWN manifest row/object must be absent now (a
    // reappearance after the deletion pass is a failure, not a clean cohort); (b) a settle that
    // landed after the pre-deletion window is a new entry. Both are merged into the manifest and
    // reported for a --cleanup-manifest re-run; any read that cannot confirm is unknown.
    const final = await safeDiscover(client, discovery.created, options);
    const presence = await verifyKnownAbsent(client, discovery.created, options);
    const unknown: Unknown[] = [...final.unknown, ...presence.unknown];
    if (final.complete && (final.added.documentIds.length || final.added.objectPaths.length)) unknown.push({ scope: "réconciliation finale", detail: `règlement tardif après nettoyage : ${addedCounts(final)}` });
    for (const id of presence.present.documentIds) unknown.push({ scope: "réconciliation finale", detail: `réapparition : ligne documents ${id} présente après nettoyage` });
    for (const p of presence.present.objectPaths) unknown.push({ scope: "réconciliation finale", detail: `réapparition : objet Storage ${p} présent après nettoyage` });
    if (unknown.length) {
      discovery = { created: final.created, added: { documentIds: [...discovery.added.documentIds, ...final.added.documentIds], objectPaths: [...discovery.added.objectPaths, ...final.added.objectPaths] }, unknown, complete: false };
      await hooks.saveManifest(discovery.created, unknown);
      for (const u of unknown) leftovers.push(unknownLeftover(u));
      await hooks.note("fail", "réconciliation finale après nettoyage", `${describeUnknown(unknown)} — relancer « --cleanup-manifest ${options.manifestPath ?? "<manifest.json>"} »`);
      return { created: discovery.created, discovery, entries, leftovers, clean: false };
    }
    await hooks.note("pass", "réconciliation finale après nettoyage", `aucune ligne ni objet réglé tardivement ; ${discovery.created.documentIds.length} ligne(s) et ${discovery.created.objectPaths.length} objet(s) connus vérifiés absents ; lectures complètes`);
  }
  return { created: discovery.created, discovery, entries, leftovers, clean: leftovers.length === 0 && entries.every((e) => e.ok) };
}

// SIGINT/SIGTERM never skip cleanup: the first signal aborts the running phase (the run's
// `finally` then performs discovery + cleanup), the second aborts the cleanup requests in flight
// (manifest kept for --cleanup-manifest), the third exits immediately with 130.
export function interruptGuard(
  on: (event: string, handler: () => void) => void,
  actions: { abort: (reason: Error) => void; exit: (code: number) => void },
  signals: string[] = ["SIGINT", "SIGTERM"],
): { count: () => number } {
  let count = 0;
  for (const signal of signals)
    on(signal, () => {
      count++;
      if (count >= 3) {
        actions.exit(130);
        return;
      }
      actions.abort(new Error(count === 1 ? `interruption par ${signal} : découverte de cohorte puis nettoyage avant sortie` : `second ${signal} : nettoyage interrompu, manifeste conservé pour --cleanup-manifest`));
    });
  return { count: () => count };
}

export type Scenario = {
  name: string;
  actor: CohortRole | "anonymous" | "invalid";
  dossier: "client" | "site" | null;
  file: "jpeg" | "fakeMime" | "oversize";
  expected: number;
  mustCreate: boolean;
};
export function scenarioPlan(): Scenario[] {
  return [
    { name: "anonyme sans jeton", actor: "anonymous", dossier: "client", file: "jpeg", expected: 401, mustCreate: false },
    { name: "jeton invalide", actor: "invalid", dossier: "client", file: "jpeg", expected: 401, mustCreate: false },
    { name: "tiers sur le dossier client", actor: "third", dossier: "client", file: "jpeg", expected: 403, mustCreate: false },
    { name: "viewer sur le dossier de site", actor: "viewer", dossier: "site", file: "jpeg", expected: 403, mustCreate: false },
    { name: "propriétaire JPEG valide", actor: "client", dossier: "client", file: "jpeg", expected: 201, mustCreate: true },
    { name: "artisan affecté JPEG valide", actor: "artisan", dossier: "client", file: "jpeg", expected: 201, mustCreate: true },
    { name: "MIME falsifié (PNG déclaré JPEG)", actor: "client", dossier: "client", file: "fakeMime", expected: 415, mustCreate: false },
    { name: "fichier 4 MiB + 1", actor: "client", dossier: "client", file: "oversize", expected: 413, mustCreate: false },
    { name: "pièce personnelle artisan sans dossier", actor: "artisan", dossier: null, file: "jpeg", expected: 201, mustCreate: true },
  ];
}

export const fixtures = {
  jpeg(size = 64): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(Math.max(size, 4));
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00].slice(0, bytes.length));
    if (bytes.length >= 6) {
      bytes[bytes.length - 2] = 0xff;
      bytes[bytes.length - 1] = 0xd9;
    }
    return bytes;
  },
  png(): Uint8Array<ArrayBuffer> {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  },
  OVERSIZE: 4194305,
};

export function leakCheck(text: string, forbidden: string[]): string[] {
  const hits: string[] = [];
  for (const needle of forbidden) if (needle && needle.length >= 8 && text.includes(needle)) hits.push(`contient ${needle.slice(0, 6)}…`);
  if (/eyJ[A-Za-z0-9_-]{10,}\./.test(text)) hits.push("contient un JWT");
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-/i.test(text)) hits.push("contient un chemin Storage");
  if (/\b(42501|P0002|23505|53300|PGRST\d{3})\b/.test(text)) hits.push("contient un code SQL/PostgREST");
  if (/service_role|SUPABASE_/.test(text)) hits.push("contient un nom de clé serveur");
  return hits;
}
export type Verdict = { pass: boolean; reasons: string[] };
// With `verify_jwt: true` on the deployed function, the Supabase platform answers a missing or
// invalid JWT BEFORE the function runs, with its own envelope. Bodies observed by the pilot:
//   anonymous      → {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
//   invalid token  → {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}
// Accepted strictly: a JSON object, a non-empty string `message`, and `code` absent, the number
// 401, or exactly the string bound to the scenario below. No other string code; never a generic,
// empty, string or array body.
export const PLATFORM_UNAUTHORIZED_CODES = {
  anonymous: "UNAUTHORIZED_NO_AUTH_HEADER",
  invalid: "UNAUTHORIZED_INVALID_JWT_FORMAT",
} as const;
export type PlatformUnauthorizedActor = keyof typeof PLATFORM_UNAUTHORIZED_CODES;
export function isPlatformUnauthorizedEnvelope(bodyText: string, actor?: PlatformUnauthorizedActor): boolean {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return false;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return false;
  const body = json as Record<string, unknown>;
  if (typeof body.message !== "string" || body.message.trim().length === 0) return false;
  if (!("code" in body) || body.code === 401) return true;
  if (typeof body.code !== "string") return false;
  const allowed: readonly string[] = actor ? [PLATFORM_UNAUTHORIZED_CODES[actor]] : Object.values(PLATFORM_UNAUTHORIZED_CODES);
  return allowed.includes(body.code);
}
export function assertScenario(
  scenario: Scenario,
  actual: { status: number; bodyText: string; document?: { id?: unknown } | null },
  forbidden: string[],
): Verdict {
  const reasons: string[] = [];
  if (actual.status !== scenario.expected) reasons.push(`statut ${actual.status} au lieu de ${scenario.expected}`);
  if (scenario.expected >= 400) {
    for (const hit of leakCheck(actual.bodyText, forbidden)) reasons.push(`fuite : ${hit}`);
    const functionEnvelope = /"error"\s*:\s*"/.test(actual.bodyText);
    // Only the no-JWT / invalid-JWT scenarios, and only on a real 401, may carry the platform
    // envelope instead of the function's `{"error":…}`; every other refusal keeps the function body.
    const platformEnvelope =
      scenario.expected === 401 && actual.status === 401 && (scenario.actor === "anonymous" || scenario.actor === "invalid") && isPlatformUnauthorizedEnvelope(actual.bodyText, scenario.actor);
    if (!functionEnvelope && !platformEnvelope) reasons.push("corps d’erreur sans message");
  }
  if (scenario.expected === 201 && actual.status === 201) {
    if (!actual.document || typeof actual.document.id !== "string") reasons.push("201 sans document.id");
    if (/"path"\s*:/.test(actual.bodyText) || /"owner_id"\s*:/.test(actual.bodyText)) reasons.push("201 expose path/owner_id");
  }
  if (!scenario.mustCreate && actual.status < 300) reasons.push("succès inattendu");
  return { pass: reasons.length === 0, reasons };
}

export type StepStatus = "pass" | "fail" | "skip" | "info";
export type StepRecord = { step: string; status: StepStatus; detail: string; at: string };
export type RunResult = {
  runId: string;
  project: string;
  mode: "run" | "dry-run" | "cleanup-manifest" | "expiry-prepare" | "expiry-verify" | "revoke-prepare" | "revoke-live";
  startedAt: string;
  finishedAt: string | null;
  steps: StepRecord[];
  scenarios: { name: string; expected: number; status: number | null; pass: boolean | null; reasons: string[] }[];
  cleanup: { label: string; ok: boolean; remaining: number | null; detail: string }[];
  leftovers: string[];
  verdict: "pass" | "fail" | "incomplete" | "prepared" | "observed";
  expiry?: ExpiryReport;
  revoke?: RevokeReport;
};
export type RevokeReport = {
  phase: "prepare" | "live";
  outcome: "prepared" | "pass" | "fail" | "unknown" | "refused" | null;
  objectPath: string | null;
  responseStatus: number | null;
  conditions: Record<string, boolean | null>;
  reasons: string[];
  liveCommand: string | null;
  unverifiedEntities?: string[];
};
// Platform codes observed for an EXPIRED JWT and bound strictly by the pilot (follow-up commit, same
// method as PLATFORM_UNAUTHORIZED_CODES). Empty until the first real observation: an unknown
// UNAUTHORIZED_* code is "observed", never a PASS.
export const EXPIRED_PLATFORM_CODES: readonly string[] = [];
export type ExpiryReport = {
  phase: "prepare" | "verify";
  userId: string | null;
  verifyNotBefore: string | null;
  leaseEndsAt: string | null;
  leasePath: string | null;
  observedCode: string | null;
  verifyCommand: string | null;
  outcome: "prepared" | "pass" | "observed" | "incomplete" | "fail" | "refused" | "too-early" | null;
};
// Any failed step (scenario, readback, cleanup) fails the run; later successes never mask it.
export function computeVerdict(result: Pick<RunResult, "steps" | "scenarios" | "cleanup" | "leftovers" | "mode"> & { expiry?: ExpiryReport; revoke?: RevokeReport }, finished: boolean): RunResult["verdict"] {
  if (!finished) return "incomplete";
  if (result.steps.some((s) => s.status === "fail")) return "fail";
  if (result.cleanup.some((c) => !c.ok) || result.leftovers.length) return "fail";
  if (result.mode === "run") {
    if (result.scenarios.some((s) => s.pass === null)) return "incomplete";
    if (result.scenarios.some((s) => s.pass === false)) return "fail";
  }
  // Prepare never claims PASS: the expiry is not proven until verify ran. Verify answers
  // "observed" (not PASS) while the platform code for an expired JWT is not bound strictly.
  if (result.mode === "expiry-prepare" || result.mode === "revoke-prepare") return "prepared";
  if (result.mode === "revoke-live" && result.revoke?.outcome !== "pass") return "fail";
  if (result.mode === "expiry-verify" && result.expiry?.outcome === "observed") return "observed";
  // A too-early verify proved nothing and touched nothing: never "pass".
  if (result.mode === "expiry-verify" && result.expiry?.outcome === "too-early") return "incomplete";
  // No HTTP answer / 5xx on the expired-token call: nothing is proven either way.
  if (result.mode === "expiry-verify" && result.expiry?.outcome === "incomplete") return "incomplete";
  return "pass";
}
export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null;
  const match = /\/(\d+|\*)$/.exec(header.trim());
  if (!match || match[1] === "*") return null;
  return Number(match[1]);
}
export function summaryMarkdown(result: RunResult): string {
  const lines: string[] = [];
  lines.push(`# QA gateway native-document-upload — run ${result.runId}`);
  lines.push("");
  const mode = result.mode === "dry-run" ? "DRY RUN (aucune écriture distante)" : result.mode === "cleanup-manifest" ? "nettoyage depuis un manifeste" : result.mode === "expiry-prepare" ? "expiration réelle — phase prepare" : result.mode === "expiry-verify" ? "expiration réelle — phase verify" : result.mode === "revoke-prepare" ? "révocation pendant upload — phase prepare" : result.mode === "revoke-live" ? "révocation pendant upload — phase live" : "exécution réelle sur la base dédiée";
  lines.push(`Projet : ${result.project} · ${mode} · début ${result.startedAt} · fin ${result.finishedAt ?? "en cours"} · verdict **${result.verdict}**`);
  lines.push("");
  if (result.expiry) {
    const e = result.expiry;
    lines.push("## Expiration réelle");
    lines.push("");
    if (e.phase === "prepare") {
      lines.push(result.verdict === "prepared" ? "**PREPARED — expiration non encore prouvée.** Le compte technique est laissé intentionnellement jusqu’au verify." : "Préparation en échec : compte nettoyé ou manifeste actionnable.");
      if (e.verifyNotBefore) lines.push(`Relancer après ${e.verifyNotBefore} et avant ${e.leaseEndsAt ?? "?"} : \`${e.verifyCommand ?? ""}\``);
    } else {
      lines.push(result.verdict === "observed" ? `**OBSERVED — pas un PASS.** Code 401 de la plateforme observé : ${e.observedCode ?? "—"} ; un 401 générique de la plateforme est consigné comme observation et ne prouve pas à lui seul que l’expiration en est la cause.` : `Corps 401 : ${e.observedCode ?? "—"}.`);
    }
    lines.push("");
  }
  if (result.revoke) {
    const r = result.revoke;
    lines.push("## Révocation pendant un upload réel");
    lines.push("");
    if (r.phase === "prepare") lines.push(result.verdict === "prepared" ? `**PREPARED — rien n’est prouvé.** Cohorte laissée pour la phase live : \`${r.liveCommand ?? ""}\`` : "Préparation en échec : cohorte nettoyée ou manifeste actionnable.");
    else {
      lines.push(`Issue : **${r.outcome ?? "—"}** ; réponse HTTP ${r.responseStatus ?? "—"} ; objet ${r.objectPath ? "découvert" : "non observé"}.`);
      for (const [k, v] of Object.entries(r.conditions)) lines.push(`- ${v === true ? "OK" : v === false ? "ÉCHEC" : "non évalué"} ${k}`);
      for (const reason of r.reasons) lines.push(`- ${reason}`);
    }
    lines.push("");
  }
  lines.push("## Scénarios");
  lines.push("");
  lines.push("| Scénario | Attendu | Obtenu | Résultat |");
  lines.push("|---|---|---|---|");
  for (const s of result.scenarios)
    lines.push(`| ${s.name} | ${s.expected} | ${s.status ?? "—"} | ${s.pass === null ? "non exécuté" : s.pass ? "PASS" : `FAIL : ${s.reasons.join(" ; ")}`} |`);
  lines.push("");
  lines.push("## Nettoyage");
  lines.push("");
  if (result.cleanup.length === 0) lines.push("Aucune étape exécutée.");
  for (const c of result.cleanup) lines.push(`- ${c.ok ? "OK" : "ÉCHEC"} ${c.label}${c.remaining === null ? " (relecture impossible)" : ` (restant : ${c.remaining})`}${c.detail ? ` — ${c.detail}` : ""}`);
  if (result.leftovers.length) {
    lines.push("");
    lines.push("Reliquats à traiter (relancer avec --cleanup-manifest ou supprimer manuellement) :");
    for (const l of result.leftovers) lines.push(`- ${l}`);
  }
  lines.push("");
  lines.push("## Journal");
  lines.push("");
  for (const s of result.steps) lines.push(`- ${s.at} [${s.status}] ${s.step}${s.detail ? ` — ${s.detail}` : ""}`);
  lines.push("");
  lines.push("Jetons, clés et en-têtes ne sont jamais écrits ; ce rapport est caviardé. Une lecture en erreur est un échec explicite, jamais un résultat vide. Les tests réseau ne prouvent pas un interleaving concurrent.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------
// QA-GW-EXPIRED-REVOKE-003 §1 — real JWT expiry in two modes (prepare / verify), no blocking wait.
// Pure orchestration over injected deps (clock, HTTP, manifest, lease) so node:test drives both
// phases with a fake clock and fake responses. No token is ever forged, signed, refreshed or
// verified here: only the payload claims are READ (base64url) for consistency checks.
// ---------------------------------------------------------------------------------------------
export const EXPIRY_VERIFY_MARGIN_S = 60;
export const EXPIRY_LEASE_MAX_S = 7200;
export function expiryEmail(run: string): string {
  return `qa-gw-exp-${run}@qa.invalid`;
}
// Cohort proof: the e-mail returned by Auth for the exact uid must be the technical account of
// THIS run (pattern and exact equality with the lease and the manifest). Nothing else is ever deleted.
export const EXPIRY_EMAIL_PATTERN = /^qa-gw-exp-[0-9a-z]{2,40}@qa\.invalid$/;
export function isExpiryCohortEmail(email: unknown, runId: string): boolean {
  return typeof email === "string" && EXPIRY_EMAIL_PATTERN.test(email) && email === expiryEmail(runId);
}
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes));
    return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
export type TokenCheck = { ok: boolean; reasons: string[]; claimExp: number | null };
export function checkTokenConsistency(input: { token: string; projectUrl: string; userId: string; expiresAt: unknown; expiresIn: unknown; now: number }): TokenCheck {
  const reasons: string[] = [];
  const claims = decodeJwtClaims(input.token);
  if (!claims) return { ok: false, reasons: ["jeton illisible (charge utile JWT invalide)"], claimExp: null };
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  if (claims.iss !== `${input.projectUrl}/auth/v1`) reasons.push("iss ≠ projet");
  if (claims.sub !== input.userId) reasons.push("sub ≠ uid créé");
  if (claims.aud !== "authenticated") reasons.push("aud ≠ authenticated");
  if (claims.role !== "authenticated") reasons.push("role ≠ authenticated");
  if (exp === null) reasons.push("exp absent");
  else {
    if (typeof input.expiresAt !== "number" || Math.abs(exp - input.expiresAt) > 5) reasons.push("exp ≠ expires_at (±5 s)");
    if (typeof input.expiresIn !== "number" || Math.abs(exp - (input.now + input.expiresIn)) > 30) reasons.push("exp ≠ now + expires_in (±30 s)");
    if (exp <= input.now) reasons.push("jeton déjà expiré à l’obtention");
  }
  return { ok: reasons.length === 0, reasons, claimExp: exp };
}
export type Lease = {
  version: 1;
  suite: "expiry";
  runId: string;
  project: string;
  userId: string;
  email: string;
  token: string;
  issuer: string;
  tokenExpiresAt: number;
  claimExp: number;
  grantExpiresIn: number;
  preparedAt: number;
  verifyNotBefore: number;
  leaseEndsAt: number;
  manifestPath: string;
  consumedAt?: number;
};
export function buildLease(input: { runId: string; project: string; userId: string; email: string; token: string; issuer: string; expiresAt: number; claimExp: number; expiresIn: number; preparedAt: number; manifestPath: string }): Lease {
  return {
    version: 1,
    suite: "expiry",
    runId: input.runId,
    project: input.project,
    userId: input.userId,
    email: input.email,
    token: input.token,
    issuer: input.issuer,
    tokenExpiresAt: input.expiresAt,
    claimExp: input.claimExp,
    grantExpiresIn: input.expiresIn,
    preparedAt: input.preparedAt,
    verifyNotBefore: input.claimExp + EXPIRY_VERIFY_MARGIN_S,
    leaseEndsAt: Math.min(input.claimExp + EXPIRY_LEASE_MAX_S, input.preparedAt + EXPIRY_LEASE_MAX_S),
    manifestPath: input.manifestPath,
  };
}
export function parseLease(raw: unknown, project: string): Lease {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("Bail invalide.");
  const l = raw as Record<string, unknown>;
  if (l.version !== 1 || l.suite !== "expiry") throw new UsageError("Bail invalide (version/suite).");
  for (const key of ["runId", "project", "userId", "email", "token", "issuer", "manifestPath"]) if (typeof l[key] !== "string" || !l[key]) throw new UsageError(`Bail invalide (${key}).`);
  for (const key of ["tokenExpiresAt", "claimExp", "grantExpiresIn", "preparedAt", "verifyNotBefore", "leaseEndsAt"]) if (typeof l[key] !== "number" || !Number.isFinite(l[key])) throw new UsageError(`Bail invalide (${key}).`);
  if (l.project !== project) throw new UsageError(`Refus : le bail appartient au projet ${l.project}, pas ${project}.`);
  if (!UUID.test(String(l.userId))) throw new UsageError("Bail invalide (userId).");
  if (l.consumedAt !== undefined && typeof l.consumedAt !== "number") throw new UsageError("Bail invalide (consumedAt).");
  const lease = { ...(l as unknown as Lease) };
  // Relations are re-validated, not trusted: verifyNotBefore = exp + 60 s, leaseEndsAt =
  // min(exp, preparedAt) + 2 h, lease ≤ 2 h after preparation, expires_at ≈ exp, uid e-mail of the run.
  if (lease.verifyNotBefore !== lease.claimExp + EXPIRY_VERIFY_MARGIN_S) throw new UsageError("Bail invalide : verifyNotBefore ≠ exp + 60 s.");
  if (lease.leaseEndsAt !== Math.min(lease.claimExp + EXPIRY_LEASE_MAX_S, lease.preparedAt + EXPIRY_LEASE_MAX_S)) throw new UsageError("Bail invalide : leaseEndsAt ≠ min(exp, preparedAt) + 2 h.");
  if (lease.leaseEndsAt - lease.preparedAt > EXPIRY_LEASE_MAX_S || lease.leaseEndsAt <= lease.preparedAt) throw new UsageError("Bail invalide : fenêtre de bail hors bornes (≤ 2 h).");
  if (Math.abs(lease.tokenExpiresAt - lease.claimExp) > 5) throw new UsageError("Bail invalide : expires_at ≠ exp (±5 s).");
  if (lease.claimExp <= lease.preparedAt) throw new UsageError("Bail invalide : exp antérieur à la préparation.");
  if (lease.verifyNotBefore >= lease.leaseEndsAt) throw new UsageError("Bail invalide : bail inexécutable (verifyNotBefore ≥ leaseEndsAt).");
  if (!isExpiryCohortEmail(lease.email, lease.runId)) throw new UsageError("Bail invalide : e-mail hors cohorte d’expiration.");
  if (lease.issuer !== `https://${lease.project}.supabase.co/auth/v1`) throw new UsageError("Bail invalide : issuer ≠ projet.");
  return lease;
}
// Private file/dir policy for the lease and the manifest (read and write): regular file, no symlink,
// no group/other bits (0600 file, 0700 directory). Pure check over lstat-like facts.
export type PrivatePathFacts = { exists: boolean; isSymlink: boolean; isFile: boolean; mode: number; dir: { isSymlink: boolean; isDirectory: boolean; mode: number } };
export function checkPrivatePath(label: string, facts: PrivatePathFacts, options: { mustExist: boolean }): string[] {
  const reasons: string[] = [];
  if (facts.dir.isSymlink) reasons.push(`${label} : le dossier est un lien symbolique`);
  if (!facts.dir.isDirectory) reasons.push(`${label} : le dossier parent n’existe pas`);
  if ((facts.dir.mode & 0o077) !== 0) reasons.push(`${label} : dossier lisible par le groupe/les autres (mode ${(facts.dir.mode & 0o777).toString(8)}, attendu 0700)`);
  if (facts.exists) {
    if (facts.isSymlink) reasons.push(`${label} : lien symbolique refusé`);
    else if (!facts.isFile) reasons.push(`${label} : pas un fichier régulier`);
    if ((facts.mode & 0o077) !== 0) reasons.push(`${label} : fichier lisible par le groupe/les autres (mode ${(facts.mode & 0o777).toString(8)}, attendu 0600)`);
  } else if (options.mustExist) reasons.push(`${label} : fichier absent`);
  return reasons;
}
export type LeaseDecision = { action: "too-early" | "expired-lease" | "verify"; detail: string };
export function leaseDecision(lease: Lease, now: number): LeaseDecision {
  const iso = (t: number) => new Date(t * 1000).toISOString();
  if (lease.consumedAt !== undefined) return { action: "expired-lease", detail: `bail déjà consommé le ${iso(lease.consumedAt)}` };
  if (now < lease.verifyNotBefore) return { action: "too-early", detail: `trop tôt : relancer après ${iso(lease.verifyNotBefore)} (exp ${iso(lease.claimExp)} + ${EXPIRY_VERIFY_MARGIN_S} s)` };
  if (now > lease.leaseEndsAt) return { action: "expired-lease", detail: `bail expiré le ${iso(lease.leaseEndsAt)} : expiration non prouvée, nettoyage seulement` };
  return { action: "verify", detail: `fenêtre de vérification ouverte (exp ${iso(lease.claimExp)}, bail jusqu’au ${iso(lease.leaseEndsAt)})` };
}
// Pre-expiry proof: a mutation-free POST (no multipart body) with the valid token must reach the
// function (platform verify_jwt AND getUser accepted it) and be refused 422 with the function body.
export function assertPreExpiryProbe(actual: { status: number; bodyText: string }, forbidden: string[]): Verdict {
  const reasons: string[] = [];
  if (actual.status === 401) reasons.push("jeton non accepté (401) avant échéance");
  else if (actual.status < 300) reasons.push(`mutation inattendue (${actual.status}) sur une commande sans corps`);
  else if (actual.status !== 422) reasons.push(`statut ${actual.status} au lieu de 422`);
  for (const hit of leakCheck(actual.bodyText, forbidden)) reasons.push(`fuite : ${hit}`);
  if (!/"error"\s*:\s*"/.test(actual.bodyText)) reasons.push("corps d’erreur sans message (enveloppe de la fonction attendue)");
  return { pass: reasons.length === 0, reasons };
}
// Expired-token refusal: 401, function envelope or a platform envelope whose string code starts
// with UNAUTHORIZED_ — except NO_AUTH_HEADER, which would prove a transport defect, not expiry.
// The exact platform code for an expired JWT has not been observed yet: it is recorded for the
// pilot and bound strictly in a follow-up (same pattern as the two known codes).
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
export type ExpiredVerdict = { outcome: "pass" | "observed" | "incomplete" | "fail"; reasons: string[]; observedCode: string | null };
// Observed on the dedicated project (root verify 2026-10-31 19:06:31 UTC, harness 6466b8a): the original,
// genuinely expired JWT (ES256, kid present in the current public JWKS, signature verified, exp + 60 s
// passed, account exact and active) was refused 401 with code UNAUTHORIZED_ASYMMETRIC_JWT. Recorded as a
// FACT only: it is a generic gateway code (not expiry-specific), so it is deliberately NOT bound in
// EXPIRED_PLATFORM_CODES — this code, like any unknown future code, stays OBSERVED, never PASS.
export const OBSERVED_EXPIRED_PLATFORM_CODES: readonly string[] = ["UNAUTHORIZED_ASYMMETRIC_JWT"];
// Classification of the expired-token call: 401 with a recognised envelope ⇒ OBSERVED (or PASS only for
// a strictly bound code / the function envelope); 2xx or 422 (token still accepted) ⇒ FAIL; no HTTP
// answer (network/transport) or 5xx ⇒ INCOMPLETE (nothing proven either way).
export function classifyExpiredProbe(result: { status: number; bodyText: string } | { error: unknown }, forbidden: string[]): ExpiredVerdict {
  if ("error" in result) return { outcome: "incomplete", reasons: [`appel sans réponse HTTP : ${result.error instanceof Error ? result.error.message : String(result.error)}`], observedCode: null };
  if (result.status >= 500) return { outcome: "incomplete", reasons: [`HTTP ${result.status} : réponse inexploitable, rien n’est prouvé`], observedCode: null };
  return assertExpiredRefusal(result, forbidden);
}
export function assertExpiredRefusal(actual: { status: number; bodyText: string }, forbidden: string[]): ExpiredVerdict {
  const reasons: string[] = [];
  let observedCode: string | null = null;
  let bound = false;
  if (actual.status === 422) reasons.push("jeton expiré encore accepté (422 : la fonction a été atteinte)");
  else if (actual.status < 300) reasons.push(`jeton expiré encore accepté (${actual.status})`);
  else if (actual.status !== 401) reasons.push(`statut ${actual.status} au lieu de 401`);
  for (const hit of leakCheck(actual.bodyText, forbidden)) reasons.push(`fuite : ${hit}`);
  if (/"error"\s*:\s*"/.test(actual.bodyText)) {
    observedCode = "function-envelope";
    bound = true;
  } else {
    let json: unknown = null;
    try {
      json = JSON.parse(actual.bodyText);
    } catch {
      json = null;
    }
    const body = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    const code = body && typeof body.code === "string" ? body.code : null;
    const message = body && typeof body.message === "string" && body.message.trim().length > 0;
    if (!body || !message || !code || !code.startsWith("UNAUTHORIZED_")) reasons.push("corps 401 sans enveloppe reconnue (fonction ou plateforme avec code chaîne UNAUTHORIZED_*)");
    else if (code === PLATFORM_UNAUTHORIZED_CODES.anonymous || code === PLATFORM_UNAUTHORIZED_CODES.invalid) reasons.push(`code ${code} : en-tête absent ou format invalide, pas une expiration`);
    else {
      observedCode = code;
      bound = EXPIRED_PLATFORM_CODES.includes(code);
    }
  }
  if (reasons.length) return { outcome: "fail", reasons, observedCode };
  return { outcome: bound ? "pass" : "observed", reasons: bound ? [] : [`code ${observedCode} non encore lié strictement : observé, pas un PASS`], observedCode };
}
export type ExpiryDeps = {
  now(): number;
  runId: string;
  project: string;
  projectUrl: string;
  manifestPath: string;
  leasePath: string;
  verifyCommand: string;
  randomPassword(): string;
  createUser(email: string, password: string): Promise<{ status: number; id: string | null; detail: string }>;
  passwordGrant(email: string, password: string): Promise<{ status: number; json: Record<string, unknown> | null; detail: string }>;
  probe(token: string): Promise<{ status: number; text: string }>;
  getUser(userId: string): Promise<{ status: number; json: Record<string, unknown> | null }>;
  readManifest(path: string): Promise<Manifest>;
  record(kind: CreatedKind, value: string, extra?: ManifestExtra): Promise<void>;
  // Verify only: durable record of the uid ONCE the cohort proof succeeded and BEFORE any further
  // network call, so an interrupted verify still leaves a cleanable manifest (REVIEW-002).
  recordValidated(userId: string): Promise<void>;
  addSecret(secret: string): void;
  forbidden(): string[];
  client: Pick<CleanupClient, "listDocuments" | "listObjects">;
  // "out": the private out dir of this run; "original": the file given by --lease (verify only).
  writeLease(lease: Lease, target: "out" | "original"): Promise<void>;
  log(status: StepStatus, step: string, detail: string): Promise<void>;
};
export type PrepareOutcome = { outcome: "prepared" | "fail"; userId: string | null; lease: Lease | null };
export async function expiryPrepare(deps: ExpiryDeps): Promise<PrepareOutcome> {
  const email = expiryEmail(deps.runId);
  const password = deps.randomPassword();
  deps.addSecret(password);
  const created = await deps.createUser(email, password);
  if (created.status >= 300 || !created.id) {
    await deps.log("fail", "compte technique d’expiration", `création → HTTP ${created.status} ${created.detail}`);
    return { outcome: "fail", userId: null, lease: null };
  }
  const userId = created.id;
  // Durable id BEFORE any authentication: the manifest can clean it whatever happens next.
  const leaseEndsAtProvisional = new Date((deps.now() + EXPIRY_LEASE_MAX_S) * 1000).toISOString();
  await deps.record("userIds", userId, { suite: "expiry", leaseEndsAt: leaseEndsAtProvisional });
  await deps.log("pass", "compte technique d’expiration créé (un seul, confirmé, rôle client)", userId);
  const grant = await deps.passwordGrant(email, password);
  const token = typeof grant.json?.access_token === "string" ? grant.json.access_token : null;
  if (grant.status !== 200 || !token) {
    await deps.log("fail", "jeton réel (password grant)", `HTTP ${grant.status} ${grant.detail}`);
    return { outcome: "fail", userId, lease: null };
  }
  deps.addSecret(token);
  if (typeof grant.json?.refresh_token === "string") deps.addSecret(grant.json.refresh_token);
  const now = deps.now();
  const check = checkTokenConsistency({ token, projectUrl: deps.projectUrl, userId, expiresAt: grant.json?.expires_at, expiresIn: grant.json?.expires_in, now });
  if (!check.ok || check.claimExp === null) {
    await deps.log("fail", "cohérence du jeton (iss/sub/aud/role/exp vs expires_at)", check.reasons.join(" ; "));
    return { outcome: "fail", userId, lease: null };
  }
  await deps.log("pass", "jeton réel cohérent (claims lues sans secret, jamais rafraîchi)", `exp ${new Date(check.claimExp * 1000).toISOString()}`);
  const probe = await deps.probe(token);
  const verdict = assertPreExpiryProbe({ status: probe.status, bodyText: probe.text }, deps.forbidden());
  await deps.log(verdict.pass ? "pass" : "fail", "jeton accepté avant échéance sur une commande sans mutation (422 attendu)", `HTTP ${probe.status}${verdict.reasons.length ? ` — ${verdict.reasons.join(" ; ")}` : ""}`);
  if (!verdict.pass) return { outcome: "fail", userId, lease: null };
  const zero = emptyCreated();
  zero.userIds.push(userId);
  const found = await discoverCohort(deps.client, zero);
  const silent = found.complete && found.added.documentIds.length === 0 && found.added.objectPaths.length === 0;
  await deps.log(silent ? "pass" : "fail", "aucune écriture par la sonde (documents 0, objets 0)", found.complete ? `${found.added.documentIds.length} ligne(s), ${found.added.objectPaths.length} objet(s)` : found.unknown.map((u) => `${u.scope} (${u.detail})`).join(" ; "));
  if (!silent) return { outcome: "fail", userId, lease: null };
  const lease = buildLease({ runId: deps.runId, project: deps.project, userId, email, token, issuer: `${deps.projectUrl}/auth/v1`, expiresAt: Number(grant.json?.expires_at), claimExp: check.claimExp, expiresIn: Number(grant.json?.expires_in), preparedAt: now, manifestPath: deps.manifestPath });
  if (lease.verifyNotBefore >= lease.leaseEndsAt) {
    // A TTL longer than the lease window can never be verified: never leave a stale account.
    await deps.log("fail", "bail inexécutable : aucun bail écrit, compte nettoyé", `TTL ${Number(grant.json?.expires_in)} s : verifyNotBefore ${new Date(lease.verifyNotBefore * 1000).toISOString()} ≥ leaseEndsAt ${new Date(lease.leaseEndsAt * 1000).toISOString()} (fenêtre ${EXPIRY_LEASE_MAX_S} s)`);
    return { outcome: "fail", userId, lease: null };
  }
  const expiry: ManifestExpiry = { userId, email, issuer: lease.issuer, claimExp: lease.claimExp, tokenSha256: await sha256Hex(token) };
  await deps.record("userIds", userId, { suite: "expiry", leaseEndsAt: new Date(lease.leaseEndsAt * 1000).toISOString(), expiry });
  await deps.writeLease(lease, "out");
  await deps.log("info", "PREPARED — expiration non encore prouvée", `relancer après ${new Date(lease.verifyNotBefore * 1000).toISOString()} et avant ${new Date(lease.leaseEndsAt * 1000).toISOString()} : ${deps.verifyCommand}`);
  return { outcome: "prepared", userId, lease };
}
export type VerifyOutcome = { outcome: "pass" | "observed" | "incomplete" | "fail" | "refused" | "too-early"; observedCode: string | null; cleanup: boolean };
// `cleanup: true` is a PERMISSION to delete lease.userId. It is granted only after the independent
// cohort proof (Auth admin GET by the exact uid → e-mail of THIS run, equal to lease and manifest).
// Every mismatch (stale lease, unreadable manifest, uid/hash/claims/e-mail mismatch) refuses WITHOUT
// deleting anything and without recording the unvalidated uid anywhere.
export async function expiryVerify(lease: Lease, deps: ExpiryDeps): Promise<VerifyOutcome> {
  const refused = async (step: string, detail: string): Promise<VerifyOutcome> => {
    await deps.log("fail", `verify refusé : ${step} — aucune suppression, aucun identifiant enregistré`, detail);
    return { outcome: "refused", observedCode: null, cleanup: false };
  };
  const decision = leaseDecision(lease, deps.now());
  if (decision.action === "too-early") {
    await deps.log("info", "verify refusé : trop tôt (rien écrit, rien supprimé, compte conservé)", decision.detail);
    return { outcome: "too-early", observedCode: null, cleanup: false };
  }
  deps.addSecret(lease.token);
  if (lease.project !== deps.project) return refused("projet du bail ≠ projet", `${lease.project} ≠ ${deps.project}`);
  // 1. Manifest of the lease, readable and of the same run/project.
  let manifest: Manifest;
  try {
    manifest = await deps.readManifest(lease.manifestPath);
  } catch (error) {
    return refused("manifeste du bail illisible", `${error instanceof Error ? error.message : String(error)} — relancer « --cleanup-manifest <manifeste de prepare> » si le compte doit être nettoyé`);
  }
  const mismatch: string[] = [];
  if (manifest.runId !== lease.runId) mismatch.push("runId du manifeste ≠ bail");
  if (manifest.project !== lease.project) mismatch.push("projet du manifeste ≠ bail");
  if (manifest.suite !== "expiry" || !manifest.expiry) mismatch.push("manifeste sans données d’expiration");
  else {
    if (manifest.expiry.tokenSha256 !== (await sha256Hex(lease.token))) mismatch.push("empreinte SHA-256 du jeton ≠ manifeste");
    if (manifest.expiry.userId !== lease.userId || !manifest.created.userIds.includes(lease.userId)) mismatch.push("uid du bail ≠ manifeste");
    if (manifest.expiry.issuer !== lease.issuer || manifest.expiry.issuer !== `${deps.projectUrl}/auth/v1`) mismatch.push("issuer ≠ manifeste/projet");
    if (manifest.expiry.claimExp !== lease.claimExp) mismatch.push("exp du bail ≠ manifeste");
    if (manifest.expiry.email !== lease.email) mismatch.push("e-mail du bail ≠ manifeste");
  }
  if (manifest.leaseEndsAt !== new Date(lease.leaseEndsAt * 1000).toISOString()) mismatch.push("leaseEndsAt du bail ≠ manifeste");
  const claims = decodeJwtClaims(lease.token);
  if (!claims) mismatch.push("jeton du bail illisible");
  else {
    if (claims.iss !== lease.issuer) mismatch.push("claim iss ≠ bail");
    if (claims.sub !== lease.userId) mismatch.push("claim sub ≠ bail");
    if (claims.exp !== lease.claimExp) mismatch.push("claim exp ≠ bail");
    if (claims.aud !== "authenticated" || claims.role !== "authenticated") mismatch.push("claims aud/role ≠ authenticated");
  }
  if (!isExpiryCohortEmail(lease.email, lease.runId)) mismatch.push("e-mail du bail hors cohorte d’expiration");
  if (mismatch.length) return refused("cohérence bail ↔ manifeste ↔ claims", mismatch.join(" ; "));
  await deps.log("pass", "cohérence bail ↔ manifeste ↔ claims (empreinte, iss, sub, exp, e-mail, run, projet)", "identiques");
  // 2. Independent cohort proof from Auth, by the exact uid, BEFORE any cleanup permission.
  const active = await deps.getUser(lease.userId);
  const u = active.json ?? {};
  if (active.status !== 200) return refused("compte introuvable dans Auth (preuve de cohorte impossible)", `Auth admin HTTP ${active.status} — rien n’est supprimé ; relancer « --cleanup-manifest <manifeste de prepare> » si nécessaire`);
  const email = typeof u.email === "string" ? u.email.toLowerCase() : "";
  const cohort: string[] = [];
  if (u.id !== lease.userId) cohort.push("id renvoyé par Auth ≠ uid demandé");
  if (!isExpiryCohortEmail(email, lease.runId)) cohort.push("e-mail Auth hors motif qa-gw-exp-<run>@qa.invalid");
  if (email !== lease.email.toLowerCase()) cohort.push("e-mail Auth ≠ bail");
  if (!manifest.expiry || email !== manifest.expiry.email.toLowerCase()) cohort.push("e-mail Auth ≠ manifeste");
  if (cohort.length) return refused("preuve de cohorte Auth", cohort.join(" ; "));
  await deps.log("pass", "preuve de cohorte Auth : uid exact → e-mail du run, égal au bail et au manifeste (suppression autorisée)", `Auth admin HTTP 200, run ${lease.runId}`);
  // From here on, cleanup of lease.userId is permitted (cohort proven): record it durably NOW, before
  // any further network call, so an interruption still leaves a cleanable manifest.
  await deps.recordValidated(lease.userId);
  if (decision.action === "expired-lease") {
    // Non-proof: the account is proven ours, but the window is gone; nothing is deleted here —
    // the manifest written by prepare remains the rescue path.
    await deps.log("fail", "bail hors fenêtre : expiration non prouvée — aucune suppression par verify", `${decision.detail} ; nettoyer par « --cleanup-manifest ${lease.manifestPath} »`);
    return { outcome: "refused", observedCode: null, cleanup: false };
  }
  // 3. Active, not banned, not deleted — otherwise a 401 proves nothing about expiry.
  const bannedUntil = typeof u.banned_until === "string" ? Date.parse(u.banned_until) / 1000 : null;
  const activeReasons: string[] = [];
  if (u.deleted_at) activeReasons.push("compte effacé (deleted_at)");
  if (bannedUntil !== null && Number.isFinite(bannedUntil) && bannedUntil > deps.now()) activeReasons.push("compte banni (banned_until futur)");
  await deps.log(activeReasons.length ? "fail" : "pass", "compte technique actif, ni banni ni effacé, avant l’appel (isole l’expiration)", activeReasons.length ? activeReasons.join(" ; ") : "Auth admin HTTP 200, e-mail et id identiques");
  if (activeReasons.length) return { outcome: "fail", observedCode: null, cleanup: true };
  const now = deps.now();
  if (now < lease.claimExp + EXPIRY_VERIFY_MARGIN_S) {
    await deps.log("fail", "horloge locale avant exp + 60 s", `now ${new Date(now * 1000).toISOString()} < ${new Date((lease.claimExp + EXPIRY_VERIFY_MARGIN_S) * 1000).toISOString()}`);
    return { outcome: "fail", observedCode: null, cleanup: true };
  }
  let probeResult: { status: number; bodyText: string } | { error: unknown };
  try {
    const probe = await deps.probe(lease.token);
    probeResult = { status: probe.status, bodyText: probe.text };
  } catch (error) {
    probeResult = { error };
  }
  const verdict = classifyExpiredProbe(probeResult, deps.forbidden());
  if (verdict.outcome === "incomplete") {
    // The validated uid is already recorded: the caller's cleanup still deletes it; the lease is not
    // consumed because nothing was proven.
    await deps.log("info", "appel du jeton expiré sans réponse exploitable : INCOMPLETE (ni PASS ni FAIL)", verdict.reasons.join(" ; "));
    return { outcome: "incomplete", observedCode: null, cleanup: true };
  }
  await deps.log(verdict.outcome === "fail" ? "fail" : verdict.outcome === "observed" ? "info" : "pass", verdict.outcome === "observed" ? "jeton réel expiré refusé 401 sans fuite — code plateforme OBSERVÉ, non lié : pas un PASS" : "jeton réel expiré refusé par la fonction déployée (401 sans fuite)", `HTTP ${"status" in probeResult ? probeResult.status : "—"}${verdict.observedCode ? ` — code ${verdict.observedCode}` : ""}${verdict.reasons.length ? ` — ${verdict.reasons.join(" ; ")}` : ""}`);
  const consumed = { ...lease, consumedAt: now };
  await deps.writeLease(consumed, "original");
  await deps.writeLease(consumed, "out");
  return { outcome: verdict.outcome, observedCode: verdict.observedCode, cleanup: true };
}

// ---------------------------------------------------------------------------------------------
// QA-GW-EXPIRED-REVOKE-003 §2 (contract v4 ac4eadf) — revocation during a REAL upload.
// Pure parsers/verdict + orchestration over injected deps. The harness never runs SQL: the pilot
// executes the rendered batch and the observation with `db query --file` and hands the two result
// rows back as private files. Any missing/malformed result is a rejection, never "empty".
// ---------------------------------------------------------------------------------------------
export const REVOKE_PAUSE_S = 3;
export const REVOKE_DISCOVERY_MS = 3000;
export const REVOKE_DISCOVERY_STEP_MS = 250;
export const REVOKE_RESULT_WAIT_MS = 120000;
export const REVOKE_RESULT_STEP_MS = 500;
export function revokeEmail(run: string, role: "owner" | "manager"): string {
  return `qa-gw-rv-${run}-${role}@qa.invalid`;
}
export const REVOKE_EMAIL_PATTERN = /^qa-gw-rv-[0-9a-z]{2,40}-(owner|manager)@qa\.invalid$/;
export function isRevokeCohortEmail(email: unknown, runId: string, role: "owner" | "manager"): boolean {
  return typeof email === "string" && REVOKE_EMAIL_PATTERN.test(email) && email === revokeEmail(runId, role);
}
// Conservative other-writer guard over the Auth admin listing: any qa-gw-* account that is not of
// this run (including a pending expiry lease) refuses the run; the pilot never erases it to pass.
export function otherWriters(emails: string[], runId: string): string[] {
  return emails.filter((e) => typeof e === "string" && /^qa-gw-/i.test(e) && !e.includes(`-${runId}-`) && !e.includes(`-${runId}@`));
}
// Exhaustive Auth admin user listing (root review of 13b68c3): absence/exhaustiveness is inferred ONLY
// from a proven end — a short page (< perPage) or a response `total` consistent with what was read.
// A full last page at the page bound, an inconsistent total, an error or a malformed page ⇒ UNKNOWN
// (ok:false): the other-writer guard refuses and no "clean" verdict can rely on it.
export type UserPage = { status: number; users: unknown[] | null; total: number | null; detail: string };
export async function listAllUserEmails(fetchPage: (page: number, perPage: number) => Promise<UserPage>, options: { perPage?: number; maxPages?: number } = {}): Promise<{ ok: boolean; emails: string[]; detail: string }> {
  const perPage = Math.max(1, options.perPage ?? 1000);
  const maxPages = Math.max(1, options.maxPages ?? 50);
  const emails: string[] = [];
  let seen = 0;
  for (let page = 1; page <= maxPages; page++) {
    let r: UserPage;
    try {
      r = await fetchPage(page, perPage);
    } catch (error) {
      return { ok: false, emails: [], detail: `listage Auth inconnu : ${error instanceof Error ? error.message : String(error)}` };
    }
    if (r.status !== 200 || !Array.isArray(r.users)) return { ok: false, emails: [], detail: `listage Auth inconnu : HTTP ${r.status} ${r.detail}` };
    if (r.users.length > perPage) return { ok: false, emails: [], detail: `listage Auth inconnu : page ${page} de ${r.users.length} > ${perPage}` };
    for (const u of r.users) {
      const email = u && typeof u === "object" ? (u as Record<string, unknown>).email : undefined;
      if (typeof email === "string") emails.push(email);
    }
    seen += r.users.length;
    if (r.total !== null && seen > r.total) return { ok: false, emails: [], detail: `listage Auth inconnu : ${seen} lus > total annoncé ${r.total}` };
    if (r.users.length < perPage) {
      if (r.total !== null && r.total !== seen) return { ok: false, emails: [], detail: `listage Auth inconnu : fin de liste à ${seen} ≠ total annoncé ${r.total}` };
      return { ok: true, emails, detail: `${seen} compte(s), fin prouvée (page ${page} courte)` };
    }
    if (r.total !== null && r.total === seen) return { ok: true, emails, detail: `${seen} compte(s), fin prouvée (total annoncé ${r.total})` };
  }
  return { ok: false, emails: [], detail: `listage Auth inconnu : ${maxPages} page(s) pleine(s) sans fin prouvée (borne atteinte)` };
}
export function parseTotalHeader(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}
export type RevokeIds = { RUN: string; PROJECT: string; ORG: string; SITE: string; DOSSIER: string; OWNER: string; MANAGER: string };
// Renders a SQL template: every {{KEY}} replaced by a validated value; unknown placeholders refused.
export function renderSqlTemplate(template: string, ids: RevokeIds): string {
  for (const [key, value] of Object.entries(ids)) {
    const ok = key === "RUN" ? /^[0-9a-z]{2,40}$/.test(value) : key === "PROJECT" ? /^[a-z0-9]{20}$/.test(value) : UUID.test(value);
    if (!ok) throw new UsageError(`Rendu SQL refusé : ${key} invalide.`);
  }
  const rendered = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    if (!(key in ids)) throw new UsageError(`Rendu SQL refusé : placeholder inconnu ${key}.`);
    return ids[key as keyof RevokeIds];
  });
  if (/\{\{[A-Z_]+\}\}/.test(rendered)) throw new UsageError("Rendu SQL refusé : placeholder restant.");
  return rendered;
}
export type RevokeState = {
  version: 1;
  suite: "revoke";
  runId: string;
  project: string;
  ownerId: string;
  managerId: string;
  orgId: string;
  siteId: string;
  dossierId: string;
  managerToken: string;
  managerTokenExp: number;
  preparedAt: number;
  manifestPath: string;
  batchSqlPath: string;
  observeSqlPath: string;
  consumedAt?: number;
};
export function parseRevokeState(raw: unknown, project: string): RevokeState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("État revoke invalide.");
  const l = raw as Record<string, unknown>;
  if (l.version !== 1 || l.suite !== "revoke") throw new UsageError("État revoke invalide (version/suite).");
  for (const key of ["runId", "project", "managerToken", "manifestPath", "batchSqlPath", "observeSqlPath"]) if (typeof l[key] !== "string" || !l[key]) throw new UsageError(`État revoke invalide (${key}).`);
  for (const key of ["ownerId", "managerId", "orgId", "siteId", "dossierId"]) if (typeof l[key] !== "string" || !UUID.test(l[key] as string)) throw new UsageError(`État revoke invalide (${key}).`);
  for (const key of ["managerTokenExp", "preparedAt"]) if (typeof l[key] !== "number" || !Number.isFinite(l[key])) throw new UsageError(`État revoke invalide (${key}).`);
  if (l.project !== project) throw new UsageError(`Refus : l’état appartient au projet ${l.project}, pas ${project}.`);
  if (l.ownerId === l.managerId) throw new UsageError("État revoke invalide : gestionnaire = propriétaire.");
  if (l.consumedAt !== undefined && typeof l.consumedAt !== "number") throw new UsageError("État revoke invalide (consumedAt).");
  return { ...(l as unknown as RevokeState) };
}
// ---- Strict parsers of the two pilot-provided result rows --------------------------------------
type Row = Record<string, unknown>;
function singleRow(raw: unknown, label: string, column: string): Row {
  // Accepted shapes: the bare object; [{column: obj}]; {column: obj}; [obj]. Exactly one row.
  let rows: unknown[] = [];
  if (Array.isArray(raw)) rows = raw;
  else if (raw && typeof raw === "object") rows = [raw];
  else throw new UsageError(`${label} : contenu non tabulaire.`);
  if (rows.length !== 1) throw new UsageError(`${label} : ${rows.length} ligne(s) au lieu d’une seule.`);
  let row = rows[0];
  if (row && typeof row === "object" && !Array.isArray(row) && column in (row as Row) && Object.keys(row as Row).length === 1) row = (row as Row)[column];
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new UsageError(`${label} : ligne malformée.`);
  const r = row as Row;
  if (typeof r.code === "string" && /^[0-9A-Z]{5}$/.test(r.code) && typeof r.message === "string") throw new UsageError(`${label} : erreur SQL ${r.code} — ${r.message}`);
  if (typeof r.error === "string") throw new UsageError(`${label} : erreur — ${r.error}`);
  return r;
}
const ts = (v: unknown, label: string): number => {
  if (typeof v !== "string" || !v) throw new UsageError(`${label} manquant ou non textuel.`);
  const t = Date.parse(v);
  if (!Number.isFinite(t)) throw new UsageError(`${label} : horodatage illisible.`);
  return t / 1000;
};
export type BatchResult = {
  run: string;
  project: string;
  batchPid: number;
  tBegin: number;
  tLock: number;
  tBeforeRevoke: number;
  tRevoked: number;
  tAfterCommit: number;
  rpcOk: true;
  actorRole: string;
  actorUid: string;
  readback: { scope: string; grants: number };
  ids: { orgId: string; siteId: string; dossierId: string; ownerId: string; managerId: string };
};
export function parseBatchResult(raw: unknown, expected: { runId: string; project: string; ownerId: string; managerId: string; orgId: string; siteId: string; dossierId: string }): BatchResult {
  const r = singleRow(raw, "résultat du lot", "result");
  const str = (k: string) => {
    if (typeof r[k] !== "string" || !r[k]) throw new UsageError(`résultat du lot : ${k} manquant.`);
    return r[k] as string;
  };
  const run = str("run");
  const project = str("project");
  if (run !== expected.runId) throw new UsageError(`résultat du lot : run ${run} ≠ ${expected.runId}.`);
  if (project !== expected.project) throw new UsageError(`résultat du lot : projet ${project} ≠ ${expected.project}.`);
  const ids = { orgId: str("org_id"), siteId: str("site_id"), dossierId: str("dossier_id"), ownerId: str("owner_id"), managerId: str("manager_id") };
  for (const [k, v] of Object.entries(ids)) if (v !== expected[k as keyof typeof expected]) throw new UsageError(`résultat du lot : ${k} ≠ cohorte attendue.`);
  if (typeof r.batch_pid !== "number" || !Number.isInteger(r.batch_pid) || r.batch_pid <= 0) throw new UsageError("résultat du lot : batch_pid manquant ou invalide.");
  const tBegin = ts(r.t_begin, "t_begin");
  const tLock = ts(r.t_lock, "t_lock");
  const tBeforeRevoke = ts(r.t_before_revoke, "t_before_revoke");
  const tRevoked = ts(r.t_revoked, "t_revoked");
  const tAfterCommit = ts(r.t_after_commit, "t_after_commit");
  if (!(tBegin <= tLock && tLock <= tBeforeRevoke && tBeforeRevoke <= tRevoked && tRevoked < tAfterCommit)) throw new UsageError("résultat du lot : horodatages incohérents (t_begin ≤ t_lock ≤ t_before_revoke ≤ t_revoked < t_after_commit attendu).");
  if (tBeforeRevoke - tLock > REVOKE_PAUSE_S + 2) throw new UsageError(`résultat du lot : pause de ${(tBeforeRevoke - tLock).toFixed(1)} s > ${REVOKE_PAUSE_S} s (+2 s de marge) : fenêtre non conforme.`);
  if (r.rpc_ok !== true) throw new UsageError("résultat du lot : rpc_ok absent ou ≠ true.");
  if (r.actor_role !== "authenticated") throw new UsageError(`résultat du lot : actor_role ${String(r.actor_role)} ≠ authenticated (preuve de l’acteur).`);
  if (r.actor_uid !== expected.ownerId) throw new UsageError("résultat du lot : actor_uid ≠ propriétaire QA (preuve de l’acteur).");
  const rb = r.readback as Row | undefined;
  if (!rb || typeof rb !== "object" || Array.isArray(rb)) throw new UsageError("résultat du lot : readback manquant.");
  const grants = typeof rb.grants === "number" ? rb.grants : typeof rb.grants === "string" && /^\d+$/.test(rb.grants) ? Number(rb.grants) : NaN;
  if (rb.scope !== "selected" || grants !== 0) throw new UsageError(`résultat du lot : relecture post-commit non révoquée (scope ${String(rb.scope)}, grants ${String(rb.grants)}).`);
  return { run, project, batchPid: r.batch_pid, tBegin, tLock, tBeforeRevoke, tRevoked, tAfterCommit, rpcOk: true, actorRole: "authenticated", actorUid: expected.ownerId, readback: { scope: "selected", grants: 0 }, ids };
}
export type Observation = { tObserved: number; finalizePid: number; waitEventType: string; blockedBy: number[]; objectCount: number; objectName: string | null };
export function parseObservation(raw: unknown): Observation {
  const r = singleRow(raw, "observation", "row");
  const tObserved = ts(r.t_observed, "t_observed");
  if (typeof r.finalize_pid !== "number" || !Number.isInteger(r.finalize_pid)) throw new UsageError("observation : finalize_pid manquant.");
  if (typeof r.wait_event_type !== "string") throw new UsageError("observation : wait_event_type manquant.");
  const blocked = Array.isArray(r.blocked_by) ? r.blocked_by : typeof r.blocked_by === "string" ? r.blocked_by.replace(/[{}\s]/g, "").split(",").filter(Boolean).map(Number) : null;
  if (!blocked || blocked.some((x) => typeof x !== "number" || !Number.isInteger(x))) throw new UsageError("observation : blocked_by manquant ou illisible.");
  const count = typeof r.object_count === "number" ? r.object_count : typeof r.object_count === "string" && /^\d+$/.test(r.object_count) ? Number(r.object_count) : NaN;
  if (!Number.isInteger(count) || count < 0) throw new UsageError("observation : object_count manquant ou illisible.");
  if (!("object_name" in r)) throw new UsageError("observation : object_name manquant.");
  if (r.object_name !== null && typeof r.object_name !== "string") throw new UsageError("observation : object_name illisible.");
  if (count === 1 && (typeof r.object_name !== "string" || !r.object_name)) throw new UsageError("observation : object_count 1 sans object_name.");
  if (count !== 1 && r.object_name !== null) throw new UsageError("observation : object_name renseigné alors que object_count ≠ 1.");
  return { tObserved, finalizePid: r.finalize_pid, waitEventType: r.wait_event_type, blockedBy: blocked as number[], objectCount: count, objectName: (r.object_name as string | null) ?? null };
}
// ---- Verdict over the full condition set (a)–(g) ------------------------------------------------
export type RevokeInput = {
  batch: BatchResult | null;
  observation: Observation | null;
  parseErrors: string[];
  objectPath: string | null;
  discoveredAtMs: number | null;
  responseAtMs: number | null;
  response: { status: number; bodyText: string } | null;
  readbacks: { documentRows: number | null; objectPresent: boolean | null };
  forbidden: string[];
  managerId: string;
  // Object paths the harness itself discovered AND recorded in its manifest (mapping proof).
  manifestObjectPaths: string[];
};
export type RevokeVerdict = { outcome: "pass" | "fail" | "unknown"; conditions: Record<string, boolean | null>; reasons: string[] };
export function revokeVerdict(i: RevokeInput): RevokeVerdict {
  const c: Record<string, boolean | null> = { "a) observation : finalisation bloquée par le lot, objet exact visible, dans [t_lock, t_before_revoke]": null, "b) RPC réussi et révocation commitée (relecture post-commit)": null, "c) réponse 403 enveloppe gateway sans fuite, objet absent, aucune ligne documents": null, "d) objet découvert avant la réponse": null, "f) ligne finale et observation acceptées par le parseur": null, "g) preuve de l’acteur (actor_role/actor_uid)": null };
  const reasons: string[] = [];
  const keys = Object.keys(c);
  const [A, B, C, D, F, G] = keys;
  // Unknown outcome first: no response, 5xx, or transport — nothing can be concluded, nothing deleted on a timer.
  if (!i.response) {
    reasons.push("aucune réponse HTTP (transport/interruption) : issue inconnue");
    return { outcome: "unknown", conditions: c, reasons };
  }
  if (i.response.status >= 500) {
    reasons.push(`HTTP ${i.response.status} : issue inconnue (objet possiblement conservé par le gateway)`);
    return { outcome: "unknown", conditions: c, reasons };
  }
  c[F] = i.parseErrors.length === 0 && i.batch !== null && i.observation !== null;
  if (!c[F]) for (const e of i.parseErrors) reasons.push(`parseur : ${e}`);
  if (i.batch) {
    c[G] = i.batch.actorRole === "authenticated" && UUID.test(i.batch.actorUid);
    c[B] = i.batch.rpcOk && i.batch.readback.scope === "selected" && i.batch.readback.grants === 0;
  }
  if (i.batch && i.observation) {
    const o = i.observation;
    const inWindow = i.batch.tLock <= o.tObserved && o.tObserved <= i.batch.tBeforeRevoke;
    const blocked = o.waitEventType === "Lock" && o.blockedBy.includes(i.batch.batchPid);
    // Exact object proof: one object under the cohort prefix, its exact name equal to the path the harness
    // discovered, that path under the manager uid and recorded in the manifest. The prefix alone never proves.
    const mapped = i.objectPath !== null && i.objectPath.startsWith(`${i.managerId}/`) && UUID.test(i.objectPath.slice(i.managerId.length + 1)) && i.manifestObjectPaths.includes(i.objectPath);
    const exact = o.objectCount === 1 && o.objectName !== null && o.objectName === i.objectPath && mapped;
    c[A] = inWindow && blocked && exact;
    if (!inWindow) reasons.push(`observation hors fenêtre : t_observed ${new Date(o.tObserved * 1000).toISOString()} ∉ [t_lock, t_before_revoke]`);
    if (!blocked) reasons.push(`finalisation non bloquée par le lot (wait ${o.waitEventType}, blocked_by ${o.blockedBy.join(",") || "∅"}, batch_pid ${i.batch.batchPid}) : fenêtre non exercée`);
    if (o.objectCount !== 1) reasons.push(`observation : ${o.objectCount} objet(s) sous le préfixe de la cohorte au lieu d’exactement 1 : non-preuve`);
    else if (o.objectName !== i.objectPath) reasons.push(`objet observé ${o.objectName ?? "∅"} ≠ objet découvert ${i.objectPath ?? "∅"} : non-preuve`);
    if (o.objectCount === 1 && o.objectName === i.objectPath && !mapped) reasons.push("objet découvert non rattaché au manifeste (chemin hors uid du gestionnaire ou non enregistré) : non-preuve");
  }
  c[D] = i.objectPath !== null && i.discoveredAtMs !== null && i.responseAtMs !== null && i.discoveredAtMs < i.responseAtMs;
  if (i.objectPath === null) reasons.push("objet jamais observé pendant la fenêtre : fenêtre non exercée");
  else if (!c[D]) reasons.push("objet découvert après la réponse : ordre non prouvé");
  const status = i.response.status;
  if (status === 201) {
    c[C] = false;
    reasons.push("201 : la révocation a perdu la course (fait documenté, pas un PASS) ; la ligne créée est nettoyée par le manifeste");
  } else if (status === 403) {
    const envelope = /"error"\s*:\s*"/.test(i.response.bodyText);
    const leaks = leakCheck(i.response.bodyText, i.forbidden);
    const absent = i.readbacks.objectPresent === false && i.readbacks.documentRows === 0;
    c[C] = envelope && leaks.length === 0 && absent;
    if (!envelope) reasons.push("403 sans enveloppe gateway");
    for (const hit of leaks) reasons.push(`fuite : ${hit}`);
    if (i.readbacks.objectPresent !== false) reasons.push(i.readbacks.objectPresent === null ? "relecture Storage inconnue" : "objet encore présent après 403 (compensation absente)");
    if (i.readbacks.documentRows !== 0) reasons.push(i.readbacks.documentRows === null ? "relecture documents inconnue" : `${i.readbacks.documentRows} ligne(s) documents après 403`);
  } else {
    c[C] = false;
    reasons.push(`statut ${status} au lieu de 403`);
  }
  const outcome = keys.every((k) => c[k] === true) ? "pass" : "fail";
  return { outcome, conditions: c, reasons };
}
// ---- Orchestration ------------------------------------------------------------------------------
export type RevokeDeps = {
  now(): number;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  runId: string;
  project: string;
  projectUrl: string;
  manifestPath: string;
  statePath: string;
  batchSqlPath: string;
  observeSqlPath: string;
  liveCommand: string;
  templates: { batch: string; observe: string };
  randomPassword(): string;
  listUserEmails(): Promise<{ ok: boolean; emails: string[]; detail: string }>;
  createUser(email: string, password: string, role: "manager"): Promise<{ status: number; id: string | null; detail: string }>;
  passwordGrant(email: string, password: string): Promise<{ status: number; json: Record<string, unknown> | null; detail: string }>;
  rpc(token: string, fn: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown; detail: string }>;
  serviceInsert(table: string, row: Record<string, unknown>): Promise<{ status: number; detail: string }>;
  serviceRows(query: string): Promise<{ ok: boolean; rows: Record<string, unknown>[]; detail: string }>;
  userRows(token: string, query: string): Promise<{ ok: boolean; rows: Record<string, unknown>[]; detail: string }>;
  upload(token: string, dossierId: string): Promise<{ status: number; text: string }>;
  getUser(userId: string): Promise<{ status: number; json: Record<string, unknown> | null }>;
  readManifest(path: string): Promise<Manifest>;
  record(kind: CreatedKind, value: string, extra?: ManifestExtra): Promise<void>;
  recordValidated(kind: CreatedKind, value: string): Promise<void>;
  addSecret(secret: string): void;
  forbidden(): string[];
  client: CleanupClient;
  writeState(state: RevokeState, target: "out" | "original"): Promise<void>;
  writeSql(path: string, text: string): Promise<void>;
  readResultFile(path: string): Promise<unknown | null>;
  log(status: StepStatus, step: string, detail: string): Promise<void>;
};
export type RevokePrepareOutcome = { outcome: "prepared" | "fail" | "refused"; state: RevokeState | null };
export async function revokePrepare(deps: RevokeDeps): Promise<RevokePrepareOutcome> {
  const listing = await deps.listUserEmails();
  if (!listing.ok) {
    await deps.log("fail", "garde autre rédacteur : listage Auth impossible", listing.detail);
    return { outcome: "refused", state: null };
  }
  const others = otherWriters(listing.emails, deps.runId);
  if (others.length) {
    await deps.log("fail", "garde autre rédacteur : refus (rien créé)", `${others.length} compte(s) qa-gw hors run (autre cohorte ou bail d’expiration en attente) : jamais effacés pour passer`);
    return { outcome: "refused", state: null };
  }
  await deps.log("pass", "garde autre rédacteur : aucun compte qa-gw étranger", `${listing.emails.length} compte(s) listés`);
  const password = deps.randomPassword();
  deps.addSecret(password);
  const users: Record<"owner" | "manager", string> = { owner: "", manager: "" };
  const tokens: Record<"owner" | "manager", string> = { owner: "", manager: "" };
  let managerExp = 0;
  for (const role of ["owner", "manager"] as const) {
    const email = revokeEmail(deps.runId, role);
    const created = await deps.createUser(email, password, "manager");
    if (created.status >= 300 || !created.id) {
      await deps.log("fail", `compte QA ${role}`, `création → HTTP ${created.status} ${created.detail}`);
      return { outcome: "fail", state: null };
    }
    users[role] = created.id;
    await deps.record("userIds", created.id, { suite: "revoke" });
    const grant = await deps.passwordGrant(email, password);
    const token = typeof grant.json?.access_token === "string" ? grant.json.access_token : null;
    if (grant.status !== 200 || !token) {
      await deps.log("fail", `jeton QA ${role}`, `HTTP ${grant.status} ${grant.detail}`);
      return { outcome: "fail", state: null };
    }
    deps.addSecret(token);
    if (typeof grant.json?.refresh_token === "string") deps.addSecret(grant.json.refresh_token);
    tokens[role] = token;
    const claims = decodeJwtClaims(token);
    if (role === "manager") managerExp = typeof claims?.exp === "number" ? claims.exp : 0;
    await deps.log("pass", `compte QA ${role} créé, jeton réel obtenu`, created.id);
  }
  const site = await deps.rpc(tokens.owner, "create_site", { p_name: `Site QA ${deps.runId}`, p_type: "office", p_address: "2 avenue du Test QA", p_budget_cents: 100000, p_organization_id: null });
  const siteRow = site.json && typeof site.json === "object" ? (site.json as Row) : null;
  if (site.status >= 300 || typeof siteRow?.id !== "string" || typeof siteRow?.organization_id !== "string") {
    await deps.log("fail", "create_site (propriétaire QA)", `HTTP ${site.status} ${site.detail}`);
    return { outcome: "fail", state: null };
  }
  const orgId = siteRow.organization_id as string;
  const siteId = siteRow.id as string;
  await deps.record("organizationIds", orgId);
  await deps.record("siteIds", siteId);
  const member = await deps.serviceInsert("organization_members", { organization_id: orgId, user_id: users.manager, role: "manager" });
  if (member.status >= 300) {
    await deps.log("fail", "membre gestionnaire QA (écriture de seeding)", `HTTP ${member.status} ${member.detail}`);
    return { outcome: "fail", state: null };
  }
  const access = await deps.rpc(tokens.owner, "set_organization_member_site_access", { p_organization_id: orgId, p_user_id: users.manager, p_scope: "selected", p_grants: [{ site_id: siteId, can_write: true }] });
  if (access.status >= 300) {
    await deps.log("fail", "grant can_write du gestionnaire QA (RPC du propriétaire)", `HTTP ${access.status} ${access.detail}`);
    return { outcome: "fail", state: null };
  }
  const job = await deps.rpc(tokens.owner, "create_intervention", { p_category: "panel", p_description: `QA révocation ${deps.runId} : dossier de site.`, p_address: "2 avenue du Test QA", p_postal_code: "97200", p_city: "Fort-de-France", p_urgency: SEED_URGENCY, p_site_id: siteId });
  const jobRow = job.json && typeof job.json === "object" ? (job.json as Row) : null;
  if (job.status >= 300 || typeof jobRow?.id !== "string") {
    await deps.log("fail", "create_intervention (dossier de site QA)", `HTTP ${job.status} ${job.detail}`);
    return { outcome: "fail", state: null };
  }
  const dossierId = jobRow.id as string;
  await deps.record("interventionIds", dossierId);
  await deps.log("pass", "organisation, site, membre gestionnaire (selected + 1 grant can_write), dossier de site", `${orgId} / ${siteId} / ${dossierId}`);
  // Guards read back through the service role (the batch re-checks them under root).
  const checks: [string, string, (rows: Row[]) => boolean][] = [
    ["organisation QA possédée par le propriétaire", `organizations?id=eq.${orgId}&select=id,owner_id`, (rows) => rows.length === 1 && rows[0].owner_id === users.owner],
    ["site QA dans l’organisation", `sites?id=eq.${siteId}&select=id,organization_id`, (rows) => rows.length === 1 && rows[0].organization_id === orgId],
    ["dossier QA sur le site, demandeur = propriétaire, aucun artisan", `interventions?id=eq.${dossierId}&select=id,site_id,client_id,artisan_id`, (rows) => rows.length === 1 && rows[0].site_id === siteId && rows[0].client_id === users.owner && !rows[0].artisan_id],
    ["membre gestionnaire QA (role manager)", `organization_members?organization_id=eq.${orgId}&user_id=eq.${users.manager}&select=role`, (rows) => rows.length === 1 && rows[0].role === "manager"],
    ["portée selected", `organization_member_site_scopes?organization_id=eq.${orgId}&user_id=eq.${users.manager}&select=scope`, (rows) => rows.length === 1 && rows[0].scope === "selected"],
    ["un seul grant can_write sur le site QA", `organization_member_site_grants?organization_id=eq.${orgId}&user_id=eq.${users.manager}&select=site_id,can_write`, (rows) => rows.length === 1 && rows[0].site_id === siteId && rows[0].can_write === true],
    ["aucun admin dans la cohorte", `profiles?id=in.(${users.owner},${users.manager})&select=id,role`, (rows) => rows.length === 2 && rows.every((r) => r.role !== "admin")],
  ];
  for (const [label, query, test] of checks) {
    const r = await deps.serviceRows(query);
    const ok = r.ok && test(r.rows);
    await deps.log(ok ? "pass" : "fail", `garde : ${label}`, r.ok ? `${r.rows.length} ligne(s)` : r.detail);
    if (!ok) return { outcome: "fail", state: null };
  }
  const visible = await deps.userRows(tokens.manager, `interventions?id=eq.${dossierId}&select=id`);
  await deps.log(visible.ok && visible.rows.length === 1 ? "pass" : "fail", "le gestionnaire QA lit le dossier sous RLS avant révocation (lecture seule)", visible.detail);
  if (!visible.ok || visible.rows.length !== 1) return { outcome: "fail", state: null };
  const ids: RevokeIds = { RUN: deps.runId, PROJECT: deps.project, ORG: orgId, SITE: siteId, DOSSIER: dossierId, OWNER: users.owner, MANAGER: users.manager };
  await deps.writeSql(deps.batchSqlPath, renderSqlTemplate(deps.templates.batch, ids));
  await deps.writeSql(deps.observeSqlPath, renderSqlTemplate(deps.templates.observe, ids));
  const state: RevokeState = { version: 1, suite: "revoke", runId: deps.runId, project: deps.project, ownerId: users.owner, managerId: users.manager, orgId, siteId, dossierId, managerToken: tokens.manager, managerTokenExp: managerExp, preparedAt: deps.now(), manifestPath: deps.manifestPath, batchSqlPath: deps.batchSqlPath, observeSqlPath: deps.observeSqlPath };
  await deps.record("userIds", users.owner, { suite: "revoke", revoke: { ownerId: users.owner, managerId: users.manager, orgId, siteId, dossierId, ownerEmail: revokeEmail(deps.runId, "owner"), managerEmail: revokeEmail(deps.runId, "manager"), tokenSha256: await sha256Hex(tokens.manager) } });
  await deps.writeState(state, "out");
  await deps.log("info", "PREPARED — rien n’est prouvé ; lot et observation rendus pour revue root", `lot ${deps.batchSqlPath} ; observation ${deps.observeSqlPath} ; jeton gestionnaire exp ${new Date(managerExp * 1000).toISOString()} ; phase live : ${deps.liveCommand}`);
  return { outcome: "prepared", state };
}
export type RevokeLiveOutcome = { outcome: "pass" | "fail" | "unknown" | "refused"; cleanup: boolean; verdict: RevokeVerdict | null; objectPath: string | null; responseStatus: number | null; unverifiedEntities?: string[] };
// Remote proof of the entity chain BEFORE any of them may be recorded for deletion (root P1 on 13b68c3):
// each entity is re-read with the service client and must belong to the validated cohort —
// org.owner_id = QA owner, member manager of that org, site.organization_id = org and name of the run,
// dossier.site_id = site, dossier.client_id = QA owner and description of the run — and be listed in
// the manifest's created lists. A child is only considered once its parent is proven. Any unknown,
// failed or mismatched read leaves that entity (and its dependants) UNRECORDED: never deleted.
export type EntityProof = { proven: { kind: CreatedKind; id: string }[]; unverified: string[] };
export async function proveRevokeEntities(state: RevokeState, manifest: Manifest, deps: Pick<RevokeDeps, "serviceRows">): Promise<EntityProof> {
  const proven: { kind: CreatedKind; id: string }[] = [];
  const unverified: string[] = [];
  const one = async (label: string, query: string, test: (row: Row) => string | null): Promise<boolean> => {
    let r: { ok: boolean; rows: Row[]; detail: string };
    try {
      r = await deps.serviceRows(query);
    } catch (error) {
      r = { ok: false, rows: [], detail: error instanceof Error ? error.message : String(error) };
    }
    if (!r.ok) {
      unverified.push(`${label} : lecture en erreur (${r.detail})`);
      return false;
    }
    if (r.rows.length !== 1) {
      unverified.push(`${label} : ${r.rows.length} ligne(s) au lieu d’une`);
      return false;
    }
    const why = test(r.rows[0]);
    if (why) unverified.push(`${label} : ${why}`);
    return why === null;
  };
  const inManifest = (kind: CreatedKind, id: string) => manifest.created[kind].includes(id);
  const orgOk =
    inManifest("organizationIds", state.orgId) &&
    (await one("organisation", `organizations?id=eq.${state.orgId}&select=id,owner_id`, (r) => (r.id !== state.orgId ? "id différent" : r.owner_id !== state.ownerId ? "propriétaire ≠ propriétaire QA validé" : null))) &&
    (await one("membre gestionnaire QA", `organization_members?organization_id=eq.${state.orgId}&user_id=eq.${state.managerId}&select=organization_id,user_id,role`, (r) => (r.organization_id !== state.orgId || r.user_id !== state.managerId ? "rattachement différent" : r.role !== "manager" ? `rôle ${String(r.role)} ≠ manager` : null)));
  if (!inManifest("organizationIds", state.orgId)) unverified.push("organisation absente des créations du manifeste");
  if (!orgOk) {
    unverified.push("site et dossier non évalués (organisation non prouvée)");
    return { proven, unverified };
  }
  proven.push({ kind: "organizationIds", id: state.orgId });
  const siteOk =
    inManifest("siteIds", state.siteId) &&
    (await one("site", `sites?id=eq.${state.siteId}&select=id,organization_id,name`, (r) => (r.id !== state.siteId ? "id différent" : r.organization_id !== state.orgId ? "organisation ≠ organisation QA" : r.name !== `Site QA ${state.runId}` ? "nom ≠ site du run" : null)));
  if (!inManifest("siteIds", state.siteId)) unverified.push("site absent des créations du manifeste");
  if (!siteOk) {
    unverified.push("dossier non évalué (site non prouvé)");
    return { proven, unverified };
  }
  proven.push({ kind: "siteIds", id: state.siteId });
  const dossierOk =
    inManifest("interventionIds", state.dossierId) &&
    (await one("dossier", `interventions?id=eq.${state.dossierId}&select=id,site_id,client_id,description`, (r) => (r.id !== state.dossierId ? "id différent" : r.site_id !== state.siteId ? "site ≠ site QA" : r.client_id !== state.ownerId ? "demandeur ≠ propriétaire QA validé" : typeof r.description !== "string" || !r.description.startsWith(`QA révocation ${state.runId}`) ? "description ≠ dossier du run" : null)));
  if (!inManifest("interventionIds", state.dossierId)) unverified.push("dossier absent des créations du manifeste");
  if (dossierOk) proven.push({ kind: "interventionIds", id: state.dossierId });
  return { proven, unverified };
}
export async function revokeLive(state: RevokeState, deps: RevokeDeps, files: { batchResultPath: string; observationPath: string }): Promise<RevokeLiveOutcome> {
  const refused = async (step: string, detail: string): Promise<RevokeLiveOutcome> => {
    await deps.log("fail", `live refusé : ${step} — aucune suppression, aucun identifiant enregistré`, detail);
    return { outcome: "refused", cleanup: false, verdict: null, objectPath: null, responseStatus: null };
  };
  deps.addSecret(state.managerToken);
  if (state.consumedAt !== undefined) return refused("état déjà consommé", new Date(state.consumedAt * 1000).toISOString());
  const listing = await deps.listUserEmails();
  if (!listing.ok) return refused("garde autre rédacteur : listage Auth impossible", listing.detail);
  const others = otherWriters(listing.emails, state.runId);
  if (others.length) return refused("garde autre rédacteur", `${others.length} compte(s) qa-gw hors run`);
  let manifest: Manifest;
  try {
    manifest = await deps.readManifest(state.manifestPath);
  } catch (error) {
    return refused("manifeste de l’état illisible", error instanceof Error ? error.message : String(error));
  }
  const m = manifest.revoke;
  const mismatch: string[] = [];
  if (manifest.runId !== state.runId || manifest.project !== state.project) mismatch.push("run/projet du manifeste ≠ état");
  if (manifest.suite !== "revoke" || !m) mismatch.push("manifeste sans données de révocation");
  else {
    if (m.tokenSha256 !== (await sha256Hex(state.managerToken))) mismatch.push("empreinte du jeton gestionnaire ≠ manifeste");
    for (const k of ["ownerId", "managerId", "orgId", "siteId", "dossierId"] as const) if (m[k] !== state[k]) mismatch.push(`${k} ≠ manifeste`);
    if (!manifest.created.userIds.includes(state.ownerId) || !manifest.created.userIds.includes(state.managerId)) mismatch.push("uids absents du manifeste");
    if (!isRevokeCohortEmail(m.ownerEmail, state.runId, "owner") || !isRevokeCohortEmail(m.managerEmail, state.runId, "manager")) mismatch.push("e-mails du manifeste hors cohorte");
  }
  const claims = decodeJwtClaims(state.managerToken);
  if (!claims || claims.sub !== state.managerId || claims.iss !== `${deps.projectUrl}/auth/v1` || claims.exp !== state.managerTokenExp) mismatch.push("claims du jeton gestionnaire ≠ état");
  if (mismatch.length) return refused("cohérence état ↔ manifeste ↔ claims", mismatch.join(" ; "));
  for (const [role, uid] of [["owner", state.ownerId], ["manager", state.managerId]] as const) {
    const u = await deps.getUser(uid);
    const email = typeof u.json?.email === "string" ? u.json.email.toLowerCase() : "";
    if (u.status !== 200 || u.json?.id !== uid || !isRevokeCohortEmail(email, state.runId, role) || email !== (m as ManifestRevoke)[`${role}Email`].toLowerCase()) return refused(`preuve de cohorte Auth (${role})`, `HTTP ${u.status}`);
  }
  await deps.log("pass", "preuve de cohorte Auth : propriétaire et gestionnaire QA (suppression autorisée)", `run ${state.runId}`);
  // Durable record of the Auth-proven QA accounts BEFORE any further network call.
  for (const value of [state.ownerId, state.managerId]) await deps.recordValidated("userIds", value);
  // Entities are recorded only after their remote chain proof; an unproven entity is never recorded.
  const entities = await proveRevokeEntities(state, manifest, deps);
  for (const e of entities.proven) await deps.recordValidated(e.kind, e.id);
  if (entities.unverified.length) {
    await deps.log("fail", "preuve distante des entités de la cohorte incomplète : entités non prouvées NON enregistrées, jamais supprimées ; upload non tenté", entities.unverified.join(" ; "));
    return { outcome: "fail", cleanup: true, verdict: null, objectPath: null, responseStatus: null, unverifiedEntities: entities.unverified };
  }
  await deps.log("pass", "preuve distante des entités : organisation (propriétaire QA, membre gestionnaire), site (organisation, nom du run), dossier (site, demandeur, description du run)", entities.proven.map((e) => e.kind).join(", "));
  if (state.managerTokenExp <= deps.now() + 30) {
    await deps.log("fail", "jeton gestionnaire expiré ou trop proche de l’échéance : upload non tenté", new Date(state.managerTokenExp * 1000).toISOString());
    return { outcome: "fail", cleanup: true, verdict: null, objectPath: null, responseStatus: null };
  }
  // ONE real upload (JPEG) with the manager's JWT, response not awaited yet; discovery of the exact object
  // under the sole authorised prefix, every 250 ms for at most 3 s.
  const started = deps.nowMs();
  const responsePromise = deps.upload(state.managerToken, state.dossierId).then((r) => ({ ok: true as const, r, at: deps.nowMs() }), (error) => ({ ok: false as const, error, at: deps.nowMs() }));
  let objectPath: string | null = null;
  let discoveredAtMs: number | null = null;
  const manifestObjectPaths: string[] = [];
  while (deps.nowMs() - started <= REVOKE_DISCOVERY_MS && objectPath === null) {
    const listing = await deps.client.listObjects(state.managerId, { limit: 1000, offset: 0 });
    if (listing.ok) {
      const name = listing.items.find((n) => UUID.test(n));
      if (name) {
        objectPath = `${state.managerId}/${name}`;
        discoveredAtMs = deps.nowMs();
        await deps.record("objectPaths", objectPath);
        manifestObjectPaths.push(objectPath);
        await deps.log("pass", "objet Storage découvert pendant la fenêtre (préfixe du gestionnaire QA)", `${discoveredAtMs - started} ms après l’envoi`);
        break;
      }
    }
    await deps.sleep(REVOKE_DISCOVERY_STEP_MS);
  }
  if (objectPath === null) await deps.log("fail", "objet jamais observé pendant la fenêtre de découverte", `${REVOKE_DISCOVERY_MS} ms`);
  const settled = await responsePromise;
  const response = settled.ok ? { status: settled.r.status, bodyText: settled.r.text } : null;
  const responseAtMs = settled.at;
  if (!settled.ok) await deps.log("fail", "réponse HTTP absente (transport/interruption) : issue inconnue", settled.error instanceof Error ? settled.error.message : String(settled.error));
  else await deps.log("info", "réponse du gateway reçue", `HTTP ${settled.r.status} ${responseAtMs - started} ms après l’envoi`);
  // Readbacks (service role): document rows for this object/dossier, exact object presence.
  let documentRows: number | null = null;
  let objectPresent: boolean | null = null;
  if (objectPath) {
    const docs = await deps.serviceRows(`documents?intervention_id=eq.${state.dossierId}&select=id,path,owner_id`);
    documentRows = docs.ok ? docs.rows.filter((d) => d.path === objectPath || d.owner_id === state.managerId).length : null;
    for (const d of docs.ok ? docs.rows : []) if (typeof d.id === "string") await deps.record("documentIds", d.id);
    const name = objectPath.slice(state.managerId.length + 1);
    const l = await deps.client.listObjects(state.managerId, { limit: 1000, offset: 0, search: name });
    objectPresent = l.ok && !l.malformed?.length ? l.items.includes(name) : null;
    await deps.log("info", "relectures après réponse", `documents ${documentRows ?? "inconnu"} ; objet ${objectPresent === null ? "inconnu" : objectPresent ? "présent" : "absent"}`);
  }
  // Bounded wait for the two pilot files (batch final row, observation row).
  let batchRaw: unknown = null;
  let observationRaw: unknown = null;
  const waitStart = deps.nowMs();
  while (deps.nowMs() - waitStart <= REVOKE_RESULT_WAIT_MS && (batchRaw === null || observationRaw === null)) {
    if (batchRaw === null) batchRaw = await deps.readResultFile(files.batchResultPath);
    if (observationRaw === null) observationRaw = await deps.readResultFile(files.observationPath);
    if (batchRaw === null || observationRaw === null) await deps.sleep(REVOKE_RESULT_STEP_MS);
  }
  const parseErrors: string[] = [];
  let batch: BatchResult | null = null;
  let observation: Observation | null = null;
  if (batchRaw === null) parseErrors.push("résultat du lot non fourni dans le délai");
  else {
    try {
      batch = parseBatchResult(batchRaw, { runId: state.runId, project: state.project, ownerId: state.ownerId, managerId: state.managerId, orgId: state.orgId, siteId: state.siteId, dossierId: state.dossierId });
    } catch (error) {
      parseErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (observationRaw === null) parseErrors.push("observation non fournie dans le délai");
  else {
    try {
      observation = parseObservation(observationRaw);
    } catch (error) {
      parseErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const verdict = revokeVerdict({ batch, observation, parseErrors, objectPath, discoveredAtMs, responseAtMs, response, readbacks: { documentRows, objectPresent }, forbidden: deps.forbidden(), managerId: state.managerId, manifestObjectPaths });
  await deps.log(verdict.outcome === "pass" ? "pass" : verdict.outcome === "unknown" ? "fail" : "fail", `verdict révocation pendant upload : ${verdict.outcome}`, verdict.reasons.join(" ; ") || "toutes les conditions (a)–(g) satisfaites");
  await deps.writeState({ ...state, consumedAt: deps.now() }, "original");
  return { outcome: verdict.outcome, cleanup: true, verdict, objectPath, responseStatus: response?.status ?? null };
}
