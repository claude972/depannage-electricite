// Enterprise professional overview — strict browser copy of 7c6eff1 (lib/features/enterprise-
// professional-overview/handler.ts is server-only): POST /api/enterprise/overview/professional
//   { organization_id, site_id|null } → { organization_id, site_id,
//     counts: { approvals_pending, deadlines30 },
//     amounts: { accepted_commitment_cents, reference_budget_cents, currency: "eur" },
//     window: { from, to, time_zone: "America/Martinique" }, captured_at }
// Feeds ONLY three cards: « Devis à approuver », « Échéances à 30 jours », « Budget engagé ».
// approvals_pending = pending approval requests (simple, not advanced steps); deadlines30 = compliance
// not completed due from today to today+30 (Martinique day, overdue excluded); commitment = accepted
// quotes + accepted amendments (no payment/refund deduction); reference budget = sum of site budgets
// (0 may mean « not filled »; never an available balance). Bound at render to identity + organization
// + site; loading / error never mean zero; 401/403 clear; late replies of another scope dropped.
import { z } from "zod";

export const PROFESSIONAL_PATH = "/api/enterprise/overview/professional";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reply = z
  .object({
    organization_id: z.string().regex(UUID),
    site_id: z.string().regex(UUID).nullable(),
    counts: z.object({ approvals_pending: count, deadlines30: count }).strict(),
    amounts: z.object({ accepted_commitment_cents: count, reference_budget_cents: count, currency: z.literal("eur") }).strict(),
    window: z.object({ from: z.iso.date(), to: z.iso.date(), time_zone: z.literal("America/Martinique") }).strict(),
    captured_at: z.iso.datetime({ offset: true }),
  })
  .strict();
export type Professional = z.infer<typeof reply>;
export type ProBody = { organization_id: string; site_id: string | null };
export const proBody = (organizationId: string, siteId: string | null): ProBody | null =>
  UUID.test(organizationId) && (siteId === null || UUID.test(siteId)) ? { organization_id: organizationId, site_id: siteId } : null;
/** Strict + same scope + the handler's own window rule (from = Martinique day of captured_at, to = from + 30 d). */
export function parseProfessional(body: unknown, req: ProBody): Professional | null {
  const r = reply.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (d.organization_id.toLowerCase() !== req.organization_id.toLowerCase()) return null;
  if ((d.site_id?.toLowerCase() ?? null) !== (req.site_id?.toLowerCase() ?? null)) return null;
  let localDay: string;
  try {
    localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Martinique", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d.captured_at));
  } catch {
    return null;
  }
  const end = new Date(`${d.window.from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 30);
  if (d.window.from !== localDay || d.window.to !== end.toISOString().slice(0, 10)) return null;
  return d;
}
/** « 7 nov. 2026 » from YYYY-MM-DD, without any time zone shift. */
export const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

export type ProResult = { status: number; body: unknown };
export type ProApi = { read(b: ProBody): Promise<ProResult> };
export function createProApi(fetcher: typeof fetch = (...a) => fetch(...a)): ProApi {
  return {
    async read(b) {
      try {
        const r = await fetcher(PROFESSIONAL_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), credentials: "same-origin", cache: "no-store" });
        return { status: r.status, body: await r.json().catch(() => null) };
      } catch {
        return { status: 0, body: null };
      }
    },
  };
}
export const PRO_COPY = {
  loading: "Vérification du chiffre…",
  failed: "Chiffre indisponible pour le moment.",
  scope: "Ce périmètre n’est pas accessible.",
  forbidden: "Accès refusé. Reconnectez-vous ou changez d’organisation.",
  approvals: "Approbations en attente sur le périmètre (demandes, pas les étapes d’approbation avancée)",
  deadlines: (from: string, to: string) => `Contrôles et maintenances non terminés, du ${dayLabel(from)} au ${dayLabel(to)} (heure de Martinique), hors échéances dépassées`,
  commitment: (budget: string | null) => `Devis et avenants acceptés, hors paiements et remboursements · ${budget ? `budget de référence des sites : ${budget} (pas un solde disponible)` : "budget de référence des sites non renseigné"}`,
} as const;
export type ProState = { key: string; phase: "idle" | "loading" | "ready" | "error" | "forbidden"; data: Professional | null; error: string };
export const PRO_INITIAL: ProState = { key: "", phase: "idle", data: null, error: "" };
type Context = { generation(): number; userId(): string | null };
const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const proKey = (c: Context, organizationId: string | null, siteId: string | null) => (organizationId ? `${identityOf(c)}|${organizationId.toLowerCase()}|${siteId?.toLowerCase() ?? "-"}` : "");
/** A render shows the stored figures only if they belong to ITS key; otherwise loading. */
export const proView = (s: ProState, key: string): ProState => (s.key === key ? s : { ...PRO_INITIAL, key, phase: key ? "loading" : "idle" });

export function createProController({ api, context, set }: { api: () => ProApi; context: Context; set: (s: ProState) => void }) {
  let alive = true;
  let seq = 0;
  let state: ProState = { ...PRO_INITIAL };
  let current: ProBody | null = null;
  const bound = identityOf(context);
  const put = (s: ProState) => {
    state = s;
    if (alive) set(s);
  };
  const run = async (req: ProBody) => {
    current = req;
    const my = ++seq;
    const key = proKey(context, req.organization_id, req.site_id);
    put({ ...PRO_INITIAL, key, phase: "loading" });
    const r = await api().read(req);
    if (!alive || my !== seq || identityOf(context) !== bound) return; // stale scope / identity: dropped
    if (r.status === 401 || r.status === 403) return put({ ...PRO_INITIAL, key, phase: "forbidden", error: PRO_COPY.forbidden });
    const d = r.status === 200 ? parseProfessional(r.body, req) : null;
    if (!d) return put({ ...PRO_INITIAL, key, phase: "error", error: r.status === 404 ? PRO_COPY.scope : PRO_COPY.failed });
    put({ key, phase: "ready", data: d, error: "" });
  };
  return {
    query(organizationId: string | null, siteId: string | null) {
      if (!alive || identityOf(context) !== bound) return;
      const req = organizationId ? proBody(organizationId, siteId) : null;
      if (!req) return;
      if (current && current.organization_id === req.organization_id && current.site_id === req.site_id) return;
      void run(req);
    },
    retry(key: string) {
      if (current && state.key === key && state.phase === "error") void run(current);
    },
    /** « Actualiser »: re-read the SAME scope (same guards). */
    refresh(key: string) {
      if (!alive || !current || state.key !== key || state.phase === "loading") return false;
      void run(current);
      return true;
    },
    get: () => state,
    stop() {
      alive = false;
    },
  };
}
