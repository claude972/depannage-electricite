// Auth admin reads for ownership proof and intent recovery (service key in this closure only;
// nothing logged). Root review P2-c/P2-d:
//  * every read validates an EXACT schema (id = the requested UUID, e-mail string); a 200 with a
//    malformed or partial body is UNKNOWN — never "absent", never "owned";
//  * only a real 404 proves the absence of a user by id;
//  * a search by e-mail scans ALL list pages and is exhaustive only when the end of the list is
//    proven (a page shorter than per_page, or the documented total reached); any page error or
//    malformed page makes the search UNKNOWN;
//  * after a lost create response, the search is repeated (spaced re-reads) until a declared
//    deadline: one absence is never proof. Absent after the deadline with every scan exhaustive is
//    "not-found-exhaustive" — still not proof of non-creation: the caller keeps the intent open.
import { assertCanonicalEmail } from "./ownership.mjs";
import { UUID } from "../../qa/lib/cohort.mjs";

export const AUTH_SEARCH_DEFAULTS = Object.freeze({ perPage: 200, maxPages: 50, attempts: 4, intervalMs: 3000, deadlineMs: 15000 });

/** Exact schema of a GET /auth/v1/admin/users/{id} body. */
export function parseUserBody(body, expectedId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, why: "body is not an object" };
  if (typeof body.id !== "string" || !UUID.test(body.id)) return { ok: false, why: "id missing or not a UUID" };
  if (body.id.toLowerCase() !== String(expectedId).toLowerCase()) return { ok: false, why: "id differs from the requested id" };
  if (typeof body.email !== "string" || !body.email.includes("@")) return { ok: false, why: "email missing" };
  return { ok: true, user: { id: body.id.toLowerCase(), email: body.email.toLowerCase() } };
}

/** Exact schema of one list page: {users:[{id, email}…]}; e-mail may be null for phone users. */
export function parseListBody(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.users)) return { ok: false, why: "users array missing" };
  const users = [];
  for (const u of body.users) {
    if (!u || typeof u !== "object" || typeof u.id !== "string" || !UUID.test(u.id)) return { ok: false, why: "a user entry has no valid id" };
    if (!(u.email === null || u.email === undefined || typeof u.email === "string")) return { ok: false, why: "a user entry has a malformed email" };
    users.push({ id: u.id.toLowerCase(), email: typeof u.email === "string" ? u.email.toLowerCase() : null });
  }
  return { ok: true, users };
}

export function createAuthAdmin({ url, serviceKey, timeoutMs = 90000, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), search = {} }) {
  const base = url.replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const get = (path) => fetchFn(`${base}${path}`, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  const options = { ...AUTH_SEARCH_DEFAULTS, ...search };
  const readJson = async (response) => {
    try {
      return { ok: true, body: JSON.parse(await response.text()) };
    } catch {
      return { ok: false };
    }
  };

  /** One exhaustive scan of every page. */
  async function scan(email) {
    let seen = 0;
    for (let page = 1; page <= options.maxPages; page++) {
      let response;
      try {
        response = await get(`/auth/v1/admin/users?page=${page}&per_page=${options.perPage}`);
      } catch (error) {
        return { state: "unknown", why: `page ${page}: ${String(error?.name || "transport error")}` };
      }
      if (response.status !== 200) return { state: "unknown", why: `page ${page}: status ${response.status}` };
      const json = await readJson(response);
      const parsed = json.ok ? parseListBody(json.body) : { ok: false, why: "body not JSON" };
      if (!parsed.ok) return { state: "unknown", why: `page ${page}: ${parsed.why}` };
      const hit = parsed.users.find((u) => u.email === email);
      if (hit) return { state: "found", id: hit.id };
      seen += parsed.users.length;
      // End of list proven only by a short page or a PRESENT, valid total (an absent header is not 0).
      const rawTotal = response.headers?.get?.("x-total-count");
      const total = rawTotal !== null && rawTotal !== undefined && /^\d+$/.test(rawTotal) ? Number(rawTotal) : null;
      if (parsed.users.length < options.perPage || (total !== null && seen >= total)) return { state: "exhausted", pages: page };
    }
    return { state: "unknown", why: `end of the list not reached within ${options.maxPages} pages` };
  }

  return {
    /** {state:"found", email} | {state:"absent"} (real 404 only) | {state:"unknown", why}. */
    async readUser(id) {
      let response;
      try {
        response = await get(`/auth/v1/admin/users/${encodeURIComponent(id)}`);
      } catch (error) {
        return { state: "unknown", why: String(error?.name || "transport error") };
      }
      if (response.status === 404) return { state: "absent" };
      if (response.status !== 200) return { state: "unknown", why: `status ${response.status}` };
      const json = await readJson(response);
      const parsed = json.ok ? parseUserBody(json.body, id) : { ok: false, why: "body not JSON" };
      return parsed.ok ? { state: "found", email: parsed.user.email } : { state: "unknown", why: parsed.why };
    },
    /**
     * Search by canonical e-mail after an unknown create: exhaustive scans repeated `attempts`
     * times, spaced by `intervalMs`, within `deadlineMs`. {state:"found", id} as soon as seen;
     * {state:"unknown"} if any scan was not exhaustive; {state:"not-found-exhaustive"} only when
     * every scan was exhaustive AND the deadline passed. Never "not created".
     */
    async searchByEmail(email, runId) {
      assertCanonicalEmail(email, runId);
      const started = now();
      let attempts = 0;
      let unknown = null;
      // Spaced re-reads until BOTH the attempt count and the declared deadline are reached.
      for (;;) {
        attempts++;
        const result = await scan(email);
        if (result.state === "found") return { ...result, attempts };
        if (result.state === "unknown") unknown = result.why;
        if (attempts >= options.attempts && now() - started >= options.deadlineMs) break;
        if (attempts >= options.attempts * 10) break; // hard bound if the clock does not advance
        await sleep(options.intervalMs);
      }
      return unknown ? { state: "unknown", why: unknown, attempts } : { state: "not-found-exhaustive", attempts };
    },
  };
}
