// Enterprise intervention list + server CSV — pure model + controller (no React). Contract (read-only):
// lib/features/enterprise-interventions/contract.ts (browser-safe zod, imported as is) and
// app/api/enterprise/interventions/search/route.ts:
//   POST /api/enterprise/interventions/search
//     { action:"list", organization_id, site_id|null, category|null, status|null, search, sort, page }
//       → { items ≤ 10, total, page: { number, limit: 10, pages } }
//     { action:"export", …same filters without page } → text/csv Response
//       (Content-Disposition: attachment; filename="interventions.csv"; 409 above 5 000 rows)
// Rows = client row + { site_id, site_name, artisan_assigned } — only these DTO fields are used.
// Every read is bound to the identity (uid + generation), the exact filters + page and a sequence:
// a reply for anything else is dropped. Search is debounced; any other change applies at once.
// The CSV is saved from the Response blob only if identity AND filters are unchanged at the end of
// the await; the object URL is revoked right after; nothing is persisted. 401/403 clear the list.
import type { z } from "zod";
import { ENTERPRISE_PAGE_SIZE, enterpriseInterventionInput, enterpriseInterventionPage } from "../../../lib/features/enterprise-interventions/contract";

export const ENTERPRISE_SEARCH_PATH = "/api/enterprise/interventions/search";
export const SEARCH_TIMEOUT_MS = 20_000;
export const SEARCH_TIMEOUT = -1;
export const DEBOUNCE_MS = 300;
export type EnterpriseRow = z.infer<typeof enterpriseInterventionPage>["items"][number];
export type EnterprisePage = z.infer<typeof enterpriseInterventionPage>;
export type Filters = {
  organization_id: string;
  site_id: string | null;
  category: EnterpriseRow["category"] | null;
  status: EnterpriseRow["status"] | null;
  search: string;
  sort: "recent" | "oldest";
};
export type ListBody = Filters & { action: "list"; page: number };
export type ExportBody = Filters & { action: "export" };

/** The exact body the route accepts (validated with the route's own schema), or null ⇒ 0 POST. */
export function listBody(f: Filters, page: number): ListBody | null {
  const body: ListBody = { action: "list", organization_id: f.organization_id, site_id: f.site_id, category: f.category, status: f.status, search: f.search.trim(), sort: f.sort, page };
  return enterpriseInterventionInput.safeParse(body).success ? body : null;
}
export function exportBody(f: Filters): ExportBody | null {
  const body: ExportBody = { action: "export", organization_id: f.organization_id, site_id: f.site_id, category: f.category, status: f.status, search: f.search.trim(), sort: f.sort };
  return enterpriseInterventionInput.safeParse(body).success ? body : null;
}
/** Strict: the contract schema, plus the route's own invariants for THIS request (page number,
 *  page count, item count, unique ids, scope of site/category/status). */
export function parseListPage(body: unknown, req: ListBody): EnterprisePage | null {
  const r = enterpriseInterventionPage.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.page.number !== req.page || p.page.pages !== Math.max(1, Math.ceil(p.total / ENTERPRISE_PAGE_SIZE))) return null;
  if (p.items.length !== Math.min(ENTERPRISE_PAGE_SIZE, Math.max(0, p.total - (req.page - 1) * ENTERPRISE_PAGE_SIZE))) return null;
  if (new Set(p.items.map((x) => x.id)).size !== p.items.length) return null;
  for (const x of p.items) if ((req.site_id && x.site_id !== req.site_id.toLowerCase()) || (req.category && x.category !== req.category) || (req.status && x.status !== req.status)) return null;
  return p;
}
export const sameFilters = (a: Filters | null, b: Filters | null) => !!a && !!b && a.organization_id === b.organization_id && a.site_id === b.site_id && a.category === b.category && a.status === b.status && a.search.trim() === b.search.trim() && a.sort === b.sort;
/** filename="…" from Content-Disposition (plain, safe characters only), else null. */
export function attachmentName(disposition: string | null): string | null {
  const m = /^attachment;\s*filename="([A-Za-z0-9._-]{1,120}\.csv)"$/i.exec(disposition ?? "");
  return m ? m[1] : null;
}

export type ListResult = { status: number; body: unknown };
export type ExportResult = { status: number; blob: Blob | null; filename: string | null; csv: boolean };
export type SearchApi = { list(body: ListBody): Promise<ListResult>; exportCsv(body: ExportBody): Promise<ExportResult> };
async function timedFetch(fetcher: typeof fetch, body: string): Promise<Response | number> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<number>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(SEARCH_TIMEOUT);
    }, SEARCH_TIMEOUT_MS);
  });
  const request = fetcher(ENTERPRISE_SEARCH_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) }).catch(() => (controller?.signal.aborted ? SEARCH_TIMEOUT : 0));
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export function createSearchApi(fetcher: typeof fetch = (...a) => fetch(...a)): SearchApi {
  return {
    async list(b) {
      const r = await timedFetch(fetcher, JSON.stringify(b));
      if (typeof r === "number") return { status: r, body: null };
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    async exportCsv(b) {
      const r = await timedFetch(fetcher, JSON.stringify(b));
      if (typeof r === "number") return { status: r, blob: null, filename: null, csv: false };
      const csv = /^text\/csv\b/i.test(r.headers.get("content-type") ?? "");
      const blob = r.ok && csv ? await r.blob().catch(() => null) : null;
      return { status: r.status, blob, filename: attachmentName(r.headers.get("content-disposition")), csv };
    },
  };
}

export const COPY = {
  loading: "Chargement des interventions…",
  failed: "Les interventions n’ont pas pu être chargées. Réessayez.",
  forbidden: "Votre accès à ces interventions n’est plus valide. Reconnectez-vous ou changez d’organisation.",
  serverNote: "résultats du serveur, tous dossiers du périmètre",
  exporting: "Préparation de l’export…",
  exported: "Export CSV téléchargé.",
  exportChanged: "Le périmètre ou les filtres ont changé pendant la préparation : le fichier n’a pas été enregistré. Relancez l’export.",
  exportTooLarge: "Affinez vos filtres pour exporter au maximum 5 000 interventions.",
  exportFailed: "L’export n’a pas pu être préparé. Réessayez.",
  exportInvalid: "La réponse du serveur n’est pas un fichier CSV valide : rien n’a été enregistré.",
} as const;

export type SearchState = {
  /** Render-time key (identity + filters + page) this state belongs to; "" = none. A render whose key
   *  differs shows loading/empty, never these rows (not even for one frame). */
  key: string;
  phase: "idle" | "loading" | "ready" | "error" | "forbidden";
  items: EnterpriseRow[];
  total: number;
  page: number;
  pages: number;
  error: string;
  exporting: boolean;
  exportNotice: string;
  exportError: string;
};
export const SEARCH_INITIAL: SearchState = { key: "", phase: "idle", items: [], total: 0, page: 1, pages: 1, error: "", exporting: false, exportNotice: "", exportError: "" };
export type Context = { generation(): number; userId(): string | null };
export const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
const keyFor = (identity: string, f: Filters, page: number) => `${identity}|${JSON.stringify([f.organization_id, f.site_id, f.category, f.status, f.search.trim(), f.sort, page])}`;
/** The key a render binds to (identity + filters + page). */
export const viewKey = (c: Context, f: Filters | null, page: number) => (f ? keyFor(identityOf(c), f, page) : "");
/** What a render may show: the stored state only if it belongs to THIS render's key. */
export const viewOf = (s: SearchState, key: string): SearchState => (s.key === key ? s : { ...SEARCH_INITIAL, key, phase: key ? "loading" : "idle" });
export type Timers = { set(f: () => void, ms: number): unknown; clear(handle: unknown): void };
export type Saver = (blob: Blob, filename: string) => void;
/** Browser saver: object URL from the blob, one click, revoked right after. Nothing persisted. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function createSearchController({ api, context, set, timers, save = saveBlob, delayMs = DEBOUNCE_MS }: { api: () => SearchApi; context: Context; set: (s: SearchState) => void; timers: Timers; save?: Saver; delayMs?: number }) {
  let alive = true;
  let state: SearchState = { ...SEARCH_INITIAL };
  let seq = 0;
  let current: ListBody | null = null;
  let timer: unknown = null;
  /** Scope epoch: +1 on every organization / site / filter / search change (not on a page change).
   *  An export is applied only if the epoch at the end equals the epoch at the click (A→B→A drops it). */
  let epoch = 0;
  const identity = () => identityOf(context);
  const bound = identity();
  const keyOf = (req: ListBody) => keyFor(bound, req, req.page);
  const put = (s: SearchState) => {
    state = s;
    if (alive) set(s);
  };
  const cancelTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const valid = (my: number, req: ListBody) => alive && my === seq && identity() === bound && current !== null && sameFilters(current, req) && current.page === req.page;
  const read = async (my: number, req: ListBody) => {
    if (!valid(my, req)) return;
    const r = await api().list(req);
    if (!valid(my, req)) return; // stale sequence, other identity, other filters or page: dropped
    if (r.status === 401 || r.status === 403) {
      epoch++; // authorisation refused: any export in flight is invalidated (its CSV is never saved)
      return put({ ...SEARCH_INITIAL, key: keyOf(req), phase: "forbidden", error: COPY.forbidden });
    }
    const p = r.status === 200 ? parseListPage(r.body, req) : null;
    if (!p) return put({ ...state, key: keyOf(req), phase: "error", items: [], error: COPY.failed });
    put({ ...state, key: keyOf(req), phase: "ready", items: p.items, total: p.total, page: p.page.number, pages: p.page.pages, error: "" });
  };
  const start = (req: ListBody, debounce: boolean) => {
    cancelTimer();
    current = req;
    const my = ++seq;
    put({ ...state, key: keyOf(req), phase: "loading", items: [], error: "", exportNotice: "", exportError: "" });
    if (debounce) timer = timers.set(() => ((timer = null), void read(my, req)), delayMs);
    else void read(my, req);
  };
  return {
    /** Search-only change ⇒ debounced; any other change (filters, page, scope) ⇒ immediate. */
    query(f: Filters, page: number) {
      if (!alive || identity() !== bound) return;
      const req = listBody(f, page);
      if (!req) return put({ ...SEARCH_INITIAL, key: keyFor(bound, f, page), phase: "error", error: COPY.failed });
      if (current && sameFilters(current, req) && current.page === req.page) return;
      if (!current || !sameFilters(current, req)) epoch++;
      const onlySearch = !!current && current.page === req.page && current.organization_id === req.organization_id && current.site_id === req.site_id && current.category === req.category && current.status === req.status && current.sort === req.sort;
      start(req, onlySearch);
    },
    retry(key: string) {
      if (!current || state.key !== key) return;
      const req = current;
      current = null;
      start(req, false);
    },
    /** Saves the CSV only if identity and filters still match the click at the end of the await. */
    async exportCsv(f: Filters, latest: () => Filters | null, key: string): Promise<boolean> {
      // Only from the list the user is looking at (same identity + filters).
      if (!alive || state.exporting || state.key !== key || !current || !sameFilters(current, f)) return false;
      const who = identity();
      const body = exportBody(f);
      if (!body || who !== bound) return false;
      const myEpoch = epoch;
      put({ ...state, exporting: true, exportNotice: "", exportError: "" });
      const r = await api().exportCsv(body);
      if (!alive) return false;
      if (identity() !== who) return false; // another identity: nothing shown, nothing saved
      // Scope check BEFORE applying any reply (a late 401/403 of another scope never clears this one).
      if (epoch !== myEpoch || !sameFilters(latest(), f) || !current || !sameFilters(current, f)) {
        put({ ...state, exporting: false, exportError: COPY.exportChanged });
        return false;
      }
      if (r.status === 401 || r.status === 403) {
        // Authorisation refused: invalidate any list read in flight (and its debounce) so an earlier
        // authorised 200 can never re-show rows.
        seq++;
        cancelTimer();
        epoch++;
        put({ ...SEARCH_INITIAL, key: state.key, phase: "forbidden", error: COPY.forbidden });
        return false;
      }
      if (r.status === 409) {
        put({ ...state, exporting: false, exportError: COPY.exportTooLarge });
        return false;
      }
      if (r.status !== 200) {
        put({ ...state, exporting: false, exportError: COPY.exportFailed });
        return false;
      }
      if (!r.csv || !r.blob || !r.filename) {
        put({ ...state, exporting: false, exportError: COPY.exportInvalid });
        return false;
      }
      save(r.blob, r.filename);
      put({ ...state, exporting: false, exportNotice: COPY.exported });
      return true;
    },
    get: () => state,
    stop() {
      alive = false;
      cancelTimer();
    },
  };
}
