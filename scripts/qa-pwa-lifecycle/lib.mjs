// QA-PWA-LIFECYCLE-002 — pure helpers of scripts/qa-pwa-lifecycle.mjs (no I/O, unit-tested).
// Contract: docs/CLAUDE_PWA_LIFECYCLE_CONTRACT.md.
import path from "node:path";

export const DEFAULT_PORT = 3020;
export const DEFAULT_TIMEOUT_MS = 90000;
export const SW_PATH = "/sw.js";
export const OFFLINE_PATH = "/offline.html";
export const DEMO_HASH = "demo/client-new";
export const PRIVATE_PATH_PREFIXES = ["/api", "/auth", "/_next/data"];
/** Variable NAMES that must never reach a child server or an evidence file (values are never read). */
export const FORBIDDEN_ENV_NAME = /SERVICE_ROLE|SECRET|PRIVATE|TOKEN/i;

export const HELP = `usage: node scripts/qa-pwa-lifecycle.mjs --old-dir <dir> --old-sha <40hex> --new-dir <dir> --new-sha <40hex>
         --playwright-path <module> --out <dir outside git> [--port ${DEFAULT_PORT}] [--timeout-ms ${DEFAULT_TIMEOUT_MS}]
         [--chromium-path <exe>] [--stage-evidence <json>] [--headless|--no-headless] [--dry-run] [--json] [--help]
Two prebuilt Next checkouts (old: SW v2, new: SW v3) are served SUCCESSIVELY on the same localhost origin by
runner-owned child servers; two Chromium tabs prove the service-worker update lifecycle. Never builds, never installs,
never uses an account or the cloud. Exit: 0 all PASS; 1 FAIL/FATAL; 2 preflight refusal; 3 a child server did not stop.
`;

const FLAGS = {
  "--old-dir": "oldDir",
  "--old-sha": "oldSha",
  "--new-dir": "newDir",
  "--new-sha": "newSha",
  "--playwright-path": "playwrightPath",
  "--chromium-path": "chromiumPath",
  "--out": "out",
  "--port": "port",
  "--timeout-ms": "timeoutMs",
  "--stage-evidence": "stageEvidence",
};

export function parseArgs(argv, env = {}) {
  const options = { port: DEFAULT_PORT, timeoutMs: DEFAULT_TIMEOUT_MS, headless: true, dryRun: false, json: false, help: false, playwrightPath: env.QA_PLAYWRIGHT_PATH || "", chromiumPath: env.QA_CHROMIUM_PATH || "", stageEvidence: "" };
  const errors = [];
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") options.help = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--headless") options.headless = true;
    else if (arg === "--no-headless") options.headless = false;
    else if (FLAGS[arg]) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) errors.push(`${arg} requires a value`);
      else if (seen.has(arg)) errors.push(`${arg} given twice`);
      else {
        seen.add(arg);
        options[FLAGS[arg]] = value;
        i++;
      }
    } else errors.push(`unknown argument ${arg}`);
  }
  if (options.help) return { options, errors: [] };
  for (const key of ["oldDir", "newDir", "out"]) if (!options[key]) errors.push(`--${key === "oldDir" ? "old-dir" : key === "newDir" ? "new-dir" : "out"} is required`);
  for (const key of ["oldSha", "newSha"]) {
    if (!options[key]) errors.push(`--${key === "oldSha" ? "old-sha" : "new-sha"} is required`);
    else if (!/^[0-9a-f]{40}$/.test(options[key])) errors.push(`--${key === "oldSha" ? "old-sha" : "new-sha"} must be a full 40-hex git SHA`);
  }
  if (options.oldSha && options.newSha && options.oldSha === options.newSha) errors.push("--old-sha and --new-sha must differ (two different builds)");
  if (options.oldDir && options.newDir && path.resolve(options.oldDir) === path.resolve(options.newDir)) errors.push("--old-dir and --new-dir must be two different checkouts");
  options.port = Number(options.port);
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) errors.push("--port must be an integer between 1024 and 65535");
  options.timeoutMs = Number(options.timeoutMs);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1000) errors.push("--timeout-ms must be an integer >= 1000");
  if (!options.playwrightPath) errors.push("--playwright-path (or QA_PLAYWRIGHT_PATH) is required");
  return { options, errors };
}

/** Reads the public cache prefix and version from the worker source; null when the pattern is absent. */
export function extractSwVersion(source) {
  const prefix = /const PUBLIC_CACHE_PREFIX\s*=\s*"([^"]+)"/.exec(source)?.[1];
  const version = /\$\{PUBLIC_CACHE_PREFIX\}v(\d+)`/.exec(source)?.[1];
  if (!prefix || !version) return null;
  return { prefix, version: Number(version), cacheName: `${prefix}v${version}` };
}

/** Names (never values) of variables in a dotenv text whose name looks like a secret. */
export function scanEnvKeyNames(text) {
  const forbidden = [];
  const names = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const name = line.replace(/^export\s+/, "").split("=")[0].trim();
    if (!name) continue;
    names.push(name);
    if (FORBIDDEN_ENV_NAME.test(name)) forbidden.push(name);
  }
  return { names, forbidden };
}

/** Classifies Cache Storage entries [{cache, path}]: private paths and anything but /offline.html in own caches. */
export function classifyCacheEntries(entries, prefix) {
  const privateEntries = entries.filter((e) => PRIVATE_PATH_PREFIXES.some((p) => e.path === p || e.path.startsWith(p + "/") || e.path.startsWith(p + "?")));
  const unexpected = entries.filter((e) => e.cache.startsWith(prefix) && e.path !== OFFLINE_PATH);
  return { privateEntries, unexpected, ok: privateEntries.length === 0 && unexpected.length === 0 };
}

/** Mismatches between the pilot's stage evidence and what the runner observed on disk. */
export function compareStageEvidence(evidence, observed) {
  const mismatches = [];
  const expect = (key, actual) => {
    if (evidence[key] === undefined) return;
    if (evidence[key] !== actual) mismatches.push(`${key}: evidence ${String(evidence[key])} ≠ observed ${String(actual)}`);
  };
  expect("old_source", observed.oldSha);
  expect("new_source", observed.newSha);
  expect("old_build_id", observed.oldBuildId);
  expect("new_build_id", observed.newBuildId);
  expect("old_sw_sha256", observed.oldSwSha256);
  expect("new_sw_sha256", observed.newSwSha256);
  if (evidence.private_service_key_copied === true) mismatches.push("private_service_key_copied is true: refusing a stage that carries a service key");
  return mismatches;
}

/** Minimal environment for a child `next start`: nothing from the pilot's shell leaks through. */
export function childEnv(baseEnv, { port }) {
  const env = { NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1" };
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]) if (baseEnv[key]) env[key] = baseEnv[key];
  return env;
}

export function buildServerArgs(dir, port) {
  return [path.join(dir, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"];
}

export function readinessUrls(origin) {
  return [`${origin}/`, `${origin}${SW_PATH}`];
}

/** 0 all PASS; 1 any FAIL/SKIPPED or a FATAL; 3 a child server is not proven stopped (dominates). */
export function exitCodeFor({ steps = [], fatal = null, serversStopped = true }) {
  if (!serversStopped) return 3;
  if (fatal) return 1;
  if (!steps.length) return 1;
  return steps.every((s) => s.status === "PASS") ? 0 : 1;
}

/**
 * Served facts vs disk metadata (contract §4, pilot precision): which candidate BUILD_IDs literally
 * appear in the HTML actually served by the running server. Next embeds the build id in the
 * App Router flight payload of the served document.
 */
export function servedBuildIdMarkers(html, candidates) {
  const text = String(html);
  const found = {};
  for (const [label, id] of Object.entries(candidates)) found[label] = typeof id === "string" && id.length >= 8 && text.includes(id);
  return found;
}

/** Markers of the public landing of the app (no account): what a reload must come back to. */
export const PUBLIC_LANDING = { offlineTitle: "La connexion est indisponible", titlePattern: /Dépannage électrique/, bodyPattern: /Connectez-vous|Se connecter/ };

/**
 * Phase 10 online recovery (pilot diagnosis): the demo (`#demo/client-new`) lives in MEMORY only,
 * so a reload after offline → online legitimately comes back to the PUBLIC landing, not to the
 * demo form. PASS requires: a real navigation response 200 with HTML, the app's public landing
 * markers, and the offline heading ABSENT. A demo textbox is NOT required here; the demo is
 * re-opened explicitly afterwards for the UI comparisons.
 */
export function classifyOnlineRecovery({ status, contentType, title, bodyText, offlineHeadingCount }, landing = PUBLIC_LANDING) {
  const reasons = [];
  if (Number(status) !== 200) reasons.push(`navigation status ${status}, expected 200`);
  if (!/text\/html/i.test(String(contentType || ""))) reasons.push(`content-type ${contentType || "(none)"}, expected text/html`);
  if (!landing.titlePattern.test(String(title || ""))) reasons.push(`document title "${title}" does not name the app`);
  if (!landing.bodyPattern.test(String(bodyText || ""))) reasons.push("public landing markers (sign-in call to action) absent from the body");
  if (Number(offlineHeadingCount) > 0) reasons.push(`offline heading "${landing.offlineTitle}" still present after the online reload`);
  if (String(bodyText || "").includes(landing.offlineTitle)) reasons.push("offline notice text still present after the online reload");
  return { ok: reasons.length === 0, reasons };
}

/**
 * Demo opt-in happens ONLY on a real document load carrying the demo hash (courant-app `onHash` at
 * a2faa02 only re-checks access/view on a hash change and never enters demo mode). Re-opening the
 * demo therefore always starts from `about:blank` and then loads the full demo URL: never a
 * same-document hash `goto` (pilot diagnosis on f91928f).
 */
export function demoReopenPlan(origin, hash = DEMO_HASH) {
  return ["about:blank", `${origin}/#${hash}`];
}

/** True only when the plan is a real-document re-open: first `about:blank`, then one full demo URL. */
export function isRealDocumentReopen(plan, origin, hash = DEMO_HASH) {
  if (!Array.isArray(plan) || plan.length !== 2) return false;
  if (plan[0] !== "about:blank") return false;
  try {
    const target = new URL(plan[1]);
    return target.origin === new URL(origin).origin && target.pathname === "/" && target.search === "" && target.hash === `#${hash}`;
  } catch {
    return false;
  }
}

/** The only console line a private-cache probe may legitimately produce (contract §4, steps 4/11). */
export const EXPECTED_PROBE = { path: "/api/workspace", status: 401, phases: ["probe-v2", "probe-v3"], maxPerPhase: 1 };

/**
 * Strict classification of ONE console record against the expected probe: Chromium logs
 * "Failed to load resource: the server responded with a status of 401 (Unauthorized)" for the
 * deliberate anonymous GET /api/workspace. Only that exact path, that exact status, during a probe
 * phase, is expected. Everything else (other paths, other statuses, pageerror, app errors) is not.
 */
export function isExpectedProbeRecord(record, probe = EXPECTED_PROBE) {
  if (!record || record.kind !== "console" || record.type !== "error") return false;
  if (!probe.phases.includes(record.phase)) return false;
  let pathname = null;
  try {
    pathname = new URL(record.url, "http://localhost").pathname;
  } catch {
    return false;
  }
  if (pathname !== probe.path) return false;
  const status = /status of (\d{3})/.exec(String(record.text || ""))?.[1];
  return status === String(probe.status) && /Failed to load resource/.test(String(record.text || ""));
}

/** Network-failure console lines Chromium emits for a navigation attempted while disconnected. */
export const EXPECTED_OFFLINE = { phase: "offline", textPattern: /Failed to load resource|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ERR_NAME_NOT_RESOLVED/, origin: null };

/**
 * Strictly attributable offline network failure: a console (never pageerror) error, during the
 * offline phase, whose text is of the disconnected-network class and whose URL belongs to the
 * tested origin (when `offline.origin` is given). Anything else is NOT expected (pilot REV-003).
 */
export function isExpectedOfflineRecord(record, offline = EXPECTED_OFFLINE) {
  if (!record || record.kind !== "console" || record.type !== "error" || record.phase !== offline.phase) return false;
  if (!offline.textPattern.test(String(record.text || ""))) return false;
  if (!record.url) return false;
  try {
    const url = new URL(record.url, offline.origin || "http://localhost");
    if (offline.origin && url.origin !== new URL(offline.origin).origin) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Console verdict: `failing` = every error/pageerror that is neither the single expected probe line
 * (at most `maxPerPhase` per probe phase; extra occurrences fail too) nor a strictly attributable
 * offline network failure; `probeExpected` / `offlineExpected` = the accepted lines. A `pageerror`
 * is ALWAYS failing, whatever the phase. Nothing else is ever masked.
 */
export function splitConsoleRecords(records, probe = EXPECTED_PROBE, offline = EXPECTED_OFFLINE) {
  const failing = [];
  const probeExpected = [];
  const offlineExpected = [];
  const perPhase = {};
  for (const r of records) {
    const isError = r.kind === "pageerror" || r.type === "error";
    if (!isError) continue;
    if (r.kind !== "pageerror" && isExpectedOfflineRecord(r, offline)) {
      offlineExpected.push(r);
      continue;
    }
    if (r.kind !== "pageerror" && isExpectedProbeRecord(r, probe)) {
      perPhase[r.phase] = (perPhase[r.phase] || 0) + 1;
      if (perPhase[r.phase] <= probe.maxPerPhase) {
        probeExpected.push(r);
        continue;
      }
    }
    failing.push(r);
  }
  // Backward-compatible alias: `online` is the failing set.
  return { failing, online: failing, probeExpected, offlineExpected };
}
