// Minimal Supabase service client over fetch (PostgREST, Auth admin, Storage). No SDK
// dependency. The service key lives only in this closure; error messages are redacted and
// never include request or response headers. Every request has a timeout.

async function timedFetch(url, init, timeoutMs, label) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    const e = new Error(`${label}: ${timedOut ? `no answer within ${timeoutMs} ms` : String(error?.message || error).split("\n")[0].slice(0, 200)}`);
    e.name = timedOut ? "TimeoutError" : "FetchError";
    throw e;
  }
}

/**
 * Direct PostgREST RPC call AS A USER: `accessToken` is the user's own session JWT (read from
 * the browser cookie), `publishableKey` the public gateway key. RLS and SECURITY DEFINER checks
 * apply exactly as for the application. Returns {status, code, message} without throwing on 4xx.
 */
export async function userRpc({ url, publishableKey, accessToken, timeoutMs = 90000 }, name, args = {}) {
  const response = await timedFetch(
    `${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
    { method: "POST", headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(args) },
    timeoutMs,
    `RPC ${name} (user session)`,
  );
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: response.status, code: body?.code ?? null, message: typeof body?.message === "string" ? body.message.slice(0, 200) : null };
}

export function createServiceClient({ url, serviceKey, redactor, timeoutMs = 90000 }) {
  const base = url.replace(/\/$/, "");
  const headers = (extra = {}) => ({
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra,
  });
  const fail = (label, status, text) => {
    const error = new Error(`${label} failed (${status}): ${redactor.redactString(String(text).slice(0, 400))}`);
    error.status = status;
    return error;
  };
  const query = (filters = {}) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) q.append(key, value);
    return q.toString();
  };
  const go = (path, init, label) => timedFetch(`${base}${path}`, init, timeoutMs, label);

  async function rest(method, table, filters, body, prefer) {
    const qs = query(filters);
    const response = await go(`/rest/v1/${table}${qs ? `?${qs}` : ""}`, { method, headers: headers(prefer ? { Prefer: prefer } : {}), body: body === undefined ? undefined : JSON.stringify(body) }, `${method} ${table}`);
    const text = await response.text();
    if (!response.ok) throw fail(`${method} ${table}`, response.status, text);
    return { text };
  }

  return {
    projectRef: new URL(base).hostname.split(".")[0],
    timeoutMs,
    async select(table, filters = {}, columns = "*") {
      const { text } = await rest("GET", table, { select: columns, ...filters });
      return text ? JSON.parse(text) : [];
    },
    async count(table, filters = {}) {
      const qs = query({ select: "*", ...filters });
      const response = await go(`/rest/v1/${table}?${qs}`, { method: "HEAD", headers: headers({ Prefer: "count=exact" }) }, `COUNT ${table}`);
      if (!response.ok) throw fail(`COUNT ${table}`, response.status, await response.text());
      const range = response.headers.get("content-range") || "";
      const total = Number(range.split("/")[1]);
      if (!Number.isFinite(total)) throw new Error(`COUNT ${table}: missing exact count`);
      return total;
    },
    async insert(table, rows) {
      const { text } = await rest("POST", table, {}, rows, "return=representation");
      return JSON.parse(text);
    },
    async upsert(table, rows, onConflict) {
      const { text } = await rest("POST", table, onConflict ? { on_conflict: onConflict } : {}, rows, "return=representation,resolution=merge-duplicates");
      return JSON.parse(text);
    },
    async update(table, filters, patch) {
      const { text } = await rest("PATCH", table, filters, patch, "return=representation");
      return JSON.parse(text);
    },
    async delete(table, filters) {
      if (!Object.keys(filters).length) throw new Error(`refusing unfiltered DELETE on ${table}`);
      await rest("DELETE", table, filters, undefined, "return=minimal");
    },
    async rpc(name, args = {}) {
      const response = await go(`/rest/v1/rpc/${name}`, { method: "POST", headers: headers(), body: JSON.stringify(args) }, `RPC ${name}`);
      const text = await response.text();
      if (!response.ok) throw fail(`RPC ${name}`, response.status, text);
      return text ? JSON.parse(text) : null;
    },
    async createAuthUser({ email, password, fullName, role }) {
      const response = await go("/auth/v1/admin/users", { method: "POST", headers: headers(), body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role } }) }, "createAuthUser");
      const text = await response.text();
      if (!response.ok) throw fail("createAuthUser", response.status, text);
      const user = JSON.parse(text);
      if (!user?.id) throw new Error("createAuthUser: no id returned");
      return user.id;
    },
    async deleteAuthUser(id) {
      const response = await go(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() }, "deleteAuthUser");
      if (!response.ok && response.status !== 404) throw fail("deleteAuthUser", response.status, await response.text());
    },
    async authUserExists(id) {
      const response = await go(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "GET", headers: headers() }, "getAuthUser");
      if (response.status === 404) return false;
      if (!response.ok) throw fail("getAuthUser", response.status, await response.text());
      const user = await response.json().catch(() => null);
      return Boolean(user?.id);
    },
    async storageRemove(bucket, paths) {
      const response = await go(`/storage/v1/object/${bucket}`, { method: "DELETE", headers: headers(), body: JSON.stringify({ prefixes: paths }) }, "storageRemove");
      if (!response.ok && response.status !== 404) throw fail("storageRemove", response.status, await response.text());
    },
    async storageList(bucket, prefix) {
      const response = await go(`/storage/v1/object/list/${bucket}`, { method: "POST", headers: headers(), body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) }, "storageList");
      if (response.status === 404 || response.status === 400) return [];
      if (!response.ok) throw fail("storageList", response.status, await response.text());
      const items = await response.json();
      return Array.isArray(items) ? items.filter((o) => o.id) : [];
    },
  };
}
