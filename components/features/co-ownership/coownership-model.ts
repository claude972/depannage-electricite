// ENT-05 co-ownership (copropriété) — pure model (no React). Human general-meeting (AG) records and
// documentary calls for funds for syndic sites. Backend contract (read-only):
// lib/features/co-ownership/schemas.ts + app/api/sites/[id]/co-ownership.
// NEVER: quorum computation, collection / payment, « sent » claims — the server states
// sends_notices / collects_funds / legal_validation = false and a reply saying otherwise is refused.
import { z } from "zod";
import { coOwnershipRecord, fundCallValues, meetingValues, type CoOwnershipRecord } from "../../../lib/features/co-ownership/schemas";

export type { CoOwnershipRecord };
export type CoKind = "meeting" | "fund_call";
export type MeetingValues = z.infer<typeof meetingValues>;
export type FundCallValues = z.infer<typeof fundCallValues>;
export type MeetingRecord = Extract<CoOwnershipRecord, { kind: "meeting" }>;
export type FundCallRecord = Extract<CoOwnershipRecord, { kind: "fund_call" }>;
export type CoResult = { status: number; body: unknown; retryAfter: number | null };
export type SaveMeeting = { kind: "meeting"; action: "save"; id: string; command_id: string; expected_version: number | null; values: MeetingValues };
export type SaveFundCall = { kind: "fund_call"; action: "save"; id: string; command_id: string; expected_version: number | null; values: FundCallValues };
export type ArchiveRecord = { kind: CoKind; action: "archive"; id: string; command_id: string; expected_version: number };
export type CoCommand = SaveMeeting | SaveFundCall | ArchiveRecord;
export type CoApi = {
  list(siteId: string, kind: CoKind, cursor: string | null): Promise<CoResult>;
  command(siteId: string, body: CoCommand): Promise<CoResult>;
};
export type CoContext = { generation(): number; userId(): string | null };
export const DEFAULT_CO_CONTEXT: CoContext = { generation: () => 0, userId: () => null };
export const CO_TIMEOUT_MS = 15_000;
export const CO_TIMEOUT = -1;

/** Real UUID or null (never a constant fallback): null ⇒ the write is refused explicitly. */
export const coUuid = (): string | null => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : null);

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<CoResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: CoResult = { status: CO_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<CoResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<CoResult> => {
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
export function createCoApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = CO_TIMEOUT_MS } = {}): CoApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  const path = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/co-ownership`;
  return {
    list: (siteId, kind, cursor) => timed(fetcher, `${path(siteId)}?kind=${kind}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { ...base, method: "GET" }, timeoutMs),
    command: (siteId, body) => timed(fetcher, path(siteId), { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const pageSchema = z
  .object({
    records: z.array(coOwnershipRecord).max(50),
    page: z.object({ limit: z.literal(50), total: z.number().int().min(0).max(500), remaining: z.number().int().min(0).max(500), has_more: z.boolean(), next_cursor: z.string().min(1).max(220).nullable(), complete: z.boolean() }).strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
    basis: z.literal("human_documentary_records"),
    capabilities: z.object({ sends_notices: z.literal(false), collects_funds: z.literal(false), legal_validation: z.literal(false) }).strict(),
  })
  .strict();
export type CoPage = z.infer<typeof pageSchema>;
/** Off-contract ⇒ null (an error, never an empty list). */
export function parseCoPage(body: unknown, siteId: string, kind: CoKind, firstPage: boolean): CoPage | null {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data, g = p.page;
  if (g.remaining > g.total || (firstPage && g.remaining !== g.total)) return null;
  if (p.records.length !== Math.min(g.remaining, 50)) return null;
  if (g.has_more !== g.remaining > 50 || g.has_more !== (g.next_cursor !== null) || g.complete !== (firstPage && !g.has_more)) return null;
  if (p.records.some((r, i) => r.site_id !== siteId || r.kind !== kind || r.archived_at !== null || (i > 0 && r.id <= p.records[i - 1].id))) return null;
  return p;
}
const sameValue = (key: string, sent: unknown, got: unknown) =>
  key === "starts_at" || key === "ends_at" ? (sent === null ? got === null : typeof got === "string" && Date.parse(got) === Date.parse(String(sent))) : JSON.stringify(sent) === JSON.stringify(got);
export function parseCoReply(body: unknown, command: CoCommand, siteId: string): CoOwnershipRecord | null {
  const parsed = z.object({ record: coOwnershipRecord }).strict().safeParse(body);
  if (!parsed.success) return null;
  const r = parsed.data.record;
  const version = command.action === "save" && command.expected_version === null ? 1 : (command.expected_version ?? 0) + 1;
  if (r.id !== command.id || r.site_id !== siteId || r.kind !== command.kind || r.version !== version || (command.action === "archive") !== (r.archived_at !== null)) return null;
  if (command.action === "save") {
    const got = r.values as unknown as Record<string, unknown>;
    if (Object.entries(command.values).some(([k, v]) => !sameValue(k, v, got[k]))) return null;
  }
  return r;
}

// ---- Exact units & dates ----------------------------------------------------------------------------
/** Exact « 1 234,56 » € → cents (2 decimals at most, 1..2147483647); anything else ⇒ null. */
export function eurosToCents(input: string): number | null {
  const s = input.trim().replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, decimals = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 2147483647 ? cents : null;
}
const GROUP = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
export const formatEuros = (cents: number) => `${GROUP(Math.floor(cents / 100))},${String(cents % 100).padStart(2, "0")} €`;
export const centsToInput = (cents: number) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
/** « YYYY-MM-DDTHH:mm » (browser local time) → ISO instant with timezone; empty ⇒ null; invalid ⇒ undefined. */
export function localToInstant(local: string): string | null | undefined {
  if (!local.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return undefined;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
export function instantToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// ---- Wording -----------------------------------------------------------------------------------------
export const KIND_TITLE: Record<CoKind, string> = { meeting: "Assemblées générales", fund_call: "Appels de fonds" };
export const MEETING_STATUS: Record<MeetingValues["status"], string> = { draft: "Brouillon", scheduled: "Planifiée", held: "Tenue (compte rendu saisi)", cancelled: "Annulée" };
export const FUND_STATUS: Record<FundCallValues["status"], string> = { draft: "Brouillon", issued: "Émis (déclaratif)", cancelled: "Annulé" };
export const CO_COPY = {
  banner: "Dossiers documentaires saisis par le gestionnaire : l’application n’envoie aucune convocation ni aucun appel, n’encaisse aucun fonds, ne calcule aucun quorum et ne valide rien juridiquement.",
  readOnly: "Lecture seule : vous pouvez consulter ces dossiers, sans les modifier.",
  loadFailed: "Les dossiers de copropriété n’ont pas pu être vérifiés. Réessayez.",
  notSyndic: "Ces dossiers ne sont disponibles que pour un site géré en syndic de copropriété.",
  unavailable: "Ce site est introuvable ou n’est plus accessible.",
  empty: { meeting: "Aucune assemblée générale enregistrée.", fund_call: "Aucun appel de fonds enregistré." },
  conflict: {
    meeting: "Enregistrement refusé : l’assemblée a été modifiée entre-temps, ou ce changement de statut n’est pas permis (une assemblée tenue ou annulée ne se rouvre pas), ou des appels de fonds actifs y sont liés (annulation ou archivage impossibles), ou la limite de 500 assemblées actives est atteinte. Actualisez la liste ; votre saisie est conservée.",
    fund_call: "Enregistrement refusé : l’appel a été modifié entre-temps, ou la référence est déjà utilisée sur ce site, ou ses montants et dates sont figés depuis son émission ou son annulation, ou ce changement de statut n’est pas permis, ou la limite de 500 appels actifs est atteinte. Actualisez la liste ; votre saisie est conservée.",
  },
  dependencyMissing: "Le site ou l’élément lié n’existe plus ou n’est plus accessible — actualisez la liste.",
  invalid: "Valeurs refusées par le serveur : vérifiez la saisie (ou ce site n’est pas géré en syndic).",
  session: "Votre session a expiré ou vos droits ont changé. Reconnectez-vous.",
  retry: "L’enregistrement n’a pas été confirmé. Réessayez : la même demande sera renvoyée.",
  timeout: "Délai dépassé : l’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
  noId: "Ce navigateur ne peut pas générer d’identifiant sûr : l’enregistrement est impossible ici.",
  demo: "En démonstration, les dossiers de copropriété ne sont pas enregistrés.",
  partial: (loaded: number, total: number) => `${loaded} dossier(s) affiché(s) sur ${total}.`,
  frozen: "Appel émis ou annulé : montant, dates, références et assemblée liée sont figés ; seule la note peut changer, ou l’annulation.",
  declarative: "Montant déclaratif : l’application n’encaisse rien et n’indique aucun paiement.",
  localTime: "heure locale de votre appareil",
  linkedCalls: "Appels de fonds actifs liés à cette assemblée, parmi les appels chargés :",
} as const;

// ---- Status rules (mirror of the contract; the server decides) -----------------------------------
/** Allowed statuses for a meeting whose SAVED status is `saved` (null = new). Held / cancelled never reopen. */
export function meetingStatusOptions(saved: MeetingValues["status"] | null): MeetingValues["status"][] {
  if (saved === "held") return ["held"];
  if (saved === "cancelled") return ["cancelled"];
  return ["draft", "scheduled", "held", "cancelled"];
}
export function fundStatusOptions(saved: FundCallValues["status"] | null): FundCallValues["status"][] {
  if (saved === "issued") return ["issued", "cancelled"];
  if (saved === "cancelled") return ["cancelled"];
  return ["draft", "issued", "cancelled"];
}
export const fundFrozen = (saved: FundCallValues["status"] | null) => saved === "issued" || saved === "cancelled";
/** Active calls among the LOADED ones that reference a meeting (no extra fetch). */
export const linkedCalls = (calls: CoOwnershipRecord[], meetingId: string) => calls.filter((c): c is FundCallRecord => c.kind === "fund_call" && c.archived_at === null && c.values.meeting_id === meetingId && c.values.status !== "cancelled");

// ---- Forms -------------------------------------------------------------------------------------------
export type MeetingForm = { kind: "meeting"; id: string; expected_version: number | null; saved_status: MeetingValues["status"] | null; title: string; starts_local: string; ends_local: string; location: string; agenda: string; minutes: string; decisions: string; status: MeetingValues["status"] };
export type FundForm = { kind: "fund_call"; id: string; expected_version: number | null; saved_status: FundCallValues["status"] | null; saved_values: FundCallValues | null; label: string; reference: string; due_on: string; amount_euros: string; document_reference: string; issued_on: string; note: string; meeting_id: string | null; status: FundCallValues["status"] };
export type CoErrors = Partial<Record<string, string>>;
export const newMeetingForm = (id: string): MeetingForm => ({ kind: "meeting", id, expected_version: null, saved_status: null, title: "", starts_local: "", ends_local: "", location: "", agenda: "", minutes: "", decisions: "", status: "draft" });
export const editMeetingForm = (r: MeetingRecord): MeetingForm => ({ kind: "meeting", id: r.id, expected_version: r.version, saved_status: r.values.status, title: r.values.title, starts_local: instantToLocal(r.values.starts_at), ends_local: instantToLocal(r.values.ends_at), location: r.values.location, agenda: r.values.agenda, minutes: r.values.minutes, decisions: r.values.decisions.join("\n"), status: r.values.status });
export const newFundForm = (id: string): FundForm => ({ kind: "fund_call", id, expected_version: null, saved_status: null, saved_values: null, label: "", reference: "", due_on: "", amount_euros: "", document_reference: "", issued_on: "", note: "", meeting_id: null, status: "draft" });
export const editFundForm = (r: FundCallRecord): FundForm => ({ kind: "fund_call", id: r.id, expected_version: r.version, saved_status: r.values.status, saved_values: r.values, label: r.values.label, reference: r.values.reference, due_on: r.values.due_on, amount_euros: centsToInput(r.values.amount_cents), document_reference: r.values.document_reference, issued_on: r.values.issued_on ?? "", note: r.values.note, meeting_id: r.values.meeting_id, status: r.values.status });

export function meetingFormToCommand(f: MeetingForm, commandId: string, now = new Date()): { command: SaveMeeting } | { errors: CoErrors } {
  const errors: CoErrors = {};
  const starts = localToInstant(f.starts_local), ends = localToInstant(f.ends_local);
  if (starts === undefined) errors.starts_local = "Date et heure de début invalides.";
  if (ends === undefined) errors.ends_local = "Date et heure de fin invalides.";
  const decisions = f.decisions.split("\n").map((d) => d.trim()).filter(Boolean);
  if (decisions.length > 20) errors.decisions = "20 décisions au plus (une par ligne).";
  else if (decisions.some((d) => d.length > 1000)) errors.decisions = "Chaque décision : 1000 caractères au plus.";
  if (!meetingStatusOptions(f.saved_status).includes(f.status)) errors.status = "Une assemblée tenue ou annulée ne se rouvre pas.";
  else if (f.status === "held" && starts && Date.parse(starts) > now.getTime()) errors.status = "Une assemblée tenue ne peut pas être dans le futur.";
  const values = { title: f.title.trim(), starts_at: starts ?? null, ends_at: ends ?? null, location: f.location.trim(), agenda: f.agenda.trim(), minutes: f.minutes.trim(), decisions, status: f.status };
  if (!errors.starts_local && !errors.ends_local) {
    const parsed = meetingValues.safeParse(values);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key === "title") errors.title ??= "Titre : 1 à 200 caractères.";
        else if (key === "location") errors.location ??= "Lieu : 300 caractères au plus.";
        else if (key === "agenda") errors.agenda ??= "Ordre du jour : 6000 caractères au plus.";
        else if (key === "minutes") errors.minutes ??= "Compte rendu : 12000 caractères au plus.";
        else if (key === "decisions") errors.decisions ??= "Décisions : 1 à 1000 caractères chacune, 20 au plus.";
        else if (values.ends_at !== null && (values.starts_at === null || Date.parse(values.ends_at) < Date.parse(values.starts_at))) errors.ends_local ??= "La fin doit suivre le début (et le début être renseigné).";
        else errors.status ??= "Planifiée ou tenue : renseignez la date de début et le lieu.";
      }
  }
  if (Object.keys(errors).length) return { errors };
  return { command: { kind: "meeting", action: "save", id: f.id, command_id: commandId, expected_version: f.expected_version, values: meetingValues.parse(values) } };
}

export function fundFormToCommand(f: FundForm, commandId: string, meetings: CoOwnershipRecord[], now = new Date()): { command: SaveFundCall } | { errors: CoErrors } {
  const errors: CoErrors = {};
  if (!fundStatusOptions(f.saved_status).includes(f.status)) errors.status = "Ce changement de statut n’est pas permis.";
  const frozen = fundFrozen(f.saved_status) && f.saved_values ? f.saved_values : null;
  // Frozen financial fields are re-sent exactly as saved (only the note / cancellation may change).
  let values: FundCallValues;
  if (frozen) values = { ...frozen, note: f.note.trim(), status: f.status };
  else {
    const cents = eurosToCents(f.amount_euros);
    if (cents === null) errors.amount_euros = "Montant en euros : nombre positif, 2 décimales au plus.";
    values = { label: f.label.trim(), reference: f.reference.trim(), due_on: f.due_on, amount_cents: cents ?? 1, document_reference: f.document_reference.trim(), issued_on: f.issued_on || null, note: f.note.trim(), meeting_id: f.meeting_id, status: f.status };
    if (values.meeting_id !== null && !meetings.some((m) => m.kind === "meeting" && m.id === values.meeting_id && m.archived_at === null && m.values.status !== "cancelled")) errors.meeting_id = "Choisissez une assemblée active, non annulée, de ce site.";
    if (values.issued_on !== null && values.issued_on > todayIso(now)) errors.issued_on = "La date d’émission ne peut pas être dans le futur.";
  }
  const parsed = fundCallValues.safeParse(values);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key === "label") errors.label ??= "Libellé : 1 à 200 caractères.";
      else if (key === "reference") errors.reference ??= "Référence : 1 à 100 caractères.";
      else if (key === "due_on") errors.due_on ??= "Date d’échéance invalide.";
      else if (key === "document_reference") errors.document_reference ??= "Référence du document : 1 à 240 caractères.";
      else if (key === "issued_on") errors.issued_on ??= "Date d’émission invalide.";
      else if (key === "note") errors.note ??= "Note : 4000 caractères au plus.";
      else if (key === "amount_cents") errors.amount_euros ??= "Montant hors limites.";
      else if (values.status === "issued" && values.issued_on === null) errors.issued_on ??= "Émis : renseignez la date d’émission.";
      else errors.due_on ??= "L’échéance ne peut pas précéder l’émission.";
    }
  if (Object.keys(errors).length || !parsed.success) return { errors };
  return { command: { kind: "fund_call", action: "save", id: f.id, command_id: commandId, expected_version: f.expected_version, values: parsed.data } };
}

// ---- State machine + controller (one per kind) -----------------------------------------------------
export type CoState = {
  phase: "loading" | "ready" | "error" | "unavailable" | "demo";
  records: CoOwnershipRecord[];
  page: CoPage["page"] | null;
  total: number | null;
  canWrite: boolean;
  loadingMore: boolean;
  error: string;
  busy: boolean;
  writeError: string;
  pending: CoCommand | null;
  saved: string;
};
export const CO_INITIAL: CoState = { phase: "loading", records: [], page: null, total: null, canWrite: false, loadingMore: false, error: "", busy: false, writeError: "", pending: null, saved: "" };

export function applyCoList(s: CoState, r: CoResult, append: boolean, siteId: string, kind: CoKind): CoState {
  if (r.status === 200) {
    const p = parseCoPage(r.body, siteId, kind, !append);
    if (!p) return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: CO_COPY.loadFailed };
    const seen = new Set(append ? s.records.map((x) => x.id) : []);
    const records = [...(append ? s.records : []), ...p.records.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))];
    return { ...s, phase: "ready", records, page: p.page, total: append ? s.total : p.page.total, canWrite: p.permissions.can_write, loadingMore: false, error: "" };
  }
  if (r.status === 404) return { ...CO_INITIAL, phase: "unavailable", error: CO_COPY.unavailable };
  if (r.status === 422) return { ...CO_INITIAL, phase: "unavailable", error: CO_COPY.notSyndic };
  const error = r.status === 401 || r.status === 403 ? CO_COPY.session : CO_COPY.loadFailed;
  return { ...s, loadingMore: false, phase: append ? s.phase : "error", error };
}
export function applyCoCommand(s: CoState, r: CoResult, command: CoCommand, siteId: string): CoState {
  const base = { ...s, busy: false, writeError: "", saved: "" };
  if (r.status === 200) {
    const record = parseCoReply(r.body, command, siteId);
    if (!record) return { ...base, writeError: CO_COPY.retry, pending: command };
    const known = s.records.some((x) => x.id === record.id);
    const records = command.action === "archive" ? s.records.filter((x) => x.id !== record.id) : known ? s.records.map((x) => (x.id === record.id ? record : x)) : [...s.records, record].sort((a, b) => (a.id < b.id ? -1 : 1));
    const total = s.total === null ? null : command.action === "archive" ? Math.max(0, s.total - 1) : known ? s.total : s.total + 1;
    return { ...base, records, total, pending: null, saved: command.action === "archive" ? "Dossier archivé." : "Dossier enregistré." };
  }
  if (r.status === 409) return { ...base, writeError: CO_COPY.conflict[command.kind], pending: null };
  if (r.status === 404) return { ...base, writeError: CO_COPY.dependencyMissing, pending: null };
  if (r.status === 422 || r.status === 400) return { ...base, writeError: CO_COPY.invalid, pending: null };
  if (r.status === 401 || r.status === 403) return { ...base, writeError: CO_COPY.session, pending: null };
  return { ...base, writeError: r.status === CO_TIMEOUT ? CO_COPY.timeout : CO_COPY.retry, pending: command };
}

/** Same discipline as the other site leaves: list sequence, single-flight writes, write barrier
 *  (sequence bumped at write start and after the reply, no load / more during a write, causal
 *  reload), generation + uid guard, detach; demo: no call. */
export function createCoController({ api, siteId, kind, context = DEFAULT_CO_CONTEXT, get, set, demo = false }: { api: () => CoApi; siteId: string; kind: CoKind; context?: CoContext; get: () => CoState; set: (s: CoState) => void; demo?: boolean }) {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let writing = false;
  let attached = true;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async (append: boolean) => {
    const my = append ? loadSeq : ++loadSeq;
    const gen = context.generation(), uid = context.userId();
    const cursor = append ? get().page?.next_cursor ?? null : null;
    let r: CoResult;
    loadsInFlight++;
    try {
      r = await api().list(siteId, kind, cursor);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      loadsInFlight--;
    }
    if (!same(gen, uid) || my !== loadSeq) return false;
    set(applyCoList(get(), r, append, siteId, kind));
    return true;
  };
  const send = async (command: CoCommand) => {
    if (writing || demo || command.kind !== kind) return false;
    writing = true;
    const hadLoad = loadsInFlight > 0 || get().phase === "loading";
    loadSeq++;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), busy: true, writeError: "", saved: "", loadingMore: false });
    let r: CoResult;
    try {
      r = await api().command(siteId, command);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      writing = false;
    }
    loadSeq++;
    if (!same(gen, uid)) return false;
    set(applyCoCommand(get(), r, command, siteId));
    // Refused right or resource: re-read before any new POST; a refused read purges the records,
    // the typed values and the write action (E64).
    const refused = r.status === 401 || r.status === 403 || r.status === 404;
    if (hadLoad || refused) void fetchList(false);
    return true;
  };
  return {
    kind,
    get writing() {
      return writing;
    },
    load() {
      if (demo) {
        set({ ...CO_INITIAL, phase: "demo" });
        return Promise.resolve(false);
      }
      if (writing) return Promise.resolve(false);
      set({ ...get(), phase: "loading", records: [], page: null, total: null, error: "", loadingMore: false });
      return fetchList(false);
    },
    more() {
      if (demo || writing) return Promise.resolve(false);
      const s = get();
      if (s.loadingMore || !s.page?.has_more || !s.page.next_cursor) return Promise.resolve(false);
      set({ ...s, loadingMore: true });
      return fetchList(true);
    },
    save(command: SaveMeeting | SaveFundCall) {
      return get().canWrite ? send(command) : Promise.resolve(false);
    },
    archive(record: CoOwnershipRecord, commandId: string) {
      return get().canWrite ? send({ kind: record.kind, action: "archive", id: record.id, command_id: commandId, expected_version: record.version }) : Promise.resolve(false);
    },
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
