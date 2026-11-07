// PUB-06 / ADM-10 warranty conditions — pure model (no React). Contract:
// lib/features/warranty-policy/contract.ts (copied exactly from backend 8539838).
//   Public: GET /api/public/warranty-terms → { published: null | { version, title, body, published_at } }
//   Admin:  GET /api/admin/warranty-policy → { version, draft:{title,body}, published|null,
//           operator_enabled, environment_enabled, enabled }
//           POST { command_id, expected_version, action: save(title, body) | publish | enable(published_version)
//                  | disable | withdraw } → { version, action, replayed } (a receipt, not the state)
// Plain text only (never interpreted as HTML). Nothing is activated automatically: « enable » is an
// explicit operator action on the CURRENT publication; the environment guard stays separate.
// Session fence (same as the operator profile editor): the command is written to tab storage and
// read back BEFORE the POST (else 0 POST), keyed by uid + generation, restored only by strict parse
// for the same identity, never replayed after an identity / rights change; 401/403 clear all.
import { z } from "zod";
import { command, editor, published, receipt } from "../../../lib/features/warranty-policy/contract";

export const PUBLIC_TERMS_PATH = "/api/public/warranty-terms";
export const POLICY_PATH = "/api/admin/warranty-policy";
export const WP_TIMEOUT_MS = 15_000;
export const WP_TIMEOUT = -1;
export type Result = { status: number; body: unknown };
export type Published = z.infer<typeof published>;
export type PolicyCommand = z.infer<typeof command>;

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: WP_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? WP_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Public read ----------------------------------------------------------------------------------
export type PublicTermsState = { phase: "loading" | "ready" | "error"; published: Published | null };
export function parsePublicTerms(body: unknown): Published | null | undefined {
  const r = z.object({ published: published.nullable() }).strict().safeParse(body);
  return r.success ? r.data.published : undefined;
}
export async function loadPublicTerms(fetcher: typeof fetch = (...a) => fetch(...a)): Promise<PublicTermsState> {
  const r = await timed(fetcher, PUBLIC_TERMS_PATH, { method: "GET" }, WP_TIMEOUT_MS);
  const p = r.status === 200 ? parsePublicTerms(r.body) : undefined;
  return p === undefined ? { phase: "error", published: null } : { phase: "ready", published: p };
}
export const PUBLIC_COPY = {
  title: "Conditions de garantie",
  loading: "Lecture des conditions publiées…",
  error: "Les conditions publiées sont momentanément indisponibles. Aucune garantie n’est déduite de cette indisponibilité.",
  pending: "Conditions de garantie non encore publiées par l’exploitant. Aucune garantie n’est promise tant qu’elles ne sont pas publiées.",
  stamp: (p: Published) => `Version ${p.version} publiée par l’exploitant le ${new Date(p.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}.`,
} as const;

// ---- Editor ---------------------------------------------------------------------------------------
const editorView = editor.safeExtend({ environment_enabled: z.boolean(), enabled: z.boolean() }).refine((v) => v.enabled === (v.operator_enabled && v.environment_enabled));
export type PolicyData = z.infer<typeof editorView>;
export function parseEditor(body: unknown): PolicyData | null {
  const r = editorView.safeParse(body);
  return r.success ? r.data : null;
}
export type EditorApi = { load(): Promise<Result>; command(body: PolicyCommand): Promise<Result> };
export function createEditorApi(fetcher: typeof fetch = (...a) => fetch(...a)): EditorApi {
  return {
    load: () => timed(fetcher, POLICY_PATH, { method: "GET" }, WP_TIMEOUT_MS),
    command: (body) => timed(fetcher, POLICY_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, WP_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type EditorContext = { generation(): number; userId(): string | null };
export const PENDING_KEY = "warranty-policy-pending-command";
export const pendingKey = (uid: string | null, generation: number) => `${PENDING_KEY}:${uid ?? "-"}:${generation}`;
const storedSchema = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const TITLE_MAX = 160;
export const BODY_MAX = 20_000;
export const EDITOR_COPY = {
  title: "Conditions de garantie (exploitant)",
  loading: "Lecture des conditions…",
  loadFailed: "Les conditions n’ont pas pu être lues. Réessayez.",
  forbidden: "Réservé aux administrateurs de la plateforme : vos droits, vérifiés par le serveur, ne couvrent pas ces conditions.",
  demo: "En démonstration, les conditions de garantie ne sont ni lues ni enregistrées, et rien n’est activé.",
  plainText: "Texte brut uniquement : il est affiché tel quel (retours à la ligne conservés), sans mise en forme HTML.",
  conflict: "Les conditions ont changé entre-temps ou la commande a déjà servi : rien n’est renvoyé automatiquement. L’état actuel a été relu ; votre saisie est conservée.",
  invalid: "Le serveur refuse cette action : vérifiez la saisie ou l’état de la publication.",
  retry: "L’action n’est pas confirmée. Réessayez : la même commande sera renvoyée.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune action n’est possible ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique.",
  emptyDraft: "Le brouillon enregistré est vide : il ne peut pas être publié.",
  enableNote: "L’activation ouvre le dépôt de nouvelles demandes de garantie pour la version publiée affichée. Elle n’est jamais automatique ; une nouvelle publication la désactive.",
  envClosed: "La garde d’environnement du service est fermée : même activé par l’opérateur, le dépôt reste fermé.",
} as const;
export const ACTION_NOTICE: Record<PolicyCommand["action"], string> = {
  save: "Brouillon enregistré.",
  publish: "Conditions publiées. Le dépôt des demandes est désactivé jusqu’à une nouvelle activation explicite.",
  enable: "Dépôt des demandes activé pour la version publiée.",
  disable: "Dépôt des demandes désactivé. Les conditions publiées restent consultables.",
  withdraw: "Publication retirée et dépôt désactivé.",
};
export type EditorState = { phase: "loading" | "ready" | "error" | "forbidden"; data: PolicyData | null; busy: boolean; error: string; pending: PolicyCommand | null; notice: string };
export const EDITOR_INITIAL: EditorState = { phase: "loading", data: null, busy: false, error: "", pending: null, notice: "" };
export const draftPublishable = (d: PolicyData) => d.draft.title.trim().length > 0 && d.draft.body.trim().length > 0;
export function validateDraft(title: string, body: string): { title?: string; body?: string } {
  const e: { title?: string; body?: string } = {};
  if (title.trim().length > TITLE_MAX) e.title = `${TITLE_MAX} caractères maximum.`;
  if (body.trim().length > BODY_MAX) e.body = `${BODY_MAX} caractères maximum.`;
  return e;
}

export function createEditorController({ api, store, newId, context, get, set }: { api: () => EditorApi; store: () => Store | null; newId: () => string | null; context: EditorContext; get: () => EditorState; set: (s: EditorState) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  let pendingFor: string | null = null;
  let alive = true;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const sameIdentity = (a: { uid: string | null; gen: number }) => alive && context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clearStored = (id = identity()) => safe(() => store()?.remove(pendingKey(id.uid, id.gen)));
  /** 401 / 403: every sensitive copy is dropped (draft, publication, pending command). */
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...EDITOR_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++loadSeq;
    const id = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading", error: get().phase === "error" ? "" : get().error });
    const r = await api().load();
    if (my !== loadSeq || !sameIdentity(id)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const data = r.status === 200 ? parseEditor(r.body) : null;
    if (!data) return set({ ...get(), phase: "error", error: EDITOR_COPY.loadFailed });
    set({ ...get(), phase: "ready", data });
  };
  /** Write + read back; anything else (no uid, no store, throw, mismatch) refuses the POST. */
  const persist = (cmd: PolicyCommand, id: { uid: string | null; gen: number }): boolean => {
    if (!id.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(id.uid, id.gen);
    const value = JSON.stringify({ uid: id.uid, gen: id.gen, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: PolicyCommand) => {
    if (inFlight) return false;
    const id = identity();
    if (!sameIdentity(id) || !persist(cmd, id)) {
      set({ ...get(), error: EDITOR_COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().command(cmd);
    } finally {
      inFlight = false;
    }
    if (!sameIdentity(id)) return false; // account / rights changed: the reply is not ours
    const ok = r.status === 200 ? receipt.safeParse(r.body) : null;
    if (ok?.success && ok.data.version === cmd.expected_version + 1 && ok.data.action === cmd.action) {
      clearStored(id);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: ACTION_NOTICE[cmd.action] });
      await load(); // a receipt is not the current state
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400) {
      clearStored(id);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? EDITOR_COPY.conflict : EDITOR_COPY.invalid });
      if (r.status === 409) await load(); // re-read only, never a replay
      return false;
    }
    pendingFor = `${id.uid}|${id.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: EDITOR_COPY.retry });
    return false;
  };
  const fresh = (build: (cid: string, version: number, d: PolicyData) => PolicyCommand | null): Promise<boolean> => {
    const d = get().data;
    if (!d || get().pending || get().phase !== "ready" || inFlight) return Promise.resolve(false);
    const cid = newId();
    if (!cid) {
      set({ ...get(), error: EDITOR_COPY.noUuid });
      return Promise.resolve(false);
    }
    const cmd = build(cid, d.version, d);
    if (!cmd) return Promise.resolve(false);
    const parsed = command.safeParse(cmd);
    if (!parsed.success) {
      set({ ...get(), error: EDITOR_COPY.invalid });
      return Promise.resolve(false);
    }
    return send(cmd);
  };
  return {
    load,
    restorePending() {
      const id = identity();
      if (!id.uid) return;
      const key = pendingKey(id.uid, id.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof storedSchema> | null = null;
      try {
        const r = storedSchema.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== id.uid || parsed.gen !== id.gen) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${id.uid}|${id.gen}`;
      set({ ...get(), pending: parsed.command, error: EDITOR_COPY.retry });
    },
    save: (title: string, body: string) => {
      const e = validateDraft(title, body);
      if (e.title || e.body) return Promise.resolve(false);
      return fresh((cid, v) => ({ command_id: cid, expected_version: v, action: "save", title: title.trim(), body: body.trim() }));
    },
    publish: () => fresh((cid, v, d) => (draftPublishable(d) ? { command_id: cid, expected_version: v, action: "publish" } : null)),
    /** Explicit operator activation of the CURRENT publication only. */
    enable: () => fresh((cid, v, d) => (d.published && !d.operator_enabled ? { command_id: cid, expected_version: v, action: "enable", published_version: d.published.version } : null)),
    disable: () => fresh((cid, v) => ({ command_id: cid, expected_version: v, action: "disable" })),
    withdraw: () => fresh((cid, v, d) => (d.published ? { command_id: cid, expected_version: v, action: "withdraw" } : null)),
    /** Replays the pending command only under the identity that created it. */
    retry: () => {
      const p = get().pending;
      if (!p) return Promise.resolve(false);
      const id = identity();
      if (pendingFor !== `${id.uid}|${id.gen}`) {
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
