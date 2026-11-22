// FIN-07 optional subscription (slice 1, client + artisan profiles) — pure model (no React).
// Strict browser copy of the backend contract: bf3cdc8 (docs/OPTIONAL_SUBSCRIPTIONS_BACKEND.md,
// lib/features/subscriptions/handlers.ts `publicOffer` + `response`) + `portal_available` (dec2594)
// + the relayed correction (state, currency strictly "eur"):
//   GET /api/subscriptions →
//     { state:"ready", available, portal_available, offers:[publicOffer], checkout_pending:boolean,
//       subscription: null | { status, cancel_at_period_end, current_period_start, current_period_end,
//       observed_at, offer: publicOffer } }
//   | EXACTLY { state:"unavailable", available:false, portal_available:false, offers:[],
//       checkout_pending:null, subscription:null }  — subscription NOT READ: never « non abonné ».
//   POST { action:"checkout", offer_id, offer_version, command_id, consent:true } → { url }
// publicOffer = { id, version, label, role, amount_cents, currency:"eur", interval, interval_count, tax_behavior }.
// Every amount / period / tax wording comes from these server fields through FIXED mappings; an offer
// whose interval or tax_behavior is not in those mappings is NOT shown (nothing guessed).
// amount_cents is the configured Price, not a collected invoice; no status is a bank confirmation.
// Return /?subscription=returned|cancelled#profile ⇒ re-read only (proves nothing).
// Billing portal (dec2594): POST /api/subscriptions/portal { command_id } → { url }, offered ONLY when
// the server says `portal_available: true`; URL origin EXACTLY https://billing.stripe.com (same rules
// as Checkout, fragment kept, memory only, opened on click). The portal is Stripe's page: no wording
// promises a cancellation. Return /?subscription=managed#profile ⇒ re-read only (proves no change).
// Without the portal, the screen says stopping is not available here yet (assistance).
// Resume (ROOT): POST /api/subscriptions/resume with body EXACTLY {} → { url } — the server reuses the
// current attempt (consent, version); no client id, no command id, nothing stored. Only on an explicit
// click, only when state "ready" + checkout_pending + eligible; same Checkout URL validator.
// Identity fence: the command is written + read back under `courant-private-subscriptions:` BEFORE
// the POST (else 0 POST), keyed by uid + generation, restored only by strict parse for the same
// identity (never sent by itself), never replayed after an identity change; 401/403 clear.
// The Checkout URL is never persisted and opened only after the user's explicit click.
import { z } from "zod";

export const SUB_PATH = "/api/subscriptions";
export const SUB_TIMEOUT_MS = 15_000;
export const SUB_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = z.string().refine((x) => Number.isFinite(Date.parse(x)));

// interval / tax_behavior are read as strings, then mapped: an unknown value hides the offer instead of
// failing the page. The currency is strictly "eur" (contract).
const offerSchema = z
  .object({
    id: z.string().regex(UUID),
    version: z.number().int().positive(),
    label: z.string().min(1).max(160),
    role: z.enum(["client", "artisan"]),
    amount_cents: z.number().int().min(0).max(2147483647),
    currency: z.literal("eur"),
    interval: z.string().min(1).max(40),
    interval_count: z.number().int().min(1).max(1000),
    tax_behavior: z.string().min(1).max(40),
  })
  .strict();
export type RawOffer = z.infer<typeof offerSchema>;
export const SUB_STATUSES = ["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"] as const;
export type SubStatus = (typeof SUB_STATUSES)[number];
const subscriptionSchema = z
  .object({
    status: z.enum(SUB_STATUSES),
    cancel_at_period_end: z.boolean(),
    current_period_start: z.number().int().nonnegative(),
    current_period_end: z.number().int().nonnegative(),
    observed_at: time,
    offer: offerSchema,
  })
  .strict();
const readySchema = z
  .object({ state: z.literal("ready"), available: z.boolean(), portal_available: z.boolean(), offers: z.array(offerSchema).max(50), checkout_pending: z.boolean(), subscription: subscriptionSchema.nullable() })
  .strict();
/** Env gate off: nothing was read. Exactly this shape. */
const unavailableSchema = z
  .object({ state: z.literal("unavailable"), available: z.literal(false), portal_available: z.literal(false), offers: z.array(z.never()).length(0), checkout_pending: z.null(), subscription: z.null() })
  .strict();
const overviewSchema = z.union([readySchema, unavailableSchema]);
export type ReadyOverview = z.infer<typeof readySchema>;
export type Overview = z.infer<typeof overviewSchema>;
const checkoutCommand = z
  .object({ action: z.literal("checkout"), offer_id: z.string().regex(UUID), offer_version: z.number().int().positive(), command_id: z.string().regex(UUID), consent: z.literal(true) })
  .strict();
const portalCommand = z.object({ command_id: z.string().regex(UUID) }).strict();
const command = z.union([checkoutCommand, portalCommand]);
export type CheckoutCommand = z.infer<typeof checkoutCommand>;
export type PortalCommand = z.infer<typeof portalCommand>;
export type SubCommand = z.infer<typeof command>;
export const isPortal = (c: SubCommand): c is PortalCommand => !("action" in c);

export function parseOverview(body: unknown): Overview | null {
  const r = overviewSchema.safeParse(body);
  if (!r.success) return null;
  if (r.data.state === "unavailable") return r.data;
  const ids = r.data.offers.map((o) => o.id);
  if (new Set(ids).size !== ids.length) return null;
  if (!r.data.available && r.data.offers.length > 0) return null; // closed gate ⇒ the server sends no offer
  const s = r.data.subscription;
  if (s && s.current_period_end < s.current_period_start) return null;
  return r.data;
}

// ---- fixed wording from the server enums ----
const INTERVAL: Record<string, { one: string; many: string; feminine: boolean }> = {
  day: { one: "jour", many: "jours", feminine: false },
  week: { one: "semaine", many: "semaines", feminine: true },
  month: { one: "mois", many: "mois", feminine: false },
  year: { one: "an", many: "ans", feminine: false },
};
const TAX: Record<string, string> = { inclusive: "taxes incluses", exclusive: "hors taxes", unspecified: "traitement des taxes non précisé" };
/** Accepted currencies: minor-unit exponent (amount_cents is in the smallest unit) + fixed symbol.
 *  The contract only sends "eur". Formatted by hand (no Intl/ICU data dependency). */
const CURRENCY: Record<string, { exp: number; symbol: string }> = { eur: { exp: 2, symbol: "€" } };
/** « tous les mois », « tous les 3 mois », « toutes les semaines », « toutes les 2 semaines »… */
export function everyLabel(interval: string, count: number): string | null {
  const i = INTERVAL[interval];
  if (!i || !Number.isInteger(count) || count < 1) return null;
  const all = i.feminine ? "toutes les" : "tous les";
  return count === 1 ? `${all} ${i.many}` : `${all} ${count} ${i.many}`;
}
export const taxLabel = (t: string): string | null => TAX[t] ?? null;
/** « 1 234,50 € » (French grouping with plain spaces), exact integer arithmetic. */
export function formatAmount(cents: number, currency: string): string | null {
  const c = CURRENCY[currency];
  if (!c || !Number.isSafeInteger(cents) || cents < 0) return null;
  const unit = 10 ** c.exp;
  const whole = String(Math.floor(cents / unit)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = c.exp ? "," + String(cents % unit).padStart(c.exp, "0") : "";
  return `${whole}${frac} ${c.symbol}`;
}
export type OfferTerms = { amount: string; every: string; tax: string };
/** All three from server fields, or null (offer not shown). */
export function offerTerms(o: RawOffer): OfferTerms | null {
  const amount = formatAmount(o.amount_cents, o.currency), every = everyLabel(o.interval, o.interval_count), tax = taxLabel(o.tax_behavior);
  return amount && every && tax ? { amount, every, tax } : null;
}
/** Offers this panel may show: the panel's role and fully known terms only. */
export function visibleOffers(o: Overview | null, role: "client" | "artisan"): RawOffer[] {
  return o?.state === "ready" && o.available ? o.offers.filter((x) => x.role === role && offerTerms(x) !== null) : [];
}
export const STATUS_LABEL: Record<SubStatus, string> = {
  incomplete: "Premier paiement non confirmé",
  incomplete_expired: "Premier paiement expiré : abonnement non démarré",
  trialing: "Période d’essai",
  active: "Actif",
  past_due: "Paiement en retard",
  canceled: "Terminé",
  unpaid: "Impayé",
  paused: "En pause",
};
/** Terminal statuses: no subscription running any more (a new one may be offered by the server). */
export const isTerminal = (s: SubStatus) => s === "canceled" || s === "incomplete_expired";
export const formatDay = (unixSeconds: number) => new Date(unixSeconds * 1000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
export const formatMoment = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Same rule as FIN-08: origin EXACTLY https://checkout.stripe.com (https, no credentials, default
 *  port), any path / query, the opaque fragment (#fid…) KEPT — the raw string, never normalised. */
export function safeCheckoutUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096 || raw !== raw.trim()) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "checkout.stripe.com" || u.port !== "" || u.username || u.password || u.origin !== "https://checkout.stripe.com") return null;
    return raw;
  } catch {
    return null;
  }
}
/** Same rules, origin EXACTLY https://billing.stripe.com (the backend checks the same host). */
export function safePortalUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096 || raw !== raw.trim()) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== "billing.stripe.com" || u.port !== "" || u.username || u.password || u.origin !== "https://billing.stripe.com") return null;
    return raw;
  } catch {
    return null;
  }
}
export function parsePortalReply(body: unknown): string | null {
  const r = z.object({ url: z.string() }).strict().safeParse(body);
  return r.success ? safePortalUrl(r.data.url) : null;
}
export function parseCheckoutReply(body: unknown): string | null {
  const r = z.object({ url: z.string() }).strict().safeParse(body);
  return r.success ? safeCheckoutUrl(r.data.url) : null;
}
/** Stripe return marker in the page URL (never a proof of anything). */
export function returnMarker(search: string): "returned" | "cancelled" | "managed" | null {
  const m = /(?:^\?|&)subscription=(returned|cancelled|managed)(?:&|$)/.exec(search);
  return m ? (m[1] as "returned" | "cancelled" | "managed") : null;
}

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: SUB_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? SUB_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export const PORTAL_PATH = "/api/subscriptions/portal";
export const RESUME_PATH = "/api/subscriptions/resume";
export type SubApi = { read(): Promise<Result>; post(cmd: CheckoutCommand): Promise<Result>; portal(cmd: PortalCommand): Promise<Result>; resume(): Promise<Result> };
export function createSubscriptionsApi(fetcher: typeof fetch = (...a) => fetch(...a)): SubApi {
  return {
    read: () => timed(fetcher, SUB_PATH, { method: "GET" }, SUB_TIMEOUT_MS),
    post: (cmd) => timed(fetcher, SUB_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, SUB_TIMEOUT_MS),
    resume: () => timed(fetcher, RESUME_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, SUB_TIMEOUT_MS),
    portal: (cmd) => timed(fetcher, PORTAL_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, SUB_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-subscriptions:";
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

const STOP = "L’arrêt de l’abonnement n’est pas encore disponible depuis cet écran : pour l’arrêter, contactez l’assistance.";
export const COPY = {
  title: "Abonnement",
  loading: "Lecture de votre abonnement…",
  optional: "L’abonnement est facultatif : sans lui, votre espace reste utilisable comme aujourd’hui.",
  loadFailed: "L’état de votre abonnement n’a pas pu être lu. Réessayez.",
  unavailable: "Les abonnements optionnels sont momentanément indisponibles. Aucun droit existant n’est retiré.",
  notRead: "Les abonnements sont indisponibles pour le moment : votre abonnement éventuel n’a pas pu être lu ici. Aucun droit existant n’est retiré.",
  forbidden: "Votre compte, vérifié par le serveur, ne donne pas accès à l’abonnement.",
  demo: "En démonstration, aucune offre n’est lue ni souscrite et aucun paiement n’est demandé.",
  none: "Aucune offre d’abonnement disponible pour votre compte.",
  hidden: "Certaines offres ne sont pas affichées : leurs conditions ne sont pas dans un format que cette page sait présenter.",
  pending: "Une souscription est en cours de confirmation sur la page sécurisée de Stripe : aucune nouvelle demande n’est possible pour l’instant. L’état est relu à chaque ouverture de cette page.",
  running: "Un abonnement est déjà en cours sur votre compte : aucune autre offre n’est proposée.",
  stop: STOP,
  consent: (label: string, t: OfferTerms) =>
    `Je souscris à l’offre « ${label} » : ${t.amount} (${t.tax}), débité une première fois après ma confirmation sur la page sécurisée de Stripe, puis renouvelé automatiquement ${t.every} au même montant, jusqu’à la fin de l’abonnement. ${STOP}`,
  choose: "Choisir cette offre",
  subscribe: "Souscrire sur Stripe",
  open: "Ouvrir la page sécurisée de Stripe",
  ready: "La page sécurisée est prête : ouvrez-la pour confirmer le premier paiement.",
  manage: "Gérer mon abonnement",
  manageNote: "La gestion de votre abonnement se fait sur la page sécurisée de Stripe.",
  openPortal: "Ouvrir la page de gestion Stripe",
  portalReady: "La page de gestion Stripe est prête : ouvrez-la.",
  resume: "Reprendre la souscription",
  resumeNote: "La souscription commencée n’est pas terminée : vous pouvez reprendre la même demande sur la page sécurisée de Stripe.",
  resumeReady: "La page sécurisée est prête : ouvrez-la pour reprendre la souscription.",
  resumeRetry: "La reprise n’est pas confirmée. Réessayez pour retrouver la souscription en cours.",
  resumeConflict: "La souscription en cours a changé ou a expiré : rien n’est renvoyé automatiquement. L’état a été relu.",
  managed: "Retour de la page de gestion Stripe : l’état a été relu. Un retour ne prouve aucune modification ; seul l’état ci-dessous, relu par le serveur, fait foi.",
  returned: "Retour de la page Stripe : l’état a été relu. Un retour ne prouve pas qu’un abonnement a été souscrit ; seul l’état ci-dessous, relu par le serveur, fait foi.",
  cancelled: "Souscription interrompue sur la page Stripe : l’état a été relu.",
  observed: (when: string) => `État relu auprès de Stripe le ${when}. Le montant affiché est le tarif de l’offre, pas une facture encaissée.`,
  period: (start: string, end: string) => `Période en cours : du ${start} au ${end}.`,
  endsAt: (end: string) => `Fin programmée au terme de la période en cours, le ${end}.`,
  termsUnknown: "Conditions de l’offre non affichées : format non reconnu par cette page.",
  conflict: "L’offre ou l’abonnement a changé entre-temps : rien n’est renvoyé automatiquement. L’état a été relu.",
  invalid: "Le serveur refuse cette demande.",
  limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  badUrl: "La réponse du serveur n’est pas une page sécurisée Stripe : rien n’est ouvert.",
  retry: "La demande n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
} as const;

/** Whether the server state lets this panel offer a new subscription at all: gate open, no Checkout
 *  pending, no running subscription (the server refuses a second one anyway). */
export function canOffer(o: Overview | null): boolean {
  return !!o && o.state === "ready" && o.available && !o.checkout_pending && !(o.subscription && !isTerminal(o.subscription.status));
}
/** Resume is offered only for a ready read, a pending Checkout, and the same eligibility as the
 *  subscribe CTA (gate open for this profile, no running subscription). */
export function canResume(o: Overview | null): boolean {
  return !!o && o.state === "ready" && o.checkout_pending === true && o.available && !(o.subscription && !isTerminal(o.subscription.status));
}
export type SubState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "forbidden";
  overview: Overview | null;
  busy: boolean;
  pending: SubCommand | null;
  /** Validated Checkout URL, kept in memory only until the user clicks (never persisted). */
  checkoutUrl: string | null;
  /** Validated portal URL, same rules (memory only, single use, opened on click). */
  portalUrl: string | null;
  /** Validated Checkout URL from a resume (memory only, single use, opened on click). */
  resumeUrl: string | null;
  /** A resume reply was lost / 5xx: offer an explicit « Réessayer ». */
  resumeRetry: boolean;
  error: string;
  notice: string;
};
export const SUB_INITIAL: SubState = { phase: "loading", overview: null, busy: false, pending: null, checkoutUrl: null, portalUrl: null, resumeUrl: null, resumeRetry: false, error: "", notice: "" };

export function createSubscriptionsController({ api, store, newId, context, role, get, set }: { api: () => SubApi; store: () => Store | null; newId: () => string | null; context: Context; role: () => "client" | "artisan"; get: () => SubState; set: (s: SubState) => void }) {
  let alive = true;
  let inFlight = false;
  let seq = 0;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => alive && context.userId() === a.uid && context.generation() === a.gen;
  const mountedIdentity = identity();
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
    set({ ...SUB_INITIAL, phase: "forbidden" });
  };
  const load = async (notice?: string) => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().phase === "ready" ? "ready" : "loading", checkoutUrl: null, portalUrl: null, resumeUrl: null, resumeRetry: false });
    const r = await api().read();
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    if (r.status === 503 || r.status === SUB_TIMEOUT || r.status === 0) return set({ ...get(), phase: "unavailable", error: COPY.unavailable });
    const p = r.status === 200 ? parseOverview(r.body) : null;
    if (!p) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", overview: p, error: get().phase === "ready" ? get().error : "", notice: notice ?? get().notice });
  };
  const persist = (cmd: SubCommand, who: { uid: string | null; gen: number }) => {
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
  const send = async (cmd: SubCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !command.safeParse(cmd).success || !persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "", checkoutUrl: null, portalUrl: null });
    let r: Result;
    try {
      r = isPortal(cmd) ? await api().portal(cmd) : await api().post(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // another identity: never applied, never replayed
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 200) {
      const url = isPortal(cmd) ? parsePortalReply(r.body) : parseCheckoutReply(r.body);
      if (url) {
        clearStored(who);
        pendingFor = null;
        set({ ...get(), busy: false, pending: null, ...(isPortal(cmd) ? { portalUrl: url, notice: COPY.portalReady } : { checkoutUrl: url, notice: COPY.ready }) });
        return true;
      }
      if (z.object({ url: z.string() }).strict().safeParse(r.body).success) {
        clearStored(who);
        pendingFor = null;
        set({ ...get(), busy: false, pending: null, error: COPY.badUrl });
        return false;
      }
    }
    if ([400, 404, 409, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 429 ? COPY.limited : COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    // Lost reply, timeout, 503, unverifiable 200: the SAME command on an explicit retry.
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  return {
    load,
    /** Explicit consent required; the validated URL goes to memory (opened only by a click). Every
     *  precondition is checked BEFORE a command id is drawn. */
    checkout(offerId: string, consent: boolean): Promise<boolean> {
      const s = get();
      if (!consent || s.phase !== "ready" || s.busy || s.pending || inFlight || !canOffer(s.overview)) return Promise.resolve(false);
      const offer = visibleOffers(s.overview, role()).find((x) => x.id === offerId);
      if (!offer) return Promise.resolve(false);
      const cid = newId();
      if (!cid || !UUID.test(cid)) {
        set({ ...s, error: COPY.noUuid });
        return Promise.resolve(false);
      }
      return send({ action: "checkout", offer_id: offer.id, offer_version: offer.version, command_id: cid.toLowerCase(), consent: true });
    },
    /** Only when the server says portal_available; every precondition before an id is drawn. */
    manage(): Promise<boolean> {
      const s = get();
      if (s.phase !== "ready" || s.busy || s.pending || inFlight || s.overview?.state !== "ready" || !s.overview.portal_available) return Promise.resolve(false);
      const cid = newId();
      if (!cid || !UUID.test(cid)) {
        set({ ...s, error: COPY.noUuid });
        return Promise.resolve(false);
      }
      return send({ command_id: cid.toLowerCase() });
    },
    /** Explicit click only. Body {} — no id drawn, nothing persisted, never a subscribe POST. */
    async resume(): Promise<boolean> {
      const s = get();
      if (s.phase !== "ready" || s.busy || s.pending || inFlight || !canResume(s.overview)) return false;
      const who = identity();
      if (!same(who)) return false;
      inFlight = true;
      seq++;
      set({ ...get(), busy: true, error: "", notice: "", resumeUrl: null, resumeRetry: false });
      let r: Result;
      try {
        r = await api().resume();
      } finally {
        inFlight = false;
      }
      if (!same(who)) return false;
      if (r.status === 401 || r.status === 403) {
        forbid();
        return false;
      }
      if (r.status === 200) {
        const url = parseCheckoutReply(r.body);
        if (url) {
          set({ ...get(), busy: false, resumeUrl: url, notice: COPY.resumeReady });
          return true;
        }
        if (z.object({ url: z.string() }).strict().safeParse(r.body).success) {
          set({ ...get(), busy: false, error: COPY.badUrl });
          return false;
        }
      }
      if (r.status === 409) {
        set({ ...get(), busy: false, error: COPY.resumeConflict });
        await load();
        return false;
      }
      if ([400, 404, 422, 429].includes(r.status)) {
        set({ ...get(), busy: false, error: r.status === 429 ? COPY.limited : COPY.invalid });
        return false;
      }
      set({ ...get(), busy: false, resumeRetry: true, error: COPY.resumeRetry });
      return false;
    },
    takeResumeUrl(): string | null {
      if (!same(mountedIdentity)) return null;
      const u = get().resumeUrl;
      if (u) set({ ...get(), resumeUrl: null });
      return u;
    },
    takePortalUrl(): string | null {
      if (!same(mountedIdentity)) return null;
      const u = get().portalUrl;
      if (u) set({ ...get(), portalUrl: null });
      return u;
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
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: SubCommand } | null = null;
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
    takeCheckoutUrl(): string | null {
      if (!same(mountedIdentity)) return null;
      const u = get().checkoutUrl;
      if (u) set({ ...get(), checkoutUrl: null });
      return u;
    },
    stop() {
      alive = false;
    },
  };
}
