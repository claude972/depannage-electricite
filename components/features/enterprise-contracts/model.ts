// ENT-13 — organisation framework contracts, pure model (no React). STRICT MIRROR of ROOT 201057a
// (lib/features/enterprise-contracts/handler.ts):
//   GET /api/enterprise/contracts?organization_id=UUID[&cursor=…]
//     → { items: [{ id, organization_id, title, reference, starts_on, ends_on, status, created_at }],
//         page: { limit: 50, has_more, next_cursor } }        (created_at DESC, id DESC)
//   GET /api/enterprise/contracts/[id]?organization_id=UUID → { contract: item + terms }
//   401 / 403 (not an enterprise account) / 404 (no organisation-wide access — a sites-only scope —
//   or unknown contract) / 422 (params, cursor) / 503 + Retry-After 2. Cursor opaque, never built.
import { z } from "zod";

export const CONTRACTS_PATH = "/api/enterprise/contracts";
export type Context = { generation(): number; userId(): string | null };
export type Result = { status: number; body: unknown; retryAfter: number | null };

const timestamp = z.iso
  .datetime({ offset: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/);
const summarySchema = z
  .object({
    id: z.uuid(),
    organization_id: z.uuid(),
    title: z.string().min(1).max(160),
    reference: z.string().max(160),
    starts_on: z.iso.date(),
    ends_on: z.iso.date().nullable(),
    status: z.enum(["draft", "active", "archived"]),
    created_at: timestamp,
  })
  .strict();
export type ContractSummary = z.infer<typeof summarySchema>;
const detailSchema = summarySchema.extend({ terms: z.string().max(8000) }).strict();
export type ContractDetail = z.infer<typeof detailSchema>;
const listSchema = z
  .object({
    items: z.array(summarySchema).max(50),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().regex(/^[A-Za-z0-9_-]{1,700}$/).nullable() }).strict(),
  })
  .strict();
export type ContractsPage = z.infer<typeof listSchema>;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Exact keys, rows of the requested organisation only, unique ids, has_more ⇔ next_cursor. */
export function parseContracts(body: unknown, organizationId: string): ContractsPage | null {
  const r = listSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (p.items.some((c) => !same(c.organization_id, organizationId))) return null;
  if (new Set(p.items.map((c) => c.id.toLowerCase())).size !== p.items.length) return null;
  return p;
}
/** The exact requested contract of the requested organisation; otherwise null. */
export function parseContract(body: unknown, organizationId: string, contractId: string): ContractDetail | null {
  const r = z.object({ contract: detailSchema }).strict().safeParse(body);
  if (!r.success) return null;
  const c = r.data.contract;
  return same(c.id, contractId) && same(c.organization_id, organizationId) ? c : null;
}

export const listUrl = (organizationId: string, cursor: string | null) =>
  `${CONTRACTS_PATH}?organization_id=${encodeURIComponent(organizationId)}${cursor !== null ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
export const detailUrl = (organizationId: string, contractId: string) =>
  `${CONTRACTS_PATH}/${encodeURIComponent(contractId)}?organization_id=${encodeURIComponent(organizationId)}`;

export function retryAfterSeconds(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,4}$/.test(value.trim())) return null;
  return Math.min(Number(value.trim()), 300);
}
/** GET with a deadline; status 0 = network failure, -1 = timeout. Never throws. */
export async function getJson(fetcher: typeof fetch, url: string, timeoutMs = 15_000): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: -1, body: null, retryAfter: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfter: retryAfterSeconds(r.headers?.get?.("Retry-After")) };
    } catch {
      return { status: 0, body: null, retryAfter: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const CONTRACTS_COPY = {
  choose: "Choisissez une organisation pour afficher ses contrats cadres.",
  loading: "Chargement des contrats…",
  loadFailed: "Les contrats n’ont pas pu être vérifiés. Réessayez.",
  cursor: "La liste a changé ou n’est plus valable : elle repart de la première page.",
  session: "Votre session a expiré. Reconnectez-vous pour voir les contrats.",
  forbidden: "Les contrats cadres sont réservés aux comptes entreprise.",
  scope: "Les contrats cadres se lisent avec un accès à toute l’organisation. Votre accès est limité à certains sites, ou cette organisation n’est plus accessible.",
  empty: "Aucun contrat cadre enregistré pour cette organisation.",
  more: "Afficher plus",
  moreFailed: "La suite n’a pas pu être chargée. Réessayez.",
  detailLoading: "Lecture du contrat…",
  detailFailed: "Le contrat n’a pas pu être vérifié. Réessayez.",
  detailGone: "Ce contrat est introuvable ou n’est plus accessible avec votre périmètre. Aucun autre contrat n’est affiché à sa place.",
} as const;
export const STATUS_LABEL: Record<ContractSummary["status"], string> = { draft: "Brouillon", active: "Actif", archived: "Archivé" };

/** 401 / 403 / 404 of the list: an honest refusal that clears everything. */
export const refusal = (status: number): string | null =>
  status === 401 ? CONTRACTS_COPY.session : status === 403 ? CONTRACTS_COPY.forbidden : status === 404 ? CONTRACTS_COPY.scope : null;

export type ListState = {
  /** identity | organisation | epoch: shown only under this exact key. */
  key: string;
  phase: "loading" | "ready" | "error" | "refused";
  items: ContractSummary[];
  next: string | null;
  loadingMore: boolean;
  error: string;
  moreError: string;
  notice: string;
  retryAt: number;
};
export const listInitial = (key: string): ListState => ({ key, phase: "loading", items: [], next: null, loadingMore: false, error: "", moreError: "", notice: "", retryAt: 0 });
export const identityKey = (ctx: Context, organizationId: string | null | undefined): string | null => {
  const uid = ctx.userId();
  return uid && organizationId ? `${uid}|${ctx.generation()}|${organizationId.toLowerCase()}` : null;
};

/** One controller per (identity, organisation, epoch); replies bound to that key + sequence. */
export function createContracts({ fetcher, organizationId, context, key, get, set, now = () => Date.now() }: { fetcher: () => typeof fetch; organizationId: string; context: Context; key: string; get: () => ListState; set: (s: ListState) => void; now?: () => number }) {
  let seq = 0;
  let alive = true;
  const base = identityKey(context, organizationId);
  const still = (my: number) => alive && my === seq && identityKey(context, organizationId) === base;
  const wait = (r: Result) => (r.retryAfter ? now() + r.retryAfter * 1000 : 0);
  const first = async (notice = ""): Promise<void> => {
    const my = ++seq;
    set({ ...listInitial(key), notice });
    const r = await getJson(fetcher(), listUrl(organizationId, null));
    if (!still(my)) return;
    const refused = refusal(r.status);
    if (refused) return set({ ...listInitial(key), phase: "refused", error: refused });
    const p = r.status === 200 ? parseContracts(r.body, organizationId) : null;
    if (!p) return set({ ...listInitial(key), phase: "error", error: CONTRACTS_COPY.loadFailed, notice, retryAt: wait(r) });
    set({ ...listInitial(key), phase: "ready", items: p.items, next: p.page.next_cursor, notice });
  };
  return {
    load: () => first(),
    dispose() {
      alive = false;
      seq++;
    },
    async more(): Promise<void> {
      const s = get();
      if (s.key !== key || s.phase !== "ready" || s.loadingMore || !s.next || now() < s.retryAt) return;
      const my = seq;
      const cursor = s.next;
      set({ ...s, loadingMore: true, moreError: "" });
      const r = await getJson(fetcher(), listUrl(organizationId, cursor));
      if (!still(my)) return;
      if (r.status === 422) return first(CONTRACTS_COPY.cursor);
      const refused = refusal(r.status);
      if (refused) return set({ ...listInitial(key), phase: "refused", error: refused });
      const p = r.status === 200 ? parseContracts(r.body, organizationId) : null;
      if (!p) return set({ ...get(), loadingMore: false, moreError: CONTRACTS_COPY.moreFailed, retryAt: wait(r) });
      const seen = new Set(get().items.map((c) => c.id.toLowerCase()));
      const fresh = p.items.filter((c) => !seen.has(c.id.toLowerCase()) && (seen.add(c.id.toLowerCase()), true));
      set({ ...get(), items: [...get().items, ...fresh], next: p.page.next_cursor, loadingMore: false, moreError: "", retryAt: 0 });
    },
  };
}
