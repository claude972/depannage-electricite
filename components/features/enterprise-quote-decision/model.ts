// ENT-12 exact enterprise quote decision context — pure model + controller (no React). Contract
// (read-only): docs/ENTERPRISE_QUOTE_DECISION_BACKEND.md (codex/enterprise-quote-decision 2ae10c3):
//   GET /api/quotes/<id>/decision-context?organization_id=UUID[&site_id=UUID]
//   → { quote_id, intervention_id, site_id, can_write, simple_rule, simple_approval, validity }
//   simple_rule: null (absence PROVEN) | { enabled, threshold_cents, required_role }
//   simple_approval: null (absence PROVEN) | { id, status: pending|approved|rejected }
//   validity: { valid_until: null|YYYY-MM-DD, state: unspecified|valid|expired }
// can_write is NOT an acceptance permission. The simple rule applies only when enabled AND the TTC
// total is STRICTLY above the threshold; refusals and errors are never read as absence. Bound at
// render to identity + organization + site + quote; late replies dropped; 401/403/404 ⇒ cleared.
import { z } from "zod";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const schema = z
  .object({
    quote_id: id,
    intervention_id: id,
    site_id: id,
    can_write: z.boolean(),
    simple_rule: z.object({ enabled: z.boolean(), threshold_cents: z.number().int().min(0).max(100000000), required_role: z.enum(["owner", "manager"]) }).strict().nullable(),
    simple_approval: z.object({ id, status: z.enum(["pending", "approved", "rejected"]) }).strict().nullable(),
    validity: z.object({ valid_until: z.iso.date().nullable(), state: z.enum(["unspecified", "valid", "expired"]) }).strict(),
  })
  .strict();
export type DecisionContext = z.infer<typeof schema>;
const lower = (x: string) => x.toLowerCase();
export function parseContext(body: unknown, quoteId: string): DecisionContext | null {
  const r = schema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.quote_id) !== lower(quoteId)) return null;
  if ((d.validity.state === "unspecified") !== (d.validity.valid_until === null)) return null;
  return d;
}
export const contextUrl = (quoteId: string, org: string, site: string | null) =>
  `/api/quotes/${encodeURIComponent(quoteId)}/decision-context?organization_id=${encodeURIComponent(org)}${site ? `&site_id=${encodeURIComponent(site)}` : ""}`;
/** Simple rule pending: applies (enabled AND total strictly above threshold) and the exact approval is not approved. */
export function simplePending(ctx: DecisionContext, totalCents: number): boolean {
  const applies = !!ctx.simple_rule && ctx.simple_rule.enabled && totalCents > ctx.simple_rule.threshold_cents;
  return applies && ctx.simple_approval?.status !== "approved";
}

export type Result = { status: number; body: unknown };
export type ContextApi = { get(url: string): Promise<Result> };
export function createContextApi(fetcher: typeof fetch = (...a) => fetch(...a)): ContextApi {
  return {
    async get(url) {
      try {
        const r = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const DECISION_COPY = {
  loading: "Vérification des conditions de décision…",
  failed: "Les conditions de décision n’ont pas pu être vérifiées : aucune décision n’est possible pour l’instant.",
  inaccessible: "Les conditions de décision de ce devis ne sont pas accessibles avec votre compte.",
  noWrite: "Vos droits sur ce site ne permettent pas de décider de ce devis.",
  expired: "Ce devis est expiré : il ne peut plus être accepté ni refusé ici.",
  simple: "Le devis doit être approuvé dans « Devis & approbations » avant de pouvoir être accepté.",
  advanced: "Le circuit d’approbation interne de ce devis n’est pas terminé.",
  unknown: "L’état de l’approbation interne de ce devis n’a pas encore pu être lu : la décision reste suspendue.",
} as const;
export type ContextState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; data: DecisionContext | null; error: string };
export const CONTEXT_INITIAL: ContextState = { key: "", phase: "idle", data: null, error: "" };
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const contextKey = (c: Context, quoteId: string | null, org: string | null, site: string | null) => (quoteId && org ? `${identityOf(c)}|${lower(org)}|${site ? lower(site) : "-"}|${lower(quoteId)}` : "");
export const contextView = (s: ContextState, key: string): ContextState => (s.key === key ? s : { ...CONTEXT_INITIAL, key, phase: key ? "loading" : "idle" });

export function createContextController({ api, context, set }: { api: () => ContextApi; context: Context; set: (s: ContextState) => void }) {
  let alive = true, seq = 0;
  let state: ContextState = { ...CONTEXT_INITIAL };
  let current: { quoteId: string; org: string; site: string | null } | null = null;
  const bound = identityOf(context);
  const put = (s: ContextState) => ((state = s), alive && set(s));
  const run = async (q: { quoteId: string; org: string; site: string | null }) => {
    current = q;
    const my = ++seq, key = contextKey(context, q.quoteId, q.org, q.site);
    put({ ...CONTEXT_INITIAL, key, phase: "loading" });
    const r = await api().get(contextUrl(q.quoteId, q.org, q.site));
    if (!alive || my !== seq || identityOf(context) !== bound) return;
    if (r.status === 401 || r.status === 403 || r.status === 404) return put({ ...CONTEXT_INITIAL, key, phase: "forbidden", error: DECISION_COPY.inaccessible });
    const d = r.status === 200 ? parseContext(r.body, q.quoteId) : null;
    if (!d) return put({ ...CONTEXT_INITIAL, key, phase: "error", error: DECISION_COPY.failed });
    put({ key, phase: "ready", data: d, error: "" });
  };
  return {
    query(quoteId: string | null, org: string | null, site: string | null) {
      if (!alive || identityOf(context) !== bound || !quoteId || !UUID.test(quoteId) || !org || !UUID.test(org) || (site !== null && !UUID.test(site))) return;
      if (current && current.quoteId === quoteId && current.org === org && current.site === site) return;
      void run({ quoteId, org, site });
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    refresh(key: string) {
      if (current && state.key === key) void run(current);
    },
    stop() {
      alive = false;
    },
  };
}
