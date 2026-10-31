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
import { mkdir, chmod, writeFile, readFile, appendFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
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
  cleanupPlan,
  manifestJson,
  parseManifest,
  scenarioPlan,
  fixtures,
  assertScenario,
  summaryMarkdown,
  computeVerdict,
  parseContentRangeTotal,
} from "./lib.ts";

const BUCKET = "intervention-documents";
const TIMEOUT_MS = 30000;

async function main(argv) {
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
  const mode = args.cleanupManifest ? "cleanup-manifest" : args.dryRun ? "dry-run" : "run";

  await mkdir(args.out, { recursive: true, mode: 0o700 });
  await chmod(args.out, 0o700);
  const logPath = path.join(args.out, "run.log");
  const manifestPath = path.join(args.out, "manifest.json");
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
  const persist = async () => {
    result.verdict = computeVerdict(result, result.finishedAt !== null);
    await writePrivate(path.join(args.out, "result.json"), redact(JSON.stringify(result, null, 2)));
    await writePrivate(path.join(args.out, "summary.md"), redact(summaryMarkdown(result)));
  };
  const log = async (status, step, detail = "") => {
    const record = { step, status, detail: redact(String(detail)), at: new Date().toISOString() };
    result.steps.push(record);
    await appendFile(logPath, `${record.at} [${status}] ${step}${record.detail ? ` — ${record.detail}` : ""}\n`, { mode: 0o600 });
    console.log(`[${status}] ${step}${record.detail ? ` — ${record.detail}` : ""}`);
    await persist();
  };
  // Durable manifest: rewritten (atomically, 0600) after every creation, before any further call.
  const record = async (kind, value) => {
    if (!created[kind].includes(value)) created[kind].push(value);
    await writePrivate(manifestPath, manifestJson(id, args.project, created, new Date()));
  };

  const http = async (url, init = {}) => {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
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
  const listObjects = async (prefix, search) => {
    const r = await http(`${credentials.url}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: serviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ prefix, limit: 1000, offset: 0, ...(search ? { search } : {}) }) });
    if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, names: [], detail: `HTTP ${r.status} ${summarize(r)}` };
    return { ok: true, names: r.json.map((o) => o?.name).filter((n) => typeof n === "string"), detail: `HTTP ${r.status}` };
  };
  const countRows = async (table, filter) => {
    const r = await rest(`${table}?${filter}&select=*`, { method: "HEAD" }, serviceHeaders({ Prefer: "count=exact", Range: "0-0", "Range-Unit": "items" }));
    if (r.status !== 200 && r.status !== 206) return null;
    return parseContentRangeTotal(r.headers.get("content-range"));
  };

  try {
    await log("info", "démarrage", `run ${id}, projet ${args.project}, mode ${mode}`);
    if (mode === "cleanup-manifest") {
      const manifest = parseManifest(JSON.parse(await readFile(args.cleanupManifest, "utf8")), args.project);
      created = manifest.created;
      await log("info", "manifeste chargé", `run d’origine ${manifest.runId} (${manifest.updatedAt}) : ${Object.entries(created).map(([k, v]) => `${k}=${v.length}`).join(", ")}`);
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
        await log("info", "dry-run terminé", "aucune cohorte créée, aucune écriture distante");
      } else {
        await runScenarios();
      }
    }
  } catch (error) {
    await log("fail", "interruption", error instanceof Error ? error.message : String(error));
  } finally {
    if (mode !== "dry-run") await cleanup();
    result.finishedAt = new Date().toISOString();
    await persist();
    console.log(`verdict : ${result.verdict} — rapport ${path.join(args.out, "summary.md")}`);
  }
  return result.verdict === "pass" ? 0 : 1;

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
        const listing = await listObjects(owner, document.id);
        if (!listing.ok) verdict.reasons.push(`listage Storage en erreur : ${listing.detail}`);
        else if (!listing.names.includes(document.id)) verdict.reasons.push("objet Storage absent après 201");
        verdict.pass = verdict.reasons.length === 0;
      }
      rec.status = r.status;
      rec.pass = verdict.pass;
      rec.reasons = verdict.reasons;
      await log(verdict.pass ? "pass" : "fail", `scénario : ${scenario.name}`, `HTTP ${r.status}${verdict.reasons.length ? ` — ${verdict.reasons.join(" ; ")}` : ""}`);
    }
    // Refused attempts must not have left metadata or objects behind.
    const stray = await readRows(`documents?owner_id=in.(${created.userIds.join(",")})&select=id`);
    if (!stray.ok) await log("fail", "relecture des métadonnées de la cohorte", stray.detail);
    else {
      const unexpected = stray.rows.map((d) => d.id).filter((x) => !created.documentIds.includes(x));
      for (const docId of unexpected) await record("documentIds", docId);
      await log(unexpected.length === 0 ? "pass" : "fail", "aucune métadonnée créée par les tentatives refusées", `${unexpected.length} ligne(s) inattendue(s)`);
    }
    for (const userId of created.userIds) {
      const listing = await listObjects(userId);
      if (!listing.ok) {
        await log("fail", `listage Storage du préfixe ${userId}`, listing.detail);
        continue;
      }
      const orphans = listing.names.map((n) => `${userId}/${n}`).filter((p) => !created.objectPaths.includes(p));
      for (const p of orphans) await record("objectPaths", p);
      await log(orphans.length === 0 ? "pass" : "fail", `aucun objet Storage orphelin sous ${userId}`, `${orphans.length} orphelin(s)`);
    }
  }

  async function cleanup() {
    for (const step of cleanupPlan(created)) {
      const entry = { label: step.label, ok: false, remaining: null, detail: "" };
      try {
        if (step.kind === "storage") {
          const r = await http(`${credentials.url}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: serviceHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: step.paths }) });
          let remaining = 0;
          let readbackFailed = false;
          for (const p of step.paths) {
            const [prefix, name] = p.split("/");
            const listing = await listObjects(prefix, name);
            if (!listing.ok) readbackFailed = true;
            else if (listing.names.includes(name)) remaining++;
          }
          entry.remaining = readbackFailed ? null : remaining;
          entry.ok = r.status < 300 && !readbackFailed && remaining === 0;
          entry.detail = `HTTP ${r.status}${readbackFailed ? " ; relecture Storage en erreur" : ""}`;
          if (!entry.ok) result.leftovers.push(`objets Storage : ${readbackFailed ? "relecture impossible" : `${remaining} restant(s)`}`);
        } else if (step.kind === "rest") {
          const r = await rest(`${step.table}?${step.filter}`, { method: "DELETE" }, serviceHeaders({ Prefer: "return=minimal" }));
          const remaining = await countRows(step.table, step.filter);
          entry.remaining = remaining;
          entry.ok = r.status < 300 && remaining === 0;
          entry.detail = `HTTP ${r.status}${r.status >= 300 ? ` ${summarize(r)}` : ""}${remaining === null ? " ; relecture en erreur" : ""}`;
          if (!entry.ok) result.leftovers.push(`${step.table} (${step.filter}) : ${remaining ?? "relecture impossible"}`);
        } else {
          const r = await http(`${credentials.url}/auth/v1/admin/users/${step.userId}`, { method: "DELETE", headers: serviceHeaders() });
          const check = await http(`${credentials.url}/auth/v1/admin/users/${step.userId}`, { headers: serviceHeaders() });
          entry.remaining = check.status === 404 ? 0 : check.status === 200 ? 1 : null;
          entry.ok = r.status < 300 && check.status === 404;
          entry.detail = `HTTP ${r.status}, relecture ${check.status}`;
          if (!entry.ok) result.leftovers.push(`auth user ${step.userId}`);
        }
      } catch (error) {
        entry.detail = error instanceof Error ? error.message : String(error);
        result.leftovers.push(step.label);
      }
      result.cleanup.push(entry);
      await log(entry.ok ? "pass" : "fail", `nettoyage : ${step.label}`, `${entry.detail}${entry.remaining === null ? "" : ` ; restant ${entry.remaining}`}`);
    }
    if (result.leftovers.length) await log("info", "manifeste conservé pour --cleanup-manifest", manifestPath);
  }
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
creds.json : {"url":"https://<ref>.supabase.co","publishable_key":"…","service_role_key":"…"}
Le harnais crée une cohorte unique, exerce la fonction déployée, nettoie tout ce qu’il a créé (manifeste durable) et écrit summary.md / result.json caviardés. Aucun jeton ni en-tête n’est affiché. Code de sortie 1 dès qu’une étape échoue.`);
}
process.exitCode = await main(process.argv.slice(2));
