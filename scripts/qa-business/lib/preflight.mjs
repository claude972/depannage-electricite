// Build identity preflight: the served application must be the build of --app-dir.
// Pure parsing here; the file read and the page fetch are done by the runner.
import { readFile } from "node:fs/promises";
import path from "node:path";

/** `<appDir>/.next/BUILD_ID`, or null when the checkout has no build (reported as "not verified"). */
export async function readLocalBuildId(appDir) {
  if (!appDir) return null;
  try {
    const text = await readFile(path.join(path.resolve(appDir), ".next", "BUILD_ID"), "utf8");
    const id = text.trim();
    return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Build id referenced by a served Next.js document (`/_next/static/<id>/…`), or null. */
export function servedBuildId(html) {
  const matches = new Set();
  for (const m of String(html).matchAll(/\/_next\/static\/([A-Za-z0-9_-]{4,64})\/(?:_buildManifest|_ssgManifest|chunks\/app\/|chunks\/main)/g)) matches.add(m[1]);
  if (matches.size === 1) return [...matches][0];
  // Fallback: any `/_next/static/<id>/` segment that is not the shared `chunks`/`css`/`media` folders.
  for (const m of String(html).matchAll(/\/_next\/static\/([A-Za-z0-9_-]{4,64})\//g)) if (!["chunks", "css", "media", "development"].includes(m[1])) matches.add(m[1]);
  return matches.size === 1 ? [...matches][0] : null;
}

/** Verdict used by the first scenario: a mismatch is an application-under-test defect (FAIL). */
export function compareBuildIds(local, served) {
  if (!local) return { verified: false, reason: "no .next/BUILD_ID in --app-dir: build identity declared, not verified" };
  if (!served) return { verified: false, reason: "served document carries no recognisable build id" };
  if (local !== served) return { verified: false, mismatch: true, reason: `served build ${served} differs from --app-dir build ${local}` };
  return { verified: true, reason: "" };
}
