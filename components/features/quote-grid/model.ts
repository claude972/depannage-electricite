// ENT-13 contract quote grid — pure model (no React). Browser-safe STRICT copy of the backend schemas
// (lib/features/contract-quote-pricing/contract.ts at e829877, access route at 737182d; the original
// imports server-only validation, so the shapes are reproduced here byte-for-byte in meaning):
//   Artisan  GET  /api/interventions/:id/quote-grid?after= → { current, grids:[{id,label,version,lines}], next_cursor }
//            POST same { grid_id, grid_version, selection:[{index,quantity}], expected_version,
//                        assignment_token, base_quote_id, tax_rate } → the draft-save envelope
//   Quote    GET  /api/quotes/:id/contract-grid → { source: null | { grid_id, grid_version, grid_label } }
//   Owner    GET  /api/interventions/:id/quote-grid/access?after= → { grid_id, version, grids:[{id,label,version}], next_cursor }
//            POST same { command_id, grid_id | null, expected_version | null } → { grid_id, version, replayed }
// The artisan only ever sees the grid the organisation owner attached to THIS dossier.
// Owner writes: identity fence under `courant-private-quote-grid:` (write + read-back or 0 POST,
// uid + generation, strict restore never auto-sent, no replay after identity change, 401/403 clear).
import { z } from "zod";
import { taxRateSchema, type TaxRate } from "../../../lib/tax-rates";
import type { QuoteDraftEnvelope } from "../../app/types";

export const QG_TIMEOUT_MS = 15_000;
export const QG_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID);
const version = z.number().int().min(1).max(2147483647);
const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
export const UNITS = ["hour", "visit", "flat", "km", "unit"] as const;
export const UNIT_LABEL: Record<(typeof UNITS)[number], string> = { hour: "heure", visit: "visite", flat: "forfait", km: "km", unit: "unité" };
const line = z.object({ index: z.number().int().min(0).max(99), label: z.string().min(1).max(160), unit: z.enum(UNITS), unit_price_cents: z.number().int().min(0).max(10_000_000) }).strict();
const source = z.object({ grid_id: uuid, grid_version: version, grid_label: z.string().min(1).max(160) }).strict();
export type GridSource = z.infer<typeof source>;
const gridOptions = z
  .object({
    current: source.nullable(),
    grids: z.array(z.object({ id: uuid, label: z.string().min(1).max(160), version, lines: z.array(line).min(1).max(100) }).strict()).max(20),
    next_cursor: uuid.nullable(),
  })
  .strict();
export type GridOptions = z.infer<typeof gridOptions>;
export type Grid = GridOptions["grids"][number];
const applyGrid = z
  .object({
    grid_id: uuid,
    grid_version: version,
    selection: z.array(z.object({ index: z.number().int().min(0).max(99), quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(30).refine((rows) => new Set(rows.map((x) => x.index)).size === rows.length),
    expected_version: z.number().int().min(0).max(2147483646),
    assignment_token: z.string().regex(/^[a-f0-9]{64}$/),
    base_quote_id: uuid.nullable(),
    tax_rate: taxRateSchema.nullable(),
  })
  .strict();
export type ApplyGrid = z.infer<typeof applyGrid>;
const appliedGrid = z
  .object({
    version,
    assignment_token: z.string().regex(/^[a-f0-9]{64}$/),
    current_quote_id: uuid.nullable(),
    draft: z
      .object({
        intervention_id: uuid, artisan_id: uuid, version, assignment_token: z.string().regex(/^[a-f0-9]{64}$/), base_quote_id: uuid.nullable(),
        lines: z.array(z.object({ label: z.string().min(1).max(160), quantity: z.number().int().min(1).max(1000), unit_price_cents: z.number().int().min(0).max(10_000_000) }).strict()).min(1).max(30),
        tax_rate: taxRateSchema.nullable(),
        updated_at: instant,
      })
      .strict(),
  })
  .strict();
const accessEditor = z.object({ grid_id: uuid.nullable(), version: z.number().int().positive().nullable(), grids: z.array(z.object({ id: uuid, label: z.string().min(1).max(160), version: z.number().int().positive() }).strict()).max(20), next_cursor: uuid.nullable() }).strict();
export type AccessView = z.infer<typeof accessEditor>;
const accessCommand = z.object({ command_id: uuid, grid_id: uuid.nullable(), expected_version: z.number().int().min(1).max(2147483646).nullable() }).strict();
export type AccessCommand = z.infer<typeof accessCommand>;
const accessReceipt = z.object({ grid_id: uuid.nullable(), version: z.number().int().positive(), replayed: z.boolean() }).strict();
const lower = (v: string) => v.toLowerCase();

export function parseOptions(body: unknown, after: string | null): GridOptions | null {
  const r = gridOptions.safeParse(body);
  if (!r.success) return null;
  const ids = r.data.grids.map((g) => lower(g.id));
  if (new Set(ids).size !== ids.length || (after && ids.some((x) => x <= lower(after)))) return null;
  for (const g of r.data.grids) {
    const idx = g.lines.map((l) => l.index);
    if (new Set(idx).size !== idx.length) return null;
  }
  return r.data;
}
/** The apply answer = the draft-save envelope, checked like the route (scope, versions, token). */
export function parseApplied(body: unknown, interventionId: string, artisanId: string | null, cmd: ApplyGrid): QuoteDraftEnvelope | null {
  const r = appliedGrid.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.draft.intervention_id) !== lower(interventionId) || (artisanId && lower(d.draft.artisan_id) !== lower(artisanId))) return null;
  if (d.version !== cmd.expected_version + 1 || d.draft.version !== d.version || d.assignment_token !== cmd.assignment_token || d.draft.assignment_token !== cmd.assignment_token) return null;
  return d as unknown as QuoteDraftEnvelope;
}
export function parseSource(body: unknown): GridSource | null | undefined {
  const r = z.object({ source: source.nullable() }).strict().safeParse(body);
  return r.success ? r.data.source : undefined;
}
export function parseAccess(body: unknown, after: string | null): AccessView | null {
  const r = accessEditor.safeParse(body);
  if (!r.success || (r.data.grid_id !== null && r.data.version === null)) return null;
  const ids = r.data.grids.map((g) => lower(g.id));
  if (new Set(ids).size !== ids.length || (after && ids.some((x) => x <= lower(after)))) return null;
  return r.data;
}
export function parseAccessReceipt(body: unknown, cmd: AccessCommand) {
  const r = accessReceipt.safeParse(body);
  if (!r.success || r.data.version !== (cmd.expected_version ?? 0) + 1 || (r.data.grid_id ? lower(r.data.grid_id) : null) !== (cmd.grid_id ? lower(cmd.grid_id) : null)) return null;
  return r.data;
}
/** Selection → strict apply body; null when the selection is empty / invalid. */
export function buildApply(grid: Grid, quantities: Record<number, string>, env: { version: number; assignment_token: string; current_quote_id: string | null }, taxRate: TaxRate | null): ApplyGrid | null {
  const selection = grid.lines
    .filter((l) => quantities[l.index] !== undefined && quantities[l.index] !== "")
    .map((l) => ({ index: l.index, quantity: Number(quantities[l.index]) }));
  const body = { grid_id: lower(grid.id), grid_version: grid.version, selection, expected_version: env.version, assignment_token: env.assignment_token, base_quote_id: env.current_quote_id, tax_rate: taxRate };
  const r = applyGrid.safeParse(body);
  return r.success ? (body as ApplyGrid) : null;
}
export const sourceLabel = (s: GridSource) => `Basé sur la grille ${s.grid_label} version ${s.grid_version}`;

// ---- API ------------------------------------------------------------------------------------------
async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: QG_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? QG_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type QgApi = {
  options(interventionId: string, after: string | null): Promise<Result>;
  apply(interventionId: string, body: ApplyGrid): Promise<Result>;
  source(quoteId: string): Promise<Result>;
  access(interventionId: string, after: string | null): Promise<Result>;
  setAccess(interventionId: string, body: AccessCommand): Promise<Result>;
};
export function createQgApi(fetcher: typeof fetch = (...a) => fetch(...a)): QgApi {
  const enc = encodeURIComponent;
  const post = (url: string, body: unknown) => timed(fetcher, url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, QG_TIMEOUT_MS);
  const get = (url: string) => timed(fetcher, url, { method: "GET" }, QG_TIMEOUT_MS);
  return {
    options: (id, after) => get(`/api/interventions/${enc(id)}/quote-grid${after ? `?after=${enc(after)}` : ""}`),
    apply: (id, body) => post(`/api/interventions/${enc(id)}/quote-grid`, body),
    source: (quoteId) => get(`/api/quotes/${enc(quoteId)}/contract-grid`),
    access: (id, after) => get(`/api/interventions/${enc(id)}/quote-grid/access${after ? `?after=${enc(after)}` : ""}`),
    setAccess: (id, body) => post(`/api/interventions/${enc(id)}/quote-grid/access`, body),
  };
}

// ---- Owner access: identity-fenced controller ---------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-quote-grid:";
export const pendingKey = (uid: string | null, gen: number, interventionId: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${lower(interventionId)}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), intervention_id: uuid, command: accessCommand }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const COPY = {
  accessTitle: "Grille contractuelle autorisée pour ce dossier",
  accessNote: "L’artisan attribué voit uniquement la grille que vous autorisez ici, pour ce dossier. Aucune autre grille ni tarif privé ne lui est montré.",
  accessNone: "Aucune grille autorisée : l’artisan établit son devis librement.",
  loading: "Lecture des grilles…",
  loadFailed: "Les grilles n’ont pas pu être lues. Réessayez.",
  forbidden: "Réservé au propriétaire de l’organisation : vos droits, vérifiés par le serveur, ne couvrent pas cette autorisation.",
  demo: "En démonstration, aucune grille contractuelle n’est lue ni autorisée.",
  confirmAttach: (label: string) => `Autoriser la grille « ${label} » pour ce dossier ? L’artisan attribué pourra l’appliquer à son brouillon de devis.`,
  confirmDetach: "Retirer l’autorisation ? L’artisan ne verra plus cette grille ; les devis déjà envoyés gardent leur référence.",
  attached: "Grille autorisée pour ce dossier.",
  detached: "Autorisation retirée.",
  replayed: "Commande déjà enregistrée : l’état actuel a été relu.",
  conflict: "L’autorisation a changé entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse cette grille pour ce dossier.",
  notFound: "Ce dossier n’est plus accessible.",
  retry: "L’autorisation n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune autorisation n’est possible ici.",
  more: "Afficher d’autres grilles",
  // artisan side
  pickerTitle: "Grille contractuelle du client",
  pickerNone: "Aucune grille contractuelle n’est autorisée pour ce dossier : établissez le devis librement.",
  pickerNote: "Seule la grille autorisée par le propriétaire de l’organisation pour ce dossier est proposée. Les prix viennent de la grille ; la TVA reste celle que vous choisissez.",
  applied: "Grille appliquée au brouillon. Vérifiez-le puis envoyez-le ; « Enregistrer » reste inutile tant que vous ne le modifiez pas.",
  linked: (s: { grid_label: string; grid_version: number }) => `Brouillon issu de la grille ${s.grid_label} version ${s.grid_version}.`,
  unlinked: "Brouillon modifié manuellement : il ne sera plus rattaché à la grille contractuelle.",
  replaceWarning: "Vos modifications non enregistrées seront remplacées par les lignes de la grille.",
  applyConflict: "Le brouillon a changé entre-temps : rechargez-le avant d’appliquer la grille.",
  applyRefused: "Le serveur refuse cette sélection pour ce dossier.",
  applyRetry: "L’application de la grille n’est pas confirmée. Réessayez la même demande ou rechargez le brouillon.",
  selectAtLeast: "Indiquez une quantité (1 à 1 000) pour au moins une ligne.",
} as const;

export type AccessState = { phase: "loading" | "ready" | "error" | "forbidden"; data: AccessView | null; busy: boolean; pending: AccessCommand | null; error: string; notice: string };
export const ACCESS_INITIAL: AccessState = { phase: "loading", data: null, busy: false, pending: null, error: "", notice: "" };

export function createAccessController({ api, interventionId, store, newId, context, get, set }: { api: () => QgApi; interventionId: string; store: () => Store | null; newId: () => string | null; context: Context; get: () => AccessState; set: (s: AccessState) => void }) {
  let alive = true;
  let inFlight = false;
  let seq = 0;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => alive && context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen, interventionId)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...ACCESS_INITIAL, phase: "forbidden" });
  };
  const load = async (after: string | null = null) => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await api().access(interventionId, after);
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const d = r.status === 200 ? parseAccess(r.body, after) : null;
    if (!d) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    const prev = after && get().data ? get().data!.grids : [];
    set({ ...get(), phase: "ready", data: { ...d, grids: [...prev, ...d.grids.filter((g) => !prev.some((p) => p.id === g.id))] } });
  };
  const persist = (cmd: AccessCommand, who: { uid: string | null; gen: number }) => {
    if (!who.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen, interventionId);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, intervention_id: lower(interventionId), command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: AccessCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().setAccess(interventionId, cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false;
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    const receipt = r.status === 200 ? parseAccessReceipt(r.body, cmd) : null;
    if (receipt) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: receipt.replayed ? COPY.replayed : cmd.grid_id ? COPY.attached : COPY.detached });
      await load();
      return true;
    }
    if ([409, 400, 404, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  const fresh = (gridId: string | null) => {
    const s = get();
    if (!s.data || s.phase !== "ready" || s.busy || s.pending) return Promise.resolve(false);
    if (gridId !== null && (!UUID.test(gridId) || !s.data.grids.some((g) => lower(g.id) === lower(gridId)))) return Promise.resolve(false);
    if (gridId === null && s.data.grid_id === null) return Promise.resolve(false);
    const cid = newId();
    if (!cid) {
      set({ ...s, error: COPY.noUuid });
      return Promise.resolve(false);
    }
    return send({ command_id: lower(cid), grid_id: gridId ? lower(gridId) : null, expected_version: s.data.version });
  };
  return {
    load,
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, interventionId);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: AccessCommand } | null = null;
      let ok = false;
      try {
        json = JSON.parse(raw);
        const r = storedSchema.safeParse(json);
        ok = r.success && r.data.uid === who.uid && r.data.gen === who.gen && lower(r.data.intervention_id) === lower(interventionId);
      } catch {
        ok = false;
      }
      if (!ok || !json?.command) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: json.command, error: COPY.retry });
    },
    attach: (gridId: string) => fresh(gridId),
    detach: () => fresh(null),
    retry() {
      const p = get().pending;
      if (!p) return Promise.resolve(false);
      const who = identity();
      if (pendingFor !== `${who.uid}|${who.gen}`) {
        pendingFor = null;
        set({ ...get(), pending: null, error: "" });
        return Promise.resolve(false);
      }
      return send(p);
    },
    stop() {
      alive = false;
    },
  };
}
