// ADM-08 admin price schedule — staging (« Préparer une version »). STRICT MIRROR of 8a2f9b6
// lib/features/indicative-prices/handler.ts (adminGET / adminPOST), read-only:
//   GET  /api/admin/indicative-prices → { active: <public view>, latest_version,
//        staged: null | { version, ranges, reason, created_at }, publication_available }
//   POST /api/admin/indicative-prices { action: "stage", command_id, expected_version (= latest),
//        ranges, reason 10–1000 } → { version (= expected + 1), replayed, publication_available: false, active_version }
// Staging never changes the active version. 401 / 403 / 409 / 422 / 503.
import { z } from "zod";
import { PRICE_CATEGORIES, publicViewSchema, rangesSchema, type PriceCategory } from "./model";

export const ADMIN_PATH = "/api/admin/indicative-prices";
const version = z.number().int().min(1).max(2147483647);
const stageView = z
  .object({
    active: publicViewSchema,
    latest_version: version,
    staged: z.object({ version, ranges: rangesSchema, reason: z.string().min(10).max(1000), created_at: z.iso.datetime({ offset: true }) }).strict().nullable(),
    publication_available: z.boolean(),
  })
  .strict();
export type StageView = z.infer<typeof stageView>;
export function parseStageView(body: unknown): StageView | null {
  const r = stageView.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if ((d.latest_version === d.active.version) !== (d.staged === null) || d.latest_version < d.active.version || (d.staged && d.staged.version !== d.latest_version)) return null;
  return d;
}
export const stageCommand = z
  .object({ action: z.literal("stage"), command_id: z.uuid(), expected_version: version, ranges: rangesSchema, reason: z.string().trim().min(10).max(1000) })
  .strict();
export type StageCommand = z.infer<typeof stageCommand>;
const receipt = z.object({ version, replayed: z.boolean(), publication_available: z.literal(false), active_version: version }).strict();
export function parseStageReceipt(body: unknown, cmd: StageCommand) {
  const r = receipt.safeParse(body);
  return r.success && r.data.version === cmd.expected_version + 1 ? r.data : null;
}

/** Euros typed by the operator ("150", "150,50") → cents; null if not a positive amount. */
export function toCents(v: string): number | null {
  const t = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(t)) return null;
  const cents = Math.round(Number(t) * 100);
  return cents >= 1 && cents <= 2147483647 ? cents : null;
}
export type RangeInputs = Record<PriceCategory, { min: string; max: string }>;
export const EMPTY_INPUTS = Object.fromEntries(PRICE_CATEGORIES.map((c) => [c, { min: "", max: "" }])) as RangeInputs;
export function inputsToRanges(inputs: RangeInputs): { ranges: z.infer<typeof rangesSchema> } | { error: string } {
  const out: Record<string, { min_cents: number; max_cents: number }> = {};
  for (const c of PRICE_CATEGORIES) {
    const min = toCents(inputs[c].min), max = toCents(inputs[c].max);
    if (min === null || max === null) return { error: "Indiquez un minimum et un maximum en euros pour chacune des cinq catégories." };
    if (max < min) return { error: "Chaque maximum doit être supérieur ou égal à son minimum." };
    out[c] = { min_cents: min, max_cents: max };
  }
  const r = rangesSchema.safeParse(out);
  return r.success ? { ranges: r.data } : { error: "Vérifiez les cinq fourchettes." };
}

export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-indicative-prices:";
export const pendingKey = (uid: string | null, gen: number) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}`;
export const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command: stageCommand }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const ADMIN_COPY = {
  stageTitle: "Préparer une version",
  stageNote: "Une version préparée n’est ni active ni visible du public : la version active ne change pas. Motif obligatoire (10 à 1000 caractères).",
  reasonRequired: "Indiquez un motif de 10 à 1000 caractères.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : rien n’a été envoyé.",
  staged: (v: number) => `Version ${v} préparée. Elle n’est pas active.`,
  replayed: "Cette version avait déjà été préparée (même commande) : état relu.",
  conflict: "Le barème a changé entre-temps : rien n’est renvoyé automatiquement. L’état a été relu.",
  invalid: "Le serveur refuse ces fourchettes ou ce motif : vérifiez la saisie.",
  retry: "La préparation n’est pas confirmée. L’état a été relu ; vous pouvez renvoyer la même commande.",
  restored: "Une préparation envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou abandonnez-la.",
  forbidden: "Réservé au Super Admin : vos droits, vérifiés par le serveur, ne couvrent pas le barème.",
  loadFailed: "Le barème n’a pas pu être lu. Réessayez.",
} as const;

export type Result = { status: number; body: unknown };
async function call(fetcher: typeof fetch, init: RequestInit): Promise<Result> {
  try {
    const r = await fetcher(ADMIN_PATH, { ...init, credentials: "same-origin", cache: "no-store" });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}
export type AdminView = { phase: "loading" | "ready" | "error" | "forbidden"; data: StageView | null; busy: boolean; error: string; notice: string; pending: StageCommand | null };
export const ADMIN_INITIAL: AdminView = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null };

/** Identity-fenced staging: command stored + read back before the POST; re-read after success, uncertain reply or 409. */
export function createStaging({ fetcher, store, newId, context, get, set }: { fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; get: () => AdminView; set: (v: AdminView) => void }) {
  let seq = 0;
  let inFlight = false;
  let alive = true;
  const who = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (w: { uid: string | null; gen: number }) => alive && context.userId() === w.uid && context.generation() === w.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clear = (w = who()) => safe(() => store()?.remove(pendingKey(w.uid, w.gen)));
  const forbid = () => {
    clear();
    set({ ...ADMIN_INITIAL, phase: "forbidden", error: ADMIN_COPY.forbidden });
  };
  const load = async () => {
    const my = ++seq;
    const w = who();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await call(fetcher(), { method: "GET" });
    if (my !== seq || !same(w)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const d = r.status === 200 ? parseStageView(r.body) : null;
    if (!d) return set({ ...get(), phase: get().data ? get().phase : "error", error: ADMIN_COPY.loadFailed });
    set({ ...get(), phase: "ready", data: d, error: get().phase === "error" ? "" : get().error });
  };
  const persist = (cmd: StageCommand, w: { uid: string | null; gen: number }) => {
    if (!w.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const value = JSON.stringify({ uid: w.uid, gen: w.gen, command: cmd });
    return safe(() => {
      s.set(pendingKey(w.uid, w.gen), value);
      return s.get(pendingKey(w.uid, w.gen)) === value;
    }) === true;
  };
  const send = async (cmd: StageCommand): Promise<boolean> => {
    if (inFlight) return false;
    const w = who();
    if (!persist(cmd, w)) {
      set({ ...get(), error: ADMIN_COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    const r = await call(fetcher(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    inFlight = false;
    if (!same(w)) return false; // identity changed: reply ignored, never replayed
    const ok = r.status === 200 ? parseStageReceipt(r.body, cmd) : null;
    if (ok) {
      clear(w);
      set({ ...get(), busy: false, pending: null, notice: ok.replayed ? ADMIN_COPY.replayed : ADMIN_COPY.staged(ok.version) });
      await load();
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422) {
      clear(w);
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? ADMIN_COPY.conflict : ADMIN_COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    set({ ...get(), busy: false, pending: cmd, error: ADMIN_COPY.retry });
    await load(); // uncertain: re-read; the same command stays offered
    return false;
  };
  return {
    load,
    dispose() {
      alive = false;
      seq++;
    },
    restorePending() {
      const w = who();
      if (!w.uid) return;
      const raw = safe(() => store()?.get(pendingKey(w.uid, w.gen)) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedSchema> | null = null;
      try {
        const r = storedSchema.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== w.uid || parsed.gen !== w.gen) return void safe(() => store()?.remove(pendingKey(w.uid, w.gen)));
      set({ ...get(), pending: parsed.command, error: ADMIN_COPY.restored });
    },
    stage(inputs: RangeInputs, reason: string): Promise<boolean> {
      const d = get().data;
      if (!d || get().pending || inFlight) return Promise.resolve(false);
      const r = inputsToRanges(inputs);
      if ("error" in r) return set({ ...get(), error: r.error }), Promise.resolve(false);
      const text = reason.trim();
      if (text.length < 10 || text.length > 1000) return set({ ...get(), error: ADMIN_COPY.reasonRequired }), Promise.resolve(false);
      const cid = safe(newId) ?? null;
      if (!cid) return set({ ...get(), error: ADMIN_COPY.noUuid }), Promise.resolve(false);
      return send({ action: "stage", command_id: cid, expected_version: d.latest_version, ranges: r.ranges, reason: text });
    },
    retry(): Promise<boolean> {
      const p = get().pending;
      return p ? send(p) : Promise.resolve(false);
    },
    discard() {
      clear();
      set({ ...get(), pending: null, error: "" });
    },
  };
}

// ---- Publication (8a2f9b6 publication.ts): shown ONLY when the admin GET says publication_available
//   POST /api/admin/indicative-prices/publication { command_id, expected_active_version,
//        expected_latest_version (> active), reason 10–1000 } → { published_version (= expected latest),
//        active_version, replayed }   503 while the server gate is off. Explicit confirmation, never automatic.
export const PUBLISH_PATH = "/api/admin/indicative-prices/publication";
export const publishCommand = z
  .object({ command_id: z.uuid(), expected_active_version: version, expected_latest_version: version, reason: z.string().trim().min(10).max(1000) })
  .strict()
  .refine((x) => x.expected_latest_version > x.expected_active_version);
export type PublishCommand = z.infer<typeof publishCommand>;
const publishReceipt = z.object({ published_version: version, active_version: version, replayed: z.boolean() }).strict();
export function parsePublishReceipt(body: unknown, cmd: PublishCommand) {
  const r = publishReceipt.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  return d.published_version === cmd.expected_latest_version && d.active_version >= d.published_version && (d.replayed || d.active_version === d.published_version) ? d : null;
}
export const publishKey = (uid: string | null, gen: number) => `${PENDING_PREFIX}publish:${uid ?? "-"}:${gen}`;
const storedPublish = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command: publishCommand }).strict();
export const PUBLISH_COPY = {
  title: "Publier la version préparée",
  note: (active: number, latest: number) => `Version active : ${active}. Version préparée : ${latest}. La publication rend la version préparée active pour les nouvelles demandes ; les réservations et dossiers existants gardent leur estimation.`,
  confirm: (latest: number) => `Confirmer la publication de la version ${latest}`,
  published: (v: number) => `Version ${v} publiée : elle est maintenant active.`,
  replayed: "Publication déjà enregistrée (même commande) : état relu.",
  conflict: "Les versions ont changé entre-temps : rien n’est renvoyé automatiquement. L’état a été relu.",
  closed: "La publication est désactivée côté serveur : rien n’a été publié. L’état a été relu.",
  retry: "La publication n’est pas confirmée. L’état a été relu ; vous pouvez renvoyer la même commande.",
  restored: "Une publication envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou abandonnez-la.",
} as const;

export type PublishView = { busy: boolean; error: string; notice: string; pending: PublishCommand | null };
export const PUBLISH_INITIAL: PublishView = { busy: false, error: "", notice: "", pending: null };
/** Identity-fenced publication; the caller re-reads the admin view after every outcome. */
export function createPublication({ fetcher, store, newId, context, get, set, reload }: { fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; get: () => PublishView; set: (v: PublishView) => void; reload: () => Promise<void> }) {
  let inFlight = false;
  let alive = true;
  const who = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (w: { uid: string | null; gen: number }) => alive && context.userId() === w.uid && context.generation() === w.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clear = (w = who()) => safe(() => store()?.remove(publishKey(w.uid, w.gen)));
  const send = async (cmd: PublishCommand): Promise<boolean> => {
    if (inFlight) return false;
    const w = who();
    if (!w.uid) return false;
    const s = safe(store);
    const value = JSON.stringify({ uid: w.uid, gen: w.gen, command: cmd });
    const ok = s && safe(() => (s.set(publishKey(w.uid, w.gen), value), s.get(publishKey(w.uid, w.gen)) === value)) === true;
    if (!ok) return set({ ...get(), error: ADMIN_COPY.storage }), false;
    inFlight = true;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      const res = await fetcher()(PUBLISH_PATH, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
      r = { status: res.status, body: await res.json().catch(() => null) };
    } catch {
      r = { status: 0, body: null };
    } finally {
      inFlight = false;
    }
    if (!same(w)) return false;
    const done = r.status === 200 ? parsePublishReceipt(r.body, cmd) : null;
    if (done) {
      clear(w);
      set({ busy: false, pending: null, error: "", notice: done.replayed ? PUBLISH_COPY.replayed : PUBLISH_COPY.published(done.published_version) });
    } else if (r.status === 409 || r.status === 422 || r.status === 401 || r.status === 403) {
      clear(w);
      set({ busy: false, pending: null, notice: "", error: r.status === 409 ? PUBLISH_COPY.conflict : r.status === 422 ? ADMIN_COPY.invalid : ADMIN_COPY.forbidden });
    } else if (r.status === 503 && (r.body as { error?: string } | null)?.error === "La publication des fourchettes est désactivée.") {
      clear(w);
      set({ busy: false, pending: null, notice: "", error: PUBLISH_COPY.closed });
    } else {
      set({ busy: false, pending: cmd, notice: "", error: PUBLISH_COPY.retry });
    }
    await reload(); // always re-read: success, conflict, closed gate or uncertain reply
    return Boolean(done);
  };
  return {
    dispose() {
      alive = false;
    },
    restorePending() {
      const w = who();
      if (!w.uid) return;
      const raw = safe(() => store()?.get(publishKey(w.uid, w.gen)) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedPublish> | null = null;
      try {
        const r = storedPublish.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== w.uid || parsed.gen !== w.gen) return void safe(() => store()?.remove(publishKey(w.uid, w.gen)));
      set({ ...get(), pending: parsed.command, error: PUBLISH_COPY.restored });
    },
    publish(view: StageView, reason: string): Promise<boolean> {
      if (!view.publication_available || view.latest_version <= view.active.version || get().pending || inFlight) return Promise.resolve(false);
      const text = reason.trim();
      if (text.length < 10 || text.length > 1000) return set({ ...get(), error: ADMIN_COPY.reasonRequired }), Promise.resolve(false);
      const cid = safe(newId) ?? null;
      if (!cid) return set({ ...get(), error: ADMIN_COPY.noUuid }), Promise.resolve(false);
      return send({ command_id: cid, expected_active_version: view.active.version, expected_latest_version: view.latest_version, reason: text });
    },
    retry(): Promise<boolean> {
      const p = get().pending;
      return p ? send(p) : Promise.resolve(false);
    },
    discard() {
      clear();
      set({ ...get(), pending: null, error: "" });
    },
  };
}
