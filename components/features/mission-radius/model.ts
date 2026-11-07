// Artisan mission radius — pure model, no React. Contract: ./contract. The server applies the radius
// to the offers; this UI filters nothing and never reads the device position (no geolocation).
import { z } from "zod";
import { RADIUS_MAX, RADIUS_MIN, command, view, type RadiusCommand, type RadiusView } from "./contract";

export type { RadiusCommand, RadiusView };
export const RADIUS_PATH = "/api/artisan/mission-radius";
export const MR_TIMEOUT_MS = 15_000;
export const MR_TIMEOUT = -1;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
export type RadiusApi = { load(): Promise<Result>; save(body: RadiusCommand): Promise<Result> };

const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
async function timed(fetcher: typeof fetch, init: RequestInit, timeoutMs = MR_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: MR_TIMEOUT, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(RADIUS_PATH, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? MR_TIMEOUT : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export function createRadiusApi(fetcher: typeof fetch = (...a) => fetch(...a)): RadiusApi {
  return {
    load: () => timed(fetcher, { method: "GET" }),
    save: (body) => timed(fetcher, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  };
}

export const parseView = (body: unknown): RadiusView | null => {
  const r = view.safeParse(body);
  return r.success ? r.data : null;
};
/** The reply is the same view; it must carry exactly what was sent, on a newer version. */
export function parseSaved(body: unknown, cmd: RadiusCommand): RadiusView | null {
  const v = parseView(body);
  if (!v) return null;
  const p = v.preference;
  return p.version > cmd.expected_version && p.reference_code === cmd.reference_code && p.radius_km === cmd.radius_km ? v : null;
}

/** Form → command, refused locally outside 1–200 km or without a listed commune (never sent). */
export function formToCommand(code: string, radius: string, v: RadiusView): { command: RadiusCommand } | { error: string } {
  if (!code || !v.options.some((o) => o.code === code)) return { error: COPY.pickCommune };
  const t = radius.trim();
  if (!/^\d{1,3}$/.test(t)) return { error: COPY.bounds };
  const km = Number(t);
  if (km < RADIUS_MIN || km > RADIUS_MAX) return { error: COPY.bounds };
  return { command: { expected_version: v.preference.version, reference_code: code, radius_km: km } };
}
export const clearCommand = (v: RadiusView): RadiusCommand => ({ expected_version: v.preference.version, reference_code: null, radius_km: null });

export function retrievedLabel(at: string): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T12:00:00Z` : at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "America/Martinique" });
}
export const COPY = {
  title: "Rayon des offres de missions",
  intro: "Choisissez une commune de référence et un rayon : le serveur ne vous propose alors que les offres dans ce rayon. Rien n’est filtré dans votre navigateur.",
  basis: "Rayon indicatif entre centres de communes : une approximation entre centres de communes, pas une distance de trajet ni une mesure depuis votre position. Votre position n’est jamais utilisée ici.",
  unknownPostal: "Les offres dont le code postal ne permet pas d’identifier une commune unique restent soumises à vos zones postales (rapprochement par code postal uniquement).",
  none: "Aucun rayon enregistré : les offres ne sont pas limitées par distance.",
  current: (name: string, km: number) => `Rayon enregistré : ${km} km autour du centre de ${name}.`,
  noOptions: "Aucune commune de référence n’est disponible pour le moment : le rayon ne peut pas être choisi.",
  loading: "Lecture de votre rayon…",
  loadFailed: "Le rayon n’a pas pu être lu. Réessayez.",
  forbidden: "Réservé aux comptes artisans : vos droits, vérifiés par le serveur, ne couvrent pas ce réglage.",
  session: "Session expirée : reconnectez-vous.",
  demo: "En démonstration, aucun rayon n’est lu ni enregistré : aucun appel n’est fait, et les offres de démonstration ne sont pas filtrées par distance.",
  pickCommune: "Choisissez une commune de référence dans la liste.",
  bounds: `Le rayon doit être un nombre entier de ${RADIUS_MIN} à ${RADIUS_MAX} km.`,
  serverBounds: `Le serveur refuse ce réglage : un rayon de ${RADIUS_MIN} à ${RADIUS_MAX} km avec une commune de la liste, ou les deux effacés.`,
  conflict: "Votre rayon a changé entre-temps (autre onglet ou appareil) : rien n’est renvoyé automatiquement. Le réglage actuel a été relu.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même commande sera renvoyée.",
  restored: "Un réglage envoyé depuis cet onglet n’a pas été confirmé : renvoyez-le (même commande) ou abandonnez-le.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  saved: "Rayon enregistré. Les offres repartent de la première page.",
  reread: "Réglage relu : voici l’état enregistré par le serveur. L’envoi précédent a pu être pris en compte ou non ; les offres suivent ce réglage.",
  cleared: "Rayon effacé. Les offres repartent de la première page.",
} as const;
export function statusError(status: number, retryAfterS: number | null): string {
  if (status === 401) return COPY.session;
  if (status === 403) return COPY.forbidden;
  if (status === 422) return COPY.serverBounds;
  if (status === 429) return retryAfterS ? `Trop de demandes : réessayez dans ${retryAfterS} s.` : "Trop de demandes : réessayez dans quelques instants.";
  if (status === 503) return retryAfterS ? `Service momentanément indisponible : réessayez dans ${retryAfterS} s.` : "Service momentanément indisponible : réessayez.";
  return COPY.loadFailed;
}

// ---- Identity-fenced command ------------------------------------------------------------------------
export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-mission-radius:";
export const pendingKey = (uid: string | null, gen: number) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export type View = { phase: "loading" | "ready" | "error" | "forbidden"; data: RadiusView | null; busy: boolean; error: string; notice: string; pending: RadiusCommand | null; waitS: number | null };
export const VIEW_INITIAL: View = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null, waitS: null };

/** What the host may rely on: a preference CONFIRMED by the server (GET or save reply). */
export type ConfirmedRadius = { version: number; active: boolean };
export function createRadiusController({ api, store, context, get, set, onConfirmed }: { api: () => RadiusApi; store: () => Store | null; context: Context; get: () => View; set: (v: View) => void; onConfirmed: (p: ConfirmedRadius) => void }) {
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
  const clearStored = (who = identity()) => safe(() => store()?.remove(pendingKey(who.uid, who.gen)));
  const forbid = (status: number) => {
    clearStored();
    pendingFor = null;
    set({ ...VIEW_INITIAL, phase: "forbidden", error: statusError(status, null) });
  };
  const confirm = (v: RadiusView) => onConfirmed({ version: v.preference.version, active: v.preference.radius_km !== null });
  /** true only for a confirmed read under the same identity (then reported to the host). */
  const load = async (): Promise<boolean> => {
    const my = ++loadSeq;
    const who = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await api().load();
    if (my !== loadSeq || !same(who)) return false;
    if (r.status === 401 || r.status === 403) return forbid(r.status), false;
    const v = r.status === 200 ? parseView(r.body) : null;
    if (!v) return set({ ...get(), phase: get().data ? get().phase : "error", error: statusError(r.status === 200 ? 0 : r.status, r.retryAfterS) }), false;
    set({ ...get(), phase: "ready", data: v, error: get().phase === "error" ? "" : get().error });
    confirm(v);
    return true;
  };
  const persist = (cmd: RadiusCommand, who: { uid: string | null; gen: number }): boolean => {
    if (!who.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const key = pendingKey(who.uid, who.gen);
    const value = JSON.stringify({ uid: who.uid, gen: who.gen, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: RadiusCommand): Promise<boolean> => {
    if (inFlight) return false;
    const who = identity();
    if (!persist(cmd, who)) {
      set({ ...get(), error: COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "", waitS: null });
    let r: Result;
    try {
      r = await api().save(cmd);
    } finally {
      inFlight = false;
    }
    if (!same(who)) return false; // identity changed: reply dropped, never replayed
    const v = r.status === 200 ? parseSaved(r.body, cmd) : null;
    if (v) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), phase: "ready", data: v, busy: false, pending: null, notice: cmd.radius_km === null ? COPY.cleared : COPY.saved });
      confirm(v); // the server now filters with the new radius: the host restarts the offers
      return true;
    }
    if (r.status === 401 || r.status === 403) {
      forbid(r.status);
      return false;
    }
    if (r.status === 409 || r.status === 422 || r.status === 400) {
      clearStored(who);
      pendingFor = null;
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? COPY.conflict : COPY.serverBounds });
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
      const key = pendingKey(who.uid, who.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof stored> | null = null;
      try {
        const r = stored.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== who.uid || parsed.gen !== who.gen) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${who.uid}|${who.gen}`;
      set({ ...get(), pending: parsed.command, error: COPY.restored });
    },
    save(code: string, radius: string): Promise<boolean> {
      const d = get().data;
      if (!d || get().pending || inFlight) return Promise.resolve(false);
      const out = formToCommand(code, radius, d);
      if ("error" in out) {
        set({ ...get(), error: out.error, notice: "" });
        return Promise.resolve(false);
      }
      return send(out.command);
    },
    clear(): Promise<boolean> {
      const d = get().data;
      if (!d || get().pending || inFlight || d.preference.radius_km === null) return Promise.resolve(false);
      return send(clearCommand(d));
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
    /** Uncertain reply: re-read the setting. A confirmed read replaces the unconfirmed command (it
     *  is no longer offered for replay) WITHOUT claiming the save was cancelled. */
    async reread(): Promise<boolean> {
      if (inFlight) return false;
      const who = identity();
      const ok = await load();
      if (!ok || !same(who)) return false;
      clearStored(who);
      pendingFor = null;
      set({ ...get(), pending: null, error: "", waitS: null, notice: COPY.reread });
      return true;
    },
  };
}
