// ENT-08 site floors / zones / common areas (ENT-05 « parties communes » = kind common_area,
// classification only) — pure model (no React). Backend contract (read-only):
// lib/features/site-areas/schemas.ts + app/api/sites/[id]/areas.
import { z } from "zod";
import { areaRecord, areaValues, type SiteArea } from "../../../lib/features/site-areas/schemas";

export type { SiteArea };
export type AreaKind = "floor" | "zone" | "common_area";
export type AreaValues = z.infer<typeof areaValues>;
export type AreasResult = { status: number; body: unknown; retryAfter: number | null };
export type SaveArea = { action: "save"; id: string; command_id: string; expected_version: number | null; values: AreaValues };
export type ArchiveArea = { action: "archive"; id: string; command_id: string; expected_version: number };
export type AreaCommand = SaveArea | ArchiveArea;
export type AreasApi = {
  list(siteId: string, cursor: string | null): Promise<AreasResult>;
  command(siteId: string, body: AreaCommand): Promise<AreasResult>;
};
export type AreasContext = { generation(): number; userId(): string | null };
export const DEFAULT_AREAS_CONTEXT: AreasContext = { generation: () => 0, userId: () => null };
export const AREAS_TIMEOUT_MS = 15_000;
export const AREAS_TIMEOUT = -1;
export const MAX_DEPTH = 4;

/** Real UUID or null (never a constant fallback): null ⇒ the write is refused explicitly. */
export const areaUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<AreasResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: AreasResult = { status: AREAS_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<AreasResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<AreasResult> => {
    try {
      const response = await fetcher(path, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch (error) {
      if (controller?.signal.aborted) return timedOut;
      throw error;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
/** Same-origin, credentials same-origin, no-store, 15 s deadline; the cursor is sent unchanged. */
export function createAreasApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = AREAS_TIMEOUT_MS } = {}): AreasApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  const path = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/areas`;
  return {
    list: (siteId, cursor) => timed(fetcher, `${path(siteId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { ...base, method: "GET" }, timeoutMs),
    command: (siteId, body) => timed(fetcher, path(siteId), { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const pageSchema = z
  .object({
    records: z.array(areaRecord).max(100),
    page: z.object({ limit: z.literal(100), total: z.number().int().min(0).max(1000), remaining: z.number().int().min(0).max(1000), has_more: z.boolean(), next_cursor: z.string().min(1).max(180).nullable(), complete: z.boolean() }).strict(),
    limits: z.object({ max_depth: z.literal(4), max_active: z.literal(1000) }).strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
  })
  .strict();
export type AreasPage = z.infer<typeof pageSchema>;
/** Off-contract ⇒ null (an error, never an empty list). */
export function parseAreasPage(body: unknown, siteId: string, firstPage: boolean): AreasPage | null {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data, g = p.page;
  if (g.remaining > g.total || (firstPage && g.remaining !== g.total)) return null;
  if (p.records.length !== Math.min(g.remaining, 100)) return null;
  if (g.has_more !== g.remaining > 100 || g.has_more !== (g.next_cursor !== null) || g.complete !== (firstPage && !g.has_more)) return null;
  if (p.records.some((r, i) => r.site_id !== siteId || r.archived_at !== null || (i > 0 && r.id <= p.records[i - 1].id))) return null;
  // Depth coherence inside the page: a loaded parent must be exactly one level up.
  const byId = new Map(p.records.map((r) => [r.id, r]));
  if (p.records.some((r) => r.parent_id !== null && byId.has(r.parent_id) && byId.get(r.parent_id)!.depth !== r.depth - 1)) return null;
  return p;
}
export function parseAreaReply(body: unknown, command: AreaCommand, siteId: string): SiteArea | null {
  const parsed = z.object({ record: areaRecord }).strict().safeParse(body);
  if (!parsed.success) return null;
  const r = parsed.data.record;
  const version = command.action === "save" && command.expected_version === null ? 1 : (command.expected_version ?? 0) + 1;
  if (r.id !== command.id || r.site_id !== siteId || r.version !== version || (command.action === "archive") !== (r.archived_at !== null)) return null;
  if (command.action === "save" && (Object.keys(command.values) as (keyof AreaValues)[]).some((k) => r[k] !== command.values[k])) return null;
  return r;
}

// ---- Hierarchy (as returned; never an invented tree) ---------------------------------------------
export type AreaRow = { area: SiteArea; orphan: boolean };
/** Loaded areas in display order: depth-first from loaded roots; areas whose parent is not loaded
 *  (another page) follow, flagged « parent sur une autre page », with their returned depth. */
export function areaRows(records: SiteArea[]): AreaRow[] {
  const ids = new Set(records.map((r) => r.id));
  const children = new Map<string | null, SiteArea[]>();
  for (const r of records) {
    const key = r.parent_id !== null && ids.has(r.parent_id) ? r.parent_id : r.parent_id === null ? null : `orphan:${r.id}`;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(r);
  }
  const out: AreaRow[] = [];
  const seen = new Set<string>();
  const walk = (r: SiteArea, orphan: boolean) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    out.push({ area: r, orphan });
    for (const c of children.get(r.id) ?? []) walk(c, false);
  };
  for (const r of children.get(null) ?? []) walk(r, false);
  for (const r of records) if (r.parent_id !== null && !ids.has(r.parent_id)) walk(r, true);
  for (const r of records) if (!seen.has(r.id)) walk(r, true); // defensive: any remaining row is still shown
  return out;
}
/** Ids of `id` and all its loaded descendants. */
export function subtree(records: SiteArea[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const r of records) if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) (out.add(r.id), (grew = true));
  }
  return out;
}
/** Parent choices for `editingId` (null = new): loaded active areas, depth < 4, never self or a
 *  descendant, and the moved subtree (as far as loaded) must stay within depth 4. */
export function parentOptions(records: SiteArea[], editingId: string | null): SiteArea[] {
  const self = editingId ? records.find((r) => r.id === editingId) : null;
  const excluded = editingId ? subtree(records, editingId) : new Set<string>();
  const height = self ? Math.max(...[...excluded].map((id) => records.find((r) => r.id === id)?.depth ?? self.depth)) - self.depth : 0;
  return records.filter((r) => r.archived_at === null && r.depth < MAX_DEPTH && !excluded.has(r.id) && r.depth + 1 + height <= MAX_DEPTH);
}

// ---- Wording ---------------------------------------------------------------------------------------
export const KIND_LABEL: Record<AreaKind, string> = { floor: "Étage", zone: "Zone", common_area: "Partie commune" };
export const AREAS_COPY = {
  intro: "Étages, zones et parties communes du site, pour situer les équipements et les interventions. Classement descriptif uniquement.",
  readOnly: "Lecture seule : vous pouvez consulter l’organisation du site, sans la modifier.",
  loadFailed: "Les zones du site n’ont pas pu être vérifiées. Réessayez.",
  empty: "Aucun étage, aucune zone ni partie commune enregistrés pour ce site.",
  conflict:
    "Enregistrement refusé : la zone a été modifiée entre-temps, ou le nom existe déjà au même niveau, ou la référence est déjà utilisée sur ce site, ou la hiérarchie serait invalide (boucle, plus de 4 niveaux, zone ayant encore des sous-zones actives), ou la limite de 1000 zones est atteinte. Actualisez la liste ; votre saisie est conservée.",
  parentMissing: "La zone parente ou le site n’existe plus ou n’est plus accessible : actualisez la liste.",
  invalid: "Vérifiez les valeurs saisies.",
  session: "Votre session a expiré ou vos droits ont changé. Reconnectez-vous.",
  retry: "L’enregistrement n’a pas été confirmé. Réessayez : la même demande sera renvoyée.",
  timeout: "Délai dépassé : l’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
  noId: "Ce navigateur ne peut pas générer d’identifiant sûr : l’enregistrement est impossible ici.",
  demo: "En démonstration, l’organisation du site (étages, zones, parties communes) n’est pas enregistrée.",
  partial: (loaded: number, total: number) => `${loaded} élément(s) affiché(s) sur ${total} : l’arborescence n’est pas complète tant que tout n’est pas chargé.`,
  orphan: "parent sur une autre page",
} as const;

// ---- Form ----------------------------------------------------------------------------------------
export type AreaForm = { id: string; expected_version: number | null; label: string; kind: AreaKind; reference: string; note: string; parent_id: string | null };
export type AreaErrors = Partial<Record<keyof AreaForm, string>>;
export const newAreaForm = (id: string, parent_id: string | null = null): AreaForm => ({ id, expected_version: null, label: "", kind: "floor", reference: "", note: "", parent_id });
export const editAreaForm = (r: SiteArea): AreaForm => ({ id: r.id, expected_version: r.version, label: r.label, kind: r.kind, reference: r.reference, note: r.note, parent_id: r.parent_id });
export function areaFormToCommand(f: AreaForm, commandId: string, records: SiteArea[]): { command: SaveArea } | { errors: AreaErrors } {
  const values = { label: f.label.trim(), kind: f.kind, reference: f.reference.trim(), note: f.note.trim(), parent_id: f.parent_id };
  const errors: AreaErrors = {};
  const parsed = areaValues.safeParse(values);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "label") as keyof AreaForm;
      if (errors[key]) continue;
      errors[key] = key === "label" ? "Nom : 1 à 160 caractères." : key === "reference" ? "Référence : 80 caractères au plus." : key === "note" ? "Note : 2000 caractères au plus." : "Valeur invalide.";
    }
  if (f.parent_id !== null && !parentOptions(records, f.expected_version === null ? null : f.id).some((r) => r.id === f.parent_id)) errors.parent_id = "Ce parent n’est pas possible (lui-même, une sous-zone, ou plus de 4 niveaux).";
  if (Object.keys(errors).length || !parsed.success) return { errors };
  return { command: { action: "save", id: f.id, command_id: commandId, expected_version: f.expected_version, values: parsed.data } };
}

// ---- State machine + controller -------------------------------------------------------------------
export type AreasState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  records: SiteArea[];
  page: AreasPage["page"] | null;
  total: number | null;
  canWrite: boolean;
  loadingMore: boolean;
  error: string;
  busy: boolean;
  writeError: string;
  pending: AreaCommand | null;
  saved: string;
};
export const AREAS_INITIAL: AreasState = { phase: "loading", records: [], page: null, total: null, canWrite: false, loadingMore: false, error: "", busy: false, writeError: "", pending: null, saved: "" };

export function applyAreasList(s: AreasState, r: AreasResult, append: boolean, siteId: string): AreasState {
  if (r.status === 200) {
    const p = parseAreasPage(r.body, siteId, !append);
    if (!p) return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: AREAS_COPY.loadFailed };
    const seen = new Set(append ? s.records.map((x) => x.id) : []);
    const records = [...(append ? s.records : []), ...p.records.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))];
    return { ...s, phase: "ready", records, page: p.page, total: append ? s.total : p.page.total, canWrite: p.permissions.can_write, loadingMore: false, error: "" };
  }
  if (r.status === 404) return { ...AREAS_INITIAL, phase: "unavailable", error: AREAS_COPY.parentMissing };
  const error = r.status === 401 || r.status === 403 ? AREAS_COPY.session : AREAS_COPY.loadFailed;
  return { ...s, loadingMore: false, phase: append ? s.phase : "error", error };
}
export function applyAreaCommand(s: AreasState, r: AreasResult, command: AreaCommand, siteId: string): AreasState {
  const base = { ...s, busy: false, writeError: "", saved: "" };
  if (r.status === 200) {
    const record = parseAreaReply(r.body, command, siteId);
    if (!record) return { ...base, writeError: AREAS_COPY.retry, pending: command };
    const known = s.records.some((x) => x.id === record.id);
    const records = command.action === "archive" ? s.records.filter((x) => x.id !== record.id) : known ? s.records.map((x) => (x.id === record.id ? record : x)) : [...s.records, record].sort((a, b) => (a.id < b.id ? -1 : 1));
    const total = s.total === null ? null : command.action === "archive" ? Math.max(0, s.total - 1) : known ? s.total : s.total + 1;
    return { ...base, records, total, pending: null, saved: command.action === "archive" ? "Élément archivé." : "Élément enregistré." };
  }
  if (r.status === 409) return { ...base, writeError: AREAS_COPY.conflict, pending: null };
  if (r.status === 404) return { ...base, writeError: AREAS_COPY.parentMissing, pending: null };
  if (r.status === 422 || r.status === 400) return { ...base, writeError: AREAS_COPY.invalid, pending: null };
  if (r.status === 401 || r.status === 403) return { ...base, writeError: AREAS_COPY.session, pending: null };
  return { ...base, writeError: r.status === AREAS_TIMEOUT ? AREAS_COPY.timeout : AREAS_COPY.retry, pending: command };
}

/** Same discipline as the contacts / energy leaves: list sequence, single-flight writes, write
 *  barrier (sequence bumped at write start and after the reply; no load / more during a write;
 *  causal reload when a write interrupted a load), generation + uid guard, detach; demo: no call. */
export function createAreasController({ api, siteId, context = DEFAULT_AREAS_CONTEXT, get, set, demo = false }: { api: () => AreasApi; siteId: string; context?: AreasContext; get: () => AreasState; set: (s: AreasState) => void; demo?: boolean }) {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let writing = false;
  let attached = true;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async (append: boolean) => {
    const my = append ? loadSeq : ++loadSeq;
    const gen = context.generation(), uid = context.userId();
    const cursor = append ? get().page?.next_cursor ?? null : null;
    let r: AreasResult;
    loadsInFlight++;
    try {
      r = await api().list(siteId, cursor);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      loadsInFlight--;
    }
    if (!same(gen, uid) || my !== loadSeq) return false;
    set(applyAreasList(get(), r, append, siteId));
    return true;
  };
  const send = async (command: AreaCommand) => {
    if (writing || demo) return false;
    writing = true;
    const hadLoad = loadsInFlight > 0 || get().phase === "loading";
    loadSeq++;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), busy: true, writeError: "", saved: "", loadingMore: false });
    let r: AreasResult;
    try {
      r = await api().command(siteId, command);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      writing = false;
    }
    loadSeq++;
    if (!same(gen, uid)) return false;
    set(applyAreaCommand(get(), r, command, siteId));
    if (hadLoad) void fetchList(false);
    return true;
  };
  return {
    get writing() {
      return writing;
    },
    load() {
      if (demo) {
        set({ ...AREAS_INITIAL, phase: "demo" });
        return Promise.resolve(false);
      }
      if (writing) return Promise.resolve(false);
      set({ ...get(), phase: "loading", records: [], page: null, total: null, error: "", loadingMore: false });
      return fetchList(false);
    },
    more() {
      if (demo || writing) return Promise.resolve(false);
      const s = get();
      if (s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return Promise.resolve(false);
      set({ ...s, loadingMore: true });
      return fetchList(true);
    },
    save(command: SaveArea) {
      return get().canWrite ? send(command) : Promise.resolve(false);
    },
    archive(record: SiteArea, commandId: string) {
      return get().canWrite ? send({ action: "archive", id: record.id, command_id: commandId, expected_version: record.version }) : Promise.resolve(false);
    },
    retry() {
      const p = get().pending;
      return p && get().canWrite ? send(p) : Promise.resolve(false);
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      loadSeq++;
    },
  };
}
