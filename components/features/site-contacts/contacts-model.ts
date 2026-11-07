// ENT-04 site contacts & instructions — pure model (no React): API client, strict parse, form
// validation, list/command state machine and controller. Backend contract (read-only):
// lib/features/site-contacts/schemas.ts + app/api/sites/[id]/contacts.
import { z } from "zod";
import { contactRecord, contactValues, type SiteContact } from "../../../lib/features/site-contacts/schemas";

export type { SiteContact };
export type ContactValues = z.infer<typeof contactValues>;
export type ContactsResult = { status: number; body: unknown; retryAfter: number | null };
export type SaveContact = { action: "save"; id: string; command_id: string; expected_version: number | null; values: ContactValues };
export type ArchiveContact = { action: "archive"; id: string; command_id: string; expected_version: number };
export type ContactCommand = SaveContact | ArchiveContact;
export type ContactsApi = {
  list(siteId: string, cursor: string | null): Promise<ContactsResult>;
  command(siteId: string, body: ContactCommand): Promise<ContactsResult>;
};
export type ContactsContext = { generation(): number; userId(): string | null };
export const DEFAULT_CONTACTS_CONTEXT: ContactsContext = { generation: () => 0, userId: () => null };
export const CONTACTS_TIMEOUT_MS = 15_000;
export const CONTACTS_TIMEOUT = -1;

/** Real UUID or null (never a constant fallback): null ⇒ the write is refused explicitly. */
export const contactUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<ContactsResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: ContactsResult = { status: CONTACTS_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<ContactsResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<ContactsResult> => {
    try {
      const response = await fetcher(path, { ...init, ...(controller ? { signal: controller.signal } : {}) });
      const retry = Number(response.headers.get("Retry-After"));
      return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
    } catch (error) {
      if (controller?.signal.aborted) return timedOut;
      throw error;
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
/** Same-origin, credentials same-origin, no-store, 15 s deadline; the cursor is sent unchanged. */
export function createContactsApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = CONTACTS_TIMEOUT_MS } = {}): ContactsApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  const path = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/contacts`;
  return {
    list: (siteId, cursor) => timed(fetcher, `${path(siteId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { ...base, method: "GET" }, timeoutMs),
    command: (siteId, body) => timed(fetcher, path(siteId), { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const pageSchema = z
  .object({
    records: z.array(contactRecord).max(100),
    page: z.object({ limit: z.literal(100), has_more: z.boolean(), next_cursor: z.string().min(1).max(180).nullable(), remaining_count: z.number().int().min(0), complete: z.boolean() }).strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
  })
  .strict();
export type ContactsPage = z.infer<typeof pageSchema>;
/** Off-contract ⇒ null (an error, never an empty list): cursor ⇔ has_more, no duplicates, only
 *  this site's active rows, at most one primary, ordered by id, counts coherent. */
export function parseContactsPage(body: unknown, siteId: string, firstPage: boolean): ContactsPage | null {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (p.records.some((r, i) => r.site_id !== siteId || r.archived_at !== null || (i > 0 && r.id <= p.records[i - 1].id))) return null;
  if (p.records.filter((r) => r.is_primary).length > 1) return null;
  if (p.records.length !== Math.min(p.page.remaining_count, 100)) return null;
  if (p.page.complete !== (firstPage && !p.page.has_more)) return null;
  return p;
}
export function parseContactReply(body: unknown, command: ContactCommand, siteId: string): SiteContact | null {
  const parsed = z.object({ record: contactRecord }).strict().safeParse(body);
  if (!parsed.success) return null;
  const r = parsed.data.record;
  const version = command.action === "save" && command.expected_version === null ? 1 : (command.expected_version ?? 0) + 1;
  if (r.id !== command.id || r.site_id !== siteId || r.version !== version) return null;
  if ((command.action === "archive") !== (r.archived_at !== null)) return null;
  return r;
}

// ---- Wording ---------------------------------------------------------------------------------------
export const CONTACTS_COPY = {
  readOnly: "Lecture seule : vous pouvez consulter les contacts de ce site, sans les modifier.",
  loadFailed: "Les contacts n’ont pas pu être vérifiés. Réessayez.",
  empty: "Aucun contact enregistré pour ce site.",
  conflict: "Modifié entre-temps, ou un autre contact est déjà le contact principal : actualisez la liste. Votre saisie est conservée.",
  invalid: "Vérifiez les valeurs saisies.",
  unavailable: "Ce site est introuvable ou n’est plus accessible.",
  session: "Votre session a expiré ou vos droits ont changé. Reconnectez-vous.",
  retry: "L’enregistrement n’a pas été confirmé. Réessayez : la même demande sera renvoyée.",
  timeout: "Délai dépassé : l’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
  noId: "Ce navigateur ne peut pas générer d’identifiant sûr : l’enregistrement est impossible ici.",
  partial: (loaded: number, total: number) => `${loaded} contact(s) affiché(s) sur ${total}.`,
} as const;

// ---- Form ----------------------------------------------------------------------------------------
export type ContactForm = { id: string; expected_version: number | null; first_name: string; last_name: string; role_label: string; phone: string; email: string; note: string; is_primary: boolean };
export type ContactErrors = Partial<Record<keyof ContactForm | "reach", string>>;
export const newContactForm = (id: string): ContactForm => ({ id, expected_version: null, first_name: "", last_name: "", role_label: "", phone: "", email: "", note: "", is_primary: false });
export const editContactForm = (r: SiteContact): ContactForm => ({ id: r.id, expected_version: r.version, first_name: r.first_name, last_name: r.last_name, role_label: r.role_label, phone: r.phone ?? "", email: r.email ?? "", note: r.note, is_primary: r.is_primary });
/** Form → exact contract values (backend schema) or field errors. command_id is the caller's. */
export function contactFormToCommand(f: ContactForm, commandId: string): { command: SaveContact } | { errors: ContactErrors } {
  const values = { first_name: f.first_name.trim(), last_name: f.last_name.trim(), role_label: f.role_label.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, note: f.note.trim(), is_primary: f.is_primary };
  const parsed = contactValues.safeParse(values);
  if (!parsed.success) {
    const errors: ContactErrors = {};
    for (const issue of parsed.error.issues) {
      const key = (issue.path[0] ? String(issue.path[0]) : "reach") as keyof ContactErrors;
      if (errors[key]) continue;
      errors[key] =
        key === "first_name" ? "Prénom : 1 à 100 caractères."
        : key === "last_name" ? "Nom : 1 à 100 caractères."
        : key === "role_label" ? "Fonction ou rôle : 1 à 160 caractères."
        : key === "phone" ? "Téléphone invalide (6 à 31 caractères)."
        : key === "email" ? "Adresse email invalide."
        : key === "note" ? "Consignes : 2000 caractères au plus."
        : key === "reach" ? "Renseignez un téléphone ou un email."
        : CONTACTS_COPY.invalid;
    }
    return { errors };
  }
  return { command: { action: "save", id: f.id, command_id: commandId, expected_version: f.expected_version, values: parsed.data } };
}

// ---- State machine + controller -------------------------------------------------------------------
export type ContactsState = {
  phase: "loading" | "ready" | "error" | "unavailable";
  records: SiteContact[];
  page: ContactsPage["page"] | null;
  /** Total of active contacts, from the FIRST page only (remaining_count with no cursor). */
  total: number | null;
  canWrite: boolean;
  loadingMore: boolean;
  error: string;
  busy: boolean;
  writeError: string;
  /** Exact command to resend after a 503 / timeout (same id + command_id + expected_version). */
  pending: ContactCommand | null;
  saved: string;
};
export const CONTACTS_INITIAL: ContactsState = { phase: "loading", records: [], page: null, total: null, canWrite: false, loadingMore: false, error: "", busy: false, writeError: "", pending: null, saved: "" };

export function applyContactsList(s: ContactsState, r: ContactsResult, append: boolean, siteId: string): ContactsState {
  if (r.status === 200) {
    const p = parseContactsPage(r.body, siteId, !append);
    if (!p) return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: CONTACTS_COPY.loadFailed };
    const seen = new Set(append ? s.records.map((x) => x.id) : []);
    const records = [...(append ? s.records : []), ...p.records.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))];
    return { ...s, phase: "ready", records, page: p.page, total: append ? s.total : p.page.remaining_count, canWrite: p.permissions.can_write, loadingMore: false, error: "" };
  }
  if (r.status === 404) return { ...CONTACTS_INITIAL, phase: "unavailable", error: CONTACTS_COPY.unavailable };
  const error = r.status === 401 || r.status === 403 ? CONTACTS_COPY.session : CONTACTS_COPY.loadFailed;
  return { ...s, loadingMore: false, phase: append ? s.phase : "error", error };
}
export function applyContactCommand(s: ContactsState, r: ContactsResult, command: ContactCommand, siteId: string): ContactsState {
  const base = { ...s, busy: false, writeError: "", saved: "" };
  if (r.status === 200) {
    const record = parseContactReply(r.body, command, siteId);
    if (!record) return { ...base, writeError: CONTACTS_COPY.retry, pending: command };
    const others = s.records.filter((x) => x.id !== record.id);
    const known = s.records.some((x) => x.id === record.id);
    const records = command.action === "archive" ? others : known ? s.records.map((x) => (x.id === record.id ? record : x)) : [...others, record].sort((a, b) => (a.id < b.id ? -1 : 1));
    const total = s.total === null ? null : command.action === "archive" ? Math.max(0, s.total - 1) : known ? s.total : s.total + 1;
    return { ...base, records, total, pending: null, saved: command.action === "archive" ? "Contact archivé." : "Contact enregistré." };
  }
  if (r.status === 409) return { ...base, writeError: CONTACTS_COPY.conflict, pending: null };
  if (r.status === 422 || r.status === 400) return { ...base, writeError: CONTACTS_COPY.invalid, pending: null };
  if (r.status === 404) return { ...base, writeError: CONTACTS_COPY.unavailable, pending: null };
  if (r.status === 401 || r.status === 403) return { ...base, writeError: CONTACTS_COPY.session, pending: null };
  return { ...base, writeError: r.status === CONTACTS_TIMEOUT ? CONTACTS_COPY.timeout : CONTACTS_COPY.retry, pending: command };
}

/** Loads (sequence) + writes (single flight) outside React. Write barrier: every list request
 *  started before or during a write is void (sequence bumped at write start and after the
 *  reply); no load / « Afficher plus » while a write is in flight; a causal reload from page 1
 *  follows a write that interrupted a load. Replies apply only under the unchanged generation +
 *  uid of an attached view. */
export function createContactsController({ api, siteId, context = DEFAULT_CONTACTS_CONTEXT, get, set }: { api: () => ContactsApi; siteId: string; context?: ContactsContext; get: () => ContactsState; set: (s: ContactsState) => void }) {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let writing = false;
  let attached = true;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async (append: boolean) => {
    const my = append ? loadSeq : ++loadSeq;
    const gen = context.generation(), uid = context.userId();
    const cursor = append ? get().page?.next_cursor ?? null : null;
    let r: ContactsResult;
    loadsInFlight++;
    try {
      r = await api().list(siteId, cursor);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      loadsInFlight--;
    }
    if (!same(gen, uid) || my !== loadSeq) return false;
    set(applyContactsList(get(), r, append, siteId));
    return true;
  };
  const send = async (command: ContactCommand) => {
    if (writing) return false;
    writing = true;
    const hadLoad = loadsInFlight > 0 || get().phase === "loading";
    loadSeq++;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), busy: true, writeError: "", saved: "", loadingMore: false });
    let r: ContactsResult;
    try {
      r = await api().command(siteId, command);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      writing = false;
    }
    loadSeq++;
    if (!same(gen, uid)) return false;
    set(applyContactCommand(get(), r, command, siteId));
    if (hadLoad) void fetchList(false);
    return true;
  };
  return {
    get writing() {
      return writing;
    },
    load() {
      if (writing) return Promise.resolve(false);
      set({ ...get(), phase: "loading", records: [], page: null, total: null, error: "", loadingMore: false });
      return fetchList(false);
    },
    more() {
      if (writing) return Promise.resolve(false);
      const s = get();
      if (s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return Promise.resolve(false);
      set({ ...s, loadingMore: true });
      return fetchList(true);
    },
    save(command: SaveContact) {
      return get().canWrite ? send(command) : Promise.resolve(false);
    },
    archive(record: SiteContact, commandId: string) {
      return get().canWrite ? send({ action: "archive", id: record.id, command_id: commandId, expected_version: record.version }) : Promise.resolve(false);
    },
    /** Replay of the exact pending command (same id + command_id + expected_version). */
    retry() {
      const p = get().pending;
      return p && get().canWrite ? send(p) : Promise.resolve(false);
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
      loadSeq++;
    },
  };
}
