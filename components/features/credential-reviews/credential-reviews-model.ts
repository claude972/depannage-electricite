// ART-03 / ADM-02 per-credential review — pure model (no React). Consumer of the backend contract
// b02f458 (app/api/artisan/credentials/[id]/reviews, read-only):
//   GET  ?before=<version> → { credential_id, kind, expires_on, can_review, current_version,
//                              reviews: [{ version, decision, reason, reviewed_at }], next_before }
//   POST { command_id, expected_version, decision, reason } → { review: { credential_id, version,
//                              decision, reason, reviewed_at } }
// The command is PERSISTED in tab storage (keyed uid|credential|expected_version) BEFORE the POST;
// a lost reply / 503 / reload resends the identical command. A 409 is never replayed: a new
// command for this version exists only after an explicit « Actualiser ».
import { z } from "zod";

export const CR_PAGE = 50;
export const CR_TIMEOUT_MS = 15_000;
export const CR_TIMEOUT = -1;
export const REASON_MAX = 1000;
export type CrResult = { status: number; body: unknown; retryAfter: number | null };
export type Decision = "accepted" | "changes_requested" | "rejected";
export type CrCommand = { command_id: string; expected_version: number; decision: Decision; reason: string };
export type CrApi = { read(credentialId: string, before: number | null): Promise<CrResult>; review(credentialId: string, body: CrCommand): Promise<CrResult> };
export type CrContext = { generation(): number; userId(): string | null };
export const DEFAULT_CR_CONTEXT: CrContext = { generation: () => 0, userId: () => null };
/** Tab storage of the pending command (JSON). `set` returns false when it could not persist. */
export type CrStore = { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const crUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
export const DECISIONS: readonly Decision[] = ["accepted", "changes_requested", "rejected"];
export const DECISION_LABEL: Record<Decision, string> = { accepted: "Acceptée", changes_requested: "Modifications demandées", rejected: "Refusée" };
export const KIND_LABEL: Record<string, string> = { registration: "Immatriculation", liability: "Assurance responsabilité", qualification: "Qualification", other: "Autre justificatif" };

const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reviewSchema = z.object({ version: z.number().int().positive(), decision: z.enum(["accepted", "changes_requested", "rejected"]), reason: z.string().min(1).max(REASON_MAX), reviewed_at: instant }).strict();
export type Review = z.infer<typeof reviewSchema>;
const pageSchema = z
  .object({
    credential_id: z.string().regex(UUID),
    kind: z.enum(["registration", "liability", "qualification", "other"]),
    expires_on: isoDate.nullable(),
    can_review: z.boolean(),
    current_version: z.number().int().nonnegative(),
    reviews: z.array(reviewSchema).max(CR_PAGE),
    next_before: z.number().int().min(2).nullable(),
  })
  .strict();
export type ReviewsPage = z.infer<typeof pageSchema>;

/** Strict page parse with the route's invariants (contiguous versions from the head, paging). */
export function parseReviewsPage(body: unknown, credentialId: string, before: number | null): ReviewsPage | null {
  const r = pageSchema.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  if (p.credential_id.toLowerCase() !== credentialId.toLowerCase()) return null;
  const head = Math.min(p.current_version, before === null ? p.current_version : before - 1);
  if (p.reviews.length !== Math.min(head, CR_PAGE) || p.reviews.some((x, i) => x.version !== head - i)) return null;
  if (p.next_before !== (head > CR_PAGE ? head - CR_PAGE + 1 : null)) return null;
  return p;
}
const replySchema = z.object({ review: reviewSchema.extend({ credential_id: z.string().regex(UUID) }).strict() }).strict();
export function parseReviewReply(body: unknown, credentialId: string, cmd: CrCommand): Review | null {
  const r = replySchema.safeParse(body);
  if (!r.success) return null;
  const v = r.data.review;
  if (v.credential_id.toLowerCase() !== credentialId.toLowerCase() || v.version !== cmd.expected_version + 1 || v.decision !== cmd.decision || v.reason !== cmd.reason) return null;
  return { version: v.version, decision: v.decision, reason: v.reason, reviewed_at: v.reviewed_at };
}

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<CrResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: CrResult = { status: CR_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<CrResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<CrResult> => {
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
export const reviewsPath = (credentialId: string) => `/api/artisan/credentials/${encodeURIComponent(credentialId)}/reviews`;
export function createCrApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = CR_TIMEOUT_MS } = {}): CrApi {
  const base = { credentials: "same-origin" as const, cache: "no-store" as const };
  return {
    read: (id, before) => timed(fetcher, `${reviewsPath(id)}${before === null ? "" : `?before=${before}`}`, { ...base, method: "GET", headers: { accept: "application/json" } }, timeoutMs),
    review: (id, c) =>
      timed(fetcher, reviewsPath(id), { ...base, method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ command_id: c.command_id, expected_version: c.expected_version, decision: c.decision, reason: c.reason }) }, timeoutMs),
  };
}
export const commandKey = (userId: string, credentialId: string, expectedVersion: number) => `credential-review:${userId}|${credentialId.toLowerCase()}|${expectedVersion}`;
export function tabStore(): CrStore {
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
/** A stored command is reused only if it is exactly a command for this credential and version. */
export function readStored(raw: string | null, expectedVersion: number): CrCommand | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (typeof v.command_id !== "string" || !UUID.test(v.command_id) || v.expected_version !== expectedVersion || !DECISIONS.includes(v.decision as Decision)) return null;
    if (typeof v.reason !== "string" || v.reason !== v.reason.trim() || v.reason.length < 1 || v.reason.length > REASON_MAX) return null;
    return { command_id: v.command_id, expected_version: expectedVersion, decision: v.decision as Decision, reason: v.reason };
  } catch {
    return null;
  }
}
export function validateDecision(decision: string, reason: string): { decision?: string; reason?: string } {
  const e: { decision?: string; reason?: string } = {};
  if (!DECISIONS.includes(decision as Decision)) e.decision = "Choisissez une décision.";
  const r = reason.trim();
  if (r.length < 1) e.reason = decision === "accepted" ? "Indiquez un commentaire (visible par l’artisan)." : "Indiquez le motif (visible par l’artisan).";
  else if (r.length > REASON_MAX) e.reason = `${REASON_MAX} caractères maximum.`;
  return e;
}

export const CR_COPY = {
  loading: "Lecture des décisions de la pièce…",
  loadFailed: "L’historique de la pièce n’a pas pu être lu. Réessayez.",
  notFound: "Cette pièce est introuvable ou n’est plus accessible.",
  forbidden: "Vous n’avez pas le droit de consulter ou d’examiner cette pièce.",
  session: "Session expirée : reconnectez-vous.",
  demo: "Démonstration : aucune décision sur les pièces n’est lue ni enregistrée.",
  empty: "Aucune décision enregistrée pour cette pièce.",
  scope: "Une décision porte sur cette seule pièce : elle n’approuve pas, à elle seule, la candidature complète.",
  newDocument: "Pour changer la nature ou la date de validité d’une pièce déjà examinée, un nouveau document doit être transmis : cette pièce n’est pas modifiable.",
  reasonVisible: "Le motif est visible par l’artisan.",
  stale: "La pièce a reçu une nouvelle décision depuis l’affichage : actualisez avant de décider.",
  saved: "Décision enregistrée.",
  conflict: "La pièce a changé (nouvelle décision ou commande déjà utilisée) : rien n’est renvoyé automatiquement. Actualisez pour voir la décision courante.",
  retry: "Issue inconnue (réponse perdue ou service indisponible). Réessayer renvoie exactement la même décision, avec le même identifiant.",
  resume: "Une décision a été envoyée depuis cet onglet sans réponse confirmée. Reprenez l’envoi : la même commande est renvoyée.",
  expired: "Une pièce expirée ne peut pas être acceptée : demandez un document à jour.",
  invalid: "Décision refusée par le serveur : vérifiez la saisie.",
  noId: "Identifiant de commande impossible à générer sur cet appareil : aucune décision n’est envoyée.",
  noStorage: "La commande ne peut pas être conservée dans cet onglet : aucune décision n’est envoyée (une reprise sûre serait impossible).",
  replyUnreadable: "Réponse illisible : l’issue est inconnue. Réessayez avec la même commande.",
  partial: (shown: number, total: number) => `${shown} décision(s) affichée(s) sur ${total}.`,
} as const;

// ---- State --------------------------------------------------------------------------------------
export type CrState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  page: Omit<ReviewsPage, "reviews" | "next_before"> | null;
  reviews: Review[];
  nextBefore: number | null;
  loadingMore: boolean;
  error: string;
  writing: boolean;
  /** Command with an unknown outcome: only the identical command may be sent. */
  pending: CrCommand | null;
  conflict: string;
  writeError: string;
  notice: string;
  stale: boolean;
};
export const CR_INITIAL: CrState = { phase: "loading", page: null, reviews: [], nextBefore: null, loadingMore: false, error: "", writing: false, pending: null, conflict: "", writeError: "", notice: "", stale: false };

function readError(status: number): Pick<CrState, "phase" | "error"> {
  if (status === 404) return { phase: "unavailable", error: CR_COPY.notFound };
  if (status === 403) return { phase: "unavailable", error: CR_COPY.forbidden };
  if (status === 401) return { phase: "unavailable", error: CR_COPY.session };
  return { phase: "error", error: CR_COPY.loadFailed };
}
export function applyFirstPage(s: CrState, r: CrResult, credentialId: string): CrState {
  if (r.status !== 200) {
    const transient = r.status === 503 || r.status <= 0;
    return { ...s, ...readError(r.status), page: transient ? s.page : null, reviews: transient ? s.reviews : [], nextBefore: transient ? s.nextBefore : null };
  }
  const p = parseReviewsPage(r.body, credentialId, null);
  if (!p) return { ...s, phase: "error", error: CR_COPY.loadFailed };
  const { reviews, next_before, ...page } = p;
  return { ...s, phase: "ready", page, reviews, nextBefore: next_before, error: "", stale: false, loadingMore: false };
}
export function applyMore(s: CrState, r: CrResult, credentialId: string, before: number): CrState {
  const base = { ...s, loadingMore: false };
  if (r.status !== 200) return { ...base, error: CR_COPY.loadFailed };
  const p = parseReviewsPage(r.body, credentialId, before);
  if (!p) return { ...base, error: CR_COPY.loadFailed };
  if (!s.page || p.current_version !== s.page.current_version) return { ...base, stale: true };
  const seen = new Set(s.reviews.map((x) => x.version));
  return { ...base, error: "", reviews: [...s.reviews, ...p.reviews.filter((x) => !seen.has(x.version))], nextBefore: p.next_before };
}
/** The form exists only for the admin view, with can_review, a fresh page and nothing in flight. */
export function canDecide(mode: "admin" | "artisan", demo: boolean, s: CrState): boolean {
  return mode === "admin" && !demo && s.phase === "ready" && !!s.page?.can_review && !s.stale && !s.conflict && !s.pending && !s.writing;
}

// ---- Controller ----------------------------------------------------------------------------------
export function createCrController({
  api,
  credentialId,
  mode,
  context = DEFAULT_CR_CONTEXT,
  store,
  newId = crUuid,
  get,
  set,
  demo = false,
}: {
  api: () => CrApi;
  credentialId: string;
  mode: "admin" | "artisan";
  context?: CrContext;
  store: () => CrStore;
  newId?: () => string | null;
  get: () => CrState;
  set: (s: CrState) => void;
  demo?: boolean;
}) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  const ok = () => attached && context.generation() === gen && context.userId() === uid;
  let seq = 0;
  let writing = false;
  const keyFor = (version: number) => (uid ? commandKey(uid, credentialId, version) : null);

  async function load(): Promise<boolean> {
    if (demo) {
      set({ ...get(), phase: "demo" });
      return false;
    }
    if (writing) return false;
    const mine = ++seq;
    set({ ...get(), phase: get().page ? get().phase : "loading", loadingMore: false });
    const r = await api().read(credentialId, null);
    if (!ok() || mine !== seq) return false;
    let next = applyFirstPage(get(), r, credentialId);
    // Resume: a command stored for THIS version (lost reply / reload) is offered as-is.
    if (next.phase === "ready" && next.page && mode === "admin" && !next.pending) {
      const key = keyFor(next.page.current_version);
      const stored = key ? readStored(store().get(key), next.page.current_version) : null;
      if (stored) next = { ...next, pending: stored, writeError: CR_COPY.resume };
    }
    set(next);
    return true;
  }
  async function send(cmd: CrCommand): Promise<boolean> {
    if (!ok() || mode !== "admin" || demo) return false;
    writing = true;
    seq++;
    set({ ...get(), writing: true, writeError: "", conflict: "", notice: "" });
    let r: CrResult;
    try {
      r = await api().review(credentialId, cmd);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    writing = false;
    if (!ok()) return false;
    const key = keyFor(cmd.expected_version);
    const base = { ...get(), writing: false };
    if (r.status === 200) {
      const review = parseReviewReply(r.body, credentialId, cmd);
      if (!review) {
        set({ ...base, pending: cmd, writeError: CR_COPY.replyUnreadable });
        return true;
      }
      if (key) store().remove(key);
      set({ ...base, pending: null, writeError: "", notice: `${CR_COPY.saved} ${DECISION_LABEL[review.decision]} (version ${review.version}).` });
      await load();
      return true;
    }
    if (r.status === 409) {
      // Never replayed. The stored command stays until the operator explicitly refreshes.
      set({ ...base, pending: null, conflict: CR_COPY.conflict });
      return true;
    }
    if (r.status === 503 || r.status === CR_TIMEOUT || r.status === 0 || r.status >= 500) {
      set({ ...base, pending: cmd, writeError: CR_COPY.retry });
      return true;
    }
    // Definitive refusals: the command was not recorded; a corrected decision may use a new key.
    if (key) store().remove(key);
    const message = r.status === 422 ? (cmd.decision === "accepted" ? CR_COPY.expired : CR_COPY.invalid) : r.status === 403 ? CR_COPY.forbidden : r.status === 404 ? CR_COPY.notFound : r.status === 401 ? CR_COPY.session : CR_COPY.invalid;
    set({ ...base, pending: null, writeError: message });
    // Refused right or piece: re-read before any new decision; a refused read purges the piece,
    // its reasons and the form (E38).
    if (r.status === 401 || r.status === 403 || r.status === 404) await load();
    return true;
  }
  return {
    load,
    async more(): Promise<boolean> {
      const s = get();
      if (demo || writing || s.loadingMore || s.nextBefore === null || s.phase !== "ready") return false;
      const before = s.nextBefore;
      const mine = seq;
      set({ ...s, loadingMore: true });
      const r = await api().read(credentialId, before);
      if (!ok() || mine !== seq) return false;
      set(applyMore(get(), r, credentialId, before));
      return true;
    },
    /** Explicit decision: persisted BEFORE the POST, single-flight. */
    async decide(decision: string, reason: string): Promise<{ errors?: { decision?: string; reason?: string } } | boolean> {
      const s = get();
      if (writing || !canDecide(mode, demo, s) || !s.page) return false;
      const errors = validateDecision(decision, reason);
      if (errors.decision || errors.reason) return { errors };
      const key = keyFor(s.page.current_version);
      if (!key) {
        set({ ...s, writeError: CR_COPY.session });
        return false;
      }
      const id = newId();
      if (!id || !UUID.test(id)) {
        set({ ...s, writeError: CR_COPY.noId });
        return false;
      }
      const cmd: CrCommand = { command_id: id.toLowerCase(), expected_version: s.page.current_version, decision: decision as Decision, reason: reason.trim() };
      if (!store().set(key, JSON.stringify(cmd))) {
        set({ ...s, writeError: CR_COPY.noStorage });
        return false;
      }
      return send(cmd);
    },
    /** Resends EXACTLY the pending command (lost reply / 503 / reload). Never after a 409. */
    async retry(): Promise<boolean> {
      const cmd = get().pending;
      if (writing || !cmd || demo || mode !== "admin") return false;
      return send(cmd);
    },
    /** Explicit « Actualiser »: drops the conflicting stored command, then re-reads. */
    async refresh(): Promise<boolean> {
      if (writing) return false;
      const s = get();
      if (s.conflict && s.page) {
        const key = keyFor(s.page.current_version);
        if (key) store().remove(key);
      }
      set({ ...s, conflict: "", writeError: "", pending: null, stale: false });
      return load();
    },
    detach() {
      attached = false;
    },
  };
}
