// CLI-07 / FIN-01 card-hold replacement — pure model (no React). Consumer of backend cdf5f57
// (lib/features/hold-reauthorization/server.ts, read-only):
//   GET  /api/bookings/settlement/reauthorization?intervention_id=UUID  (never mutates)
//     → { status, reason, attempt_id, snapshot_id, accepted_total_cents, original_authorized_cents,
//         replacement_authorized_cents, currency:"eur", available, consent_required:true }
//   POST { action:"begin", intervention_id, command_id, snapshot_id, consent:true }
//        { action:"resume"|"abort", intervention_id, attempt_id }
//     → 200 { status, attempt_id, intervention_id, currency, accepted_total_cents, url } (bank page)
//       202 { status, attempt_id, intervention_id, currency, accepted_total_cents }
// A provider return (redirect back) is NEVER a valid hold nor a payment: only a later GET proves it.
// command_id is persisted in tab storage (uid|intervention|snapshot_id) BEFORE the POST; a lost
// reply / 503 / reload resends the same command.
import { z } from "zod";

export const HR_PATH = "/api/bookings/settlement/reauthorization";
export const HR_TIMEOUT_MS = 15_000;
export const HR_TIMEOUT = -1;
export type HrResult = { status: number; body: unknown; retryAfter: number | null };
export type BeginBody = { action: "begin"; intervention_id: string; command_id: string; snapshot_id: string; consent: true };
export type AttemptBody = { action: "resume" | "abort"; intervention_id: string; attempt_id: string };
export type HrBody = BeginBody | AttemptBody;
export type HrApi = { read(interventionId: string): Promise<HrResult>; command(body: HrBody): Promise<HrResult> };
export type HrContext = { generation(): number; userId(): string | null };
export const DEFAULT_HR_CONTEXT: HrContext = { generation: () => 0, userId: () => null };
export type HrStore = { get(key: string): string | null; set(key: string, value: string): boolean; remove(key: string): void };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const hrUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);
export const HR_STATUSES = ["eligible", "opening", "awaiting_authorization", "new_authorized", "old_release_pending", "ready_for_capture", "aborting", "aborted", "needs_review"] as const;
export type HrStatus = (typeof HR_STATUSES)[number];
export const HR_REASONS = ["configuration_required", "not_completed", "manual_review", "authorization_unavailable"] as const;
export type HrReason = (typeof HR_REASONS)[number];
const cents = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const readSchema = z
  .object({
    status: z.enum(HR_STATUSES),
    reason: z.enum(HR_REASONS).nullable(),
    attempt_id: z.string().regex(UUID).nullable(),
    snapshot_id: z.string().regex(/^[a-f0-9]{64}$/),
    accepted_total_cents: cents,
    original_authorized_cents: cents,
    replacement_authorized_cents: cents,
    currency: z.literal("eur"),
    available: z.boolean(),
    consent_required: z.literal(true),
  })
  .strict();
export type HrRead = z.infer<typeof readSchema>;
export function parseHrRead(body: unknown): HrRead | null {
  const r = readSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (d.available !== (d.reason === null)) return null;
  if ((d.attempt_id === null) !== (d.status === "eligible")) return null;
  if (d.replacement_authorized_cents !== d.accepted_total_cents) return null;
  return d;
}
/** Bank page URL exactly as the server accepts it (https checkout.stripe.com, no credentials/hash). */
export function safeCheckoutUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "checkout.stripe.com" && !u.username && !u.password && !u.hash ? u.toString() : null;
  } catch {
    return null;
  }
}
const replySchema = z
  .object({ status: z.enum(HR_STATUSES), attempt_id: z.string().regex(UUID), intervention_id: z.string().regex(UUID), currency: z.literal("eur"), accepted_total_cents: cents, url: z.string().optional() })
  .strict();
export type HrReply = { status: HrStatus; attempt_id: string; url: string | null };
export function parseHrReply(r: HrResult, body: HrBody): HrReply | null {
  const p = replySchema.safeParse(r.body);
  if (!p.success) return null;
  const d = p.data;
  if (d.intervention_id.toLowerCase() !== body.intervention_id.toLowerCase()) return null;
  const expected = body.action === "begin" ? body.command_id : body.attempt_id;
  if (d.attempt_id.toLowerCase() !== expected.toLowerCase()) return null;
  if (r.status === 200) {
    const url = safeCheckoutUrl(d.url);
    return url ? { status: d.status, attempt_id: d.attempt_id, url } : null;
  }
  if (r.status === 202 && d.url === undefined) return { status: d.status, attempt_id: d.attempt_id, url: null };
  return null;
}

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<HrResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: HrResult = { status: HR_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<HrResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<HrResult> => {
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
export function createHrApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = HR_TIMEOUT_MS } = {}): HrApi {
  const base = { credentials: "same-origin" as const, cache: "no-store" as const };
  return {
    read: (id) => timed(fetcher, `${HR_PATH}?intervention_id=${encodeURIComponent(id)}`, { ...base, method: "GET", headers: { accept: "application/json" } }, timeoutMs),
    command: (body) => timed(fetcher, HR_PATH, { ...base, method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}
export const commandKey = (userId: string, interventionId: string, snapshotId: string) => `hold-reauthorization:${userId}|${interventionId.toLowerCase()}|${snapshotId}`;
export function tabStore(): HrStore {
  const ss = () => (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  return {
    get(key) {
      try {
        const v = ss()?.getItem(key) ?? null;
        return v && UUID.test(v) ? v : null;
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
/** Provider return markers in the page URL (?hold_reauthorization=<attempt>&hold_return=success|cancel). */
export function providerReturn(search: string): { attempt_id: string; outcome: "success" | "cancel" } | null {
  const q = new Map<string, string>();
  for (const part of search.replace(/^\?/, "").split("&")) {
    const i = part.indexOf("=");
    if (i > 0) {
      try {
        q.set(decodeURIComponent(part.slice(0, i)), decodeURIComponent(part.slice(i + 1)));
      } catch {
        /* malformed: ignored */
      }
    }
  }
  const id = q.get("hold_reauthorization");
  const outcome = q.get("hold_return");
  return id && UUID.test(id) && (outcome === "success" || outcome === "cancel") ? { attempt_id: id.toLowerCase(), outcome } : null;
}

// ---- Copy ---------------------------------------------------------------------------------------
export const HR_COPY = {
  title: "Nouvelle autorisation bancaire",
  loading: "Vérification de l’autorisation bancaire…",
  loadFailed: "L’état de l’autorisation n’a pas pu être vérifié. Rien n’a été modifié : réessayez.",
  notFound: "Ce dossier est introuvable ou n’est plus accessible.",
  session: "Votre session a expiré ou ne permet pas cette action : reconnectez-vous.",
  demo: "Démonstration : aucune banque n’est contactée et aucune autorisation n’est demandée.",
  consent: (amount: string) => `J’autorise une nouvelle empreinte bancaire de ${amount} (total du devis accepté). L’empreinte actuelle sera libérée une fois la nouvelle vérifiée. Aucun débit n’a lieu à cette étape.`,
  begin: "Ouvrir la page bancaire sécurisée",
  resume: "Reprendre / vérifier l’autorisation",
  abort: "Annuler le remplacement",
  providerReturn: "Retour de la page bancaire : ce retour ne prouve ni une autorisation ni un paiement. Seule la vérification ci-dessous fait foi.",
  stale: "Le dossier a changé depuis l’affichage (montant ou documents) : relisez puis donnez à nouveau votre accord.",
  conflict: "La situation a changé ou doit être vérifiée : rien n’est renvoyé automatiquement. L’état a été relu ci-dessous.",
  retry: "Issue inconnue (réponse perdue ou service indisponible). Réessayer renvoie exactement la même demande.",
  invalid: "Demande refusée par le serveur.",
  noId: "Identifiant de demande impossible à générer sur cet appareil : rien n’est envoyé.",
  noStorage: "La demande ne peut pas être conservée dans cet onglet : rien n’est envoyé (une reprise sûre serait impossible).",
  replyUnreadable: "Réponse illisible : l’issue est inconnue. Réessayez la même demande.",
  redirect: "Redirection vers la page bancaire sécurisée…",
} as const;
export const STATUS_COPY: Record<HrStatus, string> = {
  eligible: "L’empreinte bancaire actuelle ne couvre pas le total accepté : une nouvelle autorisation est nécessaire avant le règlement.",
  opening: "Préparation de la page bancaire : aucune nouvelle empreinte n’est en place.",
  awaiting_authorization: "En attente de votre accord sur la page bancaire : aucune nouvelle empreinte n’est en place.",
  new_authorized: "La banque a confirmé la nouvelle empreinte au serveur ; reprenez pour libérer l’ancienne et finaliser le remplacement.",
  old_release_pending: "Libération de l’ancienne empreinte en cours de vérification.",
  ready_for_capture: "Nouvelle empreinte en place, vérifiée par le serveur. Aucun débit n’a eu lieu : le règlement reste une étape distincte.",
  aborting: "Annulation en cours de vérification.",
  aborted: "Remplacement annulé : aucune nouvelle empreinte n’est en place.",
  needs_review: "Vérification manuelle requise par notre équipe : aucune action n’est possible ici.",
};
export const REASON_COPY: Record<HrReason, string> = {
  configuration_required: "La nouvelle autorisation bancaire n’est pas encore disponible sur ce service.",
  not_completed: "Disponible une fois l’intervention terminée.",
  manual_review: "Vérification manuelle requise : aucune action n’est possible ici.",
  authorization_unavailable: "L’autorisation n’a pas pu être vérifiée auprès de la banque pour le moment : actualisez plus tard.",
};
const RESUMABLE: readonly HrStatus[] = ["opening", "awaiting_authorization", "new_authorized", "old_release_pending"];
const ABORTABLE: readonly HrStatus[] = ["opening", "awaiting_authorization", "new_authorized"];
export type HrActions = { begin: boolean; resume: boolean; abort: boolean };
/** Actions exist only when the server says available (and never in demo / while busy / stale). */
export function actionsFor(read: HrRead | null, demo: boolean): HrActions {
  if (!read || demo || !read.available) return { begin: false, resume: false, abort: false };
  return {
    begin: read.status === "eligible" || read.status === "aborted",
    resume: read.attempt_id !== null && RESUMABLE.includes(read.status),
    abort: read.attempt_id !== null && ABORTABLE.includes(read.status),
  };
}

// ---- State --------------------------------------------------------------------------------------
export type HrState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  read: HrRead | null;
  error: string;
  /** snapshot_id the client consented to (cleared on any snapshot change). */
  consentedSnapshot: string | null;
  busy: boolean;
  pending: HrBody | null;
  conflict: string;
  writeError: string;
  stale: boolean;
  redirecting: boolean;
};
export const HR_INITIAL: HrState = { phase: "loading", read: null, error: "", consentedSnapshot: null, busy: false, pending: null, conflict: "", writeError: "", stale: false, redirecting: false };

export function applyRead(s: HrState, r: HrResult): HrState {
  if (r.status === 200) {
    const read = parseHrRead(r.body);
    if (!read) return { ...s, phase: "error", error: HR_COPY.loadFailed };
    const consentedSnapshot = s.consentedSnapshot === read.snapshot_id ? s.consentedSnapshot : null;
    return { ...s, phase: "ready", read, error: "", consentedSnapshot };
  }
  if (r.status === 404) return { ...s, phase: "unavailable", read: null, error: HR_COPY.notFound };
  if (r.status === 401 || r.status === 403) return { ...s, phase: "unavailable", read: null, error: HR_COPY.session };
  return { ...s, phase: "error", error: HR_COPY.loadFailed };
}

// ---- Controller ---------------------------------------------------------------------------------
export function createHrController({
  api,
  interventionId,
  context = DEFAULT_HR_CONTEXT,
  store,
  newId = hrUuid,
  navigate,
  get,
  set,
  demo = false,
}: {
  api: () => HrApi;
  interventionId: string;
  context?: HrContext;
  store: () => HrStore;
  newId?: () => string | null;
  /** Called only after an explicit click AND a server-validated bank URL. */
  navigate: (url: string) => void;
  get: () => HrState;
  set: (s: HrState) => void;
  demo?: boolean;
}) {
  const gen = context.generation();
  const uid = context.userId();
  let attached = true;
  const ok = () => attached && context.generation() === gen && context.userId() === uid;
  let seq = 0;
  let busy = false;

  async function load(): Promise<boolean> {
    if (demo) {
      set({ ...get(), phase: "demo" });
      return false;
    }
    if (busy) return false;
    const mine = ++seq;
    set({ ...get(), phase: get().read ? get().phase : "loading" });
    const r = await api().read(interventionId);
    if (!ok() || mine !== seq) return false;
    const next = applyRead(get(), r);
    // A server-confirmed abort frees the stored begin key of that snapshot (new consent ⇒ new key).
    if (next.read?.status === "aborted" && next.read.attempt_id && uid) {
      const key = commandKey(uid, interventionId, next.read.snapshot_id);
      if (store().get(key)?.toLowerCase() === next.read.attempt_id.toLowerCase()) store().remove(key);
    }
    set(next);
    return true;
  }
  async function send(body: HrBody): Promise<boolean> {
    if (!ok() || demo) return false;
    busy = true;
    seq++;
    set({ ...get(), busy: true, writeError: "", conflict: "" });
    let r: HrResult;
    try {
      r = await api().command(body);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    busy = false;
    if (!ok()) return false;
    const base = { ...get(), busy: false };
    if (r.status === 200 || r.status === 202) {
      const reply = parseHrReply(r, body);
      if (!reply) {
        set({ ...base, pending: body, writeError: HR_COPY.replyUnreadable });
        return true;
      }
      set({ ...base, pending: null });
      if (reply.url) {
        set({ ...get(), redirecting: true });
        navigate(reply.url);
        return true;
      }
      await load();
      return true;
    }
    if (r.status === 409) {
      set({ ...base, pending: null, conflict: HR_COPY.conflict, consentedSnapshot: null });
      await load(); // re-read only; never a POST
      return true;
    }
    if (r.status === 503 || r.status === HR_TIMEOUT || r.status === 0 || r.status >= 500) {
      set({ ...base, pending: body, writeError: HR_COPY.retry });
      return true;
    }
    const message = r.status === 401 || r.status === 403 ? HR_COPY.session : r.status === 404 ? HR_COPY.notFound : HR_COPY.invalid;
    set({ ...base, pending: null, writeError: message });
    return true;
  }
  return {
    load,
    consent(snapshotId: string | null) {
      const s = get();
      set({ ...s, consentedSnapshot: snapshotId && s.read?.snapshot_id === snapshotId ? snapshotId : null, stale: false });
    },
    /** Explicit, consented. A fresh read first: a changed snapshot ⇒ stale, consent reset, NO POST. */
    async begin(): Promise<boolean> {
      const s = get();
      if (busy || s.pending || !actionsFor(s.read, demo).begin || !s.read || s.consentedSnapshot !== s.read.snapshot_id) return false;
      const consented = s.consentedSnapshot;
      busy = true;
      const mine = ++seq;
      set({ ...s, busy: true, writeError: "", conflict: "" });
      const r = await api().read(interventionId);
      busy = false;
      if (!ok() || mine !== seq) return false;
      const fresh = applyRead({ ...get(), busy: false }, r);
      if (!fresh.read || fresh.read.snapshot_id !== consented || !actionsFor(fresh.read, demo).begin) {
        set({ ...fresh, consentedSnapshot: null, stale: !!fresh.read && fresh.read.snapshot_id !== consented });
        return false;
      }
      set(fresh);
      if (!uid) {
        set({ ...get(), writeError: HR_COPY.session });
        return false;
      }
      const key = commandKey(uid, interventionId, consented);
      const id = store().get(key) ?? newId();
      if (!id || !UUID.test(id)) {
        set({ ...get(), writeError: HR_COPY.noId });
        return false;
      }
      if (!store().set(key, id.toLowerCase())) {
        set({ ...get(), writeError: HR_COPY.noStorage });
        return false;
      }
      return send({ action: "begin", intervention_id: interventionId, command_id: id.toLowerCase(), snapshot_id: consented, consent: true });
    },
    async resume(): Promise<boolean> {
      const s = get();
      if (busy || s.pending || !actionsFor(s.read, demo).resume || !s.read?.attempt_id) return false;
      return send({ action: "resume", intervention_id: interventionId, attempt_id: s.read.attempt_id });
    },
    async abort(): Promise<boolean> {
      const s = get();
      if (busy || s.pending || !actionsFor(s.read, demo).abort || !s.read?.attempt_id) return false;
      return send({ action: "abort", intervention_id: interventionId, attempt_id: s.read.attempt_id });
    },
    /** Resends EXACTLY the pending request (lost reply / 503). Never after a 409. */
    async retry(): Promise<boolean> {
      const body = get().pending;
      if (busy || !body || demo) return false;
      return send(body);
    },
    detach() {
      attached = false;
    },
  };
}
