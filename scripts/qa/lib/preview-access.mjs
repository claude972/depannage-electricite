// QA-PREVIEW-ACCESS-001 — access to a Vercel-protected PREVIEW deployment with ONLY the Vercel
// protection cookie `_vercel_jwt`. Contract: docs/QA_PREVIEW_ACCESS_CONTRACT.md (de376db + A1–A6).
// No proxy, no global fetch patch, no bypass token, no app-auth shortcut. The cookie is injected
// into Playwright contexts for the EXACT deployment host, sent by Node only to the same origin, and
// a browser route guard aborts (and reports as a defect) any request carrying it to another origin.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { PreflightError, assertOutOutsideRepo } from "./config.mjs";

export const COOKIE_NAME = "_vercel_jwt";
/** Real `main` alias, refused whatever the allow-list says (A2). */
export const FORBIDDEN_ORIGINS = Object.freeze(["https://depannage-electricite-seven.vercel.app"]);
export const MAX_STATE_BYTES = 16 * 1024;
export const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
export const SESSION_EXPORT_MAX_AGE_MS = 30 * 60 * 1000;
export const MAX_REDIRECTS = 3;
const COOKIE_KEYS = ["domain", "expires", "httpOnly", "name", "path", "sameSite", "secure", "value"];
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const FORBIDDEN_TEXT = [/x-vercel-protection-bypass/i, /x-vercel-set-bypass-cookie/i, /service_role/i, /sb_secret_/i, /sb-[a-z0-9]+-auth-token/i, /access_token/i, /refresh_token/i];
const REDIRECT = new Set([301, 302, 303, 307, 308]);

const foreign = (why) => new PreflightError(`preview access refused: foreign state (« état étranger ») — ${why}`);

/**
 * Validates the base origin for a preview run: bare https origin on *.vercel.app, not forbidden.
 * Returns the normalised origin.
 */
export function assertPreviewOrigin(baseUrl, forbidOrigins = []) {
  let u;
  try {
    u = new URL(baseUrl);
  } catch {
    throw new PreflightError("preview access refused: --base-url is not a valid URL");
  }
  if (u.protocol !== "https:") throw new PreflightError("preview access refused: a protected preview must be served over https");
  if (u.username || u.password || u.port || u.pathname !== "/" || u.search || u.hash) throw new PreflightError("preview access refused: --base-url must be a bare https origin");
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(".vercel.app") || host === "vercel.app") throw new PreflightError("preview access refused: the base origin must be a *.vercel.app deployment host");
  const forbidden = [...FORBIDDEN_ORIGINS, ...forbidOrigins].map((o) => {
    try {
      return new URL(o).origin.toLowerCase();
    } catch {
      return String(o).toLowerCase();
    }
  });
  if (forbidden.includes(u.origin.toLowerCase())) throw new PreflightError(`preview access refused: ${u.origin} is a forbidden production/main origin`);
  return u.origin.toLowerCase();
}

/** Pure validation of the parsed state against the exact host (no I/O). Returns the cookie. */
export function validateState(state, { host, now, maxRunMs, maxRunExplicit, exportedAt }) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw foreign("not a storage-state object");
  const top = Object.keys(state).sort();
  if (top.length !== 2 || top[0] !== "cookies" || top[1] !== "origins") throw foreign("top-level keys must be exactly cookies and origins");
  if (!Array.isArray(state.origins) || state.origins.length !== 0) throw foreign("origins/localStorage entries are not allowed");
  if (!Array.isArray(state.cookies) || state.cookies.length !== 1) throw foreign("exactly one cookie is allowed");
  const cookie = state.cookies[0];
  if (!cookie || typeof cookie !== "object" || Array.isArray(cookie)) throw foreign("malformed cookie");
  const keys = Object.keys(cookie).sort();
  if (keys.length !== COOKIE_KEYS.length || keys.some((k, i) => k !== COOKIE_KEYS[i])) throw foreign("cookie fields must be exactly name, value, domain, path, expires, httpOnly, secure, sameSite");
  if (cookie.name !== COOKIE_NAME) throw foreign(`only the ${COOKIE_NAME} cookie is allowed`);
  if (typeof cookie.domain !== "string" || cookie.domain !== host) throw foreign("cookie domain must be the exact deployment host (no parent domain, no leading dot, no wildcard)");
  if (cookie.path !== "/") throw foreign("cookie path must be /");
  if (cookie.secure !== true) throw foreign("cookie must be secure");
  if (cookie.httpOnly !== true) throw foreign("cookie must be httpOnly");
  if (!["Lax", "Strict", "None"].includes(cookie.sameSite)) throw foreign("cookie sameSite must be Lax, Strict or None");
  if (typeof cookie.value !== "string" || cookie.value.length < 32 || cookie.value.length > 4096 || !JWT.test(cookie.value)) throw foreign("cookie value is not a compact JWT");
  // Lifetime: point OPEN (A5) until root confirms the real cookie. No expiry is ever invented.
  if (typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)) throw foreign("cookie expires must be a number");
  if (cookie.expires === -1) {
    if (!maxRunExplicit) throw new PreflightError("preview access refused: a session cookie needs an explicit --max-run-ms");
    if (!Number.isFinite(exportedAt) || now - exportedAt > SESSION_EXPORT_MAX_AGE_MS || exportedAt - now > 60000) throw new PreflightError("preview access refused: a session cookie needs a fresh export (state file modified within 30 minutes)");
  } else if (cookie.expires > 0) {
    if (cookie.expires * 1000 < now + maxRunMs + EXPIRY_MARGIN_MS) throw new PreflightError("preview access refused: the preview access cookie is expired or expires during the run");
  } else throw foreign("cookie expires must be -1 (session) or a positive Unix time");
  return { ...cookie };
}

/** Whether a request (url, header map, body) carries the secret value. */
export function carriesValue(value, { url = "", headers = {}, body = "" } = {}) {
  if (!value) return false;
  const encoded = encodeURIComponent(value);
  const hit = (text) => typeof text === "string" && (text.includes(value) || text.includes(encoded));
  if (hit(url) || hit(body)) return true;
  return Object.values(headers || {}).some((v) => hit(String(v)));
}

/**
 * Loads and validates the private state file. Never logs the value; registers it (and its parts)
 * with the redactor BEFORE returning. Throws PreflightError (exit 2) on any refusal.
 */
export async function loadPreviewAccess(file, { baseOrigin, maxRunMs, maxRunExplicit = false, redactor, forbidOrigins = [], now = Date.now(), fetchImpl = globalThis.fetch, getuid = () => process.getuid?.() } = {}) {
  if (!redactor || typeof redactor.add !== "function") throw new PreflightError("preview access refused: a redactor is required");
  const origin = assertPreviewOrigin(baseOrigin, forbidOrigins);
  const host = new URL(origin).hostname;
  if (!Number.isInteger(maxRunMs) || maxRunMs < 1000) throw new PreflightError("preview access refused: --max-run-ms must be an integer >= 1000");
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new PreflightError("preview access refused: --preview-access must be an absolute path");
  await assertOutOutsideRepo(file).catch((error) => {
    throw new PreflightError(`preview access refused: the state file must be outside any git work tree (${error instanceof PreflightError ? "inside a repository" : "unreadable path"})`);
  });
  let info;
  try {
    info = await lstat(file);
  } catch {
    throw new PreflightError("preview access refused: state file not found");
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new PreflightError("preview access refused: the state file must be a regular file (no symlink)");
  const uid = getuid();
  if (uid !== undefined && info.uid !== uid) throw new PreflightError("preview access refused: the state file must be owned by the current user");
  if ((info.mode & 0o777) !== 0o600) throw new PreflightError("preview access refused: the state file mode must be exactly 0600");
  if (info.size > MAX_STATE_BYTES) throw new PreflightError("preview access refused: the state file is too large");
  const text = await readFile(file, "utf8");
  if (FORBIDDEN_TEXT.some((re) => re.test(text))) throw foreign("the file contains a forbidden secret marker (bypass token, service key or app session)");
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw foreign("not valid JSON");
  }
  const cookie = validateState(state, { host, now, maxRunMs, maxRunExplicit, exportedAt: info.mtimeMs });
  const value = cookie.value;
  redactor.add(value);
  for (const part of value.split(".")) redactor.add(part);
  redactor.add(encodeURIComponent(value));
  redactor.add(`${COOKIE_NAME}=${value}`);
  return createPreviewHandle({ origin, host, cookie, fetchImpl });
}

/** Handle over an already validated cookie (exported for tests; production code uses loadPreviewAccess). */
export function createPreviewHandle({ origin, host, cookie, fetchImpl = globalThis.fetch }) {
  const value = cookie.value;
  const expiresAt = cookie.expires > 0 ? new Date(cookie.expires * 1000).toISOString() : "session";
  const applied = new WeakSet();
  const leaks = [];
  const handle = {
    origin,
    host,
    leaks,
    /** Public description: host and expiry only, never the value. */
    describe() {
      return { host, origin, cookie: COOKIE_NAME, expires_at: expiresAt };
    },
    /** Injects the cookie for the exact host into a Playwright context, once. */
    async applyToContext(context) {
      if (applied.has(context)) return;
      await context.addCookies([{ name: COOKIE_NAME, value, domain: host, path: "/", expires: cookie.expires, httpOnly: true, secure: true, sameSite: cookie.sameSite }]);
      applied.add(context);
    },
    /** Leak predicate shared by the context guard and the page-level safeRoute check. */
    async leaksToOtherOrigin(request) {
      let url;
      try {
        url = new URL(request.url());
      } catch {
        return false;
      }
      if (url.origin.toLowerCase() === origin) return false;
      let headers = {};
      try {
        headers = typeof request.allHeaders === "function" ? await request.allHeaders() : request.headers();
      } catch {
        headers = request.headers?.() || {};
      }
      let body = "";
      try {
        body = request.postData?.() || "";
      } catch {}
      return carriesValue(value, { url: request.url(), headers, body });
    },
    /** Records a leak without the value (host + method only). */
    recordLeak(request, where) {
      let target = "unknown";
      try {
        target = new URL(request.url()).origin;
      } catch {}
      const entry = { at: new Date().toISOString(), where, method: request.method?.() || "?", target_origin: target };
      leaks.push(entry);
      return entry;
    },
    /**
     * Context-level guard (defence in depth). Page-level handlers run first (Playwright order);
     * this guard never fetches, never retries: it either aborts a leaking request or falls back.
     */
    async guard(context, onLeak = () => {}) {
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (await handle.leaksToOtherOrigin(request)) {
          const entry = handle.recordLeak(request, "context-guard");
          try {
            onLeak(entry);
          } catch {}
          await route.abort("blockedbyclient").catch(() => {});
          return;
        }
        await route.fallback().catch(() => {});
      });
    },
    /**
     * Same-origin Node fetch carrying the cookie. Redirects are handled manually: same origin
     * only, the cookie never reaches another host, a non-GET/HEAD request is never replayed.
     */
    async sameOriginFetch(target, init = {}) {
      let url = new URL(target, origin);
      if (url.origin.toLowerCase() !== origin) throw new Error("preview sameOriginFetch refused: cross-origin target (the cookie is never sent to another origin)");
      const method = String(init.method || "GET").toUpperCase();
      const given = new Headers(init.headers || {});
      for (const name of given.keys()) if (name === "cookie" || name === "authorization" || name.startsWith("x-vercel-")) throw new Error(`preview sameOriginFetch refused: header ${name} must not be supplied by the caller`);
      for (let hop = 0; ; hop++) {
        const headers = new Headers(given);
        headers.set("cookie", `${COOKIE_NAME}=${value}`);
        const response = await fetchImpl(url, { ...init, method, headers, redirect: "manual" });
        if (!REDIRECT.has(response.status)) return response;
        if (method !== "GET" && method !== "HEAD") throw new Error(`preview sameOriginFetch refused: ${response.status} redirect on ${method} is never replayed`);
        if (hop >= MAX_REDIRECTS) throw new Error("preview sameOriginFetch refused: too many redirects");
        const location = response.headers.get("location");
        if (!location) throw new Error("preview sameOriginFetch refused: redirect without Location");
        const next = new URL(location, url);
        if (next.origin.toLowerCase() !== origin) throw new Error("preview sameOriginFetch refused: redirect to another origin (cookie not forwarded)");
        url = next;
      }
    },
  };
  return handle;
}
