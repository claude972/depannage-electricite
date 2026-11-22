// ENT-07/08 explicit equipment / zone ↔ intervention links — pure model (no React). Consumer of
// backend 726e367 (app/api/sites/[id]/asset-links, schemas copied strictly, read-only):
//   GET  /api/sites/:site/asset-links?intervention_id=uuid[&cursor=…]
//     → { records:[{ id, site_id, intervention_id, kind, asset_id, active, version, created_at,
//                    updated_at, detached_at, intervention:{id,category,status,created_at},
//                    asset_archived }], page:{limit:50,has_more,next_cursor,complete},
//         permissions:{can_write}, site_archived, limits:{active_per_intervention,history_per_intervention} }
//   POST { command_id, intervention_id, kind, asset_id, action:"link"|"unlink", expected_version }
//     → { record, replayed }   (first link: expected_version null; unlink / re-link: current version)
// The pending command is persisted in tab storage (uid|site|intervention) BEFORE the POST; a lost
// reply / 503 / reload resends it unchanged. 409 is never replayed; a new command only after an
// explicit « Actualiser ». No automatic remap: every link is an explicit user action.
import { z } from "zod";

export const AL_TIMEOUT_MS = 15_000;
export const AL_TIMEOUT = -1;
export type AlResult = { status: number; body: unknown; retryAfter: number | null };
export type AssetKind = "equipment" | "area";
export type LinkCommand = { command_id: string; intervention_id: string; kind: AssetKind; asset_id: string; action: "link" | "unlink"; expected_version: number | null };
export type AlApi = { list(siteId: string, interventionId: string, cursor: string | null): Promise<AlResult>; command(siteId: string, body: LinkCommand): Promise<AlResult> };
export type AlContext = { generation(): number; userId(): string | null };
export const DEFAULT_AL_CONTEXT: AlContext = { generation: () => 0, userId: () => null };
export type AlStore = { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void };
/** Asset labels come from the existing APIs (areas, site operations), supplied by the caller. */
export type AssetOption = { kind: AssetKind; id: string; label: string; archived: boolean };
export type AssetSource = () => Promise<{ assets: AssetOption[]; complete: boolean } | null>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const alUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const id = z.string().regex(UUID);
const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
const linkRecord = z
  .object({ id, site_id: id, intervention_id: id, kind: z.enum(["equipment", "area"]), asset_id: id, active: z.boolean(), version: z.number().int().min(1).max(2147483647), created_at: instant, updated_at: instant, detached_at: instant.nullable() })
  .strict()
  .refine((r) => r.active === (r.detached_at === null));
const historyRecord = z
  .object({
    id, site_id: id, intervention_id: id, kind: z.enum(["equipment", "area"]), asset_id: id, active: z.boolean(), version: z.number().int().min(1).max(2147483647), created_at: instant, updated_at: instant, detached_at: instant.nullable(),
    intervention: z.object({ id, category: z.string().min(1).max(80), status: z.string().min(1).max(80), created_at: instant }).strict(),
    asset_archived: z.boolean(),
  })
  .strict()
  .refine((r) => r.active === (r.detached_at === null) && r.intervention.id === r.intervention_id);
export type LinkRow = z.infer<typeof historyRecord>;
const pageSchema = z
  .object({
    records: z.array(historyRecord).max(50),
    page: z.object({ limit: z.literal(50), has_more: z.boolean(), next_cursor: z.string().min(1).max(1024).nullable(), complete: z.boolean() }).strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
    site_archived: z.boolean(),
    limits: z.object({ active_per_intervention: z.number().int().positive(), history_per_intervention: z.number().int().positive() }).strict(),
  })
  .strict();
export type LinksPage = z.infer<typeof pageSchema>;
const lower = (v: string) => v.toLowerCase();

export function parseLinksPage(body: unknown, siteId: string, interventionId: string, firstPage: boolean): LinksPage | null {
  const r = pageSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.site_archived && p.permissions.can_write) return null;
  if (p.page.has_more !== (p.page.next_cursor !== null) || p.page.complete !== (firstPage && !p.page.has_more)) return null;
  for (let i = 0; i < p.records.length; i++) {
    const x = p.records[i];
    if (lower(x.site_id) !== lower(siteId) || lower(x.intervention_id) !== lower(interventionId)) return null;
    if (i > 0 && lower(x.id) <= lower(p.records[i - 1].id)) return null;
  }
  return p;
}
export function parseLinkReply(body: unknown, siteId: string, cmd: LinkCommand): { record: z.infer<typeof linkRecord>; replayed: boolean } | null {
  const r = z.object({ record: linkRecord, replayed: z.boolean() }).strict().safeParse(body);
  if (!r.success) return null;
  const x = r.data.record;
  if (lower(x.site_id) !== lower(siteId) || lower(x.intervention_id) !== lower(cmd.intervention_id) || x.kind !== cmd.kind || lower(x.asset_id) !== lower(cmd.asset_id)) return null;
  if (x.active !== (cmd.action === "link") || x.version !== (cmd.expected_version === null ? 1 : cmd.expected_version + 1)) return null;
  return r.data;
}

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<AlResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: AlResult = { status: AL_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<AlResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<AlResult> => {
    try {
      const response = await fetcher(path, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch {
      return controller?.signal.aborted ? timedOut : { status: 0, body: null, retryAfter: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export const linksPath = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/asset-links`;
export function createAlApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = AL_TIMEOUT_MS } = {}): AlApi {
  const base = { credentials: "same-origin" as const, cache: "no-store" as const };
  return {
    list: (site, job, cursor) => timed(fetcher, `${linksPath(site)}?intervention_id=${encodeURIComponent(job)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { ...base, method: "GET", headers: { accept: "application/json" } }, timeoutMs),
    command: (site, body) => timed(fetcher, linksPath(site), { ...base, method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}
// ---- By asset (ENT-07): the dossiers linked to ONE equipment / zone, same route, asset filter ------
/** GET …/asset-links?kind=&asset_id= — one page (50) of the links of an asset, opaque cursor. */
export function readAssetLinks(fetcher: typeof fetch, siteId: string, kind: AssetKind, assetId: string, cursor: string | null, { timeoutMs = AL_TIMEOUT_MS } = {}): Promise<AlResult> {
  return timed(fetcher, `${linksPath(siteId)}?kind=${kind}&asset_id=${encodeURIComponent(assetId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { credentials: "same-origin", cache: "no-store", method: "GET", headers: { accept: "application/json" } }, timeoutMs);
}
/** Strict page of ONE asset: every row belongs to the site and to that asset, ids ascending. */
export function parseAssetLinksPage(body: unknown, siteId: string, kind: AssetKind, assetId: string, firstPage: boolean): LinksPage | null {
  const r = pageSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.site_archived && p.permissions.can_write) return null;
  if (p.page.has_more !== (p.page.next_cursor !== null) || p.page.complete !== (firstPage && !p.page.has_more)) return null;
  for (let i = 0; i < p.records.length; i++) {
    const x = p.records[i];
    if (lower(x.site_id) !== lower(siteId) || x.kind !== kind || lower(x.asset_id) !== lower(assetId)) return null;
    if (i > 0 && lower(x.id) <= lower(p.records[i - 1].id)) return null;
  }
  return p;
}
export type AssetDossier = { interventionId: string; category: string; status: string; createdAt: string; linkedAt: string; active: boolean; detachedAt: string | null };
/** One line per dossier (its latest link row wins), active links first, then the most recent. */
export function dossiersOfAsset(records: LinkRow[]): AssetDossier[] {
  const m = new Map<string, LinkRow>();
  for (const r of records) {
    const k = lower(r.intervention_id), seen = m.get(k);
    if (!seen || Date.parse(r.updated_at) >= Date.parse(seen.updated_at)) m.set(k, r);
  }
  return [...m.values()]
    .map((r) => ({ interventionId: r.intervention_id, category: r.intervention.category, status: r.intervention.status, createdAt: r.intervention.created_at, linkedAt: r.created_at, active: r.active, detachedAt: r.detached_at }))
    .sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export const ASSET_LINKS_COPY = {
  summary: "Interventions liées",
  loading: "Lecture des interventions liées…",
  failed: "Les interventions liées n’ont pas pu être lues.",
  forbidden: "Vous n’avez pas accès aux liens de ce site.",
  session: "Session expirée : reconnectez-vous.",
  empty: "Aucune intervention n’est rattachée. Le rattachement se fait depuis le dossier d’une intervention du site.",
  more: "Afficher la suite",
  detached: "lien retiré",
} as const;

export const commandKey = (userId: string, siteId: string, interventionId: string) => `site-asset-link:${userId}|${lower(siteId)}|${lower(interventionId)}`;
export function tabStore(): AlStore {
  const ss = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  return {
    get(key) {
      try {
        return ss()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const s = ss();
        if (!s) return false;
        s.setItem(key, value);
        return s.getItem(key) === value;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        ss()?.removeItem(key);
      } catch {
        /* nothing to clean */
      }
    },
  };
}
const commandSchema = z
  .object({ command_id: id, intervention_id: id, kind: z.enum(["equipment", "area"]), asset_id: id, action: z.enum(["link", "unlink"]), expected_version: z.number().int().min(1).max(2147483646).nullable() })
  .strict()
  .refine((v) => v.action !== "unlink" || v.expected_version !== null);
export function readStored(raw: string | null, interventionId: string): LinkCommand | null {
  if (!raw) return null;
  try {
    const r = commandSchema.safeParse(JSON.parse(raw));
    return r.success && lower(r.data.intervention_id) === lower(interventionId) ? r.data : null;
  } catch {
    return null;
  }
}

export const KIND_LABEL: Record<AssetKind, string> = { equipment: "Équipement", area: "Zone" };
export const AL_COPY = {
  title: "Équipements et zones concernés",
  loading: "Lecture des équipements et zones liés…",
  loadFailed: "Les liens de ce dossier n’ont pas pu être lus. Réessayez.",
  notFound: "Ce site ou ce dossier est introuvable ou n’est plus accessible.",
  forbidden: "Vous n’avez pas accès aux liens de ce site.",
  session: "Session expirée : reconnectez-vous.",
  demo: "Démonstration : aucun lien entre dossier et équipement ou zone n’est lu ni enregistré.",
  empty: "Aucun équipement ni aucune zone rattaché à ce dossier.",
  readOnly: "Lecture seule : vos droits ne permettent pas de modifier ces liens.",
  archived: "Site archivé : les liens restent consultables, aucune modification n’est possible.",
  explicit: "Chaque lien est une action explicite : rien n’est rattaché automatiquement.",
  partialAssets: "Liste d’équipements et de zones partielle : certains libellés peuvent manquer.",
  unknownAsset: "libellé non chargé",
  more: "Afficher la suite de l’historique",
  conflict: "Le lien a changé entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. Actualisez.",
  retry: "Issue inconnue (réponse perdue ou service indisponible). Réessayer renvoie exactement la même commande.",
  resume: "Une modification de lien a été envoyée depuis cet onglet sans réponse confirmée : reprenez la même commande.",
  invalid: "Modification refusée (actif archivé, limite atteinte ou saisie invalide).",
  writeForbidden: "Vos droits ne permettent pas cette modification.",
  noId: "Identifiant de commande impossible à générer sur cet appareil : rien n’est envoyé.",
  noStorage: "La commande ne peut pas être conservée dans cet onglet : rien n’est envoyé (une reprise sûre serait impossible).",
  replyUnreadable: "Réponse illisible : l’issue est inconnue. Réessayez la même commande.",
  saved: "Lien enregistré.",
  replayed: "Commande déjà enregistrée : l’état a été relu.",
} as const;

// ---- State --------------------------------------------------------------------------------------
export type AlState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  records: LinkRow[];
  cursor: string | null;
  canWrite: boolean;
  siteArchived: boolean;
  loadingMore: boolean;
  error: string;
  busy: boolean;
  pending: LinkCommand | null;
  conflict: string;
  writeError: string;
  notice: string;
};
export const AL_INITIAL: AlState = { phase: "loading", records: [], cursor: null, canWrite: false, siteArchived: false, loadingMore: false, error: "", busy: false, pending: null, conflict: "", writeError: "", notice: "" };
export const canModify = (demo: boolean, readOnly: boolean, s: AlState) => !demo && !readOnly && s.phase === "ready" && s.canWrite && !s.siteArchived && !s.pending && !s.conflict && !s.busy;
/** Latest row per asset (records are ordered by link id; one row per (dossier, asset)). */
export function rowsByAsset(records: LinkRow[]): LinkRow[] {
  const m = new Map<string, LinkRow>();
  for (const r of records) m.set(`${r.kind}:${lower(r.asset_id)}`, r);
  return [...m.values()];
}

export function createAlController({
  api,
  siteId,
  interventionId,
  context = DEFAULT_AL_CONTEXT,
  store,
  newId = alUuid,
  get,
  set,
  demo = false,
  readOnly = false,
}: {
  api: () => AlApi;
  siteId: string;
  interventionId: string;
  context?: AlContext;
  store: () => AlStore;
  newId?: () => string | null;
  get: () => AlState;
  set: (s: AlState) => void;
  demo?: boolean;
  readOnly?: boolean;
}) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  const ok = () => attached && context.generation() === gen && context.userId() === uid;
  let seq = 0;
  let busy = false;
  const key = () => (uid ? commandKey(uid, siteId, interventionId) : null);

  async function load(): Promise<boolean> {
    if (demo) {
      set({ ...get(), phase: "demo" });
      return false;
    }
    if (busy) return false;
    const mine = ++seq;
    set({ ...get(), phase: get().phase === "ready" ? "ready" : "loading", loadingMore: false });
    const r = await api().list(siteId, interventionId, null);
    if (!ok() || mine !== seq) return false;
    if (r.status !== 200) {
      set({ ...get(), phase: r.status === 404 || r.status === 403 || r.status === 401 ? "unavailable" : "error", error: r.status === 404 ? AL_COPY.notFound : r.status === 403 ? AL_COPY.forbidden : r.status === 401 ? AL_COPY.session : AL_COPY.loadFailed });
      return true;
    }
    const p = parseLinksPage(r.body, siteId, interventionId, true);
    if (!p) {
      set({ ...get(), phase: "error", error: AL_COPY.loadFailed });
      return true;
    }
    let next: AlState = { ...get(), phase: "ready", records: p.records, cursor: p.page.next_cursor, canWrite: p.permissions.can_write, siteArchived: p.site_archived, error: "" };
    const k = key();
    const stored = k && !next.pending && !readOnly ? readStored(store().get(k), interventionId) : null;
    if (stored) next = { ...next, pending: stored, writeError: AL_COPY.resume };
    set(next);
    return true;
  }
  async function send(cmd: LinkCommand): Promise<boolean> {
    if (!ok() || demo || readOnly) return false;
    busy = true;
    seq++;
    set({ ...get(), busy: true, writeError: "", conflict: "", notice: "" });
    let r: AlResult;
    try {
      r = await api().command(siteId, cmd);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    busy = false;
    if (!ok()) return false;
    const k = key();
    const base = { ...get(), busy: false };
    if (r.status === 200) {
      const reply = parseLinkReply(r.body, siteId, cmd);
      if (!reply) {
        set({ ...base, pending: cmd, writeError: AL_COPY.replyUnreadable });
        return true;
      }
      if (k) store().remove(k);
      set({ ...base, pending: null, notice: reply.replayed ? AL_COPY.replayed : AL_COPY.saved });
      await load(); // a replay returns the original receipt: always re-read
      return true;
    }
    if (r.status === 409) {
      set({ ...base, pending: null, conflict: AL_COPY.conflict });
      return true;
    }
    if (r.status === 503 || r.status === AL_TIMEOUT || r.status === 0 || r.status >= 500) {
      set({ ...base, pending: cmd, writeError: AL_COPY.retry });
      return true;
    }
    if (k) store().remove(k);
    set({ ...base, pending: null, writeError: r.status === 403 ? AL_COPY.writeForbidden : r.status === 404 ? AL_COPY.notFound : r.status === 401 ? AL_COPY.session : AL_COPY.invalid });
    return true;
  }
  async function issue(kind: AssetKind, assetId: string, action: "link" | "unlink", expected: number | null): Promise<boolean> {
    const s = get();
    if (busy || !canModify(demo, readOnly, s)) return false;
    if (action === "unlink" && expected === null) return false;
    const k = key();
    if (!k) {
      set({ ...s, writeError: AL_COPY.session });
      return false;
    }
    const cid = newId();
    if (!cid || !UUID.test(cid)) {
      set({ ...s, writeError: AL_COPY.noId });
      return false;
    }
    const cmd: LinkCommand = { command_id: lower(cid), intervention_id: lower(interventionId), kind, asset_id: lower(assetId), action, expected_version: expected };
    if (!store().set(k, JSON.stringify(cmd))) {
      set({ ...s, writeError: AL_COPY.noStorage });
      return false;
    }
    return send(cmd);
  }
  return {
    load,
    async more(): Promise<boolean> {
      const s = get();
      if (demo || busy || s.phase !== "ready" || s.loadingMore || !s.cursor) return false;
      const cursor = s.cursor;
      const mine = seq;
      set({ ...s, loadingMore: true });
      const r = await api().list(siteId, interventionId, cursor);
      if (!ok() || mine !== seq) return false;
      const p = r.status === 200 ? parseLinksPage(r.body, siteId, interventionId, false) : null;
      if (!p || (p.records.length && get().records.length && lower(p.records[0].id) <= lower(get().records[get().records.length - 1].id))) {
        set({ ...get(), loadingMore: false, error: AL_COPY.loadFailed });
        return true;
      }
      set({ ...get(), loadingMore: false, error: "", records: [...get().records, ...p.records], cursor: p.page.next_cursor });
      return true;
    },
    /** First link (null) or re-link of a detached row (its current version). */
    link: (kind: AssetKind, assetId: string, currentVersion: number | null) => issue(kind, assetId, "link", currentVersion),
    unlink: (row: LinkRow) => issue(row.kind, row.asset_id, "unlink", row.version),
    async retry(): Promise<boolean> {
      const cmd = get().pending;
      if (busy || !cmd || demo || readOnly) return false;
      return send(cmd);
    },
    async refresh(): Promise<boolean> {
      if (busy) return false;
      const k = key();
      if (get().conflict && k) store().remove(k);
      set({ ...get(), conflict: "", writeError: "", notice: "", pending: null });
      return load();
    },
    detach() {
      attached = false;
    },
  };
}
