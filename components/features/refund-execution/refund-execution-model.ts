// Refund execution — pure model (no React). Consumer of the backend contract
// docs/REFUND_EXECUTION_CONTRACT.md (read-only):
//   GET  /api/platform-operations/finance/refund-requests/:id/execution  (local read, never the bank)
//   POST same path, body { command_id, expected_version } ONLY — never an amount, account or policy.
// A 202 / submitted / pending is NEVER a refund. « Remboursement confirmé » is shown only when the
// GET reads execution_status "succeeded" AND request_status "settled" (the request is settled only
// by the webhook-qualified bank confirmation, in one SQL transaction).
// command_id: the existing execution_id, else a UUID persisted in tab storage (keyed by operator,
// request and approved version) BEFORE the POST; a lost reply resumes with the same key.
import { PLATFORM_MFA_MESSAGE, platformMfaRequired } from "../../../shared/platform-mfa";
import { afterWriteRefusal } from "../../app/refusal";
import { z } from "zod";

export const REFUND_EXEC_TIMEOUT_MS = 15_000;
export const REFUND_EXEC_TIMEOUT = -1;
export type RxResult = { status: number; body: unknown; retryAfter: number | null };
export type RxCommand = { command_id: string; expected_version: number };
export type RxApi = { read(requestId: string): Promise<RxResult>; execute(requestId: string, body: RxCommand): Promise<RxResult> };
export type RxContext = { generation(): number; userId(): string | null };
export const DEFAULT_RX_CONTEXT: RxContext = { generation: () => 0, userId: () => null };
/** Tab storage of command ids. `set` returns false when it could not persist. */
export type RxStore = { get(key: string): string | null; set(key: string, value: string): boolean };
/** The approved request as the finance list shows it (amount is the server's approved amount). */
export type RefundRequestView = { id: string; payment_id: string; amount_cents: number; currency: "eur"; status: string; version: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const rxUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

export const EXEC_STATUSES = ["preparing", "submitted", "pending", "requires_action", "failed", "canceled", "succeeded", "unknown", "needs_review"] as const;
export type ExecStatus = (typeof EXEC_STATUSES)[number];
export const RX_REASONS = ["configuration_required", "read_only", "approval_required", "reconciliation_required", "terminal_execution", "payment_unconfirmed", "legacy_binding_missing", "operator_mismatch", "revision_changed", "provider_verification_required"] as const;
export type RxReason = (typeof RX_REASONS)[number];
const REQUEST_STATUSES = ["requested", "approved", "rejected", "cancelled", "settled"] as const;

const readSchema = z
  .object({ request_status: z.enum(REQUEST_STATUSES), execution_status: z.enum(EXEC_STATUSES).nullable(), execution_id: z.string().regex(UUID).nullable(), eligible: z.boolean(), available: z.boolean(), reason: z.enum(RX_REASONS) })
  .strict();
export type ExecutionRead = z.infer<typeof readSchema>;
/** Strict GET parse with the contract invariants (id ⇔ status, available ⇒ eligible, no config ⇒ unavailable). */
export function parseExecutionRead(body: unknown): ExecutionRead | null {
  const r = readSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if ((d.execution_id === null) !== (d.execution_status === null)) return null;
  if (d.available && !d.eligible) return null;
  if (d.reason === "configuration_required" && d.available) return null;
  return d;
}
const replySchema = z.object({ request_status: z.enum(REQUEST_STATUSES), execution_status: z.enum(EXEC_STATUSES), execution_id: z.string().regex(UUID), bank_confirmation: z.boolean() }).strict();
export type ExecutionReply = z.infer<typeof replySchema>;
/** POST reply: must name OUR command as execution id. Its bank_confirmation is never displayed. */
export function parseExecutionReply(body: unknown, commandId: string): ExecutionReply | null {
  const r = replySchema.safeParse(body);
  return r.success && r.data.execution_id.toLowerCase() === commandId.toLowerCase() ? r.data : null;
}

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<RxResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: RxResult = { status: REFUND_EXEC_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<RxResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<RxResult> => {
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
export const executionPath = (requestId: string) => `/api/platform-operations/finance/refund-requests/${encodeURIComponent(requestId)}/execution`;
/** Same-origin, no-store, 15 s deadline. The POST body is exactly { command_id, expected_version }. */
export function createRxApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = REFUND_EXEC_TIMEOUT_MS } = {}): RxApi {
  const base = { credentials: "same-origin" as const, cache: "no-store" as const };
  return {
    read: (id) => timed(fetcher, executionPath(id), { ...base, method: "GET", headers: { accept: "application/json" } }, timeoutMs),
    execute: (id, body) =>
      timed(fetcher, executionPath(id), { ...base, method: "POST", headers: { accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ command_id: body.command_id, expected_version: body.expected_version }) }, timeoutMs),
  };
}
export const commandKey = (userId: string, requestId: string, version: number) => `refund-execution:${userId}:${requestId.toLowerCase()}:${version}`;
/** sessionStorage (tab) store; any storage failure ⇒ get null / set false (the POST is then refused). */
export function tabStore(): RxStore {
  return {
    get(key) {
      try {
        const v = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(key) : null;
        return v && UUID.test(v) ? v : null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        if (typeof sessionStorage === "undefined") return false;
        sessionStorage.setItem(key, value);
        return sessionStorage.getItem(key) === value;
      } catch {
        return false;
      }
    },
  };
}

// ---- Copy -----------------------------------------------------------------------------------------
export const RX_COPY = {
  loading: "Lecture de l’état d’exécution…",
  localRead: "Lecture locale de la plateforme : cet affichage ne contacte ni la banque ni le prestataire de paiement.",
  loadFailed: "L’état d’exécution n’a pas pu être lu. Aucune émission n’a été déclenchée par cette lecture.",
  notFound: "Cette demande est introuvable ou n’est plus accessible.",
  session: "Accès refusé ou session expirée : reconnectez-vous avec un compte finance.",
  demo: "Démonstration : aucune exécution de remboursement n’est lue ni émise.",
  noCapability: "L’exécution des remboursements n’est pas activée pour votre compte ou sur ce service.",
  stale: "La demande affichée a changé depuis sa lecture : actualisez la liste avant toute émission.",
  confirmTitle: "Confirmer l’émission du remboursement",
  recipient: (paymentShort: string) => `Bénéficiaire : le moyen de paiement d’origine du paiement ${paymentShort}, déterminé par le serveur (aucun compte saisi ici).`,
  irreversible: "Une émission transmise au prestataire de paiement ne peut pas être annulée depuis la plateforme. Le montant est celui approuvé par le serveur ; il n’est pas modifiable ici.",
  resumeNote: "Une exécution existe déjà pour cette demande : la même commande est renvoyée pour vérifier ou reprendre, sans nouvelle émission indépendante.",
  submitted: "Émission transmise. Ce n’est pas une confirmation : seule la confirmation bancaire enregistrée établira le remboursement.",
  conflict: "La demande, sa version ou son exécution a changé, ou une vérification manuelle est requise. Rien n’est renvoyé automatiquement : actualisez.",
  retry: "Issue inconnue (réponse perdue ou service indisponible). Réessayer renvoie la même commande, avec le même identifiant : aucune double émission.",
  invalid: "Requête refusée par le serveur.",
  replyUnreadable: "Réponse illisible : l’issue est inconnue. Vérifiez / reprenez avec la même commande.",
  noId: "Identifiant de commande impossible à générer sur cet appareil : aucune émission n’est envoyée.",
  noStorage: "L’identifiant de commande ne peut pas être conservé dans cet onglet : aucune émission n’est envoyée (une reprise sûre serait impossible).",
} as const;
export const REASON_COPY: Record<RxReason, string> = {
  configuration_required: "Configuration du remboursement absente côté serveur : aucune émission possible.",
  read_only: "Lecture seule : vos droits actuels ne permettent pas d’émettre ce remboursement.",
  approval_required: "La demande doit être approuvée avant toute émission.",
  reconciliation_required: "Rapprochement requis avant toute émission.",
  terminal_execution: "Exécution terminée : aucune nouvelle émission depuis cet écran.",
  payment_unconfirmed: "Paiement d’origine non confirmé : aucune émission possible.",
  legacy_binding_missing: "Paiement ancien sans liaison enregistrée avec le prestataire : émission impossible, vérification manuelle requise.",
  operator_mismatch: "Cette exécution a été engagée par un autre opérateur : lui seul peut la vérifier ou la reprendre.",
  revision_changed: "La demande a changé depuis son approbation : actualisez la liste.",
  provider_verification_required: "Vérification auprès du prestataire de paiement requise avant toute émission.",
};
/** Honest execution label. Only succeeded + settled reads as a confirmed refund. */
export function executionLabel(read: Pick<ExecutionRead, "execution_status" | "request_status">): { text: string; confirmed: boolean } {
  const s = read.execution_status;
  if (s === "succeeded") {
    return read.request_status === "settled"
      ? { text: "Remboursement confirmé (confirmation bancaire enregistrée)", confirmed: true }
      : { text: "Accepté par le prestataire, confirmation bancaire non enregistrée : non confirmé", confirmed: false };
  }
  const map: Record<Exclude<ExecStatus, "succeeded"> | "none", string> = {
    none: "Aucune émission enregistrée",
    preparing: "En préparation : aucun remboursement confirmé",
    submitted: "Transmis au prestataire de paiement : en attente de confirmation bancaire",
    pending: "En attente chez le prestataire : en attente de confirmation bancaire",
    requires_action: "Action requise chez le prestataire : aucun remboursement confirmé",
    unknown: "Issue inconnue (réponse perdue) : à vérifier / reprendre",
    failed: "Échec chez le prestataire : aucun remboursement ; une nouvelle tentative se traite explicitement",
    canceled: "Annulé chez le prestataire : aucun remboursement",
    needs_review: "Vérification manuelle requise : aucun remboursement confirmé",
  };
  return { text: map[s ?? "none"], confirmed: false };
}
export const RESUMABLE: readonly ExecStatus[] = ["preparing", "submitted", "pending", "requires_action", "unknown"];

// ---- State machine -------------------------------------------------------------------------------
export type RxState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  read: ExecutionRead | null;
  error: string;
  confirming: boolean;
  writing: boolean;
  /** Command whose outcome is unknown: Réessayer resends EXACTLY this. */
  pending: RxCommand | null;
  notice: string;
  conflict: string;
  writeError: string;
  mfaRequired: boolean;
};
export const RX_INITIAL: RxState = { phase: "loading", read: null, error: "", confirming: false, writing: false, pending: null, notice: "", conflict: "", writeError: "", mfaRequired: false };

export function applyRead(s: RxState, r: RxResult): RxState {
  if (r.status === 200) {
    const read = parseExecutionRead(r.body);
    return read ? { ...s, phase: "ready", read, error: "" } : { ...s, phase: "error", error: RX_COPY.loadFailed };
  }
  if (r.status === 401 || r.status === 403) return { ...s, phase: "unavailable", read: null, error: RX_COPY.session };
  if (r.status === 404) return { ...s, phase: "unavailable", read: null, error: RX_COPY.notFound };
  return { ...s, phase: "error", error: RX_COPY.loadFailed };
}
/** Stale: the list's request no longer matches the server read. */
export function isStale(request: RefundRequestView, read: ExecutionRead | null): boolean {
  return !!read && (read.request_status !== request.status || read.reason === "revision_changed");
}
/** The action exists only with the global capability AND the refreshed per-request availability. */
export function canExecute(capability: boolean, demo: boolean, request: RefundRequestView, s: RxState): boolean {
  const r = s.read;
  if (!capability || demo || s.phase !== "ready" || !r || isStale(request, r)) return false;
  if (!r.available || r.request_status !== "approved" || request.status !== "approved") return false;
  return r.execution_status === null || RESUMABLE.includes(r.execution_status);
}
export function applyExecute(s: RxState, r: RxResult, cmd: RxCommand): { state: RxState; reload: boolean } {
  const base = { ...s, writing: false, confirming: false };
  if (r.status === 200 || r.status === 202) {
    const reply = parseExecutionReply(r.body, cmd.command_id);
    if (!reply) return { state: { ...base, pending: cmd, writeError: RX_COPY.replyUnreadable, notice: "" }, reload: true };
    return { state: { ...base, pending: null, writeError: "", conflict: "", notice: RX_COPY.submitted }, reload: true };
  }
  if (platformMfaRequired(r.status, r.body))
    return { state: { ...base, pending: cmd, writeError: PLATFORM_MFA_MESSAGE, mfaRequired: true, notice: "" }, reload: false };
  if (r.status === 409) return { state: { ...base, pending: null, conflict: RX_COPY.conflict, notice: "" }, reload: false };
  if (r.status === 503 || r.status === REFUND_EXEC_TIMEOUT || r.status === 0 || r.status >= 500)
    return { state: { ...base, pending: cmd, writeError: RX_COPY.retry, notice: "" }, reload: false };
  // P1 shared rules (E50): 401 purges now; 403/404 re-read rights + resource before any new POST.
  const refusal = afterWriteRefusal(r.status);
  if (refusal.purge) return { state: { ...RX_INITIAL, phase: "unavailable", error: RX_COPY.session, writeError: RX_COPY.session }, reload: false };
  if (refusal.reread) return { state: { ...base, pending: null, writeError: r.status === 404 ? RX_COPY.notFound : RX_COPY.session }, reload: true };
  return { state: { ...base, pending: null, writeError: RX_COPY.invalid }, reload: false };
}

// ---- Controller ----------------------------------------------------------------------------------
export function createRxController({
  api,
  request,
  capability,
  context = DEFAULT_RX_CONTEXT,
  store,
  newId = rxUuid,
  get,
  set,
  demo = false,
}: {
  api: () => RxApi;
  request: RefundRequestView;
  /** Read at ACTION time (latest props): a revoked capability never posts. */
  capability: boolean | (() => boolean);
  context?: RxContext;
  store: () => RxStore;
  newId?: () => string | null;
  get: () => RxState;
  set: (s: RxState) => void;
  demo?: boolean;
}) {
  const cap = typeof capability === "function" ? capability : () => capability;
  const gen = context.generation();
  const uid = context.userId();
  const alive = () => context.generation() === gen && context.userId() === uid;
  let seq = 0;
  let writing = false;
  let attached = true;
  const ok = () => attached && alive();

  async function load(): Promise<boolean> {
    if (demo) {
      set({ ...get(), phase: "demo" });
      return false;
    }
    if (writing) return false;
    const mine = ++seq;
    set({ ...get(), phase: get().read ? get().phase : "loading" });
    const r = await api().read(request.id);
    if (!ok() || mine !== seq) return false;
    set(applyRead(get(), r));
    return true;
  }
  /** Resolve the command: existing execution id, else persisted key, else a new UUID persisted first. */
  function resolveCommand(): RxCommand | { error: string } {
    const read = get().read;
    if (!uid) return { error: RX_COPY.session };
    const key = commandKey(uid, request.id, request.version);
    const known = read?.execution_id ?? store().get(key);
    const id = known ?? newId();
    if (!id || !UUID.test(id)) return { error: RX_COPY.noId };
    if (!store().set(key, id.toLowerCase())) return { error: RX_COPY.noStorage };
    return { command_id: id.toLowerCase(), expected_version: request.version };
  }
  async function send(cmd: RxCommand): Promise<boolean> {
    if (!cap() || !ok()) return false; // last gate, synchronously before the POST
    writing = true;
    seq++;
    set({ ...get(), writing: true, writeError: "", conflict: "" });
    let r: RxResult;
    try {
      r = await api().execute(request.id, cmd);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    }
    writing = false;
    if (!ok()) return false;
    const out = applyExecute(get(), r, cmd);
    set(out.state);
    if (out.reload && cap()) await load();
    return true;
  }
  return {
    load,
    confirm() {
      if (!canExecute(cap(), demo, request, get()) || writing) return false;
      set({ ...get(), confirming: true, writeError: "", conflict: "" });
      return true;
    },
    cancel() {
      if (!writing) set({ ...get(), confirming: false });
    },
    /** Explicit, confirmed, single-flight. Never called on mount or after a GET. */
    async execute(): Promise<boolean> {
      if (writing || !get().confirming || !canExecute(cap(), demo, request, get())) return false;
      const cmd = resolveCommand();
      if ("error" in cmd) {
        set({ ...get(), confirming: false, writeError: cmd.error });
        return false;
      }
      return send(cmd);
    },
    finishMfa() {
      if (ok() && get().mfaRequired) {
        set({ ...get(), mfaRequired: false, writeError: "Identité vérifiée. Vous pouvez confirmer la reprise." });
      }
    },
    /** Replays EXACTLY the pending command (same id + version). Never after a 409. */
    async retry(): Promise<boolean> {
      const cmd = get().pending;
      if (writing || demo || !cmd || !cap() || get().mfaRequired) return false;
      return send(cmd);
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
    },
  };
}
