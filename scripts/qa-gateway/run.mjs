#!/usr/bin/env node
// Cloud QA harness for the deployed native-document-upload Edge Function.
// Node 24, ESM, fetch only (no SDK). Usage:
//   node scripts/qa-gateway/run.mjs --function-url https://<ref>.supabase.co/functions/v1/native-document-upload \
//     --project <ref> --credentials /private/creds.json --out /private/out-dir [--dry-run]
//   node scripts/qa-gateway/run.mjs --cleanup-manifest /private/out-dir/manifest.json --project <ref> \
//     --credentials /private/creds.json --out /private/out-dir-2
// creds.json: {"url":"https://<ref>.supabase.co","publishable_key":"…","service_role_key":"…"}
// Never prints tokens or headers; summary.md / result.json are redacted; run.log and
// manifest.json are 0600. Any failed step (scenario, readback, cleanup) fails the run.
// --suite expiry-prepare | expiry-verify (QA-GW-EXPIRED-REVOKE-003 §1): real JWT expiry in two
// phases without blocking wait; see docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md.
// Cleanup (every path: normal end, HTTP timeout, SIGINT/SIGTERM, unhandled error,
// --cleanup-manifest) first discovers the cohort's `documents` rows and Storage objects, merges
// them into the manifest, and deletes nothing while any read is unknown (GW-HARNESS-003).
import { mkdir, chmod, writeFile, readFile, appendFile, rename, lstat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  UsageError,
  parseArgs,
  normalizeCredentials,
  assertCredentialsProject,
  assertFunctionProject,
  runId as makeRunId,
  COHORT_ROLES,
  SEED_URGENCY,
  cohortEmail,
  cohortProfileRole,
  cohortPassword,
  makeRedactor,
  emptyCreated,
  manifestJson,
  parseManifest,
  scenarioPlan,
  fixtures,
  assertScenario,
  summaryMarkdown,
  computeVerdict,
  parseContentRangeTotal,
  discoverCohort,
  runCleanup,
  interruptGuard,
  unknownLeftover,
  cleanupRerunMessage,
  parseStorageListing,
  expiryPrepare,
  expiryVerify,
  parseLease,
  checkPrivatePath,
  revokePrepare,
  revokeLive,
  parseRevokeState,
  listAllUserEmails,
  parseTotalHeader,
} from "./lib.ts";

const BUCKET = "intervention-documents";
const TIMEOUT_MS = 30000;
// Late reconciliation window after an aborted/timed-out phase (and on --cleanup-manifest):
// 2 s, 4 s, 8 s, 16 s between re-discoveries, i.e. up to 30 s — the HTTP timeout — for a
// request whose outcome was unknown to settle remotely.
const RECONCILE = { attempts: 4, baseDelayMs: 2000, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

// Injectable runtime (tests drive the FULL cycle — preflight, seed, verify, interruption, finally
// cleanup — with a fake fetch, a fake clock and fast reconcile timings; production uses the defaults).
export function defaultDeps() {
  return {
    fetch: (url, init) => fetch(url, init),
    now: () => Math.floor(Date.now() / 1000),
    reconcile: RECONCILE,
    on: (event, handler) => process.on(event, handler),
    exit: (code) => process.exit(code),
    print: (line) => console.log(line),
  };
}

export async function main(argv, deps = defaultDeps()) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      usage();
      return 2;
    }
    throw error;
  }
  if (args.help) {
    usage();
    return 0;
  }
  let credentials;
  try {
    credentials = normalizeCredentials(JSON.parse(await readFile(args.credentials, "utf8")));
    assertCredentialsProject(args.project, credentials.url);
    if (!args.cleanupManifest) assertFunctionProject(args.project, args.functionUrl);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  // Additive, selectable suites: the nine nominal scenarios run only without --suite.
  const mode = args.cleanupManifest ? "cleanup-manifest" : args.dryRun ? "dry-run" : args.suite === "expiry-prepare" ? "expiry-prepare" : args.suite === "expiry-verify" ? "expiry-verify" : args.suite === "revoke-prepare" ? "revoke-prepare" : args.suite === "revoke-live" ? "revoke-live" : "run";

  await mkdir(args.out, { recursive: true, mode: 0o700 });
  await chmod(args.out, 0o700);
  const logPath = path.join(args.out, "run.log");
  const manifestPath = path.join(args.out, "manifest.json");
  const leasePath = path.join(args.out, "lease.json");
  const revokeStatePath = path.join(args.out, "revoke.json");
  const batchSqlPath = path.join(args.out, "revoke-live-batch.sql");
  const observeSqlPath = path.join(args.out, "revoke-live-observe.sql");
  const liveCommand = `node scripts/qa-gateway/run.mjs --suite revoke-live --no-other-writer --lease ${revokeStatePath} --batch-result <ligne finale du lot, fichier privé 0600> --observation <ligne d’observation, fichier privé 0600> --function-url ${args.functionUrl} --project ${args.project} --credentials <creds.json privé> --out <dossier privé 0700 distinct>`;
  const verifyCommand = `node scripts/qa-gateway/run.mjs --suite expiry-verify --lease ${leasePath} --function-url ${args.functionUrl} --project ${args.project} --credentials <creds.json privé> --out <dossier privé 0700 distinct>`;
  await appendFile(logPath, "", { mode: 0o600 });
  await chmod(logPath, 0o600);

  const secrets = [credentials.serviceRoleKey, credentials.publishableKey];
  const redact = makeRedactor(secrets);
  const id = makeRunId(new Date(), randomBytes(3));
  const result = {
    runId: id,
    project: args.project,
    mode,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: [],
    scenarios: mode === "run" ? scenarioPlan().map((s) => ({ name: s.name, expected: s.expected, status: null, pass: null, reasons: [] })) : [],
    cleanup: [],
    leftovers: [],
    verdict: "incomplete",
  };
  let created = emptyCreated();
  let manifestUnknown = [];
  // Manifest extras for an expiry cohort (suite + bounded lease end), kept across rewrites.
  let manifestExtra = {};
  // Prepare leaves its single technical account on purpose (until verify); a too-early verify
  // touches nothing. Both skip the cleanup explicitly; every other path cleans up.
  let skipCleanup = false;
  let tooEarly = false;
  let refusedBeforeWrite = false;
  // Set when the run phase ended abnormally (timeout, abort/signal, thrown error): a request
  // whose outcome is unknown may still settle remotely, so cleanup reconciles late.
  let interrupted = false;
  // The manifest keeps the cohort's original run id when cleaning from a manifest.
  let manifestRunId = id;
  // One abort controller per phase: a signal aborts the phase in flight, never the process,
  // so the `finally` below always reaches discovery + cleanup (second signal aborts cleanup
  // requests; the manifest is kept; third signal exits 130).
  let active = new AbortController();
  interruptGuard(deps.on, {
    abort: (reason) => active.abort(reason),
    exit: (code) => deps.exit(code),
  });
  const persist = async () => {
    result.verdict = computeVerdict(result, result.finishedAt !== null);
    await writePrivate(path.join(args.out, "result.json"), redact(JSON.stringify(result, null, 2)));
    await writePrivate(path.join(args.out, "summary.md"), redact(summaryMarkdown(result)));
  };
  const log = async (status, step, detail = "") => {
    const record = { step, status, detail: redact(String(detail)), at: new Date().toISOString() };
    result.steps.push(record);
    await appendFile(logPath, `${record.at} [${status}] ${step}${record.detail ? ` — ${record.detail}` : ""}\n`, { mode: 0o600 });
    deps.print(`[${status}] ${step}${record.detail ? ` — ${record.detail}` : ""}`);
    await persist();
  };
  // Durable manifest: rewritten (atomically, 0600) after every creation, before any further call.
  const saveManifest = async (nextCreated = created, unknown = manifestUnknown) => {
    created = nextCreated;
    manifestUnknown = unknown;
    await writePrivate(manifestPath, manifestJson(manifestRunId, args.project, created, new Date(), manifestUnknown, manifestExtra));
  };
  const record = async (kind, value, extra = {}) => {
    if (!created[kind].includes(value)) created[kind].push(value);
    manifestExtra = { ...manifestExtra, ...extra };
    await saveManifest();
  };

  const http = async (url, init = {}) => {
    const response = await deps.fetch(url, { ...init, signal: AbortSignal.any([active.signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, json };
  };
  const serviceHeaders = (extra = {}) => ({ apikey: credentials.serviceRoleKey, Authorization: `Bearer ${credentials.serviceRoleKey}`, ...extra });
  const userHeaders = (token, extra = {}) => ({ apikey: credentials.publishableKey, Authorization: `Bearer ${token}`, ...extra });
  const rest = (pathname, init = {}, headers = {}) => http(`${credentials.url}/rest/v1/${pathname}`, { ...init, headers: { "Content-Type": "application/json", ...headers } });
  const summarize = (r) => redact((r.text || "").slice(0, 200));
  const rpcAs = async (token, fn, body) => {
    const r = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) }, userHeaders(token));
    if (r.status >= 300) throw new Error(`rpc ${fn} → HTTP ${r.status} ${summarize(r)}`);
    return r.json;
  };
  // Reads return {ok:false} on any HTTP/shape error: callers log an explicit FAIL, never "empty".
  const readRows = async (query, headers = serviceHeaders()) => {
    const r = await rest(query, {}, headers);
    if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, rows: [], detail: `HTTP ${r.status} ${summarize(r)}` };
    return { ok: true, rows: r.json, detail: `HTTP ${r.status}` };
  };
  // Fetch-backed CleanupClient (lib.ts drives discovery and cleanup through it). Every read
  // answers {ok:false} on any HTTP/shape error so discovery records it as unknown, never empty.
  const client = {
    listDocuments: async (filter, from, to) => {
      const r = await rest(`documents?${filter}&select=id,owner_id,intervention_id,path&order=id.asc`, {}, serviceHeaders({ Prefer: "count=exact", Range: `${from}-${to}`, "Range-Unit": "items" }));
      if ((r.status !== 200 && r.status !== 206) || !Array.isArray(r.json)) return { ok: false, detail: `HTTP ${r.status} ${summarize(r)}` };
      return { ok: true, items: r.json, total: parseContentRangeTotal(r.headers.get("content-range")), detail: `HTTP ${r.status}` };
    },
    listObjects: async (prefix, { limit, offset, search }) => {
      const body = { prefix, limit, offset, sortBy: { column: "name", order: "asc" }, ...(search ? { search } : {}) };
      const r = await http(`${credentials.url}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: serviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(body) });
      if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, detail: `HTTP ${r.status} ${summarize(r)}` };
      // Rows without a string `name` (or of any other shape) are reported as malformed: discovery
      // marks them unknown and refuses to delete — never "absent".
      const { items, malformed } = parseStorageListing(r.json);
      return { ok: true, items, total: null, detail: `HTTP ${r.status}`, malformed };
    },
    deleteObjects: async (paths) => {
      const r = await http(`${credentials.url}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: serviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: paths }) });
      return { status: r.status, detail: summarize(r) };
    },
    deleteRows: async (table, filter) => {
      const r = await rest(`${table}?${filter}`, { method: "DELETE" }, serviceHeaders({ Prefer: "return=minimal" }));
      return { status: r.status, detail: summarize(r) };
    },
    countRows: async (table, filter) => {
      const r = await rest(`${table}?${filter}&select=*`, { method: "HEAD" }, serviceHeaders({ Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" }));
      if (r.status !== 200 && r.status !== 206) return null;
      return parseContentRangeTotal(r.headers.get("content-range"));
    },
    deleteUser: async (userId) => {
      const r = await http(`${credentials.url}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: serviceHeaders() });
      return { status: r.status };
    },
    userRemaining: async (userId) => {
      const r = await http(`${credentials.url}/auth/v1/admin/users/${userId}`, { headers: serviceHeaders() });
      return r.status === 404 ? 0 : r.status === 200 ? 1 : null;
    },
  };

  try {
    await log("info", "démarrage", `run ${id}, projet ${args.project}, mode ${mode}`);
    if (mode === "cleanup-manifest") {
      const manifest = parseManifest(JSON.parse(await readFile(args.cleanupManifest, "utf8")), args.project);
      manifestRunId = manifest.runId;
      if (manifest.suite) manifestExtra = { suite: manifest.suite, ...(manifest.leaseEndsAt ? { leaseEndsAt: manifest.leaseEndsAt } : {}) };
      await saveManifest(manifest.created, manifest.unknown);
      await log("info", "manifeste chargé", `run d’origine ${manifest.runId} (${manifest.updatedAt}) : ${Object.entries(created).map(([k, v]) => `${k}=${v.length}`).join(", ")}${manifest.unknown.length ? ` ; ${manifest.unknown.length} lecture(s) inconnue(s) à re-vérifier par la découverte` : ""}`);
    } else {
      // Read-only preflight (also the whole of a dry run).
      const health = await http(`${credentials.url}/auth/v1/health`, { headers: { apikey: credentials.publishableKey } });
      await log(health.status === 200 ? "pass" : "fail", "Auth joignable (/auth/v1/health)", `HTTP ${health.status}`);
      const preflight = await http(args.functionUrl, { method: "OPTIONS", headers: { apikey: credentials.publishableKey } });
      const reachable = preflight.status === 204 || preflight.status === 200;
      await log(reachable ? "pass" : mode === "dry-run" ? "info" : "fail", "fonction déployée répond au pré-vol OPTIONS", `HTTP ${preflight.status}${reachable ? "" : " — fonction non joignable (déploiement requis avant l’exécution réelle)"}`);
      const anonymousProbe = await http(args.functionUrl, { method: "POST", headers: { apikey: credentials.publishableKey } });
      await log(anonymousProbe.status === 401 ? "pass" : mode === "dry-run" ? "info" : "fail", "sonde anonyme POST", `HTTP ${anonymousProbe.status}`);
      if (mode === "dry-run") {
        await log("info", "dry-run terminé", `aucune cohorte créée, aucune écriture distante${args.suite ? ` (suite ${args.suite})` : ""}`);
      } else if (mode === "expiry-prepare") {
        // REVIEW-003: a failed preflight step aborts prepare BEFORE any creation; prepared never
        // coexists with a FAIL (no account is left behind after a failed step).
        if (result.steps.some((s) => s.status === "fail")) throw new Error("préalables en échec : prepare interrompu avant toute création de compte");
        const prepared = await expiryPrepare(expiryDeps());
        result.expiry = { phase: "prepare", userId: prepared.userId, verifyNotBefore: prepared.lease ? new Date(prepared.lease.verifyNotBefore * 1000).toISOString() : null, leaseEndsAt: prepared.lease ? new Date(prepared.lease.leaseEndsAt * 1000).toISOString() : null, leasePath: prepared.lease ? leasePath : null, observedCode: null, verifyCommand: prepared.lease ? verifyCommand : null, outcome: prepared.outcome };
        // PREPARED: the account stays until verify (bounded lease); nothing is cleaned now.
        skipCleanup = prepared.outcome === "prepared" && !result.steps.some((s) => s.status === "fail");
      } else if (mode === "expiry-verify") {
        const lease = parseLease(JSON.parse(await readPrivate(args.lease, "bail (--lease)")), args.project);
        await log("info", "bail chargé", `run d’origine ${lease.runId}, compte ${lease.userId}, exp ${new Date(lease.claimExp * 1000).toISOString()}`);
        manifestExtra = { suite: "expiry", leaseEndsAt: new Date(lease.leaseEndsAt * 1000).toISOString() };
        const verified = await expiryVerify(lease, expiryDeps());
        result.expiry = { phase: "verify", userId: lease.userId, verifyNotBefore: new Date(lease.verifyNotBefore * 1000).toISOString(), leaseEndsAt: new Date(lease.leaseEndsAt * 1000).toISOString(), leasePath: args.lease, observedCode: verified.observedCode, verifyCommand: null, outcome: verified.outcome };
        // The uid was recorded durably by expiryVerify (recordValidated) right after the Auth cohort
        // proof and before any further network call; a refused verify records nothing. This line is a
        // no-op safety net (idempotent) for the permitted outcomes.
        if (verified.cleanup) await record("userIds", lease.userId, manifestExtra);
        tooEarly = verified.outcome === "too-early";
        skipCleanup = !verified.cleanup;
      } else if (mode === "revoke-prepare") {
        if (result.steps.some((s) => s.status === "fail")) throw new Error("préalables en échec : revoke-prepare interrompu avant toute création de compte");
        const prepared = await revokePrepare(await revokeDeps());
        result.revoke = { phase: "prepare", outcome: prepared.outcome, objectPath: null, responseStatus: null, conditions: {}, reasons: [], liveCommand: prepared.state ? liveCommand : null };
        if (prepared.outcome === "refused") refusedBeforeWrite = true;
        skipCleanup = (prepared.outcome === "prepared" && !result.steps.some((s) => s.status === "fail")) || prepared.outcome === "refused";
      } else if (mode === "revoke-live") {
        const state = parseRevokeState(JSON.parse(await readPrivate(args.lease, "état revoke (--lease)")), args.project);
        await log("info", "état revoke chargé", `run d’origine ${state.runId}, dossier ${state.dossierId}, gestionnaire ${state.managerId}`);
        manifestExtra = { suite: "revoke" };
        const live = await revokeLive(state, await revokeDeps(), { batchResultPath: args.batchResult, observationPath: args.observation });
        result.revoke = { phase: "live", outcome: live.outcome, objectPath: live.objectPath, responseStatus: live.responseStatus, conditions: live.verdict?.conditions ?? {}, reasons: live.verdict?.reasons ?? [], liveCommand: null, unverifiedEntities: live.unverifiedEntities ?? [] };
        if (live.unverifiedEntities?.length) result.leftovers.push(`entités non prouvées non nettoyées : ${live.unverifiedEntities.join(" ; ")}`);
        // Unknown outcome (no response / 5xx / transport): the object may be kept by the gateway —
        // handled like an interruption: late reconcile window before the discovery-first cleanup.
        if (live.outcome === "unknown") interrupted = true;
        skipCleanup = !live.cleanup;
      } else {
        await runScenarios();
      }
    }
  } catch (error) {
    if (error instanceof UsageError && created.userIds.length === 0) {
      // Refused before any write (unsafe/unreadable lease path, foreign project…): nothing to clean.
      refusedBeforeWrite = true;
      skipCleanup = true;
      await log("fail", "refus", error.message);
    } else {
      interrupted = true;
      await log("fail", "interruption", `${error instanceof Error ? error.message : String(error)} — l’issue distante de la requête en cours est inconnue : réconciliation tardive avant nettoyage`);
    }
  } finally {
    if (mode !== "dry-run" && !skipCleanup) {
      try {
        await cleanup();
      } catch (error) {
        // A crash inside cleanup still ends with the manifest on disk and a failed verdict.
        result.leftovers.push(`nettoyage interrompu : ${error instanceof Error ? error.message : String(error)}`);
        await log("fail", "nettoyage interrompu", `${error instanceof Error ? error.message : String(error)} — ${cleanupRerunMessage(manifestPath)}`);
      }
    }
    result.finishedAt = new Date().toISOString();
    await persist();
    deps.print(`verdict : ${result.verdict} — rapport ${path.join(args.out, "summary.md")}`);
  }
  if (tooEarly || refusedBeforeWrite) return 2;
  // 3 = cleanup incomplete by design: some entities could not be proven to belong to the cohort and
  // were neither recorded nor deleted (diagnostic in summary.md / result.json).
  if (result.revoke?.unverifiedEntities?.length) return 3;
  // 0 = pass, prepared (account intentionally kept, lease written) or observed (clean, but the
  // platform code is not bound yet: not a PASS); 1 = fail; 2 = refused before any write.
  return result.verdict === "pass" || result.verdict === "prepared" || result.verdict === "observed" ? 0 : 1;

  // Injected dependencies of the two revocation phases (contract v4 §2); the harness never runs SQL.
  async function revokeDeps() {
    const sqlDir = new URL("./sql/", import.meta.url);
    const templates = { batch: await readFile(new URL("revoke-live-batch.sql", sqlDir), "utf8"), observe: await readFile(new URL("revoke-live-observe.sql", sqlDir), "utf8") };
    const userRows = async (token, query) => {
      const r = await rest(query, {}, userHeaders(token));
      return r.status === 200 && Array.isArray(r.json) ? { ok: true, rows: r.json, detail: `HTTP ${r.status}` } : { ok: false, rows: [], detail: `HTTP ${r.status} ${summarize(r)}` };
    };
    return {
      now: deps.now,
      nowMs: () => deps.now() * 1000 + (Date.now() % 1000),
      sleep: (ms) => deps.reconcile.sleep(ms),
      runId: id,
      project: args.project,
      projectUrl: credentials.url,
      manifestPath,
      statePath: revokeStatePath,
      batchSqlPath,
      observeSqlPath,
      liveCommand,
      templates,
      randomPassword: () => cohortPassword(randomBytes(32)),
      // Exhaustive only on a proven end (short page or consistent total); a full last page is UNKNOWN.
      listUserEmails: () => listAllUserEmails(async (page, perPage) => {
        const r = await http(`${credentials.url}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { headers: serviceHeaders() });
        const users = Array.isArray(r.json?.users) ? r.json.users : Array.isArray(r.json) ? r.json : null;
        const total = typeof r.json?.total === "number" ? r.json.total : parseTotalHeader(r.headers?.get?.("x-total-count") ?? null);
        return { status: r.status, users, total, detail: summarize(r) };
      }, { perPage: 1000, maxPages: 50 }),
      createUser: async (email, password, role) => {
        const r = await http(`${credentials.url}/auth/v1/admin/users`, { method: "POST", headers: serviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role, full_name: `QA révocation ${id}` } }) });
        return { status: r.status, id: typeof r.json?.id === "string" ? r.json.id : null, detail: summarize(r) };
      },
      passwordGrant: async (email, password) => {
        const r = await http(`${credentials.url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: credentials.publishableKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
        return { status: r.status, json: r.json && typeof r.json === "object" ? r.json : null, detail: r.status === 200 ? "jeton non journalisé" : summarize(r) };
      },
      rpc: async (token, fn, body) => {
        const r = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(body) }, userHeaders(token));
        return { status: r.status, json: r.json, detail: r.status >= 300 ? summarize(r) : "" };
      },
      serviceInsert: async (table, row) => {
        const r = await rest(table, { method: "POST", body: JSON.stringify(row) }, serviceHeaders({ Prefer: "return=minimal" }));
        return { status: r.status, detail: r.status >= 300 ? summarize(r) : "" };
      },
      serviceRows: async (query) => readRows(query),
      userRows,
      // ONE real upload: 2 KiB JPEG, multipart, manager JWT, intervention_id of the QA site dossier.
      upload: async (token, dossierId) => {
        const form = new FormData();
        form.set("file", new Blob([fixtures.jpeg(2048)], { type: "image/jpeg" }), "photo.jpg");
        form.set("intervention_id", dossierId);
        const r = await http(args.functionUrl, { method: "POST", headers: { apikey: credentials.publishableKey, Authorization: `Bearer ${token}` }, body: form });
        return { status: r.status, text: r.text };
      },
      getUser: async (userId) => {
        const r = await http(`${credentials.url}/auth/v1/admin/users/${userId}`, { headers: serviceHeaders() });
        return { status: r.status, json: r.json && typeof r.json === "object" && !Array.isArray(r.json) ? r.json : null };
      },
      readManifest: async (manifestFile) => parseManifest(JSON.parse(await readPrivate(manifestFile, "manifeste de l’état")), args.project),
      record,
      recordValidated: (kind, value) => record(kind, value, manifestExtra),
      addSecret: (secret) => { if (typeof secret === "string" && secret.length >= 8) secrets.push(secret); },
      forbidden: () => [...secrets, ...created.userIds],
      client,
      writeState: async (state, target) => {
        const file = target === "original" ? args.lease : revokeStatePath;
        await assertPrivatePath(file, target === "original" ? "état original (--lease)" : "état (--out)", { mustExist: target === "original" });
        await writePrivate(file, JSON.stringify(state, null, 2));
      },
      writeSql: (file, text) => writePrivate(file, text),
      readResultFile: async (file) => {
        const st = await lstat(file).catch(() => null);
        if (!st) return null;
        const text = await readPrivate(file, "résultat fourni par le pilote");
        if (!text.trim()) return null;
        return JSON.parse(text);
      },
      log,
    };
  }

  // Injected dependencies of the two expiry phases (lib.ts drives them; fully fakeable in tests).
  function expiryDeps() {
    return {
      now: deps.now,
      runId: id,
      project: args.project,
      projectUrl: credentials.url,
      manifestPath,
      leasePath,
      verifyCommand,
      randomPassword: () => cohortPassword(randomBytes(32)),
      createUser: async (email, password) => {
        const r = await http(`${credentials.url}/auth/v1/admin/users`, {
          method: "POST",
          headers: serviceHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: "client", full_name: `QA expiry ${id}` } }),
        });
        return { status: r.status, id: typeof r.json?.id === "string" ? r.json.id : null, detail: summarize(r) };
      },
      passwordGrant: async (email, password) => {
        const r = await http(`${credentials.url}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { apikey: credentials.publishableKey, "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        return { status: r.status, json: r.json && typeof r.json === "object" ? r.json : null, detail: r.status === 200 ? "jeton non journalisé" : summarize(r) };
      },
      // Mutation-free probe: POST without any body, bearer token as the only difference.
      probe: async (token) => {
        const r = await http(args.functionUrl, { method: "POST", headers: { apikey: credentials.publishableKey, Authorization: `Bearer ${token}` } });
        return { status: r.status, text: r.text };
      },
      getUser: async (userId) => {
        const r = await http(`${credentials.url}/auth/v1/admin/users/${userId}`, { headers: serviceHeaders() });
        return { status: r.status, json: r.json && typeof r.json === "object" && !Array.isArray(r.json) ? r.json : null };
      },
      readManifest: async (manifestFile) => parseManifest(JSON.parse(await readPrivate(manifestFile, "manifeste du bail")), args.project),
      recordValidated: (userId) => record("userIds", userId, manifestExtra),
      record,
      addSecret: (secret) => { if (typeof secret === "string" && secret.length >= 8) secrets.push(secret); },
      forbidden: () => [...secrets, ...created.userIds],
      client,
      // The lease holds the token: written raw (never redacted) at 0600 — in the private out dir
      // ("out") and, for verify's consumedAt, on the ORIGINAL file given by --lease ("original").
      writeLease: async (lease, target) => {
        const file = target === "original" ? args.lease : leasePath;
        await assertPrivatePath(file, target === "original" ? "bail original (--lease)" : "bail (--out)", { mustExist: target === "original" });
        await writePrivate(file, JSON.stringify(lease, null, 2));
      },
      log,
    };
  }

  async function runScenarios() {
    const password = cohortPassword(randomBytes(32));
    secrets.push(password);
    const users = {};
    for (const role of COHORT_ROLES) {
      const email = cohortEmail(id, role);
      const r = await http(`${credentials.url}/auth/v1/admin/users`, {
        method: "POST",
        headers: serviceHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { role: cohortProfileRole(role), full_name: `QA ${role} ${id}` } }),
      });
      if (r.status >= 300 || typeof r.json?.id !== "string") throw new Error(`création utilisateur ${role} → HTTP ${r.status} ${summarize(r)}`);
      users[role] = { id: r.json.id, email };
      await record("userIds", r.json.id);
      await log("pass", `utilisateur ${role} créé`, r.json.id);
    }
    const tokens = {};
    for (const role of COHORT_ROLES) {
      const r = await http(`${credentials.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: credentials.publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: users[role].email, password }),
      });
      if (r.status !== 200 || typeof r.json?.access_token !== "string") throw new Error(`jeton ${role} → HTTP ${r.status} ${summarize(r)}`);
      tokens[role] = r.json.access_token;
      secrets.push(r.json.access_token);
      if (r.json.refresh_token) secrets.push(r.json.refresh_token);
      await log("pass", `jeton utilisateur ${role} obtenu (password grant)`, "jeton non journalisé");
    }
    const clientJob = await rpcAs(tokens.client, "create_intervention", {
      p_category: "panel", p_description: `QA gateway ${id} : dossier client de test.`, p_address: "1 rue de test", p_postal_code: "97200", p_city: "Fort-de-France", p_urgency: SEED_URGENCY, p_site_id: null,
    });
    if (typeof clientJob?.id !== "string") throw new Error("create_intervention (client) sans id");
    await record("interventionIds", clientJob.id);
    await log("pass", "dossier client créé (RPC create_intervention)", clientJob.id);
    const assign = await rest(`interventions?id=eq.${clientJob.id}`, { method: "PATCH", body: JSON.stringify({ artisan_id: users.artisan.id, status: "assigned" }) }, serviceHeaders({ Prefer: "return=representation" }));
    if (assign.status >= 300 || !Array.isArray(assign.json) || assign.json.length !== 1) throw new Error(`affectation artisan → HTTP ${assign.status} ${summarize(assign)}`);
    await log("pass", "artisan affecté au dossier client (écriture service de seeding, pas le parcours métier)", users.artisan.id);
    const site = await rpcAs(tokens.manager, "create_site", { p_name: `Site QA ${id}`, p_type: "office", p_address: "2 rue des bureaux", p_budget_cents: 100000, p_organization_id: null });
    if (typeof site?.id !== "string" || typeof site?.organization_id !== "string") throw new Error("create_site sans id/organization_id");
    await record("organizationIds", site.organization_id);
    await record("siteIds", site.id);
    await log("pass", "organisation et site créés (RPC create_site)", `${site.organization_id} / ${site.id}`);
    const member = await rest("organization_members", { method: "POST", body: JSON.stringify({ organization_id: site.organization_id, user_id: users.viewer.id, role: "viewer" }) }, serviceHeaders({ Prefer: "return=representation" }));
    if (member.status >= 300) throw new Error(`membre viewer → HTTP ${member.status} ${summarize(member)}`);
    await log("pass", "viewer ajouté à l’organisation", users.viewer.id);
    const siteJob = await rpcAs(tokens.manager, "create_intervention", {
      p_category: "lighting", p_description: `QA gateway ${id} : dossier de site de test.`, p_address: "2 rue des bureaux", p_postal_code: "97200", p_city: "Fort-de-France", p_urgency: SEED_URGENCY, p_site_id: site.id,
    });
    if (typeof siteJob?.id !== "string") throw new Error("create_intervention (site) sans id");
    await record("interventionIds", siteJob.id);
    await log("pass", "dossier de site créé", siteJob.id);
    const viewerSees = await readRows(`interventions?id=eq.${siteJob.id}&select=id`, userHeaders(tokens.viewer));
    await log(viewerSees.ok && viewerSees.rows.length === 1 ? "pass" : "fail", "le viewer lit le dossier de site (lecture seule attendue)", viewerSees.detail);

    const forbidden = [...secrets, ...created.userIds];
    for (const [index, scenario] of scenarioPlan().entries()) {
      const rec = result.scenarios[index];
      const form = new FormData();
      const bytes = scenario.file === "jpeg" ? fixtures.jpeg(2048) : scenario.file === "fakeMime" ? fixtures.png() : fixtures.jpeg(fixtures.OVERSIZE);
      form.set("file", new Blob([bytes], { type: "image/jpeg" }), scenario.file === "fakeMime" ? "fake.jpg" : "photo.jpg");
      const dossierId = scenario.dossier === "client" ? clientJob.id : scenario.dossier === "site" ? siteJob.id : null;
      if (dossierId) form.set("intervention_id", dossierId);
      const headers = { apikey: credentials.publishableKey };
      if (scenario.actor === "invalid") headers.Authorization = "Bearer invalid.token.value";
      else if (scenario.actor !== "anonymous") headers.Authorization = `Bearer ${tokens[scenario.actor]}`;
      const r = await http(args.functionUrl, { method: "POST", headers, body: form });
      const document = r.json && typeof r.json === "object" && !Array.isArray(r.json) && "document" in r.json ? r.json.document : null;
      const verdict = assertScenario(scenario, { status: r.status, bodyText: r.text, document }, forbidden);
      if (r.status === 201 && typeof document?.id === "string") {
        const owner = users[scenario.actor].id;
        const objectPath = `${owner}/${document.id}`;
        await record("documentIds", document.id);
        await record("objectPaths", objectPath);
        const row = await readRows(`documents?id=eq.${document.id}&select=id,owner_id,intervention_id,path,mime_type`);
        if (!row.ok) verdict.reasons.push(`relecture documents en erreur : ${row.detail}`);
        else if (row.rows.length !== 1) verdict.reasons.push("aucune ligne documents après 201");
        else {
          const stored = row.rows[0];
          if (stored.owner_id !== owner) verdict.reasons.push("owner_id inattendu");
          if ((stored.intervention_id ?? null) !== dossierId) verdict.reasons.push("intervention_id inattendu");
          if (stored.path !== objectPath) verdict.reasons.push("chemin inattendu");
          if (stored.mime_type !== "image/jpeg") verdict.reasons.push("mime inattendu");
        }
        const listing = await client.listObjects(owner, { limit: 1000, offset: 0, search: document.id });
        if (!listing.ok) verdict.reasons.push(`listage Storage en erreur : ${listing.detail}`);
        else if (!listing.items.includes(document.id)) verdict.reasons.push("objet Storage absent après 201");
        verdict.pass = verdict.reasons.length === 0;
      }
      rec.status = r.status;
      rec.pass = verdict.pass;
      rec.reasons = verdict.reasons;
      await log(verdict.pass ? "pass" : "fail", `scénario : ${scenario.name}`, `HTTP ${r.status}${verdict.reasons.length ? ` — ${verdict.reasons.join(" ; ")}` : ""}`);
    }
    // Refused attempts must not have left metadata or objects behind. Same paginated discovery
    // as the cleanup; anything found is merged into the manifest, any unknown read is a FAIL.
    const found = await discoverCohort(client, created);
    await saveManifest(found.created, found.unknown);
    for (const u of found.unknown) await log("fail", `découverte de cohorte : ${u.scope}`, u.detail);
    if (found.unknown.every((u) => !u.scope.startsWith("documents")))
      await log(found.added.documentIds.length === 0 ? "pass" : "fail", "aucune métadonnée créée par les tentatives refusées", `${found.added.documentIds.length} ligne(s) inattendue(s)`);
    if (found.unknown.every((u) => !u.scope.startsWith("Storage")))
      await log(found.added.objectPaths.length === 0 ? "pass" : "fail", "aucun objet Storage orphelin sous les préfixes de la cohorte", `${found.added.objectPaths.length} orphelin(s)`);
  }

  // Runs on every path (normal end, timeout, signal, unhandled error, --cleanup-manifest):
  // discovery of the cohort's rows and objects, merged manifest persisted, then deletion in FK
  // order (objects first) — or no deletion at all while any read is unknown (exit 1).
  async function cleanup() {
    // A signal during the run aborted the previous controller; cleanup gets its own.
    active = new AbortController();
    const outcome = await runCleanup(client, created, {
      saveManifest: (nextCreated, unknown) => saveManifest(nextCreated, unknown),
      note: (status, step, detail) => log(status, step, detail),
      step: async (entry, leftover) => {
        result.cleanup.push(entry);
        if (leftover) result.leftovers.push(leftover);
        await log(entry.ok ? "pass" : "fail", `nettoyage : ${entry.label}`, `${entry.detail}${entry.remaining === null ? "" : ` ; restant ${entry.remaining}`}`);
      },
    }, { manifestPath, reconcile: interrupted || mode === "cleanup-manifest" ? deps.reconcile : undefined });
    if (!outcome.discovery.complete) {
      for (const u of outcome.discovery.unknown) result.leftovers.push(unknownLeftover(u));
    }
    if (!outcome.clean) await log("info", "manifeste conservé pour --cleanup-manifest", `${manifestPath} (${manifestUnknown.length} lecture(s) inconnue(s) marquée(s))`);
  }
}
// Lease and manifest files are read/written only as regular private files: no symlink, 0600 file,
// 0700 directory, no group/other bits. Refused (UsageError-like exit 2) otherwise.
async function privateFacts(file) {
  const dirPath = path.dirname(file);
  const dir = await lstat(dirPath).catch(() => null);
  const st = await lstat(file).catch(() => null);
  return {
    exists: st !== null,
    isSymlink: st?.isSymbolicLink() ?? false,
    isFile: st?.isFile() ?? false,
    mode: st?.mode ?? 0,
    dir: { isSymlink: dir?.isSymbolicLink() ?? false, isDirectory: dir?.isDirectory() ?? false, mode: dir?.mode ?? 0 },
  };
}
async function assertPrivatePath(file, label, options) {
  const reasons = checkPrivatePath(label, await privateFacts(file), options);
  if (reasons.length) throw new UsageError(`Refus : ${reasons.join(" ; ")}`);
}
async function readPrivate(file, label) {
  await assertPrivatePath(file, label, { mustExist: true });
  return readFile(file, "utf8");
}
async function writePrivate(target, content) {
  const temp = `${target}.tmp`;
  await writeFile(temp, content, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, target);
}
function usage() {
  console.error(`Usage :
  node scripts/qa-gateway/run.mjs --function-url <https://<ref>.supabase.co/functions/v1/native-document-upload> --project <ref> --credentials <creds.json privé> --out <dossier 0700> [--dry-run]
  node scripts/qa-gateway/run.mjs --cleanup-manifest <manifest.json> --project <ref> --credentials <creds.json privé> --out <dossier 0700>
  node scripts/qa-gateway/run.mjs --suite expiry-prepare --function-url <…> --project <ref> --credentials <…> --out <dossier 0700> [--dry-run]
  node scripts/qa-gateway/run.mjs --suite expiry-verify --lease <dossier 0700>/lease.json --function-url <…> --project <ref> --credentials <…> --out <dossier 0700 distinct>
  node scripts/qa-gateway/run.mjs --suite revoke-prepare --no-other-writer --function-url <…> --project <ref> --credentials <…> --out <dossier 0700>
  node scripts/qa-gateway/run.mjs --suite revoke-live --no-other-writer --lease <dossier 0700>/revoke.json --batch-result <fichier> --observation <fichier> --function-url <…> --project <ref> --credentials <…> --out <dossier 0700 distinct>
creds.json : {"url":"https://<ref>.supabase.co","publishable_key":"…","service_role_key":"…"}
Le harnais crée une cohorte unique, exerce la fonction déployée, nettoie tout ce qu’il a créé (manifeste durable) et écrit summary.md / result.json caviardés. Aucun jeton ni en-tête n’est affiché. Code de sortie 1 dès qu’une étape échoue.
--suite expiry-prepare : un seul compte technique, jeton réel prouvé valide sans mutation, bail 0600 (lease.json), verdict PREPARED (code 0), compte laissé jusqu’au verify (≤ 2 h).
--suite expiry-verify : refus (code 2) si trop tôt ; cohérence bail/manifeste/claims, compte actif ni banni ni effacé (200), appel réel avec le même jeton expiré (401 sans fuite : PASS si enveloppe fonction ou code lié, OBSERVED sinon), suppression du compte et relecture 404.
--suite revoke-prepare --no-other-writer : garde autre rédacteur, cohorte propriétaire/gestionnaire QA (selected + 1 grant can_write), dossier de site, lot et observation SQL rendus dans --out pour revue root, état revoke.json 0600, verdict PREPARED.
--suite revoke-live --no-other-writer --lease <revoke.json> --batch-result <fichier> --observation <fichier> : preuve de cohorte, UN upload réel pendant la pause du lot, découverte de l’objet, relectures, verdict (a)–(g) sur la ligne finale du lot et l’observation fournies par le pilote, nettoyage.`);
}
// Auto-run only when executed as a script; tests import main() and inject their runtime.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
