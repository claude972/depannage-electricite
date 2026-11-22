// SYS-10 photo review — pure model (no React). Contract: strict browser copy of ROOT assembly 12f62f2
// (lib/features/photo-triage/handlers.ts + provider.ts — server-only, node:crypto — and
// app/api/interventions/[id]/photo-review/route.ts):
//   GET  /api/interventions/:id/photo-review → View
//   POST same path → View (the SAME shape), with
//        { action:"request", document_id, command_id, expected_version, consent: true }
//        { action:"withdraw", review_id, command_id, expected_version }
//        { action:"review", review_id, command_id, expected_version, decision: "validate"|"reject" }
//   View = { provider_available, can_request, items:[{ id, document_id, version, status, can_withdraw,
//            can_review, result: null | { category, readability } }] }
// Fixed labels only (no free text anywhere). The client sees a result only when status is `validated`
// (human validation) AND the server returns it. Nothing here is a diagnosis or a promise.
// Identity fence under `courant-private-photo-review:` (write + read-back or 0 POST, uid + generation
// + dossier, strict restore never auto-sent, no replay after an identity change, 401/403 clear).
import { z } from "zod";

export const PR_TIMEOUT_MS = 15_000;
export const PR_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(UUID);
export const STATUSES = ["requested", "withdrawn", "uncertain", "awaiting_review", "validated", "rejected", "invalidated"] as const;
export type PrStatus = (typeof STATUSES)[number];
export const CATEGORIES = ["panel", "socket", "lighting", "other", "undetermined"] as const;
export const READABILITY = ["readable", "limited", "unusable"] as const;
const item = z
  .object({
    id: uuid,
    document_id: uuid,
    version: z.number().int().positive(),
    status: z.enum(STATUSES),
    can_withdraw: z.boolean(),
    can_review: z.boolean(),
    result: z.object({ category: z.enum(CATEGORIES), readability: z.enum(READABILITY) }).strict().nullable(),
  })
  .strict();
export type PrItem = z.infer<typeof item>;
const view = z.object({ provider_available: z.boolean(), can_request: z.boolean(), items: z.array(item).max(20) }).strict();
export type PrView = z.infer<typeof view>;
const writableVersion = z.number().int().min(0).max(2147483646);
const requestCmd = z.object({ action: z.literal("request"), document_id: uuid, command_id: uuid, expected_version: writableVersion, consent: z.literal(true) }).strict();
const withdrawCmd = z.object({ action: z.literal("withdraw"), review_id: uuid, command_id: uuid, expected_version: z.number().int().min(0).max(2147483646) }).strict();
const reviewCmd = z.object({ action: z.literal("review"), review_id: uuid, command_id: uuid, expected_version: z.number().int().min(0).max(2147483646), decision: z.enum(["validate", "reject"]) }).strict();
const command = z.union([requestCmd, withdrawCmd, reviewCmd]);
export type PrCommand = z.infer<typeof command>;
const lower = (v: string) => v.toLowerCase();
export const reviewImage = (mime: string) => ["image/jpeg", "image/png", "image/webp"].includes(mime);

export function parseView(body: unknown): PrView | null {
  const r = view.safeParse(body);
  if (!r.success) return null;
  const ids = r.data.items.map((x) => lower(x.id));
  if (new Set(ids).size !== ids.length) return null;
  if (new Set(r.data.items.map((x) => lower(x.document_id))).size !== ids.length) return null;
  // Same invariant as the server render(): a result is present exactly when the photo is validated,
  // or awaiting review for a viewer who cannot request (the assigned artisan).
  if (r.data.items.some((x) => (x.result !== null) !== (x.status === "validated" || (!r.data.can_request && x.status === "awaiting_review")))) return null;
  return r.data;
}
/** The returned view must reflect THIS command (right item, version bumped, coherent status). */
export function viewMatches(v: PrView, cmd: PrCommand): boolean {
  if (cmd.action === "request") {
    // The server verifies this exact command. A prior GET may already have observed it.
    const it = v.items.find((x) => lower(x.document_id) === lower(cmd.document_id));
    return v.can_request && !!it && it.version > cmd.expected_version && it.status !== "withdrawn" && it.status !== "invalidated";
  }
  const it = v.items.find((x) => lower(x.id) === lower(cmd.review_id));
  if (!it || it.version !== cmd.expected_version + 1) return false;
  if (cmd.action === "withdraw") return it.status === "withdrawn";
  return it.status === (cmd.decision === "validate" ? "validated" : "rejected");
}
/** The client is shown a result only after a human validation, and only if the server returns it. */
export const visibleResult = (it: PrItem, role: "client" | "artisan") => (role === "client" ? (it.status === "validated" ? it.result : null) : it.result);

export const STATUS_LABEL: Record<PrStatus, string> = {
  requested: "Demande enregistrée",
  withdrawn: "Demande retirée",
  uncertain: "Analyse non concluante : vérification humaine nécessaire",
  awaiting_review: "En attente de validation par l’artisan",
  validated: "Validée par l’artisan",
  rejected: "Écartée par l’artisan",
  invalidated: "Annulée (photo ou dossier modifié)",
};
export const CATEGORY_LABEL: Record<(typeof CATEGORIES)[number], string> = { panel: "Tableau électrique", socket: "Prise ou interrupteur", lighting: "Éclairage", other: "Autre élément", undetermined: "Élément non déterminé" };
export const READABILITY_LABEL: Record<(typeof READABILITY)[number], string> = { readable: "photo lisible", limited: "photo peu lisible", unusable: "photo inexploitable" };

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: PR_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? PR_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export type PrApi = { read(interventionId: string): Promise<Result>; send(interventionId: string, cmd: PrCommand): Promise<Result> };
export const reviewPath = (id: string) => `/api/interventions/${encodeURIComponent(id)}/photo-review`;
export function createPrApi(fetcher: typeof fetch = (...a) => fetch(...a)): PrApi {
  return {
    read: (id) => timed(fetcher, reviewPath(id), { method: "GET" }, PR_TIMEOUT_MS),
    send: (id, cmd) => timed(fetcher, reviewPath(id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) }, PR_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
export const PENDING_PREFIX = "courant-private-photo-review:";
export const pendingKey = (uid: string | null, gen: number, interventionId: string) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}:${lower(interventionId)}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), intervention_id: uuid, command }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}

export const COPY = {
  title: "Revue des photos",
  disclaimer: "Cette revue aide à trier les photos ; ce n’est ni un diagnostic ni une promesse. L’artisan décide sur place.",
  manual: "La revue manuelle des pièces reste disponible.",
  providerOff: "Revue automatique indisponible pour le moment : les demandes restent enregistrées et la revue manuelle reste accessible.",
  consent: "J’accepte que cette photo soit analysée automatiquement pour aider l’artisan ; le résultat n’est visible qu’après sa validation.",
  loading: "Lecture de la revue des photos…",
  loadFailed: "La revue des photos n’a pas pu être lue. Réessayez.",
  forbidden: "Vos droits, vérifiés par le serveur, ne couvrent pas la revue des photos de ce dossier.",
  demo: "En démonstration, aucune photo n’est analysée ni transmise.",
  none: "Aucune photo à examiner.",
  pendingHuman: "Résultat visible après validation par l’artisan.",
  conflict: "La revue a changé entre-temps : rien n’est renvoyé automatiquement. L’état actuel a été relu.",
  invalid: "Le serveur refuse cette action.",
  limited: "Trop de demandes en peu de temps : réessayez dans un instant.",
  notFound: "Cette photo ou ce dossier n’est plus accessible.",
  retry: "L’action n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  done: { request: "Demande de revue enregistrée.", withdraw: "Demande retirée.", review: "Décision enregistrée." },
} as const;

export type PrState = { phase: "loading" | "ready" | "error" | "forbidden"; view: PrView | null; busy: boolean; pending: PrCommand | null; error: string; notice: string };
export const PR_INITIAL: PrState = { phase: "loading", view: null, busy: false, pending: null, error: "", notice: "" };

export function createPrController({ api, interventionId, store, newId, context, get, set }: { api: () => PrApi; interventionId: string; store: () => Store | null; newId: () => string | null; context: Context; get: () => PrState; set: (s: PrState) => void }) {
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
    set({ ...PR_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++seq;
    const who = identity();
    set({ ...get(), phase: get().view ? get().phase : "loading" });
    const r = await api().read(interventionId);
    if (my !== seq || !same(who)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const v = r.status === 200 ? parseView(r.body) : null;
    if (!v) return set({ ...get(), phase: "error", error: COPY.loadFailed });
    set({ ...get(), phase: "ready", view: v });
  };
  const persist = (cmd: PrCommand, who: { uid: string | null; gen: number }) => {
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
  const send = async (cmd: PrCommand): Promise<boolean> => {
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
      r = await api().send(interventionId, cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false;
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    const v = r.status === 200 ? parseView(r.body) : null;
    if (v && viewMatches(v, cmd)) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, view: v, phase: "ready", notice: COPY.done[cmd.action] });
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
  const fresh = (build: (cid: string) => PrCommand | null) => {
    const s = get();
    if (s.phase !== "ready" || !s.view || s.busy || s.pending || inFlight) return Promise.resolve(false);
    const cid = newId();
    if (!cid || !UUID.test(cid)) {
      set({ ...s, error: COPY.noUuid });
      return Promise.resolve(false);
    }
    const cmd = build(lower(cid));
    return cmd ? send(cmd) : Promise.resolve(false);
  };
  return {
    load,
    /** Only with the server's top-level can_request AND the explicit consent. */
    request(documentId: string, consent: boolean) {
      // Preconditions BEFORE any identifier is created: explicit consent + server can_request.
      const v = get().view;
      if (!consent || !v?.can_request || !UUID.test(documentId)) return Promise.resolve(false);
      const previous = v.items.find((x) => lower(x.document_id) === lower(documentId));
      if (previous && previous.status !== "withdrawn") return Promise.resolve(false);
      return fresh((cid) => ({ action: "request", document_id: lower(documentId), command_id: cid, expected_version: previous?.version ?? 0, consent: true }));
    },
    withdraw(reviewId: string) {
      const it = get().view?.items.find((x) => lower(x.id) === lower(reviewId));
      if (!it?.can_withdraw) return Promise.resolve(false);
      return fresh((cid) => ({ action: "withdraw", review_id: it.id, command_id: cid, expected_version: it.version }));
    },
    review(reviewId: string, decision: "validate" | "reject") {
      const it = get().view?.items.find((x) => lower(x.id) === lower(reviewId));
      if (!it?.can_review) return Promise.resolve(false);
      return fresh((cid) => ({ action: "review", review_id: it.id, command_id: cid, expected_version: it.version, decision }));
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
      const key = pendingKey(who.uid, who.gen, interventionId);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let json: { command?: PrCommand } | null = null;
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
    stop() {
      alive = false;
    },
  };
}
