// ENT-16 delegated B2B checkout payer — pure model (no React). Contract (backend 3612a10, strict copy
// of app/api/interventions/[id]/payer/route.ts; docs/DELEGATED_PAYER_BACKEND.md):
//   GET  /api/interventions/:id/payer → { intervention_id, payer_id, version, can_manage, can_checkout,
//        delegate_current, external_session_pending, link: "/#detail/<id>" }
//   POST { command_id, payer_id | null (revoke), expected_version | null (first grant) }
//        → { intervention_id, payer_id, version, replayed } (version = expected + 1; a receipt, not the state)
// The organisation owner grants / revokes explicitly; the delegated member, while the mandate is current
// and the server says can_checkout, sees the EXISTING platform Checkout CTA and nothing else. A
// revocation never cancels a bank session already issued (external_session_pending is said).
// Identity fence: the command is written to tab storage under `courant-private-payer:` and read back
// BEFORE the POST (else 0 POST), keyed by uid + generation + dossier, restored only by strict parse for
// the same identity (never sent by itself), never replayed after an identity change; 401/403 clear.
import { z } from "zod";

export const DP_TIMEOUT_MS = 15_000;
export const DP_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const version = z.number().int().min(1).max(2147483647);
const statusSchema = z
  .object({
    intervention_id: id,
    payer_id: id.nullable(),
    version: version.nullable(),
    can_manage: z.boolean(),
    can_checkout: z.boolean(),
    delegate_current: z.boolean(),
    external_session_pending: z.boolean(),
    link: z.string(),
  })
  .strict();
export type PayerStatus = z.infer<typeof statusSchema>;
const receiptSchema = z.object({ intervention_id: id, payer_id: id.nullable(), version, replayed: z.boolean() }).strict();
const commandSchema = z.object({ command_id: id, payer_id: id.nullable(), expected_version: version.max(2147483646).nullable() }).strict();
export type PayerCommand = z.infer<typeof commandSchema>;
const lower = (v: string) => v.toLowerCase();

/** Same scope checks as the route. */
export function parseStatus(body: unknown, interventionId: string): PayerStatus | null {
  const r = statusSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.intervention_id) !== lower(interventionId) || d.link !== `/#detail/${lower(interventionId)}` || (d.version === null && d.payer_id !== null)) return null;
  return d;
}
export function parseReceipt(body: unknown, interventionId: string, cmd: PayerCommand) {
  const r = receiptSchema.safeParse(body);
  if (!r.success) return null;
  const d = r.data;
  if (lower(d.intervention_id) !== lower(interventionId) || (d.payer_id ? lower(d.payer_id) : null) !== (cmd.payer_id ? lower(cmd.payer_id) : null) || d.version !== (cmd.expected_version ?? 0) + 1) return null;
  return d;
}
/** The existing Checkout CTA is shown to a delegated member only on the server's word. */
export const delegatedCheckout = (s: PayerStatus | null) => !!s && s.delegate_current && s.can_checkout;

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: DP_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? DP_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type PayerApi = { read(interventionId: string): Promise<Result>; write(interventionId: string, cmd: PayerCommand): Promise<Result> };
export const payerPath = (interventionId: string) => `/api/interventions/${encodeURIComponent(interventionId)}/payer`;
export function createPayerApi(fetcher: typeof fetch = (...a) => fetch(...a)): PayerApi {
  return {
    read: (job) => timed(fetcher, payerPath(job), { method: "GET" }, DP_TIMEOUT_MS),
    write: (job, cmd) => timed(fetcher, payerPath(job), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, DP_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-payer:";
export const pendingKey = (uid: string | null, gen: number, interventionId: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${lower(interventionId)}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), intervention_id: id, command: commandSchema }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

export const COPY = {
  title: "Payeur délégué",
  loading: "Vérification de la délégation de paiement…",
  loadFailed: "La délégation de paiement n’a pas pu être vérifiée. Réessayez.",
  forbidden: "Vos droits, vérifiés par le serveur, ne couvrent pas la délégation de paiement de ce dossier.",
  demo: "En démonstration, aucune délégation de paiement n’est lue ni modifiée.",
  none: "Aucun payeur délégué : seul le demandeur du dossier règle sur la plateforme.",
  current: "Payeur délégué actuel :",
  scope: "La délégation autorise uniquement le règlement de ce dossier sur la plateforme : aucune approbation, modification ni document supplémentaire.",
  pendingSession: "Un paiement est peut-être déjà ouvert chez le prestataire : une révocation dans l’application n’annule pas une session bancaire déjà émise.",
  delegatedYes: "Vous êtes le payeur délégué de ce dossier.",
  checkoutNotYet: "Vous êtes désigné payeur, mais le règlement n’est pas ouvert pour l’instant (dossier, devis ou configuration).",
  notDelegated: "Le règlement est réservé au demandeur du dossier ou au payeur délégué par le propriétaire de l’organisation.",
  confirmGrant: (name: string) => `Désigner ${name} comme payeur de ce dossier ? Cette personne pourra uniquement régler ce dossier sur la plateforme.`,
  confirmRevoke: "Retirer la délégation de paiement ? Le payeur délégué ne pourra plus régler ce dossier ; une session bancaire déjà émise n’est pas annulée.",
  granted: "Payeur délégué enregistré.",
  revoked: "Délégation retirée.",
  replayed: "Commande déjà enregistrée : l’état actuel a été relu.",
  conflict: "La délégation a changé entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse ce choix : la personne doit être membre avec un accès au site du dossier.",
  limited: "Trop de commandes en peu de temps : réessayez dans un instant.",
  notFound: "Ce dossier n’est plus accessible.",
  retry: "La délégation n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune délégation n’est possible ici.",
} as const;

export type View = { phase: "loading" | "ready" | "error" | "forbidden"; status: PayerStatus | null; busy: boolean; pending: PayerCommand | null; error: string; notice: string };
export const VIEW_INITIAL: View = { phase: "loading", status: null, busy: false, pending: null, error: "", notice: "" };

export function createPayerController({ api, interventionId, store, newId, context, get, set }: { api: () => PayerApi; interventionId: string; store: () => Store | null; newId: () => string | null; context: Context; get: () => View; set: (v: View) => void }) {
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
    set({ ...VIEW_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().status ? get().phase : "loading" });
    const r = await api().read(interventionId);
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const s = r.status === 200 ? parseStatus(r.body, interventionId) : null;
    if (!s) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", status: s, error: get().phase === "error" ? "" : get().error });
  };
  const persist = (cmd: PayerCommand, who: { uid: string | null; gen: number }) => {
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
  const send = async (cmd: PayerCommand): Promise<boolean> => {
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
      r = await api().write(interventionId, cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false;
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    const receipt = r.status === 200 ? parseReceipt(r.body, interventionId, cmd) : null;
    if (receipt) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: receipt.replayed ? COPY.replayed : cmd.payer_id ? COPY.granted : COPY.revoked });
      await load(); // a receipt proves the command, not the current state
      return true;
    }
    if ([409, 400, 404, 422, 429].includes(r.status)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : r.status === 429 ? COPY.limited : COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: COPY.retry });
    return false;
  };
  const fresh = (payerId: string | null): Promise<boolean> => {
    const v = get();
    if (!v.status || !v.status.can_manage || v.pending || v.busy || v.phase !== "ready") return Promise.resolve(false);
    if (payerId !== null && !UUID.test(payerId)) return Promise.resolve(false);
    if (payerId === null && v.status.payer_id === null) return Promise.resolve(false);
    const cid = newId();
    if (!cid) {
      set({ ...v, error: COPY.noUuid });
      return Promise.resolve(false);
    }
    return send({ command_id: lower(cid), payer_id: payerId ? lower(payerId) : null, expected_version: v.status.version });
  };
  return {
    load,
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, interventionId);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: PayerCommand } | null = null;
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
    /** Explicit owner action (confirmed by the panel); the server verifies the chosen member. */
    grant: (payerId: string) => fresh(payerId),
    revoke: () => fresh(null),
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
    detach() {
      alive = false;
    },
  };
}
