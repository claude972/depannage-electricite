// Public operator profile — pure model (no React).
//   Public: GET /api/public/operator-profile → { published: null | { version, profile, published_at } }
//   Admin (super admin): GET /api/platform-operations/public-profile → { version, draft, published }
//                        POST { action: save|publish|withdraw, command_id, expected_version, profile? } → { version, action }
// Public pages read the PUBLISHED profile only (never the draft); anything missing stays
// « À renseigner par l’exploitant ». The editor sends one command at a time; its command_id is
// stored in tab storage BEFORE the POST so a lost reply / 503 replays the same command.
import { z } from "zod";
import { MINIMUM_FIELDS, editor, operatorProfile, publication, type EditorState, type OperatorField, type OperatorProfile, type ProfileCommand, type Publication } from "../../../lib/features/public-operator-profile/contract";

export const PUBLIC_PROFILE_PATH = "/api/public/operator-profile";
export const EDITOR_PATH = "/api/platform-operations/public-profile";
export const PROFILE_TIMEOUT_MS = 15_000;
export const PROFILE_TIMEOUT = -1;
export type Result = { status: number; body: unknown };

export const FIELD_LABELS: Record<OperatorField, string> = {
  legal_name: "Raison sociale",
  legal_form: "Forme juridique",
  siren: "SIREN (9 chiffres)",
  vat_number: "Numéro de TVA intracommunautaire",
  hq_address: "Adresse du siège",
  publication_director: "Directeur ou directrice de la publication",
  public_email: "Adresse e-mail de contact",
  privacy_email: "Adresse e-mail pour les données personnelles",
  public_phone: "Téléphone (format international, ex. +596…)",
  host_name: "Nom de l’hébergeur",
  host_address: "Adresse de l’hébergeur",
  host_contact: "Coordonnées de contact de l’hébergeur",
  rights_holder: "Titulaire des droits (nom, logo, contenus)",
  display_name: "Nom affiché de l’exploitant",
  about_text: "Présentation de l’exploitant",
  service_area: "Zone d’intervention couverte",
};
export const FIELD_ORDER: OperatorField[] = ["legal_name", "legal_form", "siren", "vat_number", "hq_address", "publication_director", "public_email", "privacy_email", "public_phone", "host_name", "host_address", "host_contact", "rights_holder", "display_name", "about_text", "service_area"];
export const missingMinimum = (p: OperatorProfile): OperatorField[] => MINIMUM_FIELDS.filter((f) => !p[f]);

async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: PROFILE_TIMEOUT, body: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch {
      return { status: controller?.signal.aborted ? PROFILE_TIMEOUT : 0, body: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Public read ----------------------------------------------------------------------------------
export type PublicProfileState = { phase: "loading" | "ready" | "error"; published: Publication | null };
export async function loadPublished(fetcher: typeof fetch = (...a) => fetch(...a)): Promise<PublicProfileState> {
  const r = await timed(fetcher, PUBLIC_PROFILE_PATH, { method: "GET" }, PROFILE_TIMEOUT_MS);
  if (r.status !== 200) return { phase: "error", published: null };
  const parsed = z.object({ published: publication.nullable() }).strict().safeParse(r.body);
  return parsed.success ? { phase: "ready", published: parsed.data.published } : { phase: "error", published: null };
}
/** Published value of a field, or null (⇒ the page keeps « À renseigner par l’exploitant »). */
export function publishedValue(state: PublicProfileState | null | undefined, field: OperatorField): string | null {
  const v = state?.phase === "ready" ? state.published?.profile[field] : undefined;
  return typeof v === "string" && v.trim() ? v : null;
}
export const publishedStamp = (state: PublicProfileState | null | undefined): string | null =>
  state?.phase === "ready" && state.published
    ? `Informations publiées par l’exploitant le ${new Date(state.published.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })} (version ${state.published.version}).`
    : null;

// ---- Editor -------------------------------------------------------------------------------------
export type EditorApi = { load(): Promise<Result>; command(body: ProfileCommand): Promise<Result> };
export function createEditorApi(fetcher: typeof fetch = (...a) => fetch(...a)): EditorApi {
  return {
    load: () => timed(fetcher, EDITOR_PATH, { method: "GET" }, PROFILE_TIMEOUT_MS),
    command: (body) => timed(fetcher, EDITOR_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, PROFILE_TIMEOUT_MS),
  };
}
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export const PENDING_KEY = "operator-profile-pending-command";
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const PROFILE_COPY = {
  loadFailed: "La configuration de l’exploitant n’a pas pu être lue. Réessayez.",
  forbidden: "Réservé aux super-administrateurs de la plateforme : vos droits, vérifiés par le serveur, ne couvrent pas cette configuration.",
  conflict: "La configuration a changé entre-temps : rien n’a été enregistré. Rechargez pour repartir de la version actuelle ; votre saisie est conservée.",
  invalid: "Le serveur refuse ces valeurs : vérifiez les champs.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même commande sera renvoyée.",
  demo: "En démonstration, la configuration de l’exploitant n’est ni lue ni enregistrée.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : l’enregistrement est impossible ici.",
} as const;
export type EditorView = {
  phase: "loading" | "ready" | "error" | "forbidden";
  data: EditorState | null;
  busy: boolean;
  error: string;
  /** Exact command to replay after a lost reply / 503 / timeout. */
  pending: ProfileCommand | null;
  notice: string;
};
export const EDITOR_INITIAL: EditorView = { phase: "loading", data: null, busy: false, error: "", pending: null, notice: "" };

/** Form values → profile for the save command (empty fields are omitted), or field errors. */
export function formToProfile(values: Partial<Record<OperatorField, string>>): { profile: OperatorProfile } | { errors: Partial<Record<OperatorField, string>> } {
  const candidate: Record<string, string> = {};
  for (const f of FIELD_ORDER) {
    const v = (values[f] ?? "").trim();
    if (v) candidate[f] = f === "vat_number" ? v.replace(/\s/g, "").toUpperCase() : f === "public_phone" || f === "siren" ? v.replace(/[\s.-]/g, "") : v;
  }
  const parsed = operatorProfile.safeParse(candidate);
  if (parsed.success) return { profile: parsed.data };
  const errors: Partial<Record<OperatorField, string>> = {};
  for (const issue of parsed.error.issues) {
    const f = String(issue.path[0] ?? "") as OperatorField;
    if (f in FIELD_LABELS && !errors[f]) errors[f] = `${FIELD_LABELS[f]} : valeur invalide.`;
  }
  return { errors };
}

export function createEditorController({ api, store, newId, get, set }: { api: () => EditorApi; store: () => Store | null; newId: () => string | null; get: () => EditorView; set: (s: EditorView) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  const load = async () => {
    const my = ++loadSeq;
    set({ ...get(), phase: get().data ? get().phase : "loading", error: "" });
    const r = await api().load();
    if (my !== loadSeq) return;
    if (r.status === 401 || r.status === 403) return set({ ...get(), phase: "forbidden", data: null });
    const parsed = r.status === 200 ? editor.safeParse(r.body) : null;
    if (!parsed?.success) return set({ ...get(), phase: "error", error: PROFILE_COPY.loadFailed });
    set({ ...get(), phase: "ready", data: parsed.data, error: "" });
  };
  const send = async (cmd: ProfileCommand) => {
    if (inFlight) return false;
    inFlight = true;
    loadSeq++; // a list read started before this write never overwrites its outcome
    store()?.set(PENDING_KEY, JSON.stringify(cmd)); // persisted BEFORE the POST
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().command(cmd);
    } finally {
      inFlight = false;
    }
    const okBody = r.status === 200 ? z.object({ version: z.number().int(), action: z.enum(["save", "publish", "withdraw"]) }).strict().safeParse(r.body) : null;
    if (okBody?.success && okBody.data.version === cmd.expected_version + 1 && okBody.data.action === cmd.action) {
      store()?.remove(PENDING_KEY);
      set({ ...get(), busy: false, pending: null, notice: cmd.action === "save" ? "Brouillon enregistré." : cmd.action === "publish" ? "Informations publiées." : "Publication retirée." });
      await load();
      return true;
    }
    if (r.status === 409) {
      store()?.remove(PENDING_KEY);
      set({ ...get(), busy: false, pending: null, error: PROFILE_COPY.conflict });
      return false;
    }
    if (r.status === 422 || r.status === 400) {
      store()?.remove(PENDING_KEY);
      set({ ...get(), busy: false, pending: null, error: PROFILE_COPY.invalid });
      return false;
    }
    if (r.status === 401 || r.status === 403) {
      store()?.remove(PENDING_KEY);
      set({ ...get(), busy: false, pending: null, phase: "forbidden" });
      return false;
    }
    // Lost reply, 503, timeout, unverifiable 200: keep the exact command for an explicit retry.
    set({ ...get(), busy: false, pending: cmd, error: PROFILE_COPY.retry });
    return false;
  };
  const fresh = (build: (id: string, version: number) => ProfileCommand): Promise<boolean> => {
    const data = get().data;
    if (!data || get().pending) return Promise.resolve(false);
    const id = newId();
    if (!id) {
      set({ ...get(), error: PROFILE_COPY.noUuid });
      return Promise.resolve(false);
    }
    return send(build(id, data.version));
  };
  return {
    load,
    /** A command left by a reload of this tab is offered again, never resent automatically. */
    restorePending() {
      const raw = store()?.get(PENDING_KEY);
      if (!raw) return;
      try {
        const cmd = JSON.parse(raw) as ProfileCommand;
        set({ ...get(), pending: cmd, error: PROFILE_COPY.retry });
      } catch {
        store()?.remove(PENDING_KEY);
      }
    },
    save: (profile: OperatorProfile) => fresh((id, v) => ({ action: "save", command_id: id, expected_version: v, profile })),
    publish: () => (get().data && missingMinimum(get().data!.draft).length ? Promise.resolve(false) : fresh((id, v) => ({ action: "publish", command_id: id, expected_version: v }))),
    withdraw: () => fresh((id, v) => ({ action: "withdraw", command_id: id, expected_version: v })),
    retry: () => {
      const p = get().pending;
      return p ? send(p) : Promise.resolve(false);
    },
    get inFlight() {
      return inFlight;
    },
  };
}
