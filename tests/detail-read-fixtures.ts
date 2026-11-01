import { createClient } from "@supabase/supabase-js";
import { fakeServerHelpers, loadModule } from "./documents/harness";
export type Row = Record<string, unknown>;
export const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const JOB = id(1), USER = id(2), ARTISAN = id(3), SITE = id(4), ORG = id(5);
export const stamp = "2026-10-31T10:00:00.000Z";
export const job = (patch: Row = {}): Row => ({ id: JOB, client_id: USER, artisan_id: ARTISAN, site_id: null, category: "panel", description: "Un tableau en panne", address: "2 rue du Test", postal_code: "97200", city: "Fort-de-France", urgency: "scheduled", estimate_min_cents: 1000, estimate_max_cents: 2000, status: "assigned", created_at: stamp, updated_at: stamp, completed_at: null, paid_at: null, travel_stage: "planned", ...patch });
export const quote = (n: number, patch: Row = {}): Row => ({ id: id(100 + n), intervention_id: JOB, artisan_id: ARTISAN, lines: [{ label: "Diagnostic", quantity: 1, unit_price_cents: 1000 }], subtotal_cents: 1000, tax_rate: 20, tax_cents: 200, total_cents: 1200, status: "rejected", created_at: new Date(Date.parse(stamp) + n * 1000).toISOString(), accepted_at: null, ...patch });
export const payment = (quoteId: string, n = 0): Row => ({ id: id(500 + n), quote_id: quoteId, total_cents: 1200, currency: "eur", status: "paid", created_at: stamp, paid_at: stamp, session_id: "server-only-never-return" });
export const site: Row = { id: SITE, organization_id: ORG, name: "Site technique", type: "office", address: "2 rue du Test", budget_cents: 5000, created_at: stamp };
export const org: Row = { id: ORG, name: "Organisation technique", owner_id: USER, created_at: stamp };
export type Call = { table: string; url: URL; headers: Headers; projection: string; rows?: Row[] };
export type Options = {
  rows?: Record<string, Row[]>; authenticated?: boolean; readable?: boolean; offers?: Row[];
  // Response/throw injection goes through the real Supabase HTTP client.
  intercept?: (call: Call, ordinal: number) => Response | undefined | Promise<Response | undefined>;
};
export function routeHarness(route: "detail" | "workspace", options: Options = {}) {
  const calls: Call[] = [];
  const tables: Record<string, Row[]> = { profiles: [{ id: USER, role: "client", full_name: "Compte de test", phone: "", artisan_approved: false, created_at: stamp }], interventions: [job()], quotes: [], sites: [], organizations: [], messages: [], documents: [], reviews: [], payments: [], organization_members: [], artisan_profiles: [], intervention_appointments: [], ...options.rows };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.split("/").at(-1)!;
    const headers = new Headers(init?.headers);
    const call: Call = { table, url, headers, projection: url.searchParams.get("select") ?? "" };
    calls.push(call);
    const response = await options.intercept?.(call, calls.filter(c => c.table === table).length);
    if (response) return response;
    if (url.pathname.includes("/rpc/")) return Response.json(options.offers ?? []);
    let rows = [...(tables[table] ?? [])];
    if (table === "interventions" && options.readable === false) rows = [];
    for (const [key, expression] of url.searchParams) {
      if (expression.startsWith("eq.")) rows = rows.filter(row => String(row[key]) === expression.slice(3));
      else if (expression.startsWith("in.(")) {
        const values = expression.slice(4, -1).split(","); rows = rows.filter(row => values.includes(String(row[key])));
      }
    }
    const total = rows.length;
    const order = (url.searchParams.get("order") ?? "").split(",").filter(Boolean);
    rows.sort((a, b) => { for (const item of order) { const [key, dir] = item.split("."); const c = String(a[key]).localeCompare(String(b[key])); if (c) return dir === "desc" ? -c : c; } return 0; });
    if (url.searchParams.has("limit")) rows = rows.slice(0, Number(url.searchParams.get("limit")));
    call.rows = rows;
    if (call.projection !== "*") rows = rows.map(row => Object.fromEntries(call.projection.split(",").filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]])));
    const body = headers.get("Accept")?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows;
    return Response.json(body, { headers: { "Content-Range": rows.length ? `0-${rows.length - 1}/${total}` : `*/${total}` } });
  };
  const db = createClient("https://example.supabase.co", "fake-publishable-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
  const helpers = fakeServerHelpers({ authenticated: options.authenticated, db });
  const authenticated = helpers.authenticatedClient;
  helpers.authenticatedClient = async () => ({ ...(await authenticated()), user: { id: USER } });
  const mod = loadModule(route === "detail" ? "app/api/interventions/[id]/route.ts" : "app/api/workspace/route.ts", { "@/lib/supabase/server": helpers });
  const get = async (target = JOB) => route === "detail"
    ? (mod.GET as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>)(new Request(`https://app.example.test/api/interventions/${target}`), { params: Promise.resolve({ id: target }) })
    : (mod.GET as () => Promise<Response>)();
  return { get, calls, tables };
}
