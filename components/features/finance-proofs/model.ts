// FIN-06 finance proofs (read-only display + explicit qualification) — pure model (no React).
// Contracts (read-only): docs/CHECKOUT_CHARGE_PROOF_BACKEND.md, docs/AUTOMATIC_PAYOUT_PROOF_BACKEND.md.
//   charge : GET|POST /api/platform-operations/payments/<payment_id>/charge-proof[?after=evt_…]
//            → { proof|null, dispute_observations ≤ 50, next_after }   (strict browser copy of
//            lib/features/charge-proof/handlers.ts — not browser-exported)
//   fee    : GET|POST …/payments/<payment_id>/charge-proof/fees/<evt> → { qualification|null }
//            (strict copy of lib/features/charge-proof/fee-handlers.ts)
//   payout : GET|POST /api/platform-operations/stripe-observations/<evt>/payout-proof → { qualification|null }
//            (lib/features/payout-proof/contract.ts imported as is: browser-safe zod + `coherent`)
// GET never contacts Stripe (finance_read). POST { command_id } triggers provider READS only and is
// sent ONLY on an explicit click (finance_read + finance_write, checked again by the server); both
// server gates are OFF by default ⇒ 503, shown as « désactivée ou indisponible ». The GET exposes no
// gate flag, so the button is offered to writers with that honest note.
// Scope wording: a capture proof is not an available balance nor a remaining net; a payout proof
// (Stripe status « paid ») is never a bank receipt (bank_receipt_confirmed is always false).
// Identity fence: the command is written + read back under `courant-private-finance-proofs:` BEFORE
// the POST (else 0 POST), keyed by uid + generation + kind + target; a lost reply / 5xx keeps the
// SAME command_id for an explicit retry; 409 ⇒ honest message + re-read, no replay; 401/403 clear.
// State is bound AT RENDER to identity + kind + target (+ cursor): another key renders as loading.
import { z } from "zod";
import { qualification as payoutQualification, coherent } from "../../../lib/features/payout-proof/contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sid = (p: string) => z.string().regex(new RegExp(`^${p}_[A-Za-z0-9_]{1,240}$`));
const uuid = z.string().regex(UUID);
const stamp = z.string().refine((x) => Number.isFinite(Date.parse(x)));
const amount = z.number().int().positive().max(2147483647);
const epoch = z.number().int().nonnegative();
const money0 = z.number().int().min(0).max(2147483647);
export const EVT = /^evt_[A-Za-z0-9_]{1,240}$/;

// ---- charge (copy of handlers.ts sourceSchema / proofSchema / pageSchema) ----
const chargeSource = z
  .object({ payment_id: uuid, checkout_id: uuid, quote_id: uuid, intervention_id: uuid, session_id: sid("cs"), amount_cents: amount, fee_cents: z.number().int().nonnegative(), destination_account: sid("acct"), currency: z.literal("eur"), paid_at: stamp })
  .strict();
const chargeProof = z
  .object({ payment_intent_id: sid("pi"), charge_id: sid("ch"), charge_created: epoch, session_created: epoch, intent_created: epoch, payment_id: uuid, live: z.boolean(), source: chargeSource, verified_at: stamp })
  .strict();
const disputeObservation = z
  .object({ event_id: sid("evt"), observation_version: z.number().int().positive(), dispute_id: sid("du"), observed_status: z.string().max(80).nullable(), disputed_amount_cents: amount, currency: z.literal("eur"), observed_at: stamp })
  .strict();
const chargePage = z.object({ proof: chargeProof.nullable(), dispute_observations: z.array(disputeObservation).max(50), next_after: sid("evt").nullable() }).strict();
export type ChargePage = z.infer<typeof chargePage>;
/** Strict + the handler's own read invariants for THIS payment and cursor. */
export function parseChargePage(body: unknown, paymentId: string, after: string | null): ChargePage | null {
  const r = chargePage.safeParse(body);
  if (!r.success) return null;
  const p = r.data;
  const id = paymentId.toLowerCase();
  if (p.proof && (p.proof.payment_id.toLowerCase() !== id || p.proof.source.payment_id.toLowerCase() !== id || p.proof.source.fee_cents >= p.proof.source.amount_cents)) return null;
  if (!p.proof && (p.dispute_observations.length || p.next_after)) return null;
  let previous = after ?? "";
  for (const o of p.dispute_observations) {
    if (o.event_id <= previous || o.disputed_amount_cents > p.proof!.source.amount_cents) return null;
    previous = o.event_id;
  }
  if (p.next_after && (p.dispute_observations.length !== 50 || p.next_after !== previous)) return null;
  return p;
}

// ---- fee (copy of fee-handlers.ts sourceSchema / qualificationSchema + read invariants) ----
const feeSource = z
  .object({ payment_id: uuid, event_id: sid("evt"), live: z.boolean(), fee_id: sid("fee"), charge_id: sid("ch"), connected_charge_id: sid("ch"), destination_account: sid("acct"), amount_cents: money0, currency: z.literal("eur"), observation_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), observation_created: stamp })
  .strict();
const feeQualification = z
  .object({ event_id: sid("evt"), payment_id: uuid, source: feeSource, provider_amount_refunded_cents: money0.nullable(), provider_refunded: z.boolean(), fee_created: epoch, provider_observed_at: stamp, qualified_at: stamp })
  .strict();
const feeReply = z.object({ qualification: feeQualification.nullable() }).strict();
export type FeeReply = z.infer<typeof feeReply>;
export function parseFeeReply(body: unknown, paymentId: string, eventId: string): FeeReply | null {
  const r = feeReply.safeParse(body);
  if (!r.success) return null;
  const q = r.data.qualification;
  const id = paymentId.toLowerCase();
  if (q && (q.payment_id.toLowerCase() !== id || q.event_id !== eventId || q.source.payment_id.toLowerCase() !== id || q.source.event_id !== eventId)) return null;
  if (q && q.provider_amount_refunded_cents !== null && (q.provider_amount_refunded_cents > q.source.amount_cents || q.provider_refunded !== (q.provider_amount_refunded_cents === q.source.amount_cents))) return null;
  return r.data;
}

// ---- payout (contract imported as is) ----
const payoutReply = z.object({ qualification: payoutQualification.nullable() }).strict();
export type PayoutReply = z.infer<typeof payoutReply>;
export function parsePayoutReply(body: unknown, eventId: string): PayoutReply | null {
  const r = payoutReply.safeParse(body);
  if (!r.success) return null;
  const q = r.data.qualification;
  if (q && (q.event_id !== eventId || q.source.event_id !== eventId || !coherent(q.source, q.proof) || q.proof.bank_receipt_confirmed !== false)) return null;
  return r.data;
}

// ---- targets ----
export type Target =
  | { kind: "charge"; paymentId: string; after: string | null }
  | { kind: "fee"; paymentId: string; eventId: string }
  | { kind: "payout"; eventId: string };
export const validTarget = (t: Target) =>
  t.kind === "payout" ? EVT.test(t.eventId) : UUID.test(t.paymentId) && (t.kind === "charge" ? t.after === null || EVT.test(t.after) : EVT.test(t.eventId));
const base = "/api/platform-operations";
export function pathOf(t: Target, forPost = false): string {
  if (t.kind === "payout") return `${base}/stripe-observations/${encodeURIComponent(t.eventId)}/payout-proof`;
  const pay = `${base}/payments/${encodeURIComponent(t.paymentId.toLowerCase())}/charge-proof`;
  if (t.kind === "fee") return `${pay}/fees/${encodeURIComponent(t.eventId)}`;
  return !forPost && t.after ? `${pay}?after=${encodeURIComponent(t.after)}` : pay;
}
/** Identity of the PROOF (cursor excluded): used for the fence and the qualification. */
export const targetId = (t: Target) => (t.kind === "payout" ? `payout:${t.eventId}` : t.kind === "fee" ? `fee:${t.paymentId.toLowerCase()}:${t.eventId}` : `charge:${t.paymentId.toLowerCase()}`);
export type Data = { kind: "charge"; page: ChargePage } | { kind: "fee"; reply: FeeReply } | { kind: "payout"; reply: PayoutReply };
export function parseFor(t: Target, body: unknown, after: string | null): Data | null {
  if (t.kind === "charge") {
    const page = parseChargePage(body, t.paymentId, after);
    return page ? { kind: "charge", page } : null;
  }
  if (t.kind === "fee") {
    const reply = parseFeeReply(body, t.paymentId, t.eventId);
    return reply ? { kind: "fee", reply } : null;
  }
  const reply = parsePayoutReply(body, t.eventId);
  return reply ? { kind: "payout", reply } : null;
}

// ---- transport ----
export const PROOF_TIMEOUT_MS = 30_000;
export const PROOF_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
async function timed(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: PROOF_TIMEOUT, body: null });
    }, PROOF_TIMEOUT_MS);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? PROOF_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type ProofApi = { read(t: Target): Promise<Result>; qualify(t: Target, commandId: string): Promise<Result> };
export function createProofApi(fetcher: typeof fetch = (...a) => fetch(...a)): ProofApi {
  return {
    read: (t) => timed(fetcher, pathOf(t), { method: "GET" }),
    qualify: (t, commandId) => timed(fetcher, pathOf(t, true), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ command_id: commandId }) }),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-finance-proofs:";
export const pendingKey = (uid: string | null, gen: number, t: Target) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${targetId(t)}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), target: z.string().min(1), command_id: uuid }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const identityOf = (c: Context) => `${c.userId() ?? "-"}|${c.generation()}`;
export const viewKey = (c: Context, t: Target | null) => (t && validTarget(t) ? `${identityOf(c)}|${targetId(t)}|${t.kind === "charge" ? t.after ?? "" : ""}` : "");

export const COPY = {
  loading: "Lecture de la preuve enregistrée…",
  failed: "La preuve n’a pas pu être lue. Réessayez.",
  notFound: "Aucun élément correspondant à cet identifiant.",
  forbidden: "Votre habilitation finance, vérifiée par le serveur, ne permet pas de lire ces preuves.",
  readNote: "Lecture des preuves déjà enregistrées : aucun appel à Stripe.",
  qualify: "Qualifier la preuve (lectures Stripe)…",
  qualifyExplain: "Le serveur relira les objets Stripe concernés (lectures seules, aucune modification). La qualification est désactivée par défaut côté serveur : sans activation, rien n’est lu ni enregistré.",
  confirm: "Lancer la qualification",
  cancel: "Annuler",
  disabled: "Qualification désactivée ou indisponible côté serveur : aucune preuve enregistrée. Vous pouvez renvoyer la même demande.",
  retry: "La qualification n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  retrySame: "Réessayer la même demande",
  conflict: "Les références doivent être revérifiées : rien n’est renvoyé automatiquement. La preuve a été relue.",
  invalid: "Le serveur refuse cette qualification.",
  qualified: "Qualification enregistrée par le serveur : la preuve a été relue.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  chargeNone: "Aucune preuve de capture conservée pour ce paiement. Cela ne signifie pas que le paiement n’existe pas.",
  chargeScope: "Atteste : la Session Checkout, le PaymentIntent et la Charge relus chez Stripe, réussis et capturés pour ce montant, ce compte destinataire et cette commission figée. N’atteste pas : un solde disponible, un montant net restant après remboursement ou litige, ni une réception bancaire.",
  disputesNote: "Chaque ligne est une observation datée d’un litige ; aucun « dernier statut » n’est déduit de l’ordre. Le montant contesté peut être partiel.",
  feeNone: "Aucune qualification de commission enregistrée pour cet événement.",
  feeScope: "Atteste : la commission relue chez Stripe pour ce montant, ce compte et cette Charge. Le montant remboursé est celui lu à la date de qualification. N’atteste pas : un solde bancaire, un remboursement déclenché par l’application ni une écriture du ledger. Ne pas additionner plusieurs observations.",
  payoutNone: "Aucune preuve de rapprochement enregistrée pour cet événement de versement.",
  payoutScope: "Atteste : le statut Stripe « paid » du versement automatique et sa composition, relus à la date indiquée. N’atteste pas : une réception des fonds par la banque (non confirmée), ni une attribution des lignes à des dossiers (toutes non attribuées). Ne pas additionner plusieurs événements du même versement.",
} as const;

export type ProofState = {
  key: string;
  phase: "idle" | "loading" | "ready" | "error" | "forbidden";
  data: Data | null;
  busy: boolean;
  pending: string | null;
  error: string;
  notice: string;
};
export const PROOF_INITIAL: ProofState = { key: "", phase: "idle", data: null, busy: false, pending: null, error: "", notice: "" };
export const viewOf = (s: ProofState, key: string): ProofState => (s.key === key ? s : { ...PROOF_INITIAL, key, phase: key ? "loading" : "idle" });

/** One controller per identity + proof target. */
export function createProofController({ target, api, store, newId, context, set }: { target: Target; api: () => ProofApi; store: () => Store | null; newId: () => string | null; context: Context; set: (s: ProofState) => void }) {
  let alive = true;
  let seq = 0;
  let inFlight = false;
  let t: Target = target;
  let state: ProofState = { ...PROOF_INITIAL };
  const bound = identityOf(context);
  const uid = context.userId();
  const gen = context.generation();
  const same = () => alive && identityOf(context) === bound;
  const keyOf = (x: Target) => viewKey(context, x);
  const put = (s: ProofState) => {
    state = s;
    if (alive) set(s);
  };
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const key = () => pendingKey(uid, gen, t);
  const clearStored = () => safe(() => store()?.remove(key()));
  const forbid = () => {
    clearStored();
    put({ ...PROOF_INITIAL, key: keyOf(t), phase: "forbidden", error: COPY.forbidden });
  };
  const load = async (notice?: string, keepPending = state.pending) => {
    const my = ++seq;
    const x = t;
    put({ ...state, key: keyOf(x), phase: state.phase === "ready" && state.key === keyOf(x) ? "ready" : "loading" });
    const r = await api().read(x);
    if (!same() || my !== seq) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const after = x.kind === "charge" ? x.after : null;
    const d = r.status === 200 ? parseFor(x, r.body, after) : null;
    if (!d) return put({ ...state, key: keyOf(x), phase: "error", data: null, error: r.status === 404 ? COPY.notFound : COPY.failed });
    put({ ...state, key: keyOf(x), phase: "ready", data: d, pending: keepPending, error: state.phase === "ready" ? state.error : "", notice: notice ?? state.notice });
  };
  const persist = (commandId: string) => {
    if (!uid) return false;
    const s = store();
    if (!s) return false;
    const value = JSON.stringify({ uid, gen, target: targetId(t), command_id: commandId });
    return safe(() => {
      s.set(key(), value);
      return s.get(key()) === value;
    }) === true;
  };
  const send = async (commandId: string): Promise<boolean> => {
    if (inFlight || !same() || !persist(commandId)) {
      if (!inFlight) put({ ...state, error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    const x = t;
    put({ ...state, busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().qualify(x, commandId);
    } finally {
      inFlight = false;
    }
    if (!same() || targetId(x) !== targetId(t)) return false; // another identity / target: never applied
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 200) {
      const d = parseFor(x.kind === "charge" ? { ...x, after: null } : x, r.body, null);
      if (d) {
        clearStored();
        if (x.kind === "charge" && x.after) t = { ...x, after: null };
        put({ ...state, key: keyOf(t), phase: "ready", data: d, busy: false, pending: null, error: "", notice: COPY.qualified });
        return true;
      }
    }
    if ([400, 404, 409, 422, 429].includes(r.status)) {
      clearStored();
      put({ ...state, busy: false, pending: null, error: r.status === 409 ? COPY.conflict : COPY.invalid });
      if (r.status === 409) await load(undefined, null);
      return false;
    }
    // Lost reply, timeout, 503 (gate off or unavailable), unverifiable 200: SAME command on explicit retry.
    put({ ...state, busy: false, pending: commandId, error: r.status === 503 ? COPY.disabled : COPY.retry });
    return false;
  };
  return {
    load: () => load(),
    /** Cursor change of the dispute observations (charge only). */
    page(after: string | null) {
      if (t.kind !== "charge" || !same()) return Promise.resolve();
      t = { ...t, after };
      return load();
    },
    /** Explicit click only; preconditions before the id is drawn. */
    qualify(canWrite: boolean, renderKey: string): Promise<boolean> {
      if (!canWrite || !same() || state.key !== renderKey || state.phase !== "ready" || state.busy || state.pending || inFlight) return Promise.resolve(false);
      const cid = newId();
      if (!cid || !UUID.test(cid)) {
        put({ ...state, error: COPY.noUuid });
        return Promise.resolve(false);
      }
      return send(cid.toLowerCase());
    },
    retry(renderKey: string) {
      if (!state.pending || state.key !== renderKey) return Promise.resolve(false);
      return send(state.pending);
    },
    /** Restores an uncertain command of THIS identity and target (never sent by itself). */
    restorePending() {
      if (!uid) return;
      const raw = safe(() => store()?.get(key()) ?? null) ?? null;
      if (raw === null) return;
      let ok = false;
      let cid = "";
      try {
        const r = storedSchema.safeParse(JSON.parse(raw));
        ok = r.success && r.data.uid === uid && r.data.gen === gen && r.data.target === targetId(t);
        cid = r.success ? r.data.command_id : "";
      } catch {
        ok = false;
      }
      if (!ok) {
        safe(() => store()?.remove(key()));
        return;
      }
      state = { ...state, pending: cid, error: COPY.retry };
    },
    get: () => state,
    stop() {
      alive = false;
    },
  };
}
