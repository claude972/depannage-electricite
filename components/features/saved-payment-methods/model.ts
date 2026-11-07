// FIN-08 saved payment methods — pure model (no React). Contract (backend in parallel; strict here):
//   GET  /api/payments/methods[?after=pm_…] → { methods: [{ id, brand, last4, exp_month, exp_year }], has_more }
//   POST { action:"setup", consent:true, command_id } → { url }  (ONLY origin https://checkout.stripe.com; fragment kept)
//   POST { action:"remove", method_id, command_id }  → { removed: true }
// Managing saved methods only: no payment, no card choice. A return from Stripe
// (?saved_methods=returned|cancelled) only re-reads the list — it never proves a card was added.
// Identity fence: the command is written + read back under `courant-private-payment-methods:` BEFORE
// the POST (else 0 POST), keyed by uid + generation, restored only by strict parse for the same
// identity (never sent by itself), never replayed after an identity change; 401/403 clear.
// The setup URL is never persisted and opened only after the user's explicit click.
import { z } from "zod";

export const PM_PATH = "/api/payments/methods";
export const PM_TIMEOUT_MS = 15_000;
export const PM_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PM_ID = /^pm_[A-Za-z0-9]{1,200}$/;
const method = z
  .object({
    id: z.string().regex(PM_ID),
    brand: z.string().min(1).max(40),
    last4: z.string().regex(/^\d{4}$/),
    exp_month: z.number().int().min(1).max(12),
    exp_year: z.number().int().min(2000).max(2200),
  })
  .strict();
export type SavedMethod = z.infer<typeof method>;
const page = z.object({ methods: z.array(method).max(100), has_more: z.boolean() }).strict();
const setupCommand = z.object({ action: z.literal("setup"), consent: z.literal(true), command_id: z.string().regex(UUID) }).strict();
const removeCommand = z.object({ action: z.literal("remove"), method_id: z.string().regex(PM_ID), command_id: z.string().regex(UUID) }).strict();
const command = z.union([setupCommand, removeCommand]);
export type PmCommand = z.infer<typeof command>;

export function parseMethods(body: unknown, after: string | null): { methods: SavedMethod[]; has_more: boolean } | null {
  const r = page.safeParse(body);
  if (!r.success) return null;
  const ids = r.data.methods.map((x) => x.id);
  if (new Set(ids).size !== ids.length || (after && ids.includes(after))) return null;
  if (r.data.has_more && r.data.methods.length === 0) return null;
  return r.data;
}
/** Only an https URL whose origin is EXACTLY https://checkout.stripe.com (no credentials, default port
 *  only); any path / query, and Stripe's opaque fragment (#fid…) is allowed and KEPT. The string is
 *  returned byte-for-byte as the server sent it (never normalised, never persisted). */
export function safeSetupUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096 || raw !== raw.trim()) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "checkout.stripe.com" || u.port !== "" || u.username || u.password || u.origin !== "https://checkout.stripe.com") return null;
    return raw;
  } catch {
    return null;
  }
}
export function parseSetupReply(body: unknown): string | null {
  const r = z.object({ url: z.string() }).strict().safeParse(body);
  return r.success ? safeSetupUrl(r.data.url) : null;
}
export const parseRemoveReply = (body: unknown) => z.object({ removed: z.literal(true) }).strict().safeParse(body).success;
/** Expired from exp_month / exp_year vs the LOCAL today (valid through the end of its month). */
export function isExpired(m: Pick<SavedMethod, "exp_month" | "exp_year">, now = new Date()): boolean {
  const y = now.getFullYear(), mo = now.getMonth() + 1;
  return m.exp_year < y || (m.exp_year === y && m.exp_month < mo);
}
/** Stripe return marker in the page URL (never a proof of anything). */
export function returnMarker(search: string): "returned" | "cancelled" | null {
  const m = /(?:^\?|&)saved_methods=(returned|cancelled)(?:&|$)/.exec(search);
  return m ? (m[1] as "returned" | "cancelled") : null;
}
const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", cartes_bancaires: "Cartes Bancaires", discover: "Discover", jcb: "JCB", unionpay: "UnionPay", diners: "Diners Club" };
export const brandLabel = (b: string) => BRAND[b.toLowerCase()] ?? b;

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: PM_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? PM_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type PmApi = { list(after: string | null): Promise<Result>; post(cmd: PmCommand): Promise<Result> };
export function createPmApi(fetcher: typeof fetch = (...a) => fetch(...a)): PmApi {
  return {
    list: (after) => timed(fetcher, `${PM_PATH}${after ? `?after=${encodeURIComponent(after)}` : ""}`, { method: "GET" }, PM_TIMEOUT_MS),
    post: (cmd) => timed(fetcher, PM_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, PM_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-payment-methods:";
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
  title: "Moyens de paiement enregistrés",
  loading: "Lecture de vos moyens de paiement…",
  loadFailed: "Vos moyens de paiement n’ont pas pu être lus. Réessayez.",
  unavailable: "Le service est momentanément indisponible. Réessayez dans un instant.",
  forbidden: "Votre compte, vérifié par le serveur, ne permet pas de gérer des moyens de paiement enregistrés.",
  demo: "En démonstration, aucun moyen de paiement n’est lu, ajouté ni supprimé, et aucune banque n’est contactée.",
  empty: "Aucun moyen de paiement enregistré.",
  note: "Cette page sert uniquement à gérer vos cartes enregistrées : aucun paiement n’est effectué ici.",
  consent: "J’autorise l’enregistrement d’une carte qui pourra être réutilisée lors de mes prochains règlements personnels sur la plateforme, chacun confirmé par moi sur Stripe. Aucun prélèvement automatique : la carte n’est jamais débitée sans ma confirmation. Je serai redirigé vers la page sécurisée de Stripe.",
  add: "Ajouter une carte",
  open: "Ouvrir la page sécurisée de Stripe",
  ready: "La page sécurisée est prête : ouvrez-la pour enregistrer votre carte.",
  returned: "Retour de la page Stripe : la liste a été relue. Un retour ne prouve pas qu’une carte a été enregistrée ; seule la liste ci-dessous fait foi.",
  cancelled: "Enregistrement annulé sur la page Stripe : la liste a été relue.",
  expired: "Expirée",
  removeConfirm: (label: string) => `Supprimer la carte ${label} ? Elle ne pourra plus être utilisée pour un futur règlement.`,
  removed: "Carte supprimée.",
  conflict: "La liste a changé entre-temps : rien n’est renvoyé automatiquement. La liste a été relue.",
  invalid: "Le serveur refuse cette action.",
  notFound: "Ce moyen de paiement n’existe plus : la liste a été relue.",
  limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  badUrl: "La réponse du serveur n’est pas une page sécurisée Stripe : rien n’est ouvert.",
  retry: "La demande n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  more: "Afficher la suite",
} as const;

export type PmState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "forbidden";
  methods: SavedMethod[];
  hasMore: boolean;
  loadingMore: boolean;
  busy: boolean;
  pending: PmCommand | null;
  /** Validated setup URL, kept in memory only until the user clicks (never persisted). */
  setupUrl: string | null;
  error: string;
  notice: string;
};
export const PM_INITIAL: PmState = { phase: "loading", methods: [], hasMore: false, loadingMore: false, busy: false, pending: null, setupUrl: null, error: "", notice: "" };

export function createPmController({ api, store, newId, context, get, set }: { api: () => PmApi; store: () => Store | null; newId: () => string | null; context: Context; get: () => PmState; set: (s: PmState) => void }) {
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
    set({ ...PM_INITIAL, phase: "forbidden" });
  };
  const load = async (notice?: string) => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().phase === "ready" ? "ready" : "loading", loadingMore: false });
    const r = await api().list(null);
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    if (r.status === 503 || r.status === PM_TIMEOUT || r.status === 0) return set({ ...get(), phase: "unavailable", error: COPY.unavailable });
    const p = r.status === 200 ? parseMethods(r.body, null) : null;
    if (!p) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", methods: p.methods, hasMore: p.has_more, error: get().phase === "ready" ? get().error : "", notice: notice ?? get().notice });
  };
  const persist = (cmd: PmCommand, who: { uid: string | null; gen: number }) => {
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
  const send = async (cmd: PmCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !command.safeParse(cmd).success || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "", setupUrl: null });
    let r: Result;
    try {
      r = await api().post(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // another identity: never applied, never replayed
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 200) {
      if (cmd.action === "setup") {
        const url = parseSetupReply(r.body);
        if (url) {
          clearStored(who);
          pendingFor = null;
          // In memory only; opened by the user's click.
          set({ ...get(), busy: false, pending: null, setupUrl: url, notice: COPY.ready });
          return true;
        }
        if (z.object({ url: z.string() }).strict().safeParse(r.body).success) {
          clearStored(who);
          pendingFor = null;
          set({ ...get(), busy: false, pending: null, error: COPY.badUrl });
          return false;
        }
      } else if (parseRemoveReply(r.body)) {
        clearStored(who);
        pendingFor = null;
        set({ ...get(), busy: false, pending: null });
        await load(COPY.removed);
        return true;
      }
    }
    if ([409, 400, 404, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : r.status === 429 ? COPY.limited : COPY.invalid });
      if (r.status === 409 || r.status === 404) await load();
      return false;
    }
    // Lost reply, timeout, 503, unverifiable 200: the SAME command on an explicit retry.
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  const fresh = (build: (cid: string) => PmCommand) => {
    const s = get();
    if (s.phase !== "ready" || s.busy || s.pending || inFlight) return Promise.resolve(false);
    const cid = newId();
    if (!cid || !UUID.test(cid)) {
      set({ ...s, error: COPY.noUuid });
      return Promise.resolve(false);
    }
    return send(build(cid.toLowerCase()));
  };
  return {
    load,
    async more() {
      const s = get();
      if (!s.hasMore || s.loadingMore || s.phase !== "ready" || s.methods.length === 0) return;
      const after = s.methods[s.methods.length - 1].id;
      const my = seq;
      const who = identity();
      set({ ...s, loadingMore: true });
      const r = await api().list(after);
      if (my !== seq || !same(who)) return;
      const p = r.status === 200 ? parseMethods(r.body, after) : null;
      if (!p) return set({ ...get(), loadingMore: false, error: COPY.loadFailed });
      const seen = new Set(get().methods.map((x) => x.id));
      set({ ...get(), loadingMore: false, methods: [...get().methods, ...p.methods.filter((x) => !seen.has(x.id))], hasMore: p.has_more });
    },
    /** Explicit consent required; returns the validated URL into memory (opened only by a click). */
    setup: (consent: boolean) => (consent ? fresh((cid) => ({ action: "setup", consent: true, command_id: cid })) : Promise.resolve(false)),
    /** Called by the inline confirmation only. */
    remove: (methodId: string) => (get().methods.some((x) => x.id === methodId) ? fresh((cid) => ({ action: "remove", method_id: methodId, command_id: cid })) : Promise.resolve(false)),
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
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: PmCommand } | null = null;
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
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: json.command, error: COPY.retry });
    },
    /** Consumes the in-memory URL (single use) for the click handler. */
    takeSetupUrl(): string | null {
      const u = get().setupUrl;
      if (u) set({ ...get(), setupUrl: null });
      return u;
    },
    stop() {
      alive = false;
    },
  };
}
