// Minimal Auth admin reads for ownership proof and intent recovery (service key in this closure
// only; nothing logged). The canonical e-mail is validated BEFORE any lookup by e-mail.
import { assertCanonicalEmail } from "./ownership.mjs";

export function createAuthAdmin({ url, serviceKey, timeoutMs = 90000, fetchFn = fetch }) {
  const base = url.replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const get = (path) => fetchFn(`${base}${path}`, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
  return {
    /** E-mail of an auth user, or null when the user does not exist. Throws on other errors. */
    async emailOf(id) {
      const response = await get(`/auth/v1/admin/users/${encodeURIComponent(id)}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`auth user read failed (${response.status})`);
      const user = await response.json().catch(() => null);
      return typeof user?.email === "string" ? user.email.toLowerCase() : null;
    },
    /** Bounded paginated scan for ONE canonical e-mail of this run (intent recovery). */
    async findByEmail(email, runId, { perPage = 200, maxPages = 25 } = {}) {
      assertCanonicalEmail(email, runId);
      for (let page = 1; page <= maxPages; page++) {
        const response = await get(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
        if (!response.ok) throw new Error(`auth user list failed (${response.status})`);
        const body = await response.json().catch(() => null);
        const users = Array.isArray(body?.users) ? body.users : [];
        const hit = users.find((u) => typeof u?.email === "string" && u.email.toLowerCase() === email);
        if (hit) return hit.id;
        if (users.length < perPage) return null;
      }
      throw new Error("auth user scan exceeded its page bound: outcome unknown");
    },
  };
}
