// Account data (SYS-09 / PUB-10) — pure model, no React. Contract: STRICT COPY of
// app/api/profile/data/route.ts from ROOT e541656 (that commit also edits MISSIONS.md, so it is not
// cherry-picked into this UI branch; the route file itself is never imported here).
//   GET  /api/profile/data?section=account|addresses|requests|messages|documents|support[&after=UUID]
//        → { section, data, next_cursor: null } (account) | { section, rows: [...], next_cursor: UUID|null }
//        100 rows per page, ascending id; authenticated, `Cache-Control: private, no-store`.
//   POST /api/profile/data { action: "request_erasure", request_id: UUID, confirmed: true }
//        → { ticket_id, status, replayed } through the existing support tickets. NOTHING is erased.
// Organisation dossiers and third-party messages are not part of the personal download (MISSIONS SYS-09).
import { z } from "zod";

export const DATA_PATH = "/api/profile/data";
export const AD_TIMEOUT_MS = 15_000;
export const AD_TIMEOUT = -1;
export const PAGE_SIZE = 100;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export type Context = { generation(): number; userId(): string | null };

export const SECTIONS = ["account", "addresses", "requests", "messages", "documents", "support"] as const;
export type Section = (typeof SECTIONS)[number];
export type PagedSection = Exclude<Section, "account">;
export const SECTION_LABEL: Record<Section, string> = {
  account: "Compte et préférences",
  addresses: "Adresses enregistrées",
  requests: "Demandes d’intervention personnelles",
  messages: "Messages que vous avez écrits",
  documents: "Documents dont vous êtes propriétaire",
  support: "Demandes d’assistance",
};

const uuid = z.string().uuid();
// Field lists copied verbatim from the route (the server projects exactly these keys).
const FIELDS: Record<PagedSection, { owner: string; fields: string }> = {
  addresses: { owner: "user_id", fields: "id,user_id,label,first_name,last_name,address,postal_code,city,country_code,latitude,longitude,geo_source,is_preferred,created_at,updated_at,archived_at" },
  requests: { owner: "client_id", fields: "id,client_id,site_id,category,description,address,postal_code,city,urgency,status,created_at,updated_at" },
  messages: { owner: "author_id", fields: "id,author_id,intervention_id,body,created_at" },
  documents: { owner: "owner_id", fields: "id,owner_id,intervention_id,name,mime_type,created_at" },
  support: { owner: "creator_id", fields: "id,creator_id,intervention_id,subject,status,created_at,updated_at" },
};
const ACCOUNT_FIELDS = "id,full_name,phone,role,created_at".split(",");
const PREFERENCES_FIELDS = "user_id,muted_kinds,email_enabled,sms_enabled,push_enabled,updated_at".split(",");

type Row = Record<string, unknown>;
const isRecord = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const exactKeys = (v: unknown, keys: string[]): v is Row => isRecord(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

export type AccountData = { email: string | null; verified_phone: string | null; profile: Row; notification_preferences: Row | null };
/** The account section must be exactly the route's projection. */
export function parseAccount(body: unknown): AccountData | null {
  if (!exactKeys(body, ["section", "data", "next_cursor"]) || body.section !== "account" || body.next_cursor !== null) return null;
  const d = body.data;
  if (!exactKeys(d, ["email", "verified_phone", "profile", "notification_preferences"])) return null;
  if ((d.email !== null && typeof d.email !== "string") || (d.verified_phone !== null && typeof d.verified_phone !== "string")) return null;
  if (!exactKeys(d.profile, ACCOUNT_FIELDS) || !uuid.safeParse(d.profile.id).success) return null;
  const prefs = d.notification_preferences;
  if (prefs !== null && (!exactKeys(prefs, PREFERENCES_FIELDS) || prefs.user_id !== d.profile.id)) return null;
  return d as AccountData;
}
/** A page answers exactly the request: same section, owner = the account, ids strictly after the cursor. */
export function parsePage(body: unknown, section: PagedSection, after: string | null, ownerId: string): { rows: Row[]; next: string | null } | null {
  if (!exactKeys(body, ["section", "rows", "next_cursor"]) || body.section !== section || !Array.isArray(body.rows)) return null;
  const rows = body.rows as unknown[];
  if (rows.length > PAGE_SIZE) return null;
  const { owner, fields } = FIELDS[section];
  const keys = fields.split(",");
  let previous = after?.toLowerCase() ?? "";
  for (const r of rows) {
    if (!exactKeys(r, keys) || r[owner] !== ownerId || !uuid.safeParse(r.id).success) return null;
    const id = String(r.id).toLowerCase();
    if (id <= previous) return null;
    if (section === "requests" && r.site_id !== null) return null;
    previous = id;
  }
  const next = body.next_cursor;
  if (next !== null && (typeof next !== "string" || rows.length !== PAGE_SIZE || next.toLowerCase() !== previous)) return null;
  return { rows: rows as Row[], next: next as string | null };
}

export const dataUrl = (section: Section, after: string | null): string =>
  `${DATA_PATH}?section=${section}${after ? `&after=${encodeURIComponent(after)}` : ""}`;

const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = AD_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: AD_TIMEOUT, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? AD_TIMEOUT : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const COPY = {
  title: "Mes données",
  intro: "Téléchargez une copie des données personnelles liées à votre compte, ou demandez leur effacement.",
  scope: "Le fichier JSON contient votre compte, vos préférences de notification, vos adresses, vos demandes d’intervention personnelles, les messages que vous avez écrits, vos documents et vos demandes d’assistance. Les dossiers d’une organisation et les messages écrits par d’autres personnes n’en font pas partie.",
  download: "Télécharger mes données",
  collecting: "Collecte en cours…",
  done: (name: string) => `Fichier « ${name} » généré sur cet appareil. Il n’est conservé nulle part ailleurs.`,
  aborted: "Le compte actif a changé pendant la collecte : elle a été interrompue et aucun fichier n’a été enregistré.",
  offContract: "Réponse inattendue du serveur : la collecte est interrompue, aucun fichier n’a été enregistré.",
  erasure: "Demander l’effacement",
  erasureExplain: "Cette demande ouvre un ticket auprès de l’assistance de la plateforme, qui examinera l’effacement des données personnelles de votre compte. Aucune donnée n’est effacée à ce stade : l’effacement effectif et les durées de conservation sont traités séparément, et vous suivez la demande dans l’assistance.",
  erasureConfirm: "Confirmer la demande d’effacement",
  cancel: "Annuler",
  erasureSending: "Envoi de la demande…",
  erasureDone: "Demande d’effacement enregistrée : un ticket d’assistance est ouvert. Aucune donnée n’a été effacée à ce stade.",
  erasureReplayed: "Demande déjà déposée : c’est le même ticket d’assistance. Aucune donnée n’a été effacée à ce stade.",
  openTicket: "Voir le ticket d’assistance",
  erasureRetry: "La demande n’est pas confirmée. Réessayez : la même demande sera renvoyée, sans doublon.",
  erasureConflict: "La demande n’a pas pu être enregistrée en l’état : rien n’est renvoyé automatiquement. Consultez l’assistance avant de recommencer.",
  erasureInvalid: "Le serveur refuse cette demande : rien n’a été enregistré.",
  pendingRestored: "Une demande d’effacement envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même demande, sans doublon).",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : la demande ne peut pas être envoyée d’ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  demo: "En démonstration, aucune donnée n’est lue ni téléchargée et aucune demande d’effacement n’est envoyée. Connecté, vous pourrez télécharger vos données et demander leur effacement (via un ticket d’assistance ; rien n’est effacé immédiatement).",
} as const;
export const TICKET_STATUS: Record<"open" | "in_progress" | "awaiting_user" | "resolved", string> = {
  open: "ouvert",
  in_progress: "en cours de traitement",
  awaiting_user: "en attente de votre réponse",
  resolved: "résolu",
};
/** Honest message per status (download or erasure). */
export function statusError(status: number, retryAfterS: number | null): string {
  if (status === 401) return "Session expirée : reconnectez-vous. Rien n’a été enregistré.";
  if (status === 403) return "Accès refusé par le serveur pour ce compte. Rien n’a été enregistré.";
  if (status === 404) return "Service des données du compte introuvable. Rien n’a été enregistré.";
  if (status === 422) return "Requête refusée par le serveur (paramètres invalides). Rien n’a été enregistré.";
  if (status === 429) return retryAfterS ? `Trop de demandes : réessayez dans ${retryAfterS} s.` : "Trop de demandes : réessayez dans quelques instants.";
  if (status === 503) return retryAfterS ? `Service momentanément indisponible : réessayez dans ${retryAfterS} s.` : "Service momentanément indisponible : réessayez plus tard.";
  if (status === AD_TIMEOUT) return "Délai dépassé : réessayez.";
  return "La réponse n’a pas pu être vérifiée : réessayez.";
}

// ---- Download: every section, every page, one JSON file ---------------------------------------------
export type SectionProgress = { status: "pending" | "loading" | "done" | "error"; rows: number };
export type CollectState = {
  phase: "idle" | "collecting" | "error" | "done" | "aborted";
  progress: Record<Section, SectionProgress>;
  error: string;
  waitS: number | null;
  filename: string;
};
export const initialProgress = (): Record<Section, SectionProgress> =>
  Object.fromEntries(SECTIONS.map((s) => [s, { status: "pending", rows: 0 }])) as Record<Section, SectionProgress>;
export const COLLECT_INITIAL: CollectState = { phase: "idle", progress: initialProgress(), error: "", waitS: null, filename: "" };
export type Collected = { account: AccountData | null; rows: Record<PagedSection, Row[]> };
export const exportFilename = (now: Date) => `mes-donnees-${now.toISOString().slice(0, 10)}.json`;
export function exportDocument(c: Collected, now: Date) {
  return {
    exported_at: now.toISOString(),
    source: DATA_PATH,
    note: "Copie des données personnelles du compte au moment de l’export. Les dossiers d’organisation et les messages de tiers sont exclus.",
    account: c.account,
    addresses: c.rows.addresses,
    requests: c.rows.requests,
    messages: c.rows.messages,
    documents: c.rows.documents,
    support: c.rows.support,
  };
}

/**
 * Collector: account first (it gives the owner id), then each paged section until next_cursor is
 * null. A page is appended only once validated, and the cursor advances only then, so « Réessayer »
 * resumes at the failed section / cursor without duplicating rows. uid + generation are checked after
 * every await: a change aborts, discards everything and saves nothing.
 */
export function createCollector({ fetcher, context, save, now = () => new Date(), set }: { fetcher: typeof fetch; context: Context; save: (json: string, filename: string) => void; now?: () => Date; set: (s: CollectState) => void }) {
  let state: CollectState = { ...COLLECT_INITIAL, progress: initialProgress() };
  let collected: Collected | null = null;
  let owner: { uid: string | null; gen: number } | null = null;
  let position: { index: number; cursor: string | null } = { index: 0, cursor: null };
  let running = false;
  let alive = true;
  const emit = (patch: Partial<CollectState>) => {
    state = { ...state, ...patch };
    if (alive) set(state);
  };
  const mark = (s: Section, p: Partial<SectionProgress>) => emit({ progress: { ...state.progress, [s]: { ...state.progress[s], ...p } } });
  const reset = () => {
    collected = null;
    owner = null;
    position = { index: 0, cursor: null };
  };
  const same = (o: { uid: string | null; gen: number }) => context.userId() === o.uid && context.generation() === o.gen;
  return {
    get: () => state,
    dispose() {
      alive = false;
    },
    async run() {
      if (running) return;
      const me = { uid: context.userId(), gen: context.generation() };
      // A resume only continues the same identity's partial collection.
      if (!owner || owner.uid !== me.uid || owner.gen !== me.gen) {
        reset();
        owner = me;
        collected = { account: null, rows: { addresses: [], requests: [], messages: [], documents: [], support: [] } };
        state = { ...state, progress: initialProgress() };
      }
      running = true;
      emit({ phase: "collecting", error: "", waitS: null, filename: "" });
      try {
        while (position.index < SECTIONS.length) {
          const section = SECTIONS[position.index];
          mark(section, { status: "loading" });
          const r = await timed(fetcher, dataUrl(section, section === "account" ? null : position.cursor), { method: "GET" });
          if (!alive) return;
          if (!same(me)) {
            reset();
            emit({ phase: "aborted", progress: initialProgress(), error: "", waitS: null });
            return;
          }
          if (r.status !== 200) {
            mark(section, { status: "error" });
            if (r.status === 401 || r.status === 403) reset();
            emit({ phase: "error", error: statusError(r.status, r.retryAfterS), waitS: r.status === 429 || r.status === 503 ? r.retryAfterS : null });
            return;
          }
          if (section === "account") {
            const account = parseAccount(r.body);
            if (!account) {
              mark(section, { status: "error" });
              emit({ phase: "error", error: COPY.offContract, waitS: null });
              return;
            }
            collected!.account = account;
            mark(section, { status: "done", rows: 1 });
            position = { index: position.index + 1, cursor: null };
            continue;
          }
          const ownerId = String(collected!.account!.profile.id);
          const page = parsePage(r.body, section, position.cursor, ownerId);
          if (!page) {
            mark(section, { status: "error" });
            emit({ phase: "error", error: COPY.offContract, waitS: null });
            return;
          }
          collected!.rows[section].push(...page.rows);
          if (page.next) {
            position = { index: position.index, cursor: page.next };
            mark(section, { status: "loading", rows: collected!.rows[section].length });
          } else {
            position = { index: position.index + 1, cursor: null };
            mark(section, { status: "done", rows: collected!.rows[section].length });
          }
        }
        if (!same(me)) {
          reset();
          emit({ phase: "aborted", progress: initialProgress(), error: "", waitS: null });
          return;
        }
        const at = now();
        const filename = exportFilename(at);
        save(JSON.stringify(exportDocument(collected!, at), null, 2), filename);
        reset();
        emit({ phase: "done", filename });
      } finally {
        running = false;
      }
    },
  };
}

// ---- Erasure request: identity-fenced command ------------------------------------------------------
const receipt = z.object({ ticket_id: uuid, status: z.enum(["open", "in_progress", "awaiting_user", "resolved"]), replayed: z.boolean() }).strict();
export type Receipt = z.infer<typeof receipt>;
export const parseReceipt = (body: unknown): Receipt | null => {
  const r = receipt.safeParse(body);
  return r.success ? r.data : null;
};
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export const PENDING_KEY = "account-erasure-pending";
export const pendingKey = (uid: string | null, gen: number) => `${PENDING_KEY}:${uid ?? "-"}:${gen}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), request_id: uuid }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export type ErasureState = {
  phase: "idle" | "confirming" | "sending" | "done" | "error";
  pending: string | null;
  receipt: Receipt | null;
  error: string;
  /** true ⇒ « Réessayer » re-sends the same request_id. */
  retry: boolean;
  waitS: number | null;
};
export const ERASURE_INITIAL: ErasureState = { phase: "idle", pending: null, receipt: null, error: "", retry: false, waitS: null };

export function createErasure({ fetcher, store, newId, context, set }: { fetcher: typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; set: (s: ErasureState) => void }) {
  let state: ErasureState = { ...ERASURE_INITIAL };
  let inFlight = false;
  let alive = true;
  const emit = (patch: Partial<ErasureState>) => {
    state = { ...state, ...patch };
    if (alive) set(state);
  };
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const read = (uid: string, gen: number): string | null => {
    const raw = safe(() => store()?.get(pendingKey(uid, gen)) ?? null);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const r = stored.safeParse(parsed);
    return r.success && r.data.uid === uid && r.data.gen === gen ? r.data.request_id : null;
  };
  const clear = (uid: string | null, gen: number) => safe(() => store()?.remove(pendingKey(uid, gen)));
  return {
    get: () => state,
    dispose() {
      alive = false;
    },
    /** Strict restore of an unconfirmed request of THIS identity (never another account's). */
    restore() {
      const uid = context.userId();
      if (!uid) return;
      const id = read(uid, context.generation());
      if (id) emit({ phase: "error", pending: id, error: COPY.pendingRestored, retry: true });
    },
    ask() {
      if (state.phase === "idle" || (state.phase === "error" && !state.retry)) emit({ phase: "confirming", error: "" });
    },
    cancel() {
      if (state.phase === "confirming") emit({ phase: "idle" });
    },
    async send() {
      if (inFlight) return;
      if (state.phase !== "confirming" && !(state.phase === "error" && state.retry)) return;
      const uid = context.userId(), gen = context.generation();
      if (!uid) return emit({ phase: "error", error: statusError(401, null), retry: false });
      let requestId = state.retry ? state.pending : null;
      if (requestId && read(uid, gen) !== requestId) requestId = null; // fence: only this identity's own pending command
      if (!requestId) {
        const id = safe(newId) ?? null;
        if (!id) return emit({ phase: "error", error: COPY.noUuid, retry: false });
        const s = safe(store);
        if (!s) return emit({ phase: "error", error: COPY.storage, retry: false });
        safe(() => s.set(pendingKey(uid, gen), JSON.stringify({ uid, gen, request_id: id })));
        if (read(uid, gen) !== id) return emit({ phase: "error", error: COPY.storage, retry: false }); // read-back or 0 POST
        requestId = id;
      }
      inFlight = true;
      emit({ phase: "sending", pending: requestId, error: "", waitS: null });
      const r = await timed(fetcher, DATA_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_erasure", request_id: requestId, confirmed: true }) });
      inFlight = false;
      if (!alive) return;
      if (context.userId() !== uid || context.generation() !== gen) {
        // Identity changed: the reply is dropped; the pending command stays fenced to its own identity.
        return emit({ ...ERASURE_INITIAL });
      }
      const ok = r.status === 200 ? parseReceipt(r.body) : null;
      if (ok) {
        clear(uid, gen);
        return emit({ phase: "done", pending: null, receipt: ok, error: "", retry: false });
      }
      if (r.status === 401 || r.status === 403) {
        clear(uid, gen);
        return emit({ phase: "error", pending: null, error: statusError(r.status, null), retry: false });
      }
      if (r.status === 409) {
        clear(uid, gen);
        return emit({ phase: "error", pending: null, error: COPY.erasureConflict, retry: false });
      }
      if (r.status === 422 || r.status === 404) {
        clear(uid, gen);
        return emit({ phase: "error", pending: null, error: r.status === 404 ? statusError(404, null) : COPY.erasureInvalid, retry: false });
      }
      // 503 / 429 / lost reply / off-contract 200: same command on retry.
      emit({ phase: "error", pending: requestId, error: r.status === 503 || r.status === 429 ? `${statusError(r.status, r.retryAfterS)} ${COPY.erasureRetry}` : COPY.erasureRetry, retry: true, waitS: r.retryAfterS });
    },
  };
}
