// Argument parsing for scripts/qa-business/run.mjs (QA-DOCUMENTS-B2B-004). Pure: no I/O.
// Same flags as scripts/qa/run.mjs except --suite, which accepts docs | b2b | all.
import { baseUrlAllowed, isLocalOrigin } from "../../qa/lib/args.mjs";

export { baseUrlAllowed, isLocalOrigin };
export const SUITE_NAMES = ["docs", "b2b"];
export const DEFAULT_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 1000;
const SHA = /^[0-9a-f]{40}$/;
const PROJECT_REF = /^[a-z0-9]{15,40}$/;
const STRING_FLAGS = new Map([
  ["--base-url", "baseUrl"],
  ["--sha", "sha"],
  ["--project", "project"],
  ["--credentials", "credentials"],
  ["--out", "out"],
  ["--playwright-path", "playwrightPath"],
  ["--chromium-path", "chromiumPath"],
  ["--app-dir", "appDir"],
  ["--cleanup-manifest", "cleanupManifest"],
  ["--timeout-ms", "timeoutMs"],
  // Remote mode (contract §19): root's explicit deployment configuration.
  ["--deployment-receipt", "deploymentReceipt"],
  ["--vercel-project", "vercelProject"],
  ["--vercel-team", "vercelTeam"],
  ["--vercel-deployment", "vercelDeployment"],
  ["--github-repo-id", "githubRepoId"],
  ["--expected-build-id", "expectedBuildId"],
]);
const LIST_FLAGS = new Map([
  ["--suite", "suites"],
  ["--allow-base-url", "allowBaseUrls"],
]);
const BOOL_FLAGS = new Map([
  ["--headless", ["headless", true]],
  ["--no-headless", ["headless", false]],
  ["--keep-fixtures", ["keepFixtures", true]],
  ["--dry-run", ["dryRun", true]],
  ["--json", ["json", true]],
  ["--help", ["help", true]],
  ["-h", ["help", true]],
]);

export function defaultOptions(env = {}) {
  return {
    baseUrl: "",
    sha: "",
    project: "",
    credentials: "",
    out: "",
    playwrightPath: env.QA_PLAYWRIGHT_PATH || "",
    chromiumPath: env.QA_CHROMIUM_PATH || "",
    appDir: "",
    cleanupManifest: "",
    timeoutMs: String(DEFAULT_TIMEOUT_MS),
    deploymentReceipt: "",
    vercelProject: "",
    vercelTeam: "",
    vercelDeployment: "",
    githubRepoId: "",
    expectedBuildId: "",
    suites: [],
    allowBaseUrls: [],
    headless: true,
    keepFixtures: false,
    dryRun: false,
    json: false,
    help: false,
  };
}

/** Parses argv (without node and script path). Returns {options, errors}; `all` expands to every suite. */
export function parseArgs(argv, env = {}) {
  const options = defaultOptions(env);
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf("=");
    const flag = eq > 0 ? arg.slice(0, eq) : arg;
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    const takeValue = () => {
      if (inline !== undefined) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        errors.push(`${flag} requires a value`);
        return undefined;
      }
      i++;
      return next;
    };
    if (STRING_FLAGS.has(flag)) {
      const value = takeValue();
      if (value !== undefined) options[STRING_FLAGS.get(flag)] = value;
    } else if (LIST_FLAGS.has(flag)) {
      const value = takeValue();
      if (value !== undefined) options[LIST_FLAGS.get(flag)].push(value);
    } else if (BOOL_FLAGS.has(flag)) {
      const [key, value] = BOOL_FLAGS.get(flag);
      options[key] = value;
    } else errors.push(`unknown argument ${arg}`);
  }
  if (!options.suites.length || options.suites.includes("all")) {
    if (options.suites.filter((s) => s !== "all").length) errors.push("--suite all cannot be combined with another suite");
    options.suites = [...SUITE_NAMES];
  }
  const timeout = Number(options.timeoutMs);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS) errors.push(`--timeout-ms must be an integer >= ${MIN_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS})`);
  else options.timeoutMs = timeout;
  return { options, errors: [...errors, ...validate(options)] };
}

function validate(options) {
  const errors = [];
  if (options.help) return errors;
  if (options.cleanupManifest) {
    if (!options.credentials) errors.push("--cleanup-manifest requires --credentials");
    if (!options.project) errors.push("--cleanup-manifest requires --project");
    return errors;
  }
  if (!options.baseUrl) errors.push("--base-url is required");
  else {
    try {
      const u = new URL(options.baseUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") errors.push("--base-url must be http(s)");
      if (u.pathname !== "/" || u.search || u.hash) errors.push("--base-url must be an origin without path, query or hash");
    } catch {
      errors.push("--base-url is not a valid URL");
    }
  }
  if (!options.sha) errors.push("--sha is required");
  else if (!SHA.test(options.sha)) errors.push("--sha must be a full 40-hex git sha");
  if (!options.project) errors.push("--project is required");
  else if (!PROJECT_REF.test(options.project)) errors.push("--project must be a Supabase project ref (lowercase letters and digits)");
  if (!options.credentials && !options.dryRun) errors.push("--credentials is required (except with --dry-run)");
  const remoteFlags = { deploymentReceipt: "--deployment-receipt", vercelProject: "--vercel-project", vercelTeam: "--vercel-team", vercelDeployment: "--vercel-deployment", githubRepoId: "--github-repo-id", expectedBuildId: "--expected-build-id" };
  let local = true;
  try {
    local = isLocalOrigin(options.baseUrl);
  } catch {}
  if (options.baseUrl && !local) {
    for (const [key, flag] of Object.entries(remoteFlags)) if (!options[key]) errors.push(`${flag} is required for a remote --base-url (contract §19)`);
    if (options.deploymentReceipt && !options.deploymentReceipt.startsWith("/")) errors.push("--deployment-receipt must be an absolute path");
    if (options.githubRepoId && !/^[1-9][0-9]{0,15}$/.test(options.githubRepoId)) errors.push("--github-repo-id must be a positive integer");
    if (options.expectedBuildId && !/^[A-Za-z0-9_-]{4,64}$/.test(options.expectedBuildId)) errors.push("--expected-build-id is not a build id");
  } else if (options.baseUrl) {
    for (const [key, flag] of Object.entries(remoteFlags)) if (options[key]) errors.push(`${flag} is only for a remote --base-url; local mode checks .next/BUILD_ID`);
  }
  for (const suite of options.suites) if (!SUITE_NAMES.includes(suite)) errors.push(`unknown suite ${suite}; known: ${SUITE_NAMES.join(", ")}, all`);
  if (new Set(options.suites).size !== options.suites.length) errors.push("duplicate --suite");
  return errors;
}

export const HELP = `Usage: node scripts/qa-business/run.mjs --base-url <origin> --sha <sha> --project <ref> --credentials <json>
                                        [--suite docs|b2b|all] [--app-dir <checkout>] [--out <dir outside the repo>]
                                        [--playwright-path <dir>] [--chromium-path <bin>] [--allow-base-url <origin>]...
                                        [--timeout-ms <ms, default ${DEFAULT_TIMEOUT_MS}>] [--headless|--no-headless]
                                        [--keep-fixtures] [--dry-run] [--json]
       remote mode (non-local --base-url): add --deployment-receipt <abs path, 0600, outside Git>
                                        --vercel-project <prj_…> --vercel-team <team_…> --vercel-deployment <dpl_…>
                                        --github-repo-id <int> --expected-build-id <id>
       node scripts/qa-business/run.mjs --cleanup-manifest <manifest.json> --credentials <json> --project <ref>

Suites: ${SUITE_NAMES.join(", ")} (default: all)
Contract: docs/CLAUDE_BUSINESS_QA_CONTRACT.md
`;
