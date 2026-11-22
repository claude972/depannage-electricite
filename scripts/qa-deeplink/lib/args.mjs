// CLI parsing for scripts/qa-deeplink/run.mjs. Pure: no file or network access. Provenance flags are
// those of tracking A7 (REMOTE_FLAGS imported read-only) so checkBuildProvenance applies unchanged.
import { REMOTE_FLAGS } from "../../qa-tracking/lib/args.mjs";
import { SCENARIOS } from "./constants.mjs";

export const DEFAULT_TIMEOUT_MS = 90000;
export const HELP = `Usage: node scripts/qa-deeplink/run.mjs --mode remote|local --base-url <url> --sha <sha> --build-id <id> --project <ref> \\
  --credentials <json> --playwright <path>
  REMOTE: --deployment-receipt <abs path> --vercel-project-id <prj_…> --vercel-team-id <team_…>
  --vercel-deployment-id <dpl_…> --git-repo-id <int> --git-ref <ref>   (LOCAL: loopback --base-url, none of these)
  [--only D1,D2,D3,D4] [--out <dir>] [--dry-run] [--keep-fixtures] [--cleanup-manifest <manifest.json>]
  [--timeout-ms n] [--app-dir <dir>] [--chromium <path>] [--allow-base-url <url>] [--headed] [--json]

WEB-DEEPLINK-QA-001 — deep-link defence acceptance (docs/CLAUDE_DEEPLINK_QA_CONTRACT.md).
Realtime is BLOCKED on purpose (fallback only): LIVE-WORKSPACE-001 effectiveness is not proven here.
Run by ROOT only. Exit codes: 0 no FAIL, 1 FAIL/FATAL, 2 preflight refusal, 3 cleanup incomplete or unknown
outcome, 130 interrupted (cleanup complete).
`;

const VALUE_FLAGS = {
  "--base-url": "baseUrl", "--sha": "sha", "--build-id": "buildId", "--project": "project", "--credentials": "credentials",
  "--playwright": "playwrightPath", "--out": "out", "--only": "only", "--cleanup-manifest": "cleanupManifest", "--timeout-ms": "timeoutMs",
  "--app-dir": "appDir", "--chromium": "chromiumPath", "--allow-base-url": "allowBaseUrl", "--mode": "mode",
  ...Object.fromEntries(REMOTE_FLAGS),
};
const BOOL_FLAGS = { "--dry-run": "dryRun", "--keep-fixtures": "keepFixtures", "--headed": "headed", "--json": "json", "--help": "help", "-h": "help" };
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseArgs(argv, env = {}) {
  const options = {
    baseUrl: null, sha: null, buildId: null, project: null, credentials: null, mode: null,
    receiptPath: null, vercelProjectId: null, vercelTeamId: null, vercelDeploymentId: null, gitRepoId: null, gitRef: null,
    playwrightPath: env.QA_PLAYWRIGHT_PATH || null, out: null, only: null, cleanupManifest: null, timeoutMs: DEFAULT_TIMEOUT_MS,
    appDir: process.cwd(), chromiumPath: env.QA_CHROMIUM_PATH || "", allowBaseUrls: [], dryRun: false, keepFixtures: false,
    headed: false, json: false, help: false, scenarios: [...SCENARIOS],
  };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (BOOL_FLAGS[flag]) {
      options[BOOL_FLAGS[flag]] = true;
      continue;
    }
    const key = VALUE_FLAGS[flag];
    if (!key) {
      errors.push(`unknown argument ${flag}`);
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) {
      errors.push(`${flag} needs a value`);
      if (value !== undefined) i--;
      continue;
    }
    if (key === "allowBaseUrl") options.allowBaseUrls.push(value);
    else options[key] = value;
  }
  if (options.help) return { options, errors: [] };
  options.timeoutMs = Number(options.timeoutMs);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5000 || options.timeoutMs > 600000) errors.push("--timeout-ms must be an integer between 5000 and 600000");
  if (options.only) {
    const wanted = options.only.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((s) => !SCENARIOS.includes(s));
    if (unknown.length) errors.push(`--only: unknown scenario(s) ${unknown.join(", ")}`);
    options.scenarios = SCENARIOS.filter((s) => wanted.includes(s));
  }
  if (options.cleanupManifest) {
    if (!options.credentials) errors.push("--cleanup-manifest needs --credentials");
    if (!options.project) errors.push("--cleanup-manifest needs --project");
    return { options, errors };
  }
  for (const [flag, key] of [["--base-url", "baseUrl"], ["--sha", "sha"], ["--project", "project"]]) if (!options[key]) errors.push(`${flag} is required`);
  if (options.sha && !/^[0-9a-f]{40}$/.test(options.sha)) errors.push("--sha must be a full 40-character commit SHA");
  if (options.buildId !== null && !/^[A-Za-z0-9_-]{6,64}$/.test(options.buildId)) errors.push("--build-id must be 6–64 characters [A-Za-z0-9_-]");
  if (!options.dryRun) {
    if (!options.credentials) errors.push("--credentials is required (except --dry-run)");
    if (!options.playwrightPath) errors.push("--playwright (or QA_PLAYWRIGHT_PATH) is required (except --dry-run)");
    if (!options.buildId) errors.push("--build-id is required (except --dry-run)");
    if (options.mode === null) errors.push("--mode remote|local is required (except --dry-run)");
  }
  if (options.mode !== null && options.mode !== "remote" && options.mode !== "local") errors.push("--mode must be remote or local");
  if (options.mode === "remote") {
    for (const [flag, key] of REMOTE_FLAGS) if (!options[key]) errors.push(`${flag} is required in --mode remote`);
    if (options.gitRepoId !== null) {
      if (!/^[1-9][0-9]{0,15}$/.test(String(options.gitRepoId)) || !Number.isSafeInteger(Number(options.gitRepoId))) errors.push("--git-repo-id must be a positive decimal integer");
      else options.gitRepoId = Number(options.gitRepoId);
    }
    if (options.receiptPath !== null && !options.receiptPath.startsWith("/")) errors.push("--deployment-receipt must be an absolute path");
  } else {
    for (const [flag, key] of REMOTE_FLAGS) if (options[key] !== null) errors.push(`${flag} is only accepted with --mode remote`);
  }
  if (options.baseUrl) {
    try {
      const u = new URL(options.baseUrl);
      if (!/^https?:$/.test(u.protocol)) errors.push("--base-url must be http(s)");
      if (u.search || u.hash || (u.pathname && u.pathname !== "/")) errors.push("--base-url must be an origin without path, query or hash");
      if (options.mode === "local" && !LOOPBACK.has(u.hostname)) errors.push("--mode local needs a loopback --base-url (localhost, 127.0.0.1, [::1])");
      if (options.mode === "remote" && u.protocol !== "https:") errors.push("--mode remote needs an https --base-url");
    } catch {
      errors.push("--base-url is not a URL");
    }
  }
  return { options, errors };
}
