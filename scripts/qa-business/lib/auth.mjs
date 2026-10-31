// Auth admin calls needed for durable intents: create a user WITH a pre-generated id, read one
// user by id. The service key lives only in this closure; no header is ever logged.
export function createAdminAuth({ url, serviceKey, redactor, timeoutMs = 90000, fetchImpl = fetch }) {
  const base = url.replace(/\/$/, "");
  const headers = () => ({ apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" });
  async function call(path, init, label) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      const e = new Error(`${label}: ${timedOut ? `no answer within ${timeoutMs} ms` : String(error?.message || error).split("\n")[0].slice(0, 200)}`);
      e.name = timedOut ? "TimeoutError" : "FetchError";
      throw e;
    }
    const text = await response.text();
    if (!response.ok) {
      const e = new Error(`${label} failed (${response.status}): ${redactor ? redactor.redactString(text.slice(0, 400)) : "[body hidden]"}`);
      e.status = response.status;
      throw e;
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    /** Returns the id the server assigned (expected to equal `id`; the caller compares). */
    async createUser({ id, email, password, fullName, role }) {
      const user = await call("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ id, email, password, email_confirm: true, user_metadata: { full_name: fullName, role } }) }, "createAuthUser");
      if (!user?.id) throw new Error("createAuthUser: no id returned");
      return user.id;
    },
    /**
     * Exact discovery by email: pages through `GET /auth/v1/admin/users` (per_page 1000) and keeps
     * only accounts whose email equals `email` exactly (case-insensitive, as Auth stores it). If the
     * listing is not exhausted within `maxPages`, throws: the outcome is then unknown, never "absent".
     */
    async findUsersByEmail(email, { perPage = 1000, maxPages = 50 } = {}) {
      const wanted = String(email).toLowerCase();
      const matches = [];
      for (let page = 1; page <= maxPages; page++) {
        const body = await call(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`, { method: "GET" }, "listAuthUsers");
        const users = Array.isArray(body?.users) ? body.users : null;
        if (!users) throw new Error("listAuthUsers: unexpected response shape");
        for (const u of users) if (typeof u?.email === "string" && u.email.toLowerCase() === wanted) matches.push({ id: u.id, email: u.email });
        if (users.length < perPage) return matches;
      }
      throw new Error(`listAuthUsers: more than ${maxPages * perPage} accounts, listing not exhausted`);
    },
    /** {id, email} or null when absent (404). */
    async getUser(id) {
      try {
        const user = await call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "GET" }, "getAuthUser");
        return user?.id ? { id: user.id, email: user.email ?? null } : null;
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    },
  };
}
