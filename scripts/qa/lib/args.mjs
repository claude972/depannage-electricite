// Argument parsing and validation for scripts/qa/run.mjs. Pure: no I/O, testable with node:test.
export const SUITE_NAMES = [
  "viewer-site-grants",
  "support-stale-a-b",
  "support-lost-response",
  "quote-draft",
  "photos-recovery",
  "admin-old-dossiers",
  "captures",
];

const SHA = /^[0-9a-f]{40}$/;
const PROJECT_REF = /^[a-z0-9]{15,40}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

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
]);
export const DEFAULT_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 1000;
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
    suites: [],
    allowBaseUrls: [],
    headless: true,
    keepFixtures: false,
    dryRun: false,
    json: false,
    help: false,
  };
}

/** Parses argv (without node and script path). Returns {options, errors}. */
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
    } else {
      errors.push(`unknown argument ${arg}`);
    }
  }
  if (!options.suites.length) options.suites = [...SUITE_NAMES];
  const timeout = Number(options.timeoutMs);
  if (!Number.isInteger(timeout) || timeout < MIN_TIMEOUT_MS) errors.push(`--timeout-ms must be an integer >= ${MIN_TIMEOUT_MS} (default ${DEFAULT_TIMEOUT_MS})`);
  else options.timeoutMs = timeout;
  return { options, errors: [...errors, ...validate(options)] };
}

export function isLocalOrigin(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/** Whether a base URL may be tested: local, or listed verbatim (origin match) in an allow-list. */
export function baseUrlAllowed(url, allowList = []) {
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return { allowed: false, target: null, reason: "base URL is not a valid URL" };
  }
  if (isLocalOrigin(url)) return { allowed: true, target: "local", reason: "" };
  const allowed = allowList.some((entry) => {
    try {
      return new URL(entry).origin === origin;
    } catch {
      return false;
    }
  });
  return allowed
    ? { allowed: true, target: "remote-allowed", reason: "" }
    : { allowed: false, target: null, reason: `base URL ${origin} is neither local nor in the allow-list` };
}

function validate(options) {
  const errors = [];
  if (options.help) return errors;
  const onlyCaptures = options.suites.length === 1 && options.suites[0] === "captures";
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
  if (!onlyCaptures) {
    if (!options.project) errors.push("--project is required");
    else if (!PROJECT_REF.test(options.project)) errors.push("--project must be a Supabase project ref (lowercase letters and digits)");
    if (!options.credentials && !options.dryRun) errors.push("--credentials is required (except for the captures-only run)");
  } else if (options.project && !PROJECT_REF.test(options.project)) {
    errors.push("--project must be a Supabase project ref (lowercase letters and digits)");
  }
  for (const suite of options.suites)
    if (!SUITE_NAMES.includes(suite)) errors.push(`unknown suite ${suite}; known: ${SUITE_NAMES.join(", ")}`);
  if (new Set(options.suites).size !== options.suites.length) errors.push("duplicate --suite");
  return errors;
}

export const HELP = `Usage: node scripts/qa/run.mjs --base-url <url> --sha <sha> --project <ref> --credentials <json>
                               [--suite <name>]... [--headless|--no-headless] [--out <dir>]
                               [--playwright-path <dir>] [--chromium-path <bin>] [--app-dir <checkout>]
                               [--allow-base-url <origin>]... [--timeout-ms <ms, default 90000>]
                               [--keep-fixtures] [--dry-run] [--json]
       node scripts/qa/run.mjs --cleanup-manifest <manifest.json> --credentials <json> --project <ref>

Suites: ${SUITE_NAMES.join(", ")}
Contract: docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md
`;
