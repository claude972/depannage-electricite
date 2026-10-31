// Minimal Supabase service client over fetch (PostgREST, Auth admin, Storage). No SDK
// dependency. The service key lives only in this closure; error messages are redacted.
export function createServiceClient({ url, serviceKey, redactor }) {
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

  async function rest(method, table, filters, body, prefer) {
    const qs = query(filters);
    const response = await fetch(`${base}/rest/v1/${table}${qs ? `?${qs}` : ""}`, {
      method,
      headers: headers(prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw fail(`${method} ${table}`, response.status, text);
    return { text, headers: response.headers };
  }

  return {
    projectRef: new URL(base).hostname.split(".")[0],
    async select(table, filters = {}, columns = "*") {
      const { text } = await rest("GET", table, { select: columns, ...filters });
      return text ? JSON.parse(text) : [];
    },
    async count(table, filters = {}) {
      const qs = query({ select: "*", ...filters });
      const response = await fetch(`${base}/rest/v1/${table}?${qs}`, { method: "HEAD", headers: headers({ Prefer: "count=exact" }) });
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
      const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers: headers(), body: JSON.stringify(args) });
      const text = await response.text();
      if (!response.ok) throw fail(`RPC ${name}`, response.status, text);
      return text ? JSON.parse(text) : null;
    },
    async createAuthUser({ email, password, fullName, role }) {
      const response = await fetch(`${base}/auth/v1/admin/users`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: fullName, role } }),
      });
      const text = await response.text();
      if (!response.ok) throw fail("createAuthUser", response.status, text);
      const user = JSON.parse(text);
      if (!user?.id) throw new Error("createAuthUser: no id returned");
      return user.id;
    },
    async deleteAuthUser(id) {
      const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: headers() });
      if (!response.ok && response.status !== 404) throw fail("deleteAuthUser", response.status, await response.text());
    },
    async authUserExists(id) {
      const response = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "GET", headers: headers() });
      if (response.status === 404) return false;
      if (!response.ok) throw fail("getAuthUser", response.status, await response.text());
      const user = await response.json().catch(() => null);
      return Boolean(user?.id);
    },
    async storageRemove(bucket, paths) {
      const response = await fetch(`${base}/storage/v1/object/${bucket}`, { method: "DELETE", headers: headers(), body: JSON.stringify({ prefixes: paths }) });
      if (!response.ok && response.status !== 404) throw fail("storageRemove", response.status, await response.text());
    },
    async storageList(bucket, prefix) {
      const response = await fetch(`${base}/storage/v1/object/list/${bucket}`, { method: "POST", headers: headers(), body: JSON.stringify({ prefix, limit: 1000, offset: 0 }) });
      if (response.status === 404 || response.status === 400) return [];
      if (!response.ok) throw fail("storageList", response.status, await response.text());
      const items = await response.json();
      return Array.isArray(items) ? items.filter((o) => o.id) : [];
    },
  };
}
