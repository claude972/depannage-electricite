// ENT-09 site energy — pure model (no React): API client, strict parse, exact unit conversions,
// totals wording, form validation and the list/command state machine. The backend contract is
// lib/features/energy/schemas.ts (read-only): its record schema and kWh→Wh helper are reused.
import { z } from "zod";
import { energyRecord, energyValues, kwhToWh, type EnergyRecord, type EnergyValues } from "../../../lib/features/energy/schemas";

export type { EnergyRecord, EnergyValues };
export type EnergyResult = { status: number; body: unknown; retryAfter: number | null };
export type EnergyFilters = { from: string | null; to: string | null };
export type SaveCommand = { action: "save"; id: string; expected_version: number | null; values: EnergyValues };
export type ArchiveCommand = { action: "archive"; id: string; expected_version: number };
export type EnergyCommand = SaveCommand | ArchiveCommand;
export type EnergyApi = {
  list(siteId: string, query: EnergyFilters & { cursor: string | null }): Promise<EnergyResult>;
  command(siteId: string, body: EnergyCommand): Promise<EnergyResult>;
};
export type EnergyContext = { generation(): number; userId(): string | null };
export const DEFAULT_ENERGY_CONTEXT: EnergyContext = { generation: () => 0, userId: () => null };
export const ENERGY_TIMEOUT_MS = 15_000;
export const ENERGY_TIMEOUT = -1;

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<EnergyResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: EnergyResult = { status: ENERGY_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<EnergyResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<EnergyResult> => {
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
/** Same-origin, credentials same-origin, no-store, 15 s deadline. The cursor is sent unchanged. */
export function createEnergyApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = ENERGY_TIMEOUT_MS } = {}): EnergyApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  const path = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/energy`;
  return {
    list: (siteId, { from, to, cursor }) => {
      const parts: string[] = [];
      if (from) parts.push(`from=${encodeURIComponent(from)}`);
      if (to) parts.push(`to=${encodeURIComponent(to)}`);
      if (cursor) parts.push(`cursor=${encodeURIComponent(cursor)}`); // opaque, unchanged (base64url)
      const qs = parts.join("&");
      return timed(fetcher, `${path(siteId)}${qs ? `?${qs}` : ""}`, { ...base, method: "GET" }, timeoutMs);
    },
    command: (siteId, body) => timed(fetcher, path(siteId), { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Strict parse --------------------------------------------------------------------------------
const pageSchema = z
  .object({
    records: z.array(energyRecord).max(100),
    page: z.object({ limit: z.literal(100), has_more: z.boolean(), next_cursor: z.string().min(1).max(256).nullable() }).strict(),
    totals: z
      .object({
        consumption_wh: z.number().int().min(0).nullable(),
        cost_cents: z.number().int().min(0).nullable(),
        complete: z.boolean(),
        cost_complete: z.boolean(),
      })
      .strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
    basis: z.literal("recorded_periods_fully_inside_range"),
  })
  .strict();
export type EnergyPageDTO = z.infer<typeof pageSchema>;
/** Anything off-contract ⇒ null (rendered as an error, never as an empty list or a total). */
export function parseEnergyPage(body: unknown, siteId?: string): EnergyPageDTO | null {
  const parsed = pageSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.page.has_more !== (p.page.next_cursor !== null)) return null;
  if (new Set(p.records.map((r) => r.id)).size !== p.records.length) return null;
  if (siteId && p.records.some((r) => r.site_id !== siteId)) return null;
  // A total is only meaningful when complete; an incomplete selection must not carry one.
  if (!p.totals.complete && (p.totals.consumption_wh !== null || p.totals.cost_cents !== null)) return null;
  if (!p.totals.cost_complete && p.totals.cost_cents !== null) return null;
  return p;
}
export function parseRecordReply(body: unknown, command: EnergyCommand, siteId: string): EnergyRecord | null {
  const parsed = z.object({ record: energyRecord }).strict().safeParse(body);
  if (!parsed.success) return null;
  const r = parsed.data.record;
  if (r.id !== command.id || r.site_id !== siteId) return null;
  if (command.action === "archive" ? r.archived_at === null : r.archived_at !== null) return null;
  return r;
}

// ---- Exact units -----------------------------------------------------------------------------------
const GROUP = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
/** Integer Wh shown as kWh, exactly (integer arithmetic, trailing zeros trimmed, never rounded). */
export function formatWh(wh: number): string {
  if (!Number.isSafeInteger(wh) || wh < 0) return "valeur invalide";
  const whole = Math.floor(wh / 1000), rest = wh % 1000;
  const decimals = String(rest).padStart(3, "0").replace(/0+$/, "");
  return `${GROUP(whole)}${decimals ? `,${decimals}` : ""} kWh`;
}
/** Exact « 12,34 » € → 1234 cents; at most 2 decimals, 0..1e9 cents; anything else ⇒ null. */
export function eurosToCents(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, decimals = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 1_000_000_000 ? cents : null;
}
export function formatCents(cents: number | null): string {
  if (cents === null) return "non renseigné";
  const whole = Math.floor(cents / 100), rest = cents % 100;
  return `${GROUP(whole)},${String(rest).padStart(2, "0")} €`;
}
export const whToKwhInput = (wh: number) => {
  const whole = Math.floor(wh / 1000), rest = wh % 1000;
  return rest ? `${whole},${String(rest).padStart(3, "0").replace(/0+$/, "")}` : String(whole);
};
export const centsToEurosInput = (cents: number | null) => (cents === null ? "" : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`);
export { kwhToWh };

// ---- Wording -----------------------------------------------------------------------------------
export const SOURCE_LABEL: Record<EnergyValues["source_kind"], string> = { invoice: "Facture", meter: "Relevé compteur", manual: "Saisie manuelle" };
export const ENERGY_COPY = {
  basis: "Seules les périodes entièrement comprises dans l’intervalle choisi sont comptées (aucun prorata).",
  partial: "Total partiel : d’autres périodes ne sont pas chargées. Aucun total n’est affiché tant que la liste n’est pas complète.",
  costIncomplete: "Coûts incomplets : au moins une période n’a pas de coût renseigné.",
  readOnly: "Lecture seule : vous pouvez consulter les consommations de ce site, sans les modifier.",
  loadFailed: "Les consommations n’ont pas pu être vérifiées. Réessayez.",
  empty: "Aucune période de consommation enregistrée pour ce filtre.",
  conflict: "Modifié entre-temps ou période qui chevauche une autre : actualisez la liste. Votre saisie est conservée.",
  invalid: "Vérifiez les valeurs saisies.",
  unavailable: "Ce site est introuvable ou n’est plus accessible.",
  session: "Votre session a expiré. Reconnectez-vous.",
  retry: "L’enregistrement n’a pas été confirmé. Réessayez : la même demande sera renvoyée.",
  timeout: "Délai dépassé : l’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
} as const;
export function totalsView(t: EnergyPageDTO["totals"]): { consumption: string; cost: string; notes: string[] } {
  const notes: string[] = [];
  if (!t.complete) notes.push(ENERGY_COPY.partial);
  else if (!t.cost_complete) notes.push(ENERGY_COPY.costIncomplete);
  return {
    consumption: t.complete && t.consumption_wh !== null ? formatWh(t.consumption_wh) : "total partiel",
    cost: t.complete && t.cost_complete && t.cost_cents !== null ? formatCents(t.cost_cents) : t.complete ? "coûts incomplets" : "total partiel",
    notes,
  };
}

// ---- Form ----------------------------------------------------------------------------------------
export type EnergyForm = { id: string; expected_version: number | null; meter_label: string; period_start: string; period_end: string; consumption_kwh: string; cost_euros: string; source_kind: EnergyValues["source_kind"]; source_reference: string; note: string };
export type FormErrors = Partial<Record<keyof EnergyForm, string>>;
export function newForm(id: string): EnergyForm {
  return { id, expected_version: null, meter_label: "", period_start: "", period_end: "", consumption_kwh: "", cost_euros: "", source_kind: "invoice", source_reference: "", note: "" };
}
export function editForm(r: EnergyRecord): EnergyForm {
  return { id: r.id, expected_version: r.version, meter_label: r.meter_label, period_start: r.period_start, period_end: r.period_end, consumption_kwh: whToKwhInput(r.consumption_wh), cost_euros: centsToEurosInput(r.cost_cents), source_kind: r.source_kind, source_reference: r.source_reference, note: r.note };
}
/** Form → exact command values (kWh via the backend helper, € via exact decimals) or field errors. */
export function formToCommand(f: EnergyForm): { command: SaveCommand } | { errors: FormErrors } {
  const errors: FormErrors = {};
  const wh = kwhToWh(f.consumption_kwh);
  if (wh === null) errors.consumption_kwh = "Consommation en kWh : nombre positif, 3 décimales au plus.";
  let cost: number | null = null;
  if (f.cost_euros.trim()) {
    cost = eurosToCents(f.cost_euros);
    if (cost === null) errors.cost_euros = "Coût en euros : nombre positif, 2 décimales au plus.";
  }
  const values = { meter_label: f.meter_label.trim(), period_start: f.period_start, period_end: f.period_end, consumption_wh: wh ?? 0, cost_cents: cost, source_kind: f.source_kind, source_reference: f.source_reference.trim(), note: f.note.trim() };
  const parsed = energyValues.safeParse(values);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      const field = (key === "consumption_wh" ? "consumption_kwh" : key === "cost_cents" ? "cost_euros" : key) as keyof EnergyForm;
      if (errors[field]) continue;
      errors[field] =
        field === "meter_label" ? "Compteur : 1 à 160 caractères."
        : field === "period_start" ? "Date de début invalide."
        : field === "period_end" ? (values.period_end && values.period_start && values.period_end < values.period_start ? "La fin de période précède son début." : "Date de fin invalide.")
        : field === "source_reference" ? "Référence : 1 à 240 caractères."
        : field === "note" ? "Note : 2000 caractères au plus."
        : field === "consumption_kwh" ? "Consommation hors limites."
        : field === "cost_euros" ? "Coût hors limites."
        : ENERGY_COPY.invalid;
    }
  if (Object.keys(errors).length) return { errors };
  return { command: { action: "save", id: f.id, expected_version: f.expected_version, values: parsed.data as EnergyValues } };
}

// ---- State machine + controller -------------------------------------------------------------------
export type EnergyState = {
  phase: "loading" | "ready" | "error" | "unavailable";
  records: EnergyRecord[];
  page: EnergyPageDTO["page"] | null;
  /** The filters the current next_cursor belongs to (the cursor is bound to site + from/to). */
  cursorFilters: EnergyFilters | null;
  totals: EnergyPageDTO["totals"] | null;
  canWrite: boolean;
  filters: EnergyFilters;
  loadingMore: boolean;
  error: string;
  /** Write outcome */
  busy: boolean;
  writeError: string;
  /** The exact command to resend after a 503 / timeout (same id + expected_version). */
  pending: EnergyCommand | null;
  saved: string;
};
export const ENERGY_INITIAL: EnergyState = { phase: "loading", records: [], page: null, cursorFilters: null, totals: null, canWrite: false, filters: { from: null, to: null }, loadingMore: false, error: "", busy: false, writeError: "", pending: null, saved: "" };

export function applyList(s: EnergyState, r: EnergyResult, append: boolean, siteId: string): EnergyState {
  if (r.status === 200) {
    const p = parseEnergyPage(r.body, siteId);
    if (!p) return { ...s, loadingMore: false, phase: append ? s.phase : "error", error: ENERGY_COPY.loadFailed };
    const seen = new Set(append ? s.records.map((x) => x.id) : []);
    const records = [...(append ? s.records : []), ...p.records.filter((x) => !seen.has(x.id) && (seen.add(x.id), true))];
    // Totals: the server's for the FIRST page of the selection (incomplete when more pages exist);
    // loading later pages never turns them into an exhaustive client-side sum.
    return { ...s, phase: "ready", records, page: p.page, cursorFilters: { ...s.filters }, totals: append ? s.totals : p.totals, canWrite: p.permissions.can_write, loadingMore: false, error: "" };
  }
  if (r.status === 404) return { ...ENERGY_INITIAL, filters: s.filters, phase: "unavailable", error: ENERGY_COPY.unavailable };
  const error = r.status === 401 || r.status === 403 ? ENERGY_COPY.session : ENERGY_COPY.loadFailed;
  return { ...s, loadingMore: false, phase: append ? s.phase : "error", error };
}
export function applyCommand(s: EnergyState, r: EnergyResult, command: EnergyCommand, siteId: string): EnergyState {
  const base = { ...s, busy: false, writeError: "", saved: "" };
  if (r.status === 200) {
    const record = parseRecordReply(r.body, command, siteId);
    if (!record) return { ...base, writeError: ENERGY_COPY.retry, pending: command };
    const others = s.records.filter((x) => x.id !== record.id);
    const records = command.action === "archive" ? others : s.records.some((x) => x.id === record.id) ? s.records.map((x) => (x.id === record.id ? record : x)) : [record, ...others];
    // Any write makes the shown totals stale: they are hidden until the next full load.
    return { ...base, records, pending: null, totals: s.totals ? { consumption_wh: null, cost_cents: null, complete: false, cost_complete: false } : null, saved: command.action === "archive" ? "Période archivée." : "Période enregistrée." };
  }
  if (r.status === 409) return { ...base, writeError: ENERGY_COPY.conflict, pending: null };
  if (r.status === 422 || r.status === 400) return { ...base, writeError: ENERGY_COPY.invalid, pending: null };
  if (r.status === 404) return { ...base, writeError: ENERGY_COPY.unavailable, pending: null };
  if (r.status === 401 || r.status === 403) return { ...base, writeError: ENERGY_COPY.session, pending: null };
  return { ...base, writeError: r.status === ENERGY_TIMEOUT ? ENERGY_COPY.timeout : ENERGY_COPY.retry, pending: command };
}

export const sameFilters = (a: EnergyFilters, b: EnergyFilters) => a.from === b.from && a.to === b.to;
/** Loads (generation counter) and writes (single flight, ref) outside React; every reply is
 *  applied only if the generation + uid are unchanged since the request started and the view is
 *  still attached. */
export function createEnergyController({ api, siteId, context = DEFAULT_ENERGY_CONTEXT, get, set }: { api: () => EnergyApi; siteId: string; context?: EnergyContext; get: () => EnergyState; set: (s: EnergyState) => void }) {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let writing = false;
  let attached = true;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async (append: boolean) => {
    const my = append ? loadSeq : ++loadSeq;
    const gen = context.generation(), uid = context.userId();
    const s = get();
    const cursor = append ? s.page?.next_cursor ?? null : null;
    const filters = { ...s.filters };
    let r: EnergyResult;
    loadsInFlight++;
    try {
      r = await api().list(siteId, { ...filters, cursor });
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      loadsInFlight--;
    }
    // Dropped if another load started, the identity changed, or the filters changed meanwhile.
    if (!same(gen, uid) || my !== loadSeq || !sameFilters(get().filters, filters)) return false;
    set(applyList(get(), r, append, siteId));
    return true;
  };
  /** Write barrier: every list request started before (or during) a write is void — its reply
   *  can never erase the written record. If a load was in flight, a causal reload starts after
   *  the write so the list reflects the server state including that write. */
  const send = async (command: EnergyCommand) => {
    if (writing) return false;
    writing = true;
    const hadLoad = loadsInFlight > 0 || get().phase === "loading";
    loadSeq++; // barrier at the START of the write
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), busy: true, writeError: "", saved: "", loadingMore: false });
    let r: EnergyResult;
    try {
      r = await api().command(siteId, command);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      writing = false;
    }
    loadSeq++; // and again after the reply: nothing started meanwhile may apply
    if (!same(gen, uid)) return false;
    set(applyCommand(get(), r, command, siteId));
    if (hadLoad) void fetchList(false); // causal reload
    return true;
  };
  return {
    get writing() {
      return writing;
    },
    /** New period (or reload): the cursor is dropped and the list restarts from page 1. */
    load(filters?: EnergyFilters) {
      if (writing) return Promise.resolve(false); // no list request while a write is in flight
      set({ ...get(), ...(filters ? { filters: { ...filters } } : {}), phase: "loading", records: [], page: null, cursorFilters: null, totals: null, error: "", loadingMore: false });
      return fetchList(false);
    },
    more() {
      if (writing) return Promise.resolve(false);
      const s = get();
      // Never reuse a cursor across filters: it must belong to the filters currently applied.
      if (s.loadingMore || !s.page?.has_more || !s.page.next_cursor || !s.cursorFilters || !sameFilters(s.cursorFilters, s.filters)) return Promise.resolve(false);
      set({ ...s, loadingMore: true });
      return fetchList(true);
    },
    save(command: SaveCommand) {
      if (!get().canWrite) return Promise.resolve(false);
      return send(command);
    },
    archive(record: EnergyRecord) {
      if (!get().canWrite) return Promise.resolve(false);
      return send({ action: "archive", id: record.id, expected_version: record.version });
    },
    /** Replay of the exact pending command (same id + expected_version). */
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
