// FIN-07 operator subscription catalog — pure model (no React). Strict browser copy of ROOT's contract:
//   GET  /api/subscriptions/offers?mode=test|live → { mode, configured_mode: "test"|"live"|null,
//        can_write, catalog_enabled, offers: [publicOffer + active + price_id] }  (finance_read; no Stripe call)
//   POST /api/subscriptions/offers { mode, command_id, id: null|uuid, expected_version, label, role,
//        active, price_id } → { offer: publicOffer, active }
// The server derives amount / currency / period / tax from the Stripe Price: NO amount is ever sent or
// edited here; amounts are only displayed as read back. Mutations only when the server says can_write
// AND the selected mode is the configured one. No activation button, no default offer / price / role.
// Identity fence: the command is written + read back under `courant-private-subscriptions-catalog:`
// BEFORE the POST (else 0 POST), keyed by uid + generation, restored only by strict parse for the same
// identity (never sent by itself), never replayed after an identity change; 401/403 clear everything.
// After success / lost reply / 409 the GET is re-read; lost reply or 5xx ⇒ the SAME command on retry;
// 409 ⇒ honest message, no replay.
import { z } from "zod";
import { everyLabel, formatAmount, taxLabel } from "../subscriptions/model";

export const CATALOG_PATH = "/api/subscriptions/offers";
export const CATALOG_TIMEOUT_MS = 15_000;
export const CATALOG_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRICE_ID = /^price_[A-Za-z0-9]{1,200}$/;
const mode = z.enum(["test", "live"]);
export type Mode = z.infer<typeof mode>;
const role = z.enum(["client", "artisan"]);
export type Role = z.infer<typeof role>;
const publicShape = {
  id: z.string().regex(UUID),
  version: z.number().int().positive(),
  label: z.string().min(1).max(160),
  role,
  amount_cents: z.number().int().min(0).max(2147483647),
  currency: z.literal("eur"),
  interval: z.enum(["day", "week", "month", "year"]),
  interval_count: z.number().int().min(1).max(1000),
  tax_behavior: z.enum(["inclusive", "exclusive", "unspecified"]),
};
const catalogOffer = z.object({ ...publicShape, active: z.boolean(), price_id: z.string().regex(PRICE_ID) }).strict();
export type CatalogOffer = z.infer<typeof catalogOffer>;
const catalogSchema = z
  .object({ mode, configured_mode: mode.nullable(), can_write: z.boolean(), catalog_enabled: z.boolean(), offers: z.array(catalogOffer).max(50) })
  .strict();
export type Catalog = z.infer<typeof catalogSchema>;
const saveReply = z.object({ offer: z.object(publicShape).strict(), active: z.boolean() }).strict();
const command = z
  .object({
    mode,
    command_id: z.string().regex(UUID),
    id: z.string().regex(UUID).nullable(),
    expected_version: z.number().int().min(0).max(2147483646),
    label: z.string().min(1).max(160).refine((x) => x === x.trim()),
    role,
    active: z.boolean(),
    price_id: z.string().regex(PRICE_ID),
  })
  .strict();
export type CatalogCommand = z.infer<typeof command>;

export function parseCatalog(body: unknown, requested: Mode): Catalog | null {
  const r = catalogSchema.safeParse(body);
  if (!r.success || r.data.mode !== requested) return null;
  const ids = r.data.offers.map((o) => o.id);
  if (new Set(ids).size !== ids.length) return null;
  return r.data;
}
export const parseSaveReply = (body: unknown) => saveReply.safeParse(body).success;
/** Mutations only when the server allows writing AND the shown mode is the configured one. */
export const writable = (c: Catalog | null, sessionWritable = true) => !!c && sessionWritable && c.can_write && c.configured_mode !== null && c.configured_mode === c.mode;
export function amountText(o: CatalogOffer): string {
  const a = formatAmount(o.amount_cents, o.currency), e = everyLabel(o.interval, o.interval_count), t = taxLabel(o.tax_behavior);
  return a && e && t ? `${a} ${e} · ${t}` : "Conditions non affichables";
}
export const ROLE_LABEL: Record<Role, string> = { client: "Particulier", artisan: "Artisan" };
export const MODE_LABEL: Record<Mode, string> = { test: "Test", live: "Live" };

export type Draft = { label: string; role: Role | ""; active: boolean; price_id: string };
export const EMPTY_DRAFT: Draft = { label: "", role: "", active: false, price_id: "" };
export const draftOf = (o: CatalogOffer): Draft => ({ label: o.label, role: o.role, active: o.active, price_id: o.price_id });
/** Field errors (empty object ⇒ valid). No default value is ever filled in. */
export function validateDraft(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  const label = d.label.trim();
  if (label.length < 1 || label.length > 160) e.label = "Libellé requis (1 à 160 caractères).";
  if (d.role !== "client" && d.role !== "artisan") e.role = "Choisissez le profil concerné.";
  if (!PRICE_ID.test(d.price_id.trim())) e.price_id = "Identifiant de Price Stripe attendu (price_…).";
  return e;
}

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: CATALOG_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? CATALOG_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type CatalogApi = { read(m: Mode): Promise<Result>; save(cmd: CatalogCommand): Promise<Result> };
export function createCatalogApi(fetcher: typeof fetch = (...a) => fetch(...a)): CatalogApi {
  return {
    read: (m) => timed(fetcher, `${CATALOG_PATH}?mode=${m}`, { method: "GET" }, CATALOG_TIMEOUT_MS),
    save: (cmd) => timed(fetcher, CATALOG_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, CATALOG_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-subscriptions-catalog:";
export const pendingKey = (uid: string | null, gen: number) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

export const COPY = {
  title: "Catalogue des abonnements",
  intro: "Offres d’abonnement optionnel. Le montant, la devise, la périodicité et la fiscalité sont lus par le serveur depuis le Price Stripe : ils ne se saisissent pas ici.",
  demo: "En démonstration, aucun catalogue n’est lu ni modifié.",
  loading: "Lecture du catalogue…",
  loadFailed: "Le catalogue n’a pas pu être lu. Réessayez.",
  unavailable: "Le catalogue est momentanément indisponible. Réessayez dans un instant.",
  forbidden: "Votre habilitation, vérifiée par le serveur, ne permet pas de consulter le catalogue des abonnements.",
  empty: "Aucune offre dans ce mode.",
  disabled: "Offres non publiées tant que le service est désactivé.",
  readOnly: "Lecture seule : votre habilitation ne permet pas de modifier le catalogue.",
  noConfigured: "Aucun mode n’est configuré sur le serveur : lecture seule.",
  mismatch: (shown: Mode, configured: Mode) => `Le mode affiché (${MODE_LABEL[shown]}) n’est pas le mode configuré sur le serveur (${MODE_LABEL[configured]}) : lecture seule.`,
  saved: "Offre enregistrée. Le catalogue a été relu.",
  conflict: "L’offre a changé entre-temps : rien n’est renvoyé automatiquement. Le catalogue a été relu.",
  invalid: "Le serveur refuse cette offre (Price, devise, périodicité ou fiscalité non acceptés, ou valeurs invalides).",
  limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
} as const;

export type CatalogState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "forbidden";
  mode: Mode;
  catalog: Catalog | null;
  busy: boolean;
  pending: CatalogCommand | null;
  error: string;
  notice: string;
};
export const CATALOG_INITIAL: CatalogState = { phase: "loading", mode: "test", catalog: null, busy: false, pending: null, error: "", notice: "" };

export function createCatalogController({ api, store, newId, context, sessionWritable, get, set }: { api: () => CatalogApi; store: () => Store | null; newId: () => string | null; context: Context; sessionWritable: () => boolean; get: () => CatalogState; set: (s: CatalogState) => void }) {
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
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...CATALOG_INITIAL, mode: get().mode, phase: "forbidden" });
  };
  const load = async (m: Mode = get().mode, notice?: string) => {
    const my = ++seq;
    const who = identity();
    const switching = m !== get().mode;
    set({ ...get(), mode: m, catalog: switching ? null : get().catalog, phase: switching || get().phase !== "ready" ? "loading" : "ready" });
    const r = await api().read(m);
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    if (r.status === 503 || r.status === CATALOG_TIMEOUT || r.status === 0) return set({ ...get(), phase: "unavailable", catalog: null, error: COPY.unavailable });
    const c = r.status === 200 ? parseCatalog(r.body, m) : null;
    if (!c) return set({ ...get(), phase: "error", catalog: null, error: COPY.loadFailed });
    set({ ...get(), phase: "ready", catalog: c, error: get().phase === "ready" ? get().error : "", notice: notice ?? get().notice });
  };
  const persist = (cmd: CatalogCommand, who: { uid: string | null; gen: number }) => {
    if (!who.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: CatalogCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !command.safeParse(cmd).success || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().save(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // another identity: never applied, never replayed
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 200 && parseSaveReply(r.body)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null });
      await load(cmd.mode, COPY.saved);
      return true;
    }
    if ([400, 404, 409, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 429 ? COPY.limited : COPY.invalid });
      if (r.status === 409) await load(cmd.mode);
      return false;
    }
    // Lost reply, timeout, 5xx, unverifiable 200: keep the SAME command for an explicit retry; re-read.
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    await load(cmd.mode);
    return false;
  };
  return {
    load,
    /** Changes the shown mode (re-read); blocked while a command is busy or uncertain. */
    selectMode(m: Mode) {
      const s = get();
      if (s.busy || s.pending || inFlight || m === s.mode) return Promise.resolve();
      return load(m);
    },
    /** id null ⇒ create (expected_version 0); otherwise the shown offer's version. All checks before the id is drawn. */
    save(target: CatalogOffer | null, draft: Draft): Promise<boolean> {
      const s = get();
      if (s.phase !== "ready" || s.busy || s.pending || inFlight || !writable(s.catalog, sessionWritable())) return Promise.resolve(false);
      if (Object.keys(validateDraft(draft)).length) return Promise.resolve(false);
      if (target && !s.catalog!.offers.some((o) => o.id === target.id && o.version === target.version)) return Promise.resolve(false);
      const cid = newId();
      if (!cid || !UUID.test(cid)) {
        set({ ...s, error: COPY.noUuid });
        return Promise.resolve(false);
      }
      return send({ mode: s.mode, command_id: cid.toLowerCase(), id: target ? target.id : null, expected_version: target ? target.version : 0, label: draft.label.trim(), role: draft.role as Role, active: draft.active, price_id: draft.price_id.trim() });
    },
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
    /** Restores an uncertain command of THIS identity (never sends it); returns its mode. */
    restorePending(): Mode | null {
      const who = identity();
      if (!who.uid) return null;
      const key = pendingKey(who.uid, who.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return null;
      let json: { command?: CatalogCommand } | null = null;
      let ok = false;
      try {
        json = JSON.parse(raw);
        const r = storedSchema.safeParse(json);
        ok = r.success && r.data.uid === who.uid && r.data.gen === who.gen;
      } catch {
        ok = false;
      }
      if (!ok || !json?.command) {
        safe(() => store()?.remove(key));
        return null;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), mode: json.command.mode, pending: json.command, error: COPY.retry });
      return json.command.mode;
    },
    stop() {
      alive = false;
    },
  };
}
