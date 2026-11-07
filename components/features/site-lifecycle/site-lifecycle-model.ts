// Enterprise site lifecycle — pure model (no React). Consumer of backend 9d23fff (read-only):
//   GET  /api/sites/:id/settings → { site, can_write }   (can_write is false once archived)
//   POST /api/sites/:id/settings { command_id, expected_version, action:"save", values }
//                                | { command_id, expected_version, action:"archive" } → { site }
//   GET  /api/organizations/:id/sites?state=active|archived&after=uuid → { sites, next_after }
// Schemas copied strictly from lib/features/site-lifecycle/contract.ts. The contract has NO restore
// action: archiving is one-way from this screen. The whole command is persisted in tab storage
// (uid|site|expected_version) BEFORE the POST; lost reply / 503 / reload ⇒ the identical command.
import { z } from "zod";

export const SL_TIMEOUT_MS = 15_000;
export const SL_TIMEOUT = -1;
export const SITES_LIMIT = 50;
export type SlResult = { status: number; body: unknown; retryAfter: number | null };
export type SiteState = "active" | "archived";
export type OpeningSlot = { day: number; opens: string; closes: string };
export type SiteValues = { name: string; address: string; access_notes: string; opening_hours: OpeningSlot[] };
export type SaveCommand = { command_id: string; expected_version: number; action: "save"; values: SiteValues };
export type ArchiveCommand = { command_id: string; expected_version: number; action: "archive" };
export type SiteCommand = SaveCommand | ArchiveCommand;
export type SlApi = {
  settings(siteId: string): Promise<SlResult>;
  command(siteId: string, body: SiteCommand): Promise<SlResult>;
  sites(organizationId: string, state: SiteState, after: string | null): Promise<SlResult>;
};
export type SlContext = { generation(): number; userId(): string | null };
export const DEFAULT_SL_CONTEXT: SlContext = { generation: () => 0, userId: () => null };
export type SlStore = { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const slUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
const uuid = z.string().regex(UUID);
const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
const hour = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
/** No overlap on the same day, opens < closes (same rule as the contract). */
export function slotsValid(slots: OpeningSlot[]): boolean {
  return slots.every((slot, i) => slot.opens < slot.closes && slots.slice(i + 1).every((o) => o.day !== slot.day || o.closes <= slot.opens || slot.closes <= o.opens));
}
const openingHours = z
  .array(z.object({ day: z.number().int().min(1).max(7), opens: hour, closes: hour }).strict())
  .max(28)
  .refine(slotsValid);
const siteValues = z.object({ name: z.string().trim().min(1).max(160), address: z.string().trim().min(5).max(500), access_notes: z.string().trim().max(2000), opening_hours: openingHours }).strict();
export const SITE_TYPES = ["syndic", "restaurant", "office", "erp"] as const;
const siteRecord = siteValues
  .extend({ id: uuid, organization_id: uuid, type: z.enum(SITE_TYPES), budget_cents: z.number().int().nonnegative(), settings_version: z.number().int().positive(), archived_at: instant.nullable(), created_at: instant })
  .strict();
export type SiteRecord = z.infer<typeof siteRecord>;

export function parseSettings(body: unknown, siteId: string): { site: SiteRecord; can_write: boolean } | null {
  const r = z.object({ site: siteRecord, can_write: z.boolean() }).strict().safeParse(body);
  if (!r.success || r.data.site.id.toLowerCase() !== siteId.toLowerCase()) return null;
  if (r.data.can_write && r.data.site.archived_at !== null) return null;
  return r.data;
}
export function parseCommandReply(body: unknown, siteId: string, cmd: SiteCommand): SiteRecord | null {
  const r = z.object({ site: siteRecord }).strict().safeParse(body);
  if (!r.success) return null;
  const s = r.data.site;
  if (s.id.toLowerCase() !== siteId.toLowerCase() || s.settings_version !== cmd.expected_version + 1 || (s.archived_at !== null) !== (cmd.action === "archive")) return null;
  if (cmd.action === "save") {
    const v = cmd.values;
    if (s.name !== v.name || s.address !== v.address || s.access_notes !== v.access_notes || JSON.stringify(s.opening_hours) !== JSON.stringify(v.opening_hours)) return null;
  }
  return s;
}
export type SitesPage = { sites: SiteRecord[]; next_after: string | null };
export function parseSitesPage(body: unknown, organizationId: string, state: SiteState, after: string | null): SitesPage | null {
  const r = z.object({ sites: z.array(siteRecord).max(SITES_LIMIT), next_after: uuid.nullable() }).strict().safeParse(body);
  if (!r.success) return null;
  const { sites, next_after } = r.data;
  const a = after?.toLowerCase() ?? null;
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const id = s.id.toLowerCase();
    if (s.organization_id.toLowerCase() !== organizationId.toLowerCase() || (s.archived_at !== null) !== (state === "archived")) return null;
    if ((a && id <= a) || (i > 0 && id <= sites[i - 1].id.toLowerCase())) return null;
  }
  if (next_after !== null && (sites.length !== SITES_LIMIT || next_after.toLowerCase() !== sites[sites.length - 1].id.toLowerCase())) return null;
  return { sites, next_after };
}

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<SlResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: SlResult = { status: SL_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<SlResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<SlResult> => {
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
export function createSlApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = SL_TIMEOUT_MS } = {}): SlApi {
  const base = { credentials: "same-origin" as const, cache: "no-store" as const };
  const get = { ...base, method: "GET", headers: { accept: "application/json" } };
  return {
    settings: (id) => timed(fetcher, `/api/sites/${encodeURIComponent(id)}/settings`, get, timeoutMs),
    command: (id, body) => timed(fetcher, `/api/sites/${encodeURIComponent(id)}/settings`, { ...base, method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
    sites: (org, state, after) => timed(fetcher, `/api/organizations/${encodeURIComponent(org)}/sites?state=${state}${after ? `&after=${encodeURIComponent(after)}` : ""}`, get, timeoutMs),
  };
}
export const commandKey = (userId: string, siteId: string, expectedVersion: number) => `site-settings:${userId}|${siteId.toLowerCase()}|${expectedVersion}`;
export function tabStore(): SlStore {
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
const commandSchema = z.discriminatedUnion("action", [
  z.object({ command_id: uuid, expected_version: z.number().int().min(1).max(2147483646), action: z.literal("save"), values: siteValues }).strict(),
  z.object({ command_id: uuid, expected_version: z.number().int().min(1).max(2147483646), action: z.literal("archive") }).strict(),
]);
/** A stored command is reused only if it is a valid command for exactly this version. */
export function readStored(raw: string | null, expectedVersion: number): SiteCommand | null {
  if (!raw) return null;
  try {
    const r = commandSchema.safeParse(JSON.parse(raw));
    return r.success && r.data.expected_version === expectedVersion ? (r.data as SiteCommand) : null;
  } catch {
    return null;
  }
}

// ---- Form ---------------------------------------------------------------------------------------
export const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;
export type SiteForm = { name: string; address: string; access_notes: string; opening_hours: OpeningSlot[] };
export type FormErrors = { name?: string; address?: string; access_notes?: string; opening_hours?: string };
export const formFromSite = (s: SiteRecord): SiteForm => ({ name: s.name, address: s.address, access_notes: s.access_notes, opening_hours: s.opening_hours.map((x) => ({ ...x })) });
export function formToValues(f: SiteForm): { values: SiteValues } | { errors: FormErrors } {
  const e: FormErrors = {};
  const name = f.name.trim(), address = f.address.trim(), notes = f.access_notes.trim();
  if (name.length < 1 || name.length > 160) e.name = "Nom requis (160 caractères maximum).";
  if (address.length < 5 || address.length > 500) e.address = "Adresse de 5 à 500 caractères.";
  if (notes.length > 2000) e.access_notes = "2 000 caractères maximum.";
  const slots = f.opening_hours.map((s) => ({ day: Number(s.day), opens: s.opens, closes: s.closes }));
  const parsed = openingHours.safeParse(slots);
  if (slots.length > 28) e.opening_hours = "28 créneaux maximum.";
  else if (!parsed.success) e.opening_hours = "Créneaux invalides : heure d’ouverture avant l’heure de fermeture, sans chevauchement le même jour.";
  if (Object.keys(e).length) return { errors: e };
  return { values: { name, address, access_notes: notes, opening_hours: slots } };
}
export const sameValues = (a: SiteValues, b: SiteValues) => JSON.stringify(a) === JSON.stringify(b);

export const SL_COPY = {
  loading: "Lecture des paramètres du site…",
  loadFailed: "Les paramètres du site n’ont pas pu être lus. Rien n’a été modifié : réessayez.",
  notFound: "Ce site est introuvable ou n’est plus accessible.",
  forbidden: "Vous n’avez pas accès à ce site.",
  session: "Session expirée : reconnectez-vous.",
  demo: "Démonstration : les paramètres du site ne sont ni lus ni enregistrés.",
  readOnly: "Lecture seule : vos droits ne permettent pas de modifier ce site.",
  archived: "Site archivé : il reste consultable en lecture seule. La restauration n’est pas proposée depuis cet écran.",
  archiveConfirm: "Archiver ce site ? Il passe en lecture seule pour toute l’organisation et la restauration n’est pas disponible depuis cet écran.",
  saved: "Paramètres enregistrés.",
  archivedDone: "Site archivé.",
  unchanged: "Aucune modification à enregistrer.",
  conflict: "Le site a été modifié entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. Actualisez pour voir la version courante.",
  retry: "Issue inconnue (réponse perdue ou service indisponible). Réessayer renvoie exactement la même commande.",
  resume: "Une modification a été envoyée depuis cet onglet sans réponse confirmée : reprenez l’envoi de la même commande.",
  invalid: "Modification refusée par le serveur : vérifiez la saisie.",
  writeForbidden: "Vos droits ne permettent pas cette modification.",
  noId: "Identifiant de commande impossible à générer sur cet appareil : rien n’est envoyé.",
  noStorage: "La commande ne peut pas être conservée dans cet onglet : rien n’est envoyé (une reprise sûre serait impossible).",
  replyUnreadable: "Réponse illisible : l’issue est inconnue. Réessayez la même commande.",
  listLoading: "Lecture des sites…",
  listFailed: "La liste des sites n’a pas pu être lue. Réessayez.",
  orgNotFound: "Cette organisation est introuvable ou n’est plus accessible.",
  listDemo: "Démonstration : le portefeuille de sites n’est pas lu.",
  emptyActive: "Aucun site actif dans cette organisation.",
  emptyArchived: "Aucun site archivé.",
  shown: (n: number) => `${n} site(s) affiché(s).`,
  more: "D’autres sites existent : affichez la suite.",
} as const;

// ---- Settings state + controller ----------------------------------------------------------------
export type SettingsState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  site: SiteRecord | null;
  canWrite: boolean;
  error: string;
  busy: boolean;
  pending: SiteCommand | null;
  conflict: string;
  writeError: string;
  notice: string;
};
export const SETTINGS_INITIAL: SettingsState = { phase: "loading", site: null, canWrite: false, error: "", busy: false, pending: null, conflict: "", writeError: "", notice: "" };

export function applySettings(s: SettingsState, r: SlResult, siteId: string): SettingsState {
  if (r.status === 200) {
    const p = parseSettings(r.body, siteId);
    return p ? { ...s, phase: "ready", site: p.site, canWrite: p.can_write, error: "" } : { ...s, phase: "error", error: SL_COPY.loadFailed };
  }
  if (r.status === 404) return { ...s, phase: "unavailable", site: null, error: SL_COPY.notFound };
  if (r.status === 403) return { ...s, phase: "unavailable", site: null, error: SL_COPY.forbidden };
  if (r.status === 401) return { ...s, phase: "unavailable", site: null, error: SL_COPY.session };
  return { ...s, phase: "error", error: SL_COPY.loadFailed };
}
export const canEdit = (demo: boolean, s: SettingsState) => !demo && s.phase === "ready" && s.canWrite && !!s.site && s.site.archived_at === null && !s.pending && !s.conflict && !s.busy;

export function createSettingsController({
  api,
  siteId,
  context = DEFAULT_SL_CONTEXT,
  store,
  newId = slUuid,
  get,
  set,
  demo = false,
  onChanged,
}: {
  api: () => SlApi;
  siteId: string;
  context?: SlContext;
  store: () => SlStore;
  newId?: () => string | null;
  get: () => SettingsState;
  set: (s: SettingsState) => void;
  demo?: boolean;
  onChanged?: (site: SiteRecord) => void;
}) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  const ok = () => attached && context.generation() === gen && context.userId() === uid;
  let seq = 0;
  let busy = false;
  const keyFor = (v: number) => (uid ? commandKey(uid, siteId, v) : null);

  async function load(): Promise<boolean> {
    if (demo) {
      set({ ...get(), phase: "demo" });
      return false;
    }
    if (busy) return false;
    const mine = ++seq;
    set({ ...get(), phase: get().site ? get().phase : "loading" });
    const r = await api().settings(siteId);
    if (!ok() || mine !== seq) return false;
    let next = applySettings(get(), r, siteId);
    if (next.phase === "ready" && next.site && !next.pending) {
      const key = keyFor(next.site.settings_version);
      const stored = key ? readStored(store().get(key), next.site.settings_version) : null;
      if (stored) next = { ...next, pending: stored, writeError: SL_COPY.resume };
    }
    set(next);
    return true;
  }
  async function send(cmd: SiteCommand): Promise<boolean> {
    if (!ok() || demo) return false;
    busy = true;
    seq++;
    set({ ...get(), busy: true, writeError: "", conflict: "", notice: "" });
    let r: SlResult;
    try {
      r = await api().command(siteId, cmd);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    busy = false;
    if (!ok()) return false;
    const key = keyFor(cmd.expected_version);
    const base = { ...get(), busy: false };
    if (r.status === 200) {
      const site = parseCommandReply(r.body, siteId, cmd);
      if (!site) {
        set({ ...base, pending: cmd, writeError: SL_COPY.replyUnreadable });
        return true;
      }
      if (key) store().remove(key);
      set({ ...base, pending: null, site, canWrite: base.canWrite && site.archived_at === null, notice: cmd.action === "archive" ? SL_COPY.archivedDone : SL_COPY.saved });
      onChanged?.(site);
      await load();
      return true;
    }
    if (r.status === 409) {
      set({ ...base, pending: null, conflict: SL_COPY.conflict });
      return true;
    }
    if (r.status === 503 || r.status === SL_TIMEOUT || r.status === 0 || r.status >= 500) {
      set({ ...base, pending: cmd, writeError: SL_COPY.retry });
      return true;
    }
    if (key) store().remove(key);
    const message = r.status === 403 ? SL_COPY.writeForbidden : r.status === 404 ? SL_COPY.notFound : r.status === 401 ? SL_COPY.session : SL_COPY.invalid;
    set({ ...base, pending: null, writeError: message });
    return true;
  }
  async function issue(build: (id: string, version: number) => SiteCommand): Promise<boolean> {
    const s = get();
    if (busy || !canEdit(demo, s) || !s.site) return false;
    const key = keyFor(s.site.settings_version);
    if (!key) {
      set({ ...s, writeError: SL_COPY.session });
      return false;
    }
    const id = newId();
    if (!id || !UUID.test(id)) {
      set({ ...s, writeError: SL_COPY.noId });
      return false;
    }
    const cmd = build(id.toLowerCase(), s.site.settings_version);
    if (!store().set(key, JSON.stringify(cmd))) {
      set({ ...s, writeError: SL_COPY.noStorage });
      return false;
    }
    return send(cmd);
  }
  return {
    load,
    async save(form: SiteForm): Promise<{ errors: FormErrors } | boolean> {
      const s = get();
      if (busy || !canEdit(demo, s) || !s.site) return false;
      const out = formToValues(form);
      if ("errors" in out) return { errors: out.errors };
      if (sameValues(out.values, formFromSite(s.site))) {
        set({ ...s, notice: SL_COPY.unchanged });
        return false;
      }
      return issue((command_id, expected_version) => ({ command_id, expected_version, action: "save", values: out.values }));
    },
    /** Explicitly confirmed by the panel; one-way (the contract has no restore). */
    async archive(): Promise<boolean> {
      return issue((command_id, expected_version) => ({ command_id, expected_version, action: "archive" }));
    },
    async retry(): Promise<boolean> {
      const cmd = get().pending;
      if (busy || !cmd || demo) return false;
      return send(cmd);
    },
    /** Explicit « Actualiser »: drops the conflicting stored command, then re-reads. */
    async refresh(): Promise<boolean> {
      if (busy) return false;
      const s = get();
      if (s.conflict && s.site) {
        const key = keyFor(s.site.settings_version);
        if (key) store().remove(key);
      }
      set({ ...s, conflict: "", writeError: "", notice: "", pending: null });
      return load();
    },
    detach() {
      attached = false;
    },
  };
}

// ---- Portfolio list state + controller ----------------------------------------------------------
export type ListState = { phase: "loading" | "ready" | "error" | "unavailable" | "demo"; state: SiteState; sites: SiteRecord[]; nextAfter: string | null; loadingMore: boolean; error: string };
export const LIST_INITIAL: ListState = { phase: "loading", state: "active", sites: [], nextAfter: null, loadingMore: false, error: "" };
export function createListController({ api, organizationId, context = DEFAULT_SL_CONTEXT, get, set, demo = false }: { api: () => SlApi; organizationId: string; context?: SlContext; get: () => ListState; set: (s: ListState) => void; demo?: boolean }) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  const ok = () => attached && context.generation() === gen && context.userId() === uid;
  let seq = 0;
  return {
    async load(state: SiteState = get().state): Promise<boolean> {
      if (demo) {
        set({ ...get(), state, phase: "demo" });
        return false;
      }
      const mine = ++seq;
      set({ ...LIST_INITIAL, state });
      const r = await api().sites(organizationId, state, null);
      if (!ok() || mine !== seq) return false;
      if (r.status !== 200) {
        set({ ...get(), phase: r.status === 404 || r.status === 403 ? "unavailable" : "error", error: r.status === 404 ? SL_COPY.orgNotFound : r.status === 403 ? SL_COPY.forbidden : r.status === 401 ? SL_COPY.session : SL_COPY.listFailed });
        return true;
      }
      const p = parseSitesPage(r.body, organizationId, state, null);
      set(p ? { ...get(), phase: "ready", sites: p.sites, nextAfter: p.next_after, error: "" } : { ...get(), phase: "error", error: SL_COPY.listFailed });
      return true;
    },
    async more(): Promise<boolean> {
      const s = get();
      if (demo || s.phase !== "ready" || s.loadingMore || !s.nextAfter) return false;
      const after = s.nextAfter;
      const mine = seq;
      set({ ...s, loadingMore: true });
      const r = await api().sites(organizationId, s.state, after);
      if (!ok() || mine !== seq) return false;
      const p = r.status === 200 ? parseSitesPage(r.body, organizationId, s.state, after) : null;
      if (!p) {
        set({ ...get(), loadingMore: false, error: SL_COPY.listFailed });
        return true;
      }
      const seen = new Set(get().sites.map((x) => x.id.toLowerCase()));
      set({ ...get(), loadingMore: false, error: "", sites: [...get().sites, ...p.sites.filter((x) => !seen.has(x.id.toLowerCase()))], nextAfter: p.next_after });
      return true;
    },
    detach() {
      attached = false;
    },
  };
}
