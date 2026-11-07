// FIN-06 — provider transfer observations and operator reconciliation review. Pure model, no React.
// Contract: docs/STRIPE_FINANCIAL_RECONCILIATION_BACKEND.md:
//   GET  /api/platform-operations/stripe-observations?after=<evt>&state=matched|needs_review
//        → { records (≤ 50, ascending event id), next_after }   — finance_read
//   GET  /api/platform-operations/stripe-observations/<evt> → { record, history (≤ 50, newest first), history_limited }
//   POST /api/platform-operations/stripe-observations/<evt> { command_id, expected_version, note }
//        → { event_id, version, result, replayed }   — finance_read AND finance_write. The review keeps
//        the note and re-runs the automatic association with the references ALREADY recorded; there is
//        no manual link, amount or state. 401 / 403 / 404 / 409 / 422 / 429 / 503 (+ Retry-After).
// An observation is NEVER a payment, a payout or a refund; nothing here calls the provider.
import { z } from "zod";
import { detail, eventId, page, receipt, reviewCommand, type FinancialObservation } from "../../../lib/features/stripe-reconciliation/contract";

export const BASE_PATH = "/api/platform-operations/stripe-observations";
export const FR_TIMEOUT_MS = 15_000;
export const FR_TIMEOUT = -1;
export const PAGE_MAX = 50;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export type Observation = FinancialObservation;
export type Detail = z.infer<typeof detail>;
export type Receipt = z.infer<typeof receipt>;
export type ReviewCommand = z.infer<typeof reviewCommand>;
export type StateFilter = "" | "matched" | "needs_review";

const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = FR_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: FR_TIMEOUT, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? FR_TIMEOUT : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function listUrl(after: string | null, state: StateFilter): string {
  const q: string[] = [];
  if (after) q.push(`after=${encodeURIComponent(after)}`);
  if (state) q.push(`state=${state}`);
  return q.length ? `${BASE_PATH}?${q.join("&")}` : BASE_PATH;
}
export const detailUrl = (id: string) => `${BASE_PATH}/${encodeURIComponent(id)}`;
export const isEventId = (v: string) => eventId.safeParse(v).success;

/** Same checks as the route: ascending ids after the cursor, state filter honoured, cursor = last id of a full page. */
export function parsePage(body: unknown, after: string | null, state: StateFilter): { records: Observation[]; next_after: string | null } | null {
  const p = page.safeParse(body);
  if (!p.success) return null;
  const { records, next_after } = p.data;
  for (let i = 0; i < records.length; i++) {
    const id = records[i].event.id;
    if ((after !== null && id <= after) || (i > 0 && id <= records[i - 1].event.id) || (state && records[i].result.state !== state)) return null;
  }
  if (next_after !== null && (records.length !== PAGE_MAX || next_after !== records[records.length - 1]?.event.id)) return null;
  return p.data;
}
export function parseDetail(body: unknown, id: string): Detail | null {
  const d = detail.safeParse(body);
  if (!d.success || d.data.record.event.id !== id) return null;
  const h = d.data.history;
  if (h.some((v, i) => v.version > d.data.record.version || (i > 0 && v.version >= h[i - 1].version))) return null;
  return d.data;
}
export function parseReceipt(body: unknown, id: string, expectedVersion: number): Receipt | null {
  const r = receipt.safeParse(body);
  return r.success && r.data.event_id === id && r.data.version === expectedVersion + 1 ? r.data : null;
}

// ---- Plain-language labels (never « paiement / versement / remboursement effectué ») ------------------
export const OBSERVATION_LABEL = "Observation du fournisseur (lecture)";
export const FAMILY_LABEL: Record<Observation["event"]["family"], string> = {
  transfer: "Transfert vers un compte connecté",
  payout: "Versement bancaire agrégé",
  fee: "Commission de plateforme",
  dispute: "Contestation",
};
export const TYPE_LABEL: Record<string, string> = {
  "transfer.created": "transfert créé (selon le fournisseur)",
  "transfer.updated": "transfert mis à jour (selon le fournisseur)",
  "transfer.reversed": "transfert repris (selon le fournisseur)",
  "payout.created": "versement créé (selon le fournisseur)",
  "payout.updated": "versement mis à jour (selon le fournisseur)",
  "payout.paid": "versement indiqué payé par le fournisseur",
  "payout.failed": "versement indiqué en échec par le fournisseur",
  "payout.canceled": "versement indiqué annulé par le fournisseur",
  "payout.reconciliation_completed": "rapprochement du versement terminé côté fournisseur",
  "application_fee.created": "commission créée (selon le fournisseur)",
  "application_fee.refunded": "commission indiquée reversée par le fournisseur",
  "application_fee.refund.updated": "reversement de commission mis à jour (selon le fournisseur)",
  "charge.dispute.created": "contestation ouverte (selon le fournisseur)",
  "charge.dispute.updated": "contestation mise à jour (selon le fournisseur)",
  "charge.dispute.closed": "contestation close (selon le fournisseur)",
  "charge.dispute.funds_withdrawn": "fonds retenus pour contestation (selon le fournisseur)",
  "charge.dispute.funds_reinstated": "fonds restitués après contestation (selon le fournisseur)",
};
export const STATE_LABEL: Record<Observation["result"]["state"], string> = {
  matched: "Associée au transfert enregistré",
  needs_review: "À examiner",
};
export const REASON_LABEL: Record<Observation["result"]["reason"], string> = {
  unexpected_source_account: "L’événement provient d’un compte inattendu : il n’est rattaché à rien.",
  unlinked_transfer: "Aucun transfert enregistré ne porte cet identifiant : non rattaché.",
  transfer_proof_mismatch: "Les références (charge source, compte destinataire, montant ou devise) ne correspondent pas exactement au transfert enregistré : non rattaché.",
  transfer_reversal: "Reprise totale ou partielle du transfert : le lien prouvé au dossier est conservé, la situation reste à examiner.",
  linked_transfer_observation: "Cette observation correspond exactement au transfert déjà enregistré pour ce dossier. Ce n’est pas la preuve d’un versement bancaire ni d’une réception de fonds par l’artisan.",
  aggregate_payout_unallocated: "Versement bancaire agrégé : son montant n’est jamais réparti entre dossiers.",
  fee_reference_not_bound: "Commission conservée sans rattachement automatique (aucune référence immuable enregistrée).",
  dispute_reference_not_bound: "Contestation conservée sans rattachement automatique (aucune référence immuable enregistrée).",
};
export const COPY = {
  title: "Observations du fournisseur de paiement",
  intro: "Événements signés reçus du fournisseur et enregistrés par notre serveur, avec le résultat du rapprochement automatique. Une observation n’est ni un paiement, ni un versement, ni un remboursement : « associée » signifie seulement que l’événement correspond au transfert déjà enregistré pour un dossier. Aucune requête n’est envoyée au fournisseur depuis ce navigateur.",
  paging: "Pages de 50 au plus, ordonnées par identifiant d’événement — ni un solde, ni un ordre bancaire. Seuls les événements reçus et enregistrés apparaissent.",
  empty: "Aucune observation sur cette page pour ce filtre.",
  lastPage: "Pas de page suivante pour ce filtre au moment de la lecture.",
  loading: "Lecture des observations…",
  loadFailed: "Les observations n’ont pas pu être vérifiées. Réessayez.",
  forbidden: "Accès refusé par le serveur : la lecture des observations nécessite le droit finance en lecture.",
  notFound: "Observation introuvable.",
  demo: "En démonstration, aucune observation n’est lue et aucune revue n’est enregistrée : aucun appel n’est fait.",
  readOnly: "Lecture seule : enregistrer une revue nécessite les droits finance en lecture et en écriture.",
  reviewExplain: "La revue enregistre votre note et relance l’association automatique avec les références déjà enregistrées. Elle ne crée aucun paiement, transfert ni remboursement, ne force aucun rattachement, et une note n’est pas une preuve bancaire : l’observation peut rester « à examiner ».",
  reread: "Relire depuis notre serveur",
  noteRequired: "Saisissez une note (2000 caractères au plus).",
  sending: "Enregistrement de la revue…",
  saved: "Revue enregistrée. Résultat renvoyé par le serveur ci-dessous ; détail relu.",
  replayed: "Revue déjà enregistrée (même commande) : le reçu décrit la revue passée. Détail relu.",
  conflict: "L’observation a changé entre-temps ou la commande ne correspond plus : rien n’est renvoyé automatiquement. Le détail a été relu ; votre note est conservée.",
  invalid: "Le serveur refuse cette revue : vérifiez la note.",
  retry: "La revue n’est pas confirmée. Réessayez : la même commande sera renvoyée, sans doublon.",
  restored: "Une revue envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou abandonnez-la.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : la revue ne peut pas être envoyée d’ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
} as const;
export function statusError(status: number, retryAfterS: number | null): string {
  if (status === 401) return "Session expirée : reconnectez-vous.";
  if (status === 403) return COPY.forbidden;
  if (status === 404) return COPY.notFound;
  if (status === 422) return "Requête refusée par le serveur (filtre ou identifiant invalide).";
  if (status === 429) return retryAfterS ? `Trop de demandes : réessayez dans ${retryAfterS} s.` : "Trop de demandes : réessayez dans quelques instants.";
  if (status === 503) return retryAfterS ? `Rapprochement à vérifier côté serveur : réessayez dans ${retryAfterS} s.` : "Rapprochement à vérifier côté serveur : réessayez.";
  return COPY.loadFailed;
}
/** Exact amount in the smallest unit; EUR shown in euros by string arithmetic (never floats). */
export function amountText(amount: number, currency: string): string {
  if (currency === "eur") {
    const d = String(amount).padStart(3, "0");
    return `${d.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${d.slice(-2)} €`;
  }
  return `${amount} (plus petite unité) ${currency.toUpperCase()}`;
}

// ---- Review command: identity-fenced ----------------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-reconciliation:";
export const pendingKey = (uid: string | null, gen: number, eventId: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${eventId}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), event_id: eventId, command: reviewCommand }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export type DetailView = {
  phase: "loading" | "ready" | "error" | "forbidden";
  data: Detail | null;
  busy: boolean;
  error: string;
  notice: string;
  receipt: Receipt | null;
  pending: ReviewCommand | null;
  waitS: number | null;
};
export const DETAIL_INITIAL: DetailView = { phase: "loading", data: null, busy: false, error: "", notice: "", receipt: null, pending: null, waitS: null };

export function createDetail({ id, fetcher, store, newId, context, get, set }: { id: string; fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; get: () => DetailView; set: (v: DetailView) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const same = (a: { uid: string | null; gen: number }) => context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen, id)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...DETAIL_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++loadSeq;
    const who = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await timed(fetcher(), detailUrl(id), { method: "GET" });
    if (my !== loadSeq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const d = r.status === 200 ? parseDetail(r.body, id) : null;
    if (!d) return set({ ...get(), phase: get().data ? get().phase : "error", error: statusError(r.status === 200 ? 0 : r.status, r.retryAfterS) });
    set({ ...get(), phase: "ready", data: d, error: get().phase === "error" ? "" : get().error }); // keep a command error (409…) after the reload
  };
  const persist = (cmd: ReviewCommand, who: { uid: string | null; gen: number }): boolean => {
    if (!who.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen, id);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, event_id: id, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: ReviewCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "", waitS: null, receipt: null });
    let r: Result;
    try {
      r = await timed(fetcher(), detailUrl(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // identity changed: reply dropped, never replayed
    const ok = r.status === 200 ? parseReceipt(r.body, id, cmd.expected_version) : null;
    if (ok) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, receipt: ok, notice: ok.replayed ? COPY.replayed : COPY.saved });
      await load();
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400 || r.status === 404) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: r.status === 429 || r.status === 503 ? `${statusError(r.status, r.retryAfterS)} ${COPY.retry}` : COPY.retry, waitS: r.status === 429 || r.status === 503 ? r.retryAfterS : null });
    return false;
  };
  return {
    load,
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, id);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof stored> | null = null;
      try {
        const r = stored.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== who.uid || parsed.gen !== who.gen || parsed.event_id !== id) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: parsed.command, error: COPY.restored });
    },
    /** New review on the version displayed. */
    review(note: string): Promise<boolean> {
      const data = get().data;
      if (!data || get().pending || inFlight) return Promise.resolve(false);
      const trimmed = note.trim();
      if (!trimmed || trimmed.length > 2000) {
        set({ ...get(), error: COPY.noteRequired });
        return Promise.resolve(false);
      }
      const cid = safe(newId) ?? null;
      if (!cid) {
        set({ ...get(), error: COPY.noUuid });
        return Promise.resolve(false);
      }
      const cmd = reviewCommand.safeParse({ command_id: cid, expected_version: data.record.version, note: trimmed });
      if (!cmd.success) {
        set({ ...get(), error: COPY.invalid });
        return Promise.resolve(false);
      }
      return send(cmd.data);
    },
    retry(): Promise<boolean> {
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
    discard() {
      clearStored();
      pendingFor = null;
      set({ ...get(), pending: null, error: "", waitS: null });
    },
  };
}
