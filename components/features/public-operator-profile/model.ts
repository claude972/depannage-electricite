// Public operator profile — pure model (no React).
//   Public: GET /api/public/operator-profile → { published: null | { version, profile, published_at } }
//   Admin (super admin): GET /api/platform-operations/public-profile → { version, draft, published }
//                        POST { action: save|publish|withdraw, command_id, expected_version, profile? } → { version, action }
// Public pages read the PUBLISHED profile only (never the draft); anything missing stays
// « À renseigner par l’exploitant ». The editor sends one command at a time; its command_id is
// stored in tab storage BEFORE the POST so a lost reply / 503 replays the same command.
import { z } from "zod";
import { MINIMUM_FIELDS, command, editor, operatorProfile, publication, type EditorState, type OperatorField, type OperatorProfile, type ProfileCommand, type Publication } from "../../../lib/features/public-operator-profile/contract";

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
export type EditorContext = { generation(): number; userId(): string | null };
export const PENDING_KEY = "operator-profile-pending-command";
/** The stored command is bound to the account and identity generation that created it. */
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
export const PROFILE_COPY = {
  loadFailed: "La configuration de l’exploitant n’a pas pu être lue. Réessayez.",
  forbidden: "Réservé aux super-administrateurs de la plateforme : vos droits, vérifiés par le serveur, ne couvrent pas cette configuration.",
  conflict: "La configuration a changé entre-temps : rien n’a été enregistré. Rechargez pour repartir de la version actuelle ; votre saisie est conservée.",
  invalid: "Le serveur refuse ces valeurs : vérifiez les champs.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même commande sera renvoyée.",
  demo: "En démonstration, la configuration de l’exploitant n’est ni lue ni enregistrée.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : l’enregistrement est impossible ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être rejouée à l’identique ; autorisez le stockage du site ou utilisez un autre onglet.",
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

export function createEditorController({ api, store, newId, context, get, set }: { api: () => EditorApi; store: () => Store | null; newId: () => string | null; context: EditorContext; get: () => EditorView; set: (s: EditorView) => void }) {
  let inFlight = false;
  let loadSeq = 0;
  /** Identity the in-memory pending command belongs to. */
  let pendingFor: string | null = null;
  const identity = () => ({ uid: context.userId(), gen: context.generation() });
  const sameIdentity = (a: { uid: string | null; gen: number }) => context.userId() === a.uid && context.generation() === a.gen;
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };
  const clearStored = (id = identity()) => safe(() => store()?.remove(pendingKey(id.uid, id.gen)));
  /** 401 / 403: every sensitive copy is dropped (draft, published, pending command). */
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...EDITOR_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++loadSeq;
    const id = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading", error: "" });
    const r = await api().load();
    if (my !== loadSeq || !sameIdentity(id)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const parsed = r.status === 200 ? editor.safeParse(r.body) : null;
    if (!parsed?.success) return set({ ...get(), phase: "error", error: PROFILE_COPY.loadFailed });
    set({ ...get(), phase: "ready", data: parsed.data, error: "" });
  };
  /** Writes the command, reads it back; anything else (null store, throw, mismatch) refuses the POST. */
  const persist = (cmd: ProfileCommand, id: { uid: string | null; gen: number }): boolean => {
    if (!id.uid) return false;
    const s = store();
    if (!s) return false;
    const key = pendingKey(id.uid, id.gen);
    const value = JSON.stringify({ uid: id.uid, gen: id.gen, command: cmd });
    const ok = safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    });
    return ok === true;
  };
  const send = async (cmd: ProfileCommand) => {
    if (inFlight) return false;
    const id = identity();
    if (!persist(cmd, id)) {
      set({ ...get(), error: PROFILE_COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++; // a read started before this write never overwrites its outcome
    set({ ...get(), busy: true, error: "", notice: "" });
    let r: Result;
    try {
      r = await api().command(cmd);
    } finally {
      inFlight = false;
    }
    // Account or rights changed while waiting: the reply belongs to another context, ignore it.
    if (!sameIdentity(id)) return false;
    const okBody = r.status === 200 ? z.object({ version: z.number().int(), action: z.enum(["save", "publish", "withdraw"]) }).strict().safeParse(r.body) : null;
    if (okBody?.success && okBody.data.version === cmd.expected_version + 1 && okBody.data.action === cmd.action) {
      clearStored(id);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, notice: cmd.action === "save" ? "Brouillon enregistré." : cmd.action === "publish" ? "Informations publiées." : "Publication retirée." });
      await load();
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid();
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400) {
      clearStored(id);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? PROFILE_COPY.conflict : PROFILE_COPY.invalid });
      return false;
    }
    // Lost reply, 503, timeout, unverifiable 200: keep the exact command for an explicit retry.
    pendingFor = `${id.uid}|${id.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: PROFILE_COPY.retry });
    return false;
  };
  const fresh = (build: (cid: string, version: number) => ProfileCommand): Promise<boolean> => {
    const data = get().data;
    if (!data || get().pending) return Promise.resolve(false);
    const cid = newId();
    if (!cid) {
      set({ ...get(), error: PROFILE_COPY.noUuid });
      return Promise.resolve(false);
    }
    return send(build(cid, data.version));
  };
  return {
    load,
    /** A command stored by this tab for the SAME uid + generation is offered again (never sent
     *  automatically); anything malformed or from another identity is removed / ignored. */
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
      set({ ...get(), pending: parsed.command, error: PROFILE_COPY.retry });
    },
    save: (profile: OperatorProfile) => fresh((cid, v) => ({ action: "save", command_id: cid, expected_version: v, profile })),
    publish: () => (get().data && missingMinimum(get().data!.draft).length ? Promise.resolve(false) : fresh((cid, v) => ({ action: "publish", command_id: cid, expected_version: v }))),
    withdraw: () => fresh((cid, v) => ({ action: "withdraw", command_id: cid, expected_version: v })),
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
    get inFlight() {
      return inFlight;
    },
  };
}
