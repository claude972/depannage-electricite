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
