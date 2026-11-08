// ADM-10 corrective dossier of a warranty case — pure model (no React). Contract (ROOT, backend in
// parallel; strict schemas here, api injectable):
//   GET  /api/warranty                         → { cases: [{ id, intervention_id, status, created_at, … }], … }
//   GET  /api/warranty/{case_id}/corrective    → { link: null | Dossier, candidates: Dossier[], has_more }
//        Dossier = { id, category, status, created_at }. Candidates are listed for Super Admin only
//        (newer dossiers of the same requester and site); no access is granted by this list.
//   POST /api/warranty/{case_id}/corrective { intervention_id } → { link: Dossier, replayed } (backend
//        ef31206): links an EXISTING eligible dossier (a listed candidate or another eligible one — the
//        server decides), only while the case is « En cours d’examen »; replayed:true ⇒ already linked;
//        409 / 422 on refusal. Candidates capped at 30 with has_more. Nothing is created automatically,
//        no price, no financial act.
// Identity fence (same as the warranty-policy editor): the command is written to tab storage and
// read back BEFORE the POST (else 0 POST), keyed by uid + generation + case, restored only by strict
// parse for the same identity, never replayed after an identity change; 401/403 clear everything.
// A 2xx is never trusted alone: success = the re-read GET shows the target as the link.
import { z } from "zod";

export const WC_TIMEOUT_MS = 15_000;
export const WC_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = z.string().regex(UUID);
const instant = z.string().refine((v) => /T.*(Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
export const CASE_STATUSES = ["submitted", "reviewing", "resolved", "declined"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
const caseRow = z.object({ id, intervention_id: id, status: z.enum(CASE_STATUSES), created_at: instant }).passthrough();
export type WarrantyCaseRow = { id: string; intervention_id: string; status: CaseStatus; created_at: string };
const dossier = z
  .object({
    id,
    category: z.enum(["outage", "panel", "socket", "lighting", "diagnostic"]),
    status: z.enum(["requested", "assigned", "quoted", "accepted", "in_progress", "completed", "paid", "cancelled"]),
    created_at: instant,
  })
  .strict();
export type Dossier = z.infer<typeof dossier>;
const corrective = z.object({ link: dossier.nullable(), candidates: z.array(dossier).max(30), has_more: z.boolean() }).strict();
const receipt = z.object({ link: dossier, replayed: z.boolean() }).strict();
/** POST receipt for exactly this target; null otherwise (unknown outcome). */
export function parseReceipt(body: unknown, target: string): { link: Dossier; replayed: boolean } | null {
  const r = receipt.safeParse(body);
  return r.success && r.data.link.id.toLowerCase() === target.toLowerCase() ? r.data : null;
}
export type Corrective = z.infer<typeof corrective>;

export function parseCases(body: unknown): WarrantyCaseRow[] | null {
  const r = z.object({ cases: z.array(caseRow).max(100) }).passthrough().safeParse(body);
  return r.success ? r.data.cases.map((c) => ({ id: c.id, intervention_id: c.intervention_id, status: c.status, created_at: c.created_at })) : null;
}
/** Next page cursor of the global history read (null = last page / absent); undefined if malformed. */
export function parseNextCursor(body: unknown): string | null | undefined {
  const r = z.object({ next_cursor: z.string().min(1).max(2048).nullable().optional() }).passthrough().safeParse(body);
  return r.success ? (r.data.next_cursor ?? null) : undefined;
}
export function parseCorrective(body: unknown): Corrective | null {
  const r = corrective.safeParse(body);
  if (!r.success) return null;
  const ids = r.data.candidates.map((c) => c.id.toLowerCase());
  if (new Set(ids).size !== ids.length) return null;
  return r.data;
}

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: WC_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? WC_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type CorrectiveApi = { cases(cursor?: string | null): Promise<Result>; read(caseId: string): Promise<Result>; link(caseId: string, interventionId: string): Promise<Result> };
export const correctivePath = (caseId: string) => `/api/warranty/${encodeURIComponent(caseId)}/corrective`;
export function createCorrectiveApi(fetcher: typeof fetch = (...a) => fetch(...a)): CorrectiveApi {
  return {
    // ADM-10 history contract (b8301be): global read, opaque next_cursor followed as is.
    cases: (cursor) => timed(fetcher, cursor ? `/api/warranty?cursor=${encodeURIComponent(cursor)}` : "/api/warranty", { method: "GET" }, WC_TIMEOUT_MS),
    read: (caseId) => timed(fetcher, correctivePath(caseId), { method: "GET" }, WC_TIMEOUT_MS),
    link: (caseId, interventionId) => timed(fetcher, correctivePath(caseId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervention_id: interventionId }) }, WC_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_KEY = "warranty-corrective-pending";
export const pendingKey = (uid: string | null, generation: number, caseId: string) => `${PENDING_KEY}:${uid ?? "-"}:${generation}:${caseId.toLowerCase()}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), case_id: id, intervention_id: id }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

export const COPY = {
  title: "Dossier correctif",
  loading: "Lecture du dossier correctif…",
  loadFailed: "Le dossier correctif n’a pas pu être lu. Réessayez.",
  casesLoading: "Lecture des demandes de garantie…",
  casesFailed: "Les demandes de garantie n’ont pas pu être lues. Réessayez.",
  noCases: "Aucune demande de garantie à rattacher.",
  forbidden: "Vos droits, vérifiés par le serveur, ne permettent pas de consulter ce rattachement.",
  demo: "En démonstration, aucun dossier correctif n’est lu ni rattaché.",
  none: "Aucun dossier correctif rattaché.",
  linked: "Dossier correctif rattaché :",
  candidatesTitle: "Dossiers existants du même demandeur et du même site (plus récents)",
  noCandidates: "Aucun dossier existant ne peut être rattaché pour l’instant.",
  more: "D’autres dossiers existent : seuls les premiers sont affichés.",
  notReviewing: "Rattachement possible seulement quand la demande est « En cours d’examen ». Passez d’abord la décision à cet état.",
  superAdminOnly: "Les dossiers candidats sont proposés aux super-administrateurs uniquement.",
  noAccessGranted: "Rattacher un dossier n’ouvre aucun accès supplémentaire, ne fixe aucun prix et ne crée aucun acte financier.",
  confirm: (job: string, kase: string) => `Rattacher le dossier existant ${job} comme intervention corrective de la demande de garantie ${kase} ? Aucun dossier ni devis n’est créé automatiquement, aucun prix ni paiement.`,
  saved: "Dossier correctif rattaché.",
  replayed: "Ce dossier était déjà rattaché à cette demande : l’état a été relu.",
  otherLabel: "Ou l’identifiant d’un autre dossier existant (le serveur vérifie qu’il est éligible)",
  otherInvalid: "Identifiant de dossier invalide.",
  conflict: "Le rattachement a changé entre-temps ou n’est plus possible : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse ce rattachement.",
  notFound: "Cette demande de garantie ou ce dossier est introuvable.",
  retry: "Le rattachement n’est pas confirmé. Réessayez : la même commande (même dossier) sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
} as const;
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = { submitted: "Transmise", reviewing: "En cours d’examen", resolved: "Résolue", declined: "Refusée" };

// ---- Per-case controller ---------------------------------------------------------------------------
export type CaseView = { phase: "loading" | "ready" | "error" | "forbidden"; data: Corrective | null; busy: boolean; error: string; notice: string; pending: string | null };
export const CASE_INITIAL: CaseView = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null };
export const canLink = (superAdmin: boolean, status: CaseStatus, v: CaseView) => superAdmin && status === "reviewing" && v.phase === "ready" && !!v.data && v.data.link === null && !v.busy && !v.pending;

export function createCaseController({ api, caseId, store, context, get, set }: { api: () => CorrectiveApi; caseId: string; store: () => Store | null; context: Context; get: () => CaseView; set: (v: CaseView) => void }) {
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
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen, caseId)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...CASE_INITIAL, phase: "forbidden" });
  };
  const load = async (): Promise<Corrective | null> => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await api().read(caseId);
    if (my !== seq || !same(who)) return null;
    if (r.status === 401 || r.status === 403) {
      forbid();
      return null;
    }
    const data = r.status === 200 ? parseCorrective(r.body) : null;
    if (!data) {
      set({ ...get(), phase: "error", error: COPY.loadFailed });
      return null;
    }
    set({ ...get(), phase: "ready", data });
    return data;
  };
  const persist = (target: string, who: { uid: string | null; gen: number }) => {
    if (!who.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen, caseId);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, case_id: caseId.toLowerCase(), intervention_id: target.toLowerCase() });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (target: string): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!same(who) || !persist(target, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    seq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().link(caseId, target.toLowerCase());
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // identity changed while waiting: never applied, never replayed
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status >= 200 && r.status < 300) {
      const receiptOk = parseReceipt(r.body, target);
      set({ ...get(), busy: false });
      const now = await load(); // the server state, not the reply alone, proves the link
      if (!same(who)) return false;
      if (receiptOk && now?.link && now.link.id.toLowerCase() === target.toLowerCase()) {
        clearStored(who);
        pendingFor = null;
        set({ ...get(), pending: null, error: "", notice: receiptOk.replayed ? COPY.replayed : COPY.saved });
        return true;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: target.toLowerCase(), error: COPY.retry });
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400 || r.status === 404) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : r.status === 404 ? COPY.notFound : COPY.invalid });
      if (r.status === 409) await load(); // re-read only, never a replay
      return false;
    }
    pendingFor = `${who.uid}|${who.gen}`;
    set({ ...get(), busy: false, pending: target.toLowerCase(), error: COPY.retry });
    return false;
  };
  return {
    load,
    /** Offered again for the same identity only (strict parse), never sent automatically. */
    restorePending() {
      const who = identity();
      if (!who.uid) return;
      const key = pendingKey(who.uid, who.gen, caseId);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedSchema> | null = null;
      try {
        const r = storedSchema.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== who.uid || parsed.gen !== who.gen || parsed.case_id !== caseId.toLowerCase()) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: parsed.intervention_id, error: COPY.retry });
    },
    /** Explicit, confirmed by the panel, only « En cours d’examen ». Any well-formed dossier id: the
     *  server decides eligibility (no pre-filter beyond what it returns). */
    link(superAdmin: boolean, status: CaseStatus, target: string) {
      if (!UUID.test(target.trim()) || !canLink(superAdmin, status, get())) return Promise.resolve(false);
      return send(target.trim());
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
    detach() {
      alive = false;
    },
  };
}
