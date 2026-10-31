// Credentials loading and preflight refusals (contract §2 and §4). Nothing here touches the
// network; the service key is handed to the Supabase client only.
import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { baseUrlAllowed } from "./args.mjs";

const execFileAsync = promisify(execFile);
const PROJECT_REF = /^[a-z0-9]{15,40}$/;

export class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}

/** Reads and validates the credentials file shape. Returns the parsed object (never logged). */
export async function loadCredentials(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    throw new PreflightError(`credentials file unreadable: ${error.code || error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PreflightError("credentials file is not valid JSON");
  }
  const sb = parsed?.supabase;
  if (!sb || typeof sb !== "object") throw new PreflightError("credentials: missing `supabase` object");
  if (typeof sb.url !== "string" || !/^https:\/\/[a-z0-9]+\.supabase\.(co|in|red)$/.test(sb.url) && !/^https?:\/\/[^/]+$/.test(sb.url))
    throw new PreflightError("credentials: `supabase.url` must be an https origin");
  if (typeof sb.service_role_key !== "string" || sb.service_role_key.length < 20) throw new PreflightError("credentials: `supabase.service_role_key` missing");
  const refFromUrl = new URL(sb.url).hostname.split(".")[0];
  const ref = typeof sb.project_ref === "string" ? sb.project_ref : refFromUrl;
  if (!PROJECT_REF.test(ref)) throw new PreflightError("credentials: `supabase.project_ref` is not a project ref");
  if (sb.project_ref && refFromUrl !== sb.project_ref && /\.supabase\./.test(sb.url))
    throw new PreflightError("credentials: `supabase.project_ref` does not match `supabase.url`");
  const allowed = Array.isArray(parsed.allowed_base_urls) ? parsed.allowed_base_urls.filter((s) => typeof s === "string") : [];
  try {
    const info = await stat(filePath);
    if (info.mode & 0o077) process.stderr.write("warning: credentials file is readable by other users (recommended mode 0600)\n");
  } catch {}
  return { supabase: { url: sb.url.replace(/\/$/, ""), projectRef: ref, serviceKey: sb.service_role_key }, allowedBaseUrls: allowed };
}

/** Refuses a project mismatch between --project and the credentials. */
export function assertProject(expectedRef, credentials) {
  if (!credentials) return;
  if (credentials.supabase.projectRef !== expectedRef)
    throw new PreflightError(`--project ${expectedRef} does not match the configured Supabase project (credentials point elsewhere); refusing to run`);
}

/** Refuses a base URL that is neither local nor explicitly allowed. Returns the target label. */
export function assertBaseUrl(baseUrl, allowLists) {
  const verdict = baseUrlAllowed(baseUrl, allowLists.flat());
  if (!verdict.allowed) throw new PreflightError(`${verdict.reason}; refusing to run`);
  return verdict.target;
}

/** With --app-dir: compares HEAD to --sha. Returns {verified:boolean, head:string|null}. */
export async function verifySha(sha, appDir) {
  if (!appDir) return { verified: false, head: null };
  let head;
  try {
    const { stdout } = await execFileAsync("git", ["-C", appDir, "rev-parse", "HEAD"]);
    head = stdout.trim();
  } catch (error) {
    throw new PreflightError(`cannot read HEAD of --app-dir: ${error.message}`);
  }
  if (head !== sha) throw new PreflightError(`--sha ${sha} differs from HEAD ${head} of --app-dir; refusing to run`);
  return { verified: true, head };
}

/** Default evidence directory, outside any repository. */
export function defaultOutDir(sha, runId) {
  return path.join(os.tmpdir(), "depannage-qa", `${sha.slice(0, 12)}-${runId}`);
}

/** Refuses an --out located inside a git work tree (QA data must never reach the bundle). */
export async function assertOutOutsideRepo(outDir) {
  const absolute = path.resolve(outDir);
  try {
    const { stdout } = await execFileAsync("git", ["-C", path.dirname(absolute), "rev-parse", "--show-toplevel"]);
    const top = stdout.trim();
    if (top && absolute.startsWith(top + path.sep)) throw new PreflightError(`--out ${absolute} is inside the git work tree ${top}; choose a directory outside the repository`);
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    // not a git directory: fine
  }
  return absolute;
}
