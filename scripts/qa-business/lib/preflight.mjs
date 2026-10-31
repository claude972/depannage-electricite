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

export const BUILD_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Arguments of every `self.__next_f.push(<array>)` call in the HTML, parsed as JSON. The argument is
 * scanned with a string-aware bracket matcher (no regex over the payload); a call whose argument is
 * not valid JSON is skipped and counted.
 */
export function flightPushes(html) {
  const text = String(html);
  const marker = "self.__next_f.push(";
  const pushes = [];
  let invalid = 0;
  let at = 0;
  while ((at = text.indexOf(marker, at)) >= 0) {
    let i = at + marker.length;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== "[") {
      // null, object, string, number…: not a Flight push. Counted, never skipped silently.
      invalid++;
      at = i;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    let end = -1;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "[") depth++;
      else if (c === "]" && --depth === 0) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      invalid++;
      break;
    }
    // The array must be the whole argument: only whitespace, then the closing parenthesis.
    let k = end + 1;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (text[k] !== ")") {
      invalid++;
      at = end + 1;
      continue;
    }
    try {
      const value = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(value)) pushes.push(value);
      else invalid++;
    } catch {
      invalid++;
    }
    at = k + 1;
  }
  return { pushes, invalid };
}

/**
 * Build id carried by the React Server Components Flight payload of a Next.js App Router page:
 * the string chunks pushed with type 1 are concatenated, split into `<row id>:<payload>` lines, and
 * the ROOT row (`0:`) is parsed as JSON; its `b` key is the build id (Next 15/16 initial tree).
 * Only that key of that row is read; a value outside the build-id charset is ignored.
 */
export function flightBuildIds(html) {
  const { pushes, invalid } = flightPushes(html);
  const flight = pushes.filter((p) => Array.isArray(p) && p[0] === 1 && typeof p[1] === "string").map((p) => p[1]).join("");
  const ids = [];
  for (const line of flight.split("\n")) {
    const sep = line.indexOf(":");
    if (sep <= 0 || line.slice(0, sep) !== "0") continue;
    const payload = line.slice(sep + 1);
    if (!payload.startsWith("{")) continue;
    let root;
    try {
      root = JSON.parse(payload);
    } catch {
      continue;
    }
    if (root && typeof root === "object" && !Array.isArray(root) && typeof root.b === "string" && BUILD_ID_RE.test(root.b)) ids.push(root.b);
  }
  return { ids: [...new Set(ids)], pushes: pushes.length, invalid };
}

/** Legacy marker: `/_next/static/<id>/_buildManifest.js|_ssgManifest.js` (Pages Router / older builds). */
export function staticBuildIds(html) {
  const ids = new Set();
  for (const m of String(html).matchAll(/\/_next\/static\/([A-Za-z0-9_-]{4,64})\/(?:_buildManifest\.js|_ssgManifest\.js)/g)) ids.add(m[1]);
  return [...ids];
}

/**
 * Served build identity: Flight root `b` first, `/_next/static/<id>/` manifests as fallback. Never
 * read from a URL query. Several distinct candidates (in either source, or across both) are
 * AMBIGUOUS; none is UNVERIFIED; any malformed push is INVALID (id null). Returns
 * {id|null, source: flight|static|ambiguous|none|invalid, candidates, ambiguous[, invalid]}.
 */
export function servedBuildIdentity(html) {
  const parsed = flightBuildIds(html);
  // Strict parser for received data: any malformed push makes the page unusable as evidence.
  if (parsed.invalid > 0) return { id: null, source: "invalid", candidates: parsed.ids, ambiguous: false, invalid: parsed.invalid };
  const flight = parsed.ids;
  const legacy = staticBuildIds(html);
  const candidates = [...new Set([...flight, ...legacy])];
  if (candidates.length > 1) return { id: null, source: "ambiguous", candidates, ambiguous: true };
  if (flight.length === 1) return { id: flight[0], source: "flight", candidates, ambiguous: false };
  if (legacy.length === 1) return { id: legacy[0], source: "static", candidates, ambiguous: false };
  return { id: null, source: "none", candidates, ambiguous: false };
}
/** Compatibility helper: the served id when unambiguous, else null. */
export function servedBuildId(html) {
  return servedBuildIdentity(html).id;
}

/** Verdict used by the first scenario: a mismatch is an application-under-test defect (FAIL). */
export function compareBuildIds(local, served, identity = null) {
  if (!local) return { verified: false, reason: "no .next/BUILD_ID in --app-dir: build identity declared, not verified" };
  if (identity?.source === "invalid") return { verified: false, invalid: true, reason: `served document carries ${identity.invalid} malformed Flight push(es): not attributable` };
  if (identity?.ambiguous) return { verified: false, ambiguous: true, reason: `served document carries several build ids (${identity.candidates.join(", ")}): ambiguous, not attributable` };
  if (!served) return { verified: false, reason: "served document carries no recognisable build id" };
  if (local !== served) return { verified: false, mismatch: true, reason: `served build ${served} differs from --app-dir build ${local}` };
  return { verified: true, reason: "" };
}
