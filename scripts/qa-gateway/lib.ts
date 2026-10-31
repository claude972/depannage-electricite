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
  help: boolean;
};
export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    functionUrl: "",
    project: "",
    credentials: "",
    out: "",
    dryRun: false,
    cleanupManifest: "",
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
export type Manifest = { version: 1; runId: string; project: string; updatedAt: string; created: Created; unknown: Unknown[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OBJECT_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i;
export function manifestJson(runId: string, project: string, created: Created, now: Date, unknown: Unknown[] = []): string {
  const manifest: Manifest = { version: 1, runId, project, updatedAt: now.toISOString(), created, unknown };
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
  return { version: 1, runId: m.runId, project: m.project, updatedAt: String(m.updatedAt ?? ""), created, unknown };
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
export type Page<T> = { ok: true; items: T[]; total: number | null; detail: string } | { ok: false; detail: string };
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
      if (page.items.length < pageSize) return;
      offset += page.items.length;
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
// Always: discover -> persist merged manifest -> (only if every read is known) delete in FK
// order, Storage objects first. A single unknown read forbids any deletion and the clean verdict.
export async function runCleanup(client: CleanupClient, created: Created, hooks: CleanupHooks, options: DiscoveryOptions & { manifestPath?: string } = {}): Promise<CleanupOutcome> {
  let discovery: Discovery;
  try {
    discovery = await discoverCohort(client, created, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    discovery = { created: cloneCreated(created), added: { documentIds: [], objectPaths: [] }, unknown: [{ scope: "découverte de cohorte", detail }], complete: false };
  }
  await hooks.saveManifest(discovery.created, discovery.unknown);
  const entries: CleanupEntry[] = [];
  const leftovers: string[] = [];
  const counts = `${discovery.added.documentIds.length} ligne(s) documents et ${discovery.added.objectPaths.length} objet(s) Storage ajoutés au manifeste`;
  if (!discovery.complete) {
    for (const u of discovery.unknown) leftovers.push(unknownLeftover(u));
    await hooks.note("fail", "découverte de cohorte incomplète avant nettoyage", `${counts} ; ${discovery.unknown.length} lecture(s) inconnue(s) : ${discovery.unknown.map((u) => `${u.scope} (${u.detail})`).join(" ; ")} — ${cleanupRerunMessage(options.manifestPath ?? "<manifest.json>")}`);
    return { created: discovery.created, discovery, entries, leftovers, clean: false };
  }
  await hooks.note("pass", "découverte de cohorte avant nettoyage", `${counts} ; lectures complètes`);
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
          if (!listing.ok) readbackFailed = true;
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
export function assertScenario(
  scenario: Scenario,
  actual: { status: number; bodyText: string; document?: { id?: unknown } | null },
  forbidden: string[],
): Verdict {
  const reasons: string[] = [];
  if (actual.status !== scenario.expected) reasons.push(`statut ${actual.status} au lieu de ${scenario.expected}`);
  if (scenario.expected >= 400) {
    for (const hit of leakCheck(actual.bodyText, forbidden)) reasons.push(`fuite : ${hit}`);
    if (!/"error"\s*:\s*"/.test(actual.bodyText)) reasons.push("corps d’erreur sans message");
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
  mode: "run" | "dry-run" | "cleanup-manifest";
  startedAt: string;
  finishedAt: string | null;
  steps: StepRecord[];
  scenarios: { name: string; expected: number; status: number | null; pass: boolean | null; reasons: string[] }[];
  cleanup: { label: string; ok: boolean; remaining: number | null; detail: string }[];
  leftovers: string[];
  verdict: "pass" | "fail" | "incomplete";
};
// Any failed step (scenario, readback, cleanup) fails the run; later successes never mask it.
export function computeVerdict(result: Pick<RunResult, "steps" | "scenarios" | "cleanup" | "leftovers" | "mode">, finished: boolean): RunResult["verdict"] {
  if (!finished) return "incomplete";
  if (result.steps.some((s) => s.status === "fail")) return "fail";
  if (result.cleanup.some((c) => !c.ok) || result.leftovers.length) return "fail";
  if (result.mode === "run") {
    if (result.scenarios.some((s) => s.pass === null)) return "incomplete";
    if (result.scenarios.some((s) => s.pass === false)) return "fail";
  }
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
  const mode = result.mode === "dry-run" ? "DRY RUN (aucune écriture distante)" : result.mode === "cleanup-manifest" ? "nettoyage depuis un manifeste" : "exécution réelle sur la base dédiée";
  lines.push(`Projet : ${result.project} · ${mode} · début ${result.startedAt} · fin ${result.finishedAt ?? "en cours"} · verdict **${result.verdict}**`);
  lines.push("");
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
