// CLI parsing for scripts/qa-realtime/run.mjs. Pure.
import { MEASUREMENT_NAMES, EXPECTED_SDK } from "./constants.mjs";

export const HELP = `Usage: node scripts/qa-realtime/run.mjs --credentials <json> --project <ref> --playwright <path>
  --confirm-no-active-cohort [--app-dir <dir>] [--expect-sdk ${EXPECTED_SDK}] [--only app-4,pub-3,int-1,app-4-wait]
  [--out <dir>] [--chromium <path>] [--timeout-ms n] [--keep-fixtures] [--headed] [--json] [--dry-run]
  [--cleanup-manifest <manifest.json> --credentials <json> --project <ref>]

WEB-REALTIME-PROBE-001 — bounded Realtime diagnostic (docs/REALTIME_DIAGNOSTIC_CONTRACT.md). QA page only,
not the production UI; no claim of UI proof. Run by ROOT only. Exit codes: 0 diagnostic completed,
1 FATAL, 2 BLOCKED / preflight refusal, 3 cleanup incomplete or unknown outcome, 130 interrupted.
`;

const VALUE = { "--credentials": "credentials", "--project": "project", "--playwright": "playwrightPath", "--app-dir": "appDir", "--expect-sdk": "expectSdk", "--only": "only", "--out": "out", "--chromium": "chromiumPath", "--timeout-ms": "timeoutMs", "--cleanup-manifest": "cleanupManifest" };
const BOOL = { "--confirm-no-active-cohort": "confirmNoActiveCohort", "--keep-fixtures": "keepFixtures", "--headed": "headed", "--json": "json", "--dry-run": "dryRun", "--help": "help", "-h": "help" };

export function parseArgs(argv, env = {}) {
  const options = { credentials: null, project: null, playwrightPath: env.QA_PLAYWRIGHT_PATH || null, appDir: process.cwd(), expectSdk: EXPECTED_SDK, only: null, out: null, chromiumPath: env.QA_CHROMIUM_PATH || "", timeoutMs: 90000, cleanupManifest: null, confirmNoActiveCohort: false, keepFixtures: false, headed: false, json: false, dryRun: false, help: false, measurements: [...MEASUREMENT_NAMES] };
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (BOOL[flag]) {
      options[BOOL[flag]] = true;
      continue;
    }
    const key = VALUE[flag];
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
    options[key] = value;
  }
  if (options.help) return { options, errors: [] };
  options.timeoutMs = Number(options.timeoutMs);
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 5000 || options.timeoutMs > 600000) errors.push("--timeout-ms must be an integer between 5000 and 600000");
  if (options.only) {
    const wanted = options.only.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((s) => !MEASUREMENT_NAMES.includes(s));
    if (unknown.length) errors.push(`--only: unknown measurement(s) ${unknown.join(", ")}`);
    options.measurements = MEASUREMENT_NAMES.filter((s) => wanted.includes(s));
  }
  if (!options.credentials && !options.dryRun) errors.push("--credentials is required (except --dry-run)");
  if (!options.project) errors.push("--project is required");
  if (options.cleanupManifest) return { options, errors };
  if (!options.dryRun) {
    if (!options.playwrightPath) errors.push("--playwright (or QA_PLAYWRIGHT_PATH) is required (except --dry-run)");
    if (!options.confirmNoActiveCohort) errors.push("--confirm-no-active-cohort is required: ROOT confirms that no QA cohort is active");
  }
  if (!/^\d+\.\d+\.\d+$/.test(options.expectSdk)) errors.push("--expect-sdk must be x.y.z");
  return { options, errors };
}
