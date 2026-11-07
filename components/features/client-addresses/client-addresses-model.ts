// CLI-09 client saved addresses — pure model (no React): API client, strict parse of the backend
// contract (lib/features/client-addresses/schemas.ts, read-only: its record + values schemas are
// reused), form validation with the same bounds, and the list/command controller (single flight,
// write barrier, identity guard, exact replay of a 503 / timeout command).
//   GET  /api/profile/addresses → { records, page: { limit: 50, count, complete: true }, permissions: { can_write } }
//   POST /api/profile/addresses { action: "save", id, command_id, expected_version, values } | { action: "archive", id, command_id, expected_version } → { record }
import { z } from "zod";
import { addressRecord, addressValues, type ClientAddress } from "../../../lib/features/client-addresses/schemas";

export type { ClientAddress };
export type AddressValues = z.infer<typeof addressValues>;
export type AddressResult = { status: number; body: unknown; retryAfter: number | null };
export type SaveCommand = { action: "save"; id: string; command_id: string; expected_version: number | null; values: AddressValues };
export type ArchiveCommand = { action: "archive"; id: string; command_id: string; expected_version: number };
export type AddressCommand = SaveCommand | ArchiveCommand;
export type AddressApi = { list(): Promise<AddressResult>; command(body: AddressCommand): Promise<AddressResult> };
export type AddressContext = { generation(): number; userId(): string | null };
export const DEFAULT_ADDRESS_CONTEXT: AddressContext = { generation: () => 0, userId: () => null };
export const ADDRESS_PATH = "/api/profile/addresses";
export const ADDRESS_TIMEOUT_MS = 15_000;
export const ADDRESS_TIMEOUT = -1;
export const ADDRESS_LIMIT = 50;

async function timed(fetcher: typeof fetch, init: RequestInit, timeoutMs: number): Promise<AddressResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: AddressResult = { status: ADDRESS_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<AddressResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<AddressResult> => {
    try {
      const response = await fetcher(ADDRESS_PATH, { ...init, ...(controller ? { signal: controller.signal } : {}) });
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
/** Same-origin, credentials same-origin, no-store, 15 s deadline, no query string. */
export function createAddressApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = ADDRESS_TIMEOUT_MS } = {}): AddressApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  return {
    list: () => timed(fetcher, { ...base, method: "GET" }, timeoutMs),
    command: (body) => timed(fetcher, { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Strict parse ---------------------------------------------------------------------------------
const listSchema = z
  .object({
    records: z.array(addressRecord).max(ADDRESS_LIMIT),
    page: z.object({ limit: z.literal(ADDRESS_LIMIT), count: z.number().int().min(0).max(ADDRESS_LIMIT), complete: z.literal(true) }).strict(),
    permissions: z.object({ can_write: z.boolean() }).strict(),
  })
  .strict();
export type AddressListDTO = z.infer<typeof listSchema>;
/** Anything off-contract ⇒ null (an error, never an empty or shortened list). */
export function parseAddressList(body: unknown, userId: string | null): AddressListDTO | null {
  const parsed = listSchema.safeParse(body);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.records.length !== p.page.count) return null;
  if (new Set(p.records.map((r) => r.id)).size !== p.records.length) return null;
  if (p.records.filter((r) => r.is_preferred).length > 1) return null;
  if (p.records.some((r) => r.archived_at !== null || (userId !== null && r.user_id !== userId))) return null;
  return p;
}
/** The reply must be exactly the record the command produced (id, version, archive state, values). */
export function parseRecordReply(body: unknown, command: AddressCommand, userId: string | null): ClientAddress | null {
  const parsed = z.object({ record: addressRecord }).strict().safeParse(body);
  if (!parsed.success) return null;
  const r = parsed.data.record;
  const version = command.expected_version === null ? 1 : command.expected_version + 1;
  if (r.id !== command.id || r.version !== version || (userId !== null && r.user_id !== userId)) return null;
  if ((command.action === "archive") !== (r.archived_at !== null)) return null;
  if (command.action === "save" && (Object.keys(command.values) as (keyof AddressValues)[]).some((k) => r[k] !== command.values[k])) return null;
  return r;
}

// ---- Wording ----------------------------------------------------------------------------------------
export const GEO_SOURCE_LABEL: Record<NonNullable<AddressValues["geo_source"]>, string> = {
  manual_pin: "position placée à la main",
  device_reported: "position transmise par l’appareil",
  geocoder_selected: "position choisie dans une suggestion d’adresse",
};
export const ADDRESS_COPY = {
  declared: "Position déclarée par vous, non vérifiée : elle aide l’artisan à vous trouver, sans garantie d’exactitude.",
  demo: "En démonstration, aucune adresse n’est enregistrée : connectez-vous à votre espace pour mémoriser vos adresses.",
  readOnly: "Lecture seule : vos adresses sont affichées, sans modification possible pour le moment.",
  loadFailed: "Vos adresses n’ont pas pu être vérifiées. Réessayez.",
  empty: "Aucune adresse enregistrée. Ajoutez celle de votre logement ou d’un autre lieu d’intervention.",
  conflict: "Cette adresse a changé entre-temps, ou une autre est déjà votre adresse préférée : actualisez la liste. Votre saisie est conservée.",
  invalid: "Vérifiez les informations saisies.",
  session: "Votre session a expiré. Reconnectez-vous.",
  retry: "L’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
  timeout: "Délai dépassé : l’enregistrement n’est pas confirmé. Réessayez : la même demande sera renvoyée.",
  noUuid: "Ce navigateur ne permet pas de créer un identifiant sécurisé : l’enregistrement d’adresse est impossible ici. Mettez à jour le navigateur ou utilisez-en un autre.",
  otherPreferred: (label: string) => `« ${label} » est votre adresse préférée : retirez d’abord sa préférence pour en choisir une autre.`,
} as const;

// ---- Declared position (explicit user action only) --------------------------------------------------
export const GEO_TIMEOUT_MS = 10_000;
/** Browser GeolocationPositionError codes → honest text; the address stays declared text only. */
export function geoErrorMessage(code: number | null): string {
  if (code === 1) return "Position refusée : l’adresse reste enregistrée sans position.";
  if (code === 3) return "Position non obtenue à temps : l’adresse reste enregistrée sans position. Vous pouvez réessayer.";
  return "Position indisponible sur cet appareil : l’adresse reste enregistrée sans position.";
}
/** A device fix → declared values (device_reported); anything non-finite / out of range ⇒ null. */
export function devicePosition(latitude: unknown, longitude: unknown): { latitude: number; longitude: number; geo_source: "device_reported" } | null {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude, geo_source: "device_reported" };
}

// ---- Form -------------------------------------------------------------------------------------------
export type AddressForm = {
  id: string;
  expected_version: number | null;
  label: string;
  first_name: string;
  last_name: string;
  address: string;
  postal_code: string;
  city: string;
  country_code: string;
  is_preferred: boolean;
  /** Declared position: kept as-is from the record, or cleared. Never invented. */
  latitude: number | null;
  longitude: number | null;
  geo_source: AddressValues["geo_source"];
};
export type FormErrors = Partial<Record<keyof AddressForm | "geo", string>>;
export function newForm(id: string, preferred = false): AddressForm {
  return { id, expected_version: null, label: "", first_name: "", last_name: "", address: "", postal_code: "", city: "", country_code: "FR", is_preferred: preferred, latitude: null, longitude: null, geo_source: null };
}
export function editForm(r: ClientAddress): AddressForm {
  return { id: r.id, expected_version: r.version, label: r.label, first_name: r.first_name, last_name: r.last_name, address: r.address, postal_code: r.postal_code, city: r.city, country_code: r.country_code, is_preferred: r.is_preferred, latitude: r.latitude, longitude: r.longitude, geo_source: r.geo_source };
}
export const recordValues = (r: ClientAddress): AddressValues => ({
  label: r.label,
  first_name: r.first_name,
  last_name: r.last_name,
  address: r.address,
  postal_code: r.postal_code,
  city: r.city,
  country_code: r.country_code,
  latitude: r.latitude,
  longitude: r.longitude,
  geo_source: r.geo_source,
  is_preferred: r.is_preferred,
});
const FIELD_ERRORS: Record<string, string> = {
  label: "Nom de l’adresse : 1 à 100 caractères.",
  first_name: "Prénom : 1 à 100 caractères.",
  last_name: "Nom : 1 à 100 caractères.",
  address: "Adresse complète : 5 à 500 caractères (numéro et voie).",
  postal_code: "Code postal : 2 à 20 lettres, chiffres, espaces ou tirets.",
  city: "Ville : 1 à 160 caractères.",
  country_code: "Pays : code à deux lettres (ex. FR).",
};
/** Form → exact command values validated by the backend schema itself, or field errors. */
export function formToValues(f: AddressForm): { values: AddressValues } | { errors: FormErrors } {
  const candidate = {
    label: f.label.trim(),
    first_name: f.first_name.trim(),
    last_name: f.last_name.trim(),
    address: f.address.trim(),
    postal_code: f.postal_code.trim().toUpperCase(),
    city: f.city.trim(),
    country_code: f.country_code.trim().toUpperCase(),
    latitude: f.latitude,
    longitude: f.longitude,
    geo_source: f.geo_source,
    is_preferred: f.is_preferred,
  };
  const parsed = addressValues.safeParse(candidate);
  if (parsed.success) return { values: parsed.data };
  const errors: FormErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    const field = (key in FIELD_ERRORS ? key : "geo") as keyof FormErrors;
    if (!errors[field]) errors[field] = FIELD_ERRORS[key] ?? "Position déclarée invalide : coordonnées et provenance vont ensemble.";
  }
  return { errors };
}

// ---- State + controller ---------------------------------------------------------------------------
export type AddressState = {
  phase: "loading" | "ready" | "error";
  records: ClientAddress[];
  canWrite: boolean;
  error: string;
  busy: boolean;
  writeError: string;
  /** The exact command to resend after a 503 / timeout (same id, command_id, expected_version, values). */
  pending: AddressCommand | null;
  saved: string;
};
export const ADDRESS_INITIAL: AddressState = { phase: "loading", records: [], canWrite: false, error: "", busy: false, writeError: "", pending: null, saved: "" };
const order = (records: ClientAddress[]) => [...records].sort((a, b) => Number(b.is_preferred) - Number(a.is_preferred) || a.label.localeCompare(b.label, "fr"));

export function applyList(s: AddressState, r: AddressResult, userId: string | null): AddressState {
  if (r.status === 200) {
    const p = parseAddressList(r.body, userId);
    if (!p) return { ...s, phase: "error", records: [], error: ADDRESS_COPY.loadFailed };
    return { ...s, phase: "ready", records: order(p.records), canWrite: p.permissions.can_write, error: "" };
  }
  return { ...s, phase: "error", records: [], error: r.status === 401 || r.status === 403 ? ADDRESS_COPY.session : ADDRESS_COPY.loadFailed };
}
export function applyCommand(s: AddressState, r: AddressResult, command: AddressCommand, userId: string | null): AddressState {
  const base = { ...s, busy: false, writeError: "", saved: "" };
  if (r.status === 200) {
    const record = parseRecordReply(r.body, command, userId);
    // Unverifiable success: the same command can be replayed (the server answers the replay
    // exactly, or 409 if the address changed meanwhile — never a stale success).
    if (!record) return { ...base, writeError: ADDRESS_COPY.retry, pending: command };
    const others = s.records.filter((x) => x.id !== record.id);
    const records = command.action === "archive" ? others : order([record, ...others]);
    const saved = command.action === "archive" ? "Adresse archivée." : command.expected_version === null ? "Adresse enregistrée." : "Adresse mise à jour.";
    return { ...base, records, pending: null, saved };
  }
  if (r.status === 409) return { ...base, writeError: ADDRESS_COPY.conflict, pending: null };
  if (r.status === 422 || r.status === 400) return { ...base, writeError: ADDRESS_COPY.invalid, pending: null };
  if (r.status === 401 || r.status === 403) return { ...base, writeError: ADDRESS_COPY.session, pending: null };
  if (r.status === 429) return { ...base, writeError: ADDRESS_COPY.retry, pending: command };
  return { ...base, writeError: r.status === ADDRESS_TIMEOUT ? ADDRESS_COPY.timeout : ADDRESS_COPY.retry, pending: command };
}

/** Loads (sequence counter) and writes (single flight) outside React; a reply applies only if the
 *  identity (generation + uid) is unchanged and the view is attached. A write voids every list
 *  request started before or during it (write barrier) and re-reads the list afterwards when one
 *  was in flight. No automatic retry: a 503 / timeout keeps the exact command for « Réessayer ». */
export function createAddressController({ api, context = DEFAULT_ADDRESS_CONTEXT, get, set }: { api: () => AddressApi; context?: AddressContext; get: () => AddressState; set: (s: AddressState) => void }) {
  let loadSeq = 0;
  let loadsInFlight = 0;
  let writing = false;
  let attached = true;
  const same = (gen: number, uid: string | null) => attached && context.generation() === gen && context.userId() === uid;
  const fetchList = async () => {
    const my = ++loadSeq;
    const gen = context.generation(), uid = context.userId();
    let r: AddressResult;
    loadsInFlight++;
    try {
      r = await api().list();
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      loadsInFlight--;
    }
    if (!same(gen, uid) || my !== loadSeq) return false;
    set(applyList(get(), r, uid));
    return true;
  };
  const send = async (command: AddressCommand) => {
    if (writing) return false;
    writing = true;
    const hadLoad = loadsInFlight > 0 || get().phase === "loading";
    loadSeq++;
    const gen = context.generation(), uid = context.userId();
    set({ ...get(), busy: true, writeError: "", saved: "" });
    let r: AddressResult;
    try {
      r = await api().command(command);
    } catch {
      r = { status: 0, body: null, retryAfter: null };
    } finally {
      writing = false;
    }
    loadSeq++;
    if (!same(gen, uid)) return false;
    set(applyCommand(get(), r, command, uid));
    if (hadLoad) void fetchList();
    return true;
  };
  return {
    get writing() {
      return writing;
    },
    load() {
      if (writing) return Promise.resolve(false);
      set({ ...get(), phase: "loading", records: [], error: "" });
      return fetchList();
    },
    save(command: SaveCommand) {
      return get().canWrite ? send(command) : Promise.resolve(false);
    },
    archive(record: ClientAddress, commandId: string) {
      return get().canWrite ? send({ action: "archive", id: record.id, command_id: commandId, expected_version: record.version }) : Promise.resolve(false);
    },
    /** Explicit preference change on an existing address (same values, versioned). */
    setPreferred(record: ClientAddress, preferred: boolean, commandId: string) {
      if (!get().canWrite) return Promise.resolve(false);
      return send({ action: "save", id: record.id, command_id: commandId, expected_version: record.version, values: { ...recordValues(record), is_preferred: preferred } });
    },
    /** Replay of the exact pending command. */
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
