// Postal coverage (PUB-03) — pure model, no React. Contract: ./contract (strict copy of ROOT d2831c8).
//   GET  /api/public/coverage?postal_code=NNNNN → { status: unknown|covered|not_covered, version }
//        informative only: never promises an artisan or a delay, never blocks a request.
//   GET  /api/admin/coverage → { version, postal_codes }   (platform admin, server-enforced)
//   POST /api/admin/coverage { action: publish|withdraw, command_id, expected_version, postal_codes? }
//        → { version, postal_codes, replayed }. Explicit publication; nothing prefilled.
import { z } from "zod";
import { coverageCommand, coverageEditor, coverageReceipt, postalCode, publicCoverage } from "./contract";

export const PUBLIC_PATH = "/api/public/coverage";
export const ADMIN_PATH = "/api/admin/coverage";
export const CV_TIMEOUT_MS = 15_000;
export const CV_TIMEOUT = -1;
export const MAX_CODES = 250;
export type Result = { status: number; body: unknown; retryAfterS: number | null };
const retryAfter = (v: string | null): number | null => (v && /^\d{1,5}$/.test(v.trim()) ? Math.min(Number(v.trim()), 3600) : null);
export async function timed(fetcher: typeof fetch, url: string, init: RequestInit, timeoutMs = CV_TIMEOUT_MS): Promise<Result> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Result>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve({ status: CV_TIMEOUT, body: null, retryAfterS: null });
    }, timeoutMs);
  });
  const request = (async (): Promise<Result> => {
    try {
      const r = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store", ...(controller ? { signal: controller.signal } : {}) });
      return { status: r.status, body: await r.json().catch(() => null), retryAfterS: retryAfter(r.headers.get("retry-after")) };
    } catch {
      return { status: controller?.signal.aborted ? CV_TIMEOUT : 0, body: null, retryAfterS: null };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- Public check -----------------------------------------------------------------------------------
export const isPostalCode = (v: string) => postalCode.safeParse(v).success;
export const publicUrl = (code: string) => `${PUBLIC_PATH}?postal_code=${encodeURIComponent(code)}`;
export type PublicCoverage = z.infer<typeof publicCoverage>;
export const parsePublic = (body: unknown): PublicCoverage | null => {
  const r = publicCoverage.safeParse(body);
  return r.success ? r.data : null;
};
export const PUBLIC_COPY = {
  title: "Ma commune est-elle dans la zone publiée ?",
  intro: "Indiquez un code postal pour savoir s’il figure dans la liste publiée par l’exploitant. Le code n’est ni enregistré ni conservé.",
  label: "Code postal",
  check: "Vérifier",
  checking: "Vérification…",
  invalid: "Saisissez un code postal de cinq chiffres.",
  failed: "La vérification n’a pas abouti. Réessayez.",
  informative: "C’est une information sur la liste publiée : elle n’engage ni la disponibilité d’un artisan, ni un délai d’intervention, et ne bloque jamais le dépôt d’une demande.",
} as const;
export function publicMessage(code: string, r: PublicCoverage): string {
  if (r.status === "covered") return `Le code postal ${code} figure dans la zone publiée par l’exploitant.`;
  if (r.status === "not_covered") return `Le code postal ${code} ne figure pas dans la zone publiée par l’exploitant. Vous pouvez tout de même déposer une demande : elle sera examinée.`;
  return "Zone non encore publiée : l’exploitant n’a pas encore publié la liste des codes postaux desservis. Vous pouvez déposer une demande : elle sera examinée.";
}
export function publicError(status: number, retryAfterS: number | null): string {
  if (status === 422) return PUBLIC_COPY.invalid;
  if ((status === 429 || status === 503) && retryAfterS) return `Service momentanément indisponible : réessayez dans ${retryAfterS} s.`;
  return PUBLIC_COPY.failed;
}

// ---- Admin editor -----------------------------------------------------------------------------------
export type CoverageState = z.infer<typeof coverageEditor>;
export type CoverageCommand = z.infer<typeof coverageCommand>;
/** Free text → codes: separators are spaces, commas, semicolons, new lines. */
export function parseCodes(input: string, existing: string[]): { added: string[]; invalid: string[]; duplicates: string[]; overflow: boolean } {
  const tokens = input.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const have = new Set(existing);
  const added: string[] = [], invalid: string[] = [], duplicates: string[] = [];
  for (const t of tokens) {
    if (!isPostalCode(t)) invalid.push(t);
    else if (have.has(t)) duplicates.push(t);
    else {
      have.add(t);
      added.push(t);
    }
  }
  const room = Math.max(0, MAX_CODES - existing.length);
  return { added: added.slice(0, room), invalid, duplicates, overflow: added.length > room };
}
export const sortedCodes = (codes: string[]) => [...codes].sort();

export type Store = { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void };
export type Context = { generation(): number; userId(): string | null };
/** Private tab storage; purged centrally (courant-app) on logout / identity change by this prefix. */
export const PENDING_PREFIX = "courant-private-coverage:";
export const pendingKey = (uid: string | null, gen: number) => `${PENDING_PREFIX}${uid ?? "-"}:${gen}`;
const stored = z.object({ uid: z.string().min(1), gen: z.number().int().nonnegative(), command: coverageCommand }).strict();
export function tabStore(): Store | null {
  try {
    const s = window.sessionStorage;
    return { get: (k) => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: (k) => s.removeItem(k) };
  } catch {
    return null;
  }
}
export const EDITOR_COPY = {
  title: "Zone desservie publiée (codes postaux)",
  intro: "Liste exacte des codes postaux affichée au public sous « Tarifs ». Information seulement : elle ne change pas l’attribution des demandes et n’en bloque aucune. Rien n’est prérempli ; chaque publication est explicite et versionnée.",
  loading: "Lecture de la zone publiée…",
  loadFailed: "La zone publiée n’a pas pu être lue. Réessayez.",
  forbidden: "Réservé aux administrateurs de la plateforme : vos droits, vérifiés par le serveur, ne couvrent pas cette zone.",
  demo: "En démonstration, la zone desservie n’est ni lue ni publiée : aucun appel n’est fait.",
  none: "Aucune zone publiée : le public voit « zone non encore publiée ».",
  conflict: "La zone publiée a changé entre-temps : rien n’a été publié. La version actuelle a été relue ; votre liste en cours est conservée.",
  invalid: "Le serveur refuse cette liste : 1 à 250 codes postaux de cinq chiffres, sans doublon.",
  retry: "La publication n’est pas confirmée. Réessayez : la même commande sera renvoyée, sans doublon.",
  restored: "Une action envoyée depuis cet onglet n’a pas été confirmée : renvoyez-la (même commande) ou abandonnez-la.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : aucune publication n’est possible ici.",
  storage: "Le stockage de cet onglet est indisponible : rien n’a été envoyé. Sans lui, une réponse perdue ne pourrait pas être renvoyée à l’identique.",
  replayed: "Cette action avait déjà été enregistrée (même commande) : rien n’a été publié deux fois.",
  published: (n: number, v: number) => `Zone publiée : ${n} code(s) postal(aux), version ${v}.`,
  withdrawn: (v: number) => `Zone retirée (version ${v}) : le public voit « zone non encore publiée ».`,
} as const;
export type EditorView = {
  phase: "loading" | "ready" | "error" | "forbidden";
  data: CoverageState | null;
  busy: boolean;
  error: string;
  notice: string;
  pending: CoverageCommand | null;
  waitS: number | null;
};
export const EDITOR_INITIAL: EditorView = { phase: "loading", data: null, busy: false, error: "", notice: "", pending: null, waitS: null };

export function createEditor({ fetcher, store, newId, context, get, set }: { fetcher: () => typeof fetch; store: () => Store | null; newId: () => string | null; context: Context; get: () => EditorView; set: (v: EditorView) => void }) {
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
  const clearStored = (id = identity()) => safe(() => store()?.remove(pendingKey(id.uid, id.gen)));
  const forbid = () => {
    clearStored();
    pendingFor = null;
    set({ ...EDITOR_INITIAL, phase: "forbidden" });
  };
  const load = async () => {
    const my = ++loadSeq;
    const id = identity();
    set({ ...get(), phase: get().data ? get().phase : "loading" });
    const r = await timed(fetcher(), ADMIN_PATH, { method: "GET" });
    if (my !== loadSeq || !same(id)) return;
    if (r.status === 401 || r.status === 403) return forbid();
    const parsed = r.status === 200 ? coverageEditor.safeParse(r.body) : null;
    if (!parsed?.success) return set({ ...get(), phase: get().data ? get().phase : "error", error: EDITOR_COPY.loadFailed });
    set({ ...get(), phase: "ready", data: parsed.data });
  };
  /** Write then read back; anything else (no uid, no store, throw, mismatch) refuses the POST. */
  const persist = (cmd: CoverageCommand, id: { uid: string | null; gen: number }): boolean => {
    if (!id.uid) return false;
    const s = safe(store);
    if (!s) return false;
    const key = pendingKey(id.uid, id.gen);
    const value = JSON.stringify({ uid: id.uid, gen: id.gen, command: cmd });
    return safe(() => {
      s.set(key, value);
      return s.get(key) === value;
    }) === true;
  };
  const send = async (cmd: CoverageCommand): Promise<boolean> => {
    if (inFlight) return false;
    const id = identity();
    if (!persist(cmd, id)) {
      set({ ...get(), error: EDITOR_COPY.storage });
      return false;
    }
    inFlight = true;
    loadSeq++;
    set({ ...get(), busy: true, error: "", notice: "", waitS: null });
    let r: Result;
    try {
      r = await timed(fetcher(), ADMIN_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
    } finally {
      inFlight = false;
    }
    if (!same(id)) return false; // another account / generation: the reply is dropped
    const expected = cmd.action === "publish" ? sortedCodes(cmd.postal_codes) : [];
    const ok = r.status === 200 ? coverageReceipt.strict().safeParse(r.body) : null;
    if (ok?.success && ok.data.version === cmd.expected_version + 1 && ok.data.postal_codes.join(",") === expected.join(",")) {
      clearStored(id);
      pendingFor = null;
      const notice = ok.data.replayed ? EDITOR_COPY.replayed : cmd.action === "publish" ? EDITOR_COPY.published(expected.length, ok.data.version) : EDITOR_COPY.withdrawn(ok.data.version);
      set({ ...get(), busy: false, pending: null, data: { version: ok.data.version, postal_codes: ok.data.postal_codes }, notice });
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
      set({ ...get(), busy: false, pending: null, error: r.status === 409 ? EDITOR_COPY.conflict : EDITOR_COPY.invalid });
      if (r.status === 409) await load();
      return false;
    }
    // Lost reply, 429, 503, timeout, unverifiable 200: keep the exact command for an explicit retry.
    pendingFor = `${id.uid}|${id.gen}`;
    set({ ...get(), busy: false, pending: cmd, error: EDITOR_COPY.retry, waitS: r.status === 429 || r.status === 503 ? r.retryAfterS : null });
    return false;
  };
  const fresh = (build: (cid: string, version: number) => CoverageCommand | null): Promise<boolean> => {
    const data = get().data;
    if (!data || get().pending || inFlight) return Promise.resolve(false);
    const cid = safe(newId) ?? null;
    if (!cid) {
      set({ ...get(), error: EDITOR_COPY.noUuid });
      return Promise.resolve(false);
    }
    const cmd = build(cid, data.version);
    if (!cmd || !coverageCommand.safeParse(cmd).success) {
      set({ ...get(), error: EDITOR_COPY.invalid });
      return Promise.resolve(false);
    }
    return send(cmd);
  };
  return {
    load,
    /** Strict restore: only a well-formed command stored for the SAME uid + generation is offered. */
    restorePending() {
      const id = identity();
      if (!id.uid) return;
      const key = pendingKey(id.uid, id.gen);
      const raw = safe(() => store()?.get(key) ?? null) ?? null;
      if (raw === null) return;
      let parsed: z.infer<typeof stored> | null = null;
      try {
        const r = stored.safeParse(JSON.parse(raw));
        parsed = r.success ? r.data : null;
      } catch {
        parsed = null;
      }
      if (!parsed || parsed.uid !== id.uid || parsed.gen !== id.gen) {
        safe(() => store()?.remove(key));
        return;
      }
      pendingFor = `${id.uid}|${id.gen}`;
      set({ ...get(), pending: parsed.command, error: EDITOR_COPY.restored });
    },
    publish: (codes: string[]) => fresh((cid, v) => (codes.length ? { action: "publish", command_id: cid, expected_version: v, postal_codes: sortedCodes(codes) } : null)),
    withdraw: () => fresh((cid, v) => ({ action: "withdraw", command_id: cid, expected_version: v })),
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
    /** Explicitly abandon an unconfirmed command (it is removed from the tab). */
    discard: () => {
      clearStored();
      pendingFor = null;
      set({ ...get(), pending: null, error: "", waitS: null });
    },
    get inFlight() {
      return inFlight;
    },
  };
}
