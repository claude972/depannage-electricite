"use client";
// Address field leaf (FASTSPLIT-CLIENT-ADDRESS-NAME-001). Street / postal code / city stay three
// normal, labelled, editable inputs; suggestions (IGN / BAN through our API) and « Utiliser ma
// position » only ever fill them after an EXPLICIT choice. Pure controller (debounce, abort,
// stale replies, keyboard, geolocation) + thin React view; the controller is tested without DOM.
// Coordinates never leave this file: the emitted value is { address, postal_code, city } only.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./address-field.module.css";

// ---- Contract types: published by the address API (lib/features/addresses/types.ts) --------
import type { AddressAssistError as ApiError, AddressCandidate, AddressSuggestions } from "../../lib/features/addresses/types";
export type { AddressCandidate, AddressSuggestions };
/** Rejection shape of `search` / `reverse`: the API error body + optional Retry-After seconds. */
export type AddressAssistError = ApiError & { retryAfterSeconds?: number };
export type AddressValue = { address: string; postal_code: string; city: string };
export type AddressSearch = (q: string, signal: AbortSignal) => Promise<AddressSuggestions>;
export type AddressReverse = (lat: number, lon: number, signal: AbortSignal) => Promise<AddressSuggestions>;
type GeoLike = Pick<Geolocation, "getCurrentPosition">;

export const ADDRESS_COPY = {
  searching: "Recherche…",
  empty: "Aucune adresse trouvée",
  unavailable: "Suggestions indisponibles, saisissez l’adresse",
  locate: "Utiliser ma position",
  locating: "Localisation en cours…",
  confirmUse: "Utiliser cette adresse",
  confirmNo: "Non",
  geoRefused: "Position refusée. Saisissez l’adresse.",
  geoTimeout: "Position indisponible (délai dépassé). Saisissez l’adresse.",
  geoUnavailable: "Position indisponible. Saisissez l’adresse.",
  geoNone: "Aucune adresse trouvée pour cette position. Saisissez l’adresse.",
} as const;
export const MIN_QUERY = 3;
export const DEBOUNCE_MS = 300;
export const GEO_TIMEOUT_MS = 10_000;
const MAX_CANDIDATES = 5;

// ---- Pure controller ---------------------------------------------------------------------------
export type AddressState = {
  status: "idle" | "searching" | "results" | "empty" | "unavailable";
  candidates: AddressCandidate[];
  attribution: string;
  /** Neutral message shown when suggestions are unavailable (API `message` when given). */
  message: string;
  open: boolean;
  active: number;
  geo: "idle" | "locating" | "confirm" | "message";
  geoCandidate: AddressCandidate | null;
  geoMessage: string;
};
export const INITIAL_ADDRESS_STATE: AddressState = {
  status: "idle",
  candidates: [],
  attribution: "",
  message: "",
  open: false,
  active: -1,
  geo: "idle",
  geoCandidate: null,
  geoMessage: "",
};
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void; now(): number };
const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};
/** True when `value` was not produced by this field's own last emission (external replace). */
export function isExternalChange(value: AddressValue, lastEmitted: AddressValue): boolean {
  return value.address !== lastEmitted.address || value.postal_code !== lastEmitted.postal_code || value.city !== lastEmitted.city;
}
/** Only the three address strings: never ids, labels or coordinates. */
export function pickFields(c: AddressCandidate): AddressValue {
  return { address: c.address, postal_code: c.postal_code, city: c.city };
}
function isAbort(e: unknown) {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}
function errorInfo(e: unknown): { message: string; retryable: boolean; retryAfterMs: number } {
  const o = (typeof e === "object" && e !== null ? e : {}) as Partial<AddressAssistError>;
  const message = typeof o.message === "string" && o.message.trim() ? o.message.trim().slice(0, 200) : ADDRESS_COPY.unavailable;
  const retryable = o.retryable === true;
  const seconds = typeof o.retryAfterSeconds === "number" && Number.isFinite(o.retryAfterSeconds) ? Math.min(Math.max(o.retryAfterSeconds, 1), 60) : 2;
  return { message, retryable, retryAfterMs: seconds * 1000 };
}
function cleanCandidates(s: AddressSuggestions | null | undefined): AddressCandidate[] {
  const list = Array.isArray(s?.candidates) ? s!.candidates : [];
  return list
    .filter((c) => c && typeof c.id === "string" && typeof c.label === "string" && typeof c.address === "string" && typeof c.postal_code === "string" && typeof c.city === "string")
    .slice(0, MAX_CANDIDATES);
}

export type AddressControllerOptions = {
  search?: AddressSearch;
  reverse?: AddressReverse;
  geolocation?: GeoLike | null;
  /** Explicit choice only (suggestion picked or position confirmed). */
  onPick(fields: AddressValue): void;
  onState(state: AddressState): void;
  timers?: Timers;
};

export function createAddressController(opts: AddressControllerOptions) {
  const timers = opts.timers ?? defaultTimers;
  const deps: { search?: AddressSearch; reverse?: AddressReverse; geolocation?: GeoLike | null } = { search: opts.search, reverse: opts.reverse, geolocation: opts.geolocation };
  let state: AddressState = INITIAL_ADDRESS_STATE;
  let timer: unknown = null;
  let inflight: AbortController | null = null;
  let seq = 0;
  /** No request before this instant (retryable error with Retry-After): no retry storm. */
  let blockedUntil = 0;
  let geoAbort: AbortController | null = null;
  let geoGuard: unknown = null;
  let geoSeq = 0;

  const set = (patch: Partial<AddressState>) => {
    state = { ...state, ...patch };
    opts.onState(state);
  };
  const cancelSearch = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
    inflight?.abort();
    inflight = null;
    seq++;
  };

  async function run(q: string) {
    timer = null;
    if (!deps.search) return;
    if (timers.now() < blockedUntil) {
      set({ status: "unavailable", open: true, candidates: [], active: -1 });
      return;
    }
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    const id = ++seq;
    set({ status: "searching", open: true, candidates: [], active: -1 });
    try {
      const reply = await deps.search(q, ctrl.signal);
      if (id !== seq || ctrl.signal.aborted) return; // stale or superseded: dropped
      inflight = null;
      const candidates = cleanCandidates(reply);
      set({ status: candidates.length ? "results" : "empty", candidates, attribution: typeof reply?.attribution === "string" ? reply.attribution : "", open: true, active: -1 });
    } catch (e) {
      if (id !== seq || ctrl.signal.aborted || isAbort(e)) return;
      inflight = null;
      const info = errorInfo(e);
      if (info.retryable) blockedUntil = timers.now() + info.retryAfterMs;
      set({ status: "unavailable", message: info.message, candidates: [], open: true, active: -1 });
    }
  }

  return {
    getState: () => state,
    /** Latest search / reverse / geolocation from props (read at call time). */
    setDeps(next: { search?: AddressSearch; reverse?: AddressReverse; geolocation?: GeoLike | null }) {
      deps.search = next.search;
      deps.reverse = next.reverse;
      deps.geolocation = next.geolocation;
    },
    /** Street typed by the user (the value itself is updated by the caller, never here). */
    input(text: string) {
      cancelSearch();
      const q = text.trim();
      if (!deps.search || q.length < MIN_QUERY) {
        set({ status: "idle", candidates: [], open: false, active: -1 });
        return;
      }
      // E11: suggestions of the previous text are void at once (Enter can no longer choose them).
      set({ status: "idle", candidates: [], open: false, active: -1 });
      timer = timers.set(() => void run(q), DEBOUNCE_MS);
    },
    move(delta: 1 | -1) {
      const n = state.candidates.length;
      if (!n) return;
      if (!state.open) {
        set({ open: true, active: delta > 0 ? 0 : n - 1 });
        return;
      }
      const next = state.active < 0 ? (delta > 0 ? 0 : n - 1) : (state.active + delta + n) % n;
      set({ active: next });
    },
    /** Explicit choice (Enter on the active option or click). Returns true when something was picked. */
    choose(index = state.active): boolean {
      const c = state.open ? state.candidates[index] : undefined;
      if (!c) return false;
      cancelSearch();
      opts.onPick(pickFields(c));
      set({ status: "idle", candidates: [], open: false, active: -1 });
      return true;
    },
    close() {
      if (state.open) set({ open: false, active: -1 });
    },
    // ---- « Utiliser ma position »: click only, one getCurrentPosition, no watch ----
    locate() {
      const geo = deps.geolocation;
      const reverse = deps.reverse;
      if (!geo || !reverse || state.geo === "locating") return;
      const id = ++geoSeq;
      geoAbort?.abort();
      set({ geo: "locating", geoCandidate: null, geoMessage: "" });
      let settled = false;
      const finish = (patch: Partial<AddressState>) => {
        if (settled || id !== geoSeq) return;
        settled = true;
        if (geoGuard !== null) timers.clear(geoGuard);
        geoGuard = null;
        set(patch);
      };
      // Own guard in case the browser never calls back.
      geoGuard = timers.set(() => {
        geoAbort?.abort();
        finish({ geo: "message", geoMessage: ADDRESS_COPY.geoTimeout });
      }, GEO_TIMEOUT_MS + 500);
      geo.getCurrentPosition(
        (pos) => {
          if (settled || id !== geoSeq) return;
          const ctrl = new AbortController();
          geoAbort = ctrl;
          reverse(pos.coords.latitude, pos.coords.longitude, ctrl.signal).then(
            (reply) => {
              if (ctrl.signal.aborted) return;
              const c = cleanCandidates(reply)[0];
              finish(c ? { geo: "confirm", geoCandidate: c } : { geo: "message", geoMessage: ADDRESS_COPY.geoNone });
            },
            (e) => {
              if (ctrl.signal.aborted || isAbort(e)) return;
              finish({ geo: "message", geoMessage: errorInfo(e).message === ADDRESS_COPY.unavailable ? ADDRESS_COPY.geoUnavailable : errorInfo(e).message });
            },
          );
        },
        (err) => {
          const code = (err as { code?: number } | null)?.code;
          finish({ geo: "message", geoMessage: code === 1 ? ADDRESS_COPY.geoRefused : code === 3 ? ADDRESS_COPY.geoTimeout : ADDRESS_COPY.geoUnavailable });
        },
        { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 },
      );
    },
    /** « Utiliser cette adresse » (true) or « Non » (false). Only true fills the fields. */
    confirmGeo(use: boolean) {
      const c = state.geoCandidate;
      if (state.geo !== "confirm" || !c) return;
      if (use) opts.onPick(pickFields(c));
      set({ geo: "idle", geoCandidate: null, geoMessage: "" });
    },
    dismissGeo() {
      if (state.geo === "message") set({ geo: "idle", geoMessage: "" });
    },
    /** Parent replaced the value (new draft / reset): forget everything in flight. Aborts the
     *  search and reverse, cancels a pending geolocation (its late callback is ignored), closes
     *  the list and drops any pending « Utiliser cette adresse » confirmation. */
    reset() {
      cancelSearch();
      blockedUntil = 0;
      geoSeq++;
      geoAbort?.abort();
      geoAbort = null;
      if (geoGuard !== null) timers.clear(geoGuard);
      geoGuard = null;
      state = INITIAL_ADDRESS_STATE;
      opts.onState(state);
    },
    dispose() {
      cancelSearch();
      geoSeq++;
      geoAbort?.abort();
      if (geoGuard !== null) timers.clear(geoGuard);
    },
  };
}
export type AddressController = ReturnType<typeof createAddressController>;

// ---- Optional API client (the lead decides where it is wired) ---------------------------------
export function createAddressApi(options: { fetcher?: typeof fetch; searchPath?: string; reversePath?: string } = {}) {
  const fetcher = options.fetcher ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const searchPath = options.searchPath ?? "/api/addresses/search";
  const reversePath = options.reversePath ?? "/api/addresses/reverse";
  async function call(url: string, signal: AbortSignal): Promise<AddressSuggestions> {
    const res = await fetcher(url, { signal, cache: "no-store", headers: { Accept: "application/json" } });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const b = (body ?? {}) as Partial<AddressAssistError>;
      const retryAfter = Number(res.headers.get("Retry-After"));
      const error: AddressAssistError = {
        message: typeof b.message === "string" ? b.message : ADDRESS_COPY.unavailable,
        retryable: typeof b.retryable === "boolean" ? b.retryable : res.status !== 400,
        ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
      };
      throw error;
    }
    const b = (body ?? {}) as Partial<AddressSuggestions>;
    return { source: "IGN / BAN", candidates: cleanCandidates(b as AddressSuggestions), attribution: typeof b.attribution === "string" ? b.attribution : "" };
  }
  return {
    search: (q: string, signal: AbortSignal) => call(`${searchPath}?q=${encodeURIComponent(q)}`, signal),
    reverse: (lat: number, lon: number, signal: AbortSignal) => call(`${reversePath}?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`, signal),
  };
}

/** Attribution line: always names the source « IGN / BAN », plus the API's attribution text. */
export function attributionText(attribution: string): string {
  const extra = attribution.trim();
  return extra ? `Suggestions IGN / BAN — ${extra}` : "Suggestions IGN / BAN";
}

// ---- View --------------------------------------------------------------------------------------
export function AddressField({
  value,
  onChange,
  disabled = false,
  error,
  search,
  reverse,
  geolocation,
}: {
  value: AddressValue;
  onChange(next: AddressValue): void;
  disabled?: boolean;
  error?: string;
  search?: AddressSearch;
  reverse?: AddressReverse;
  geolocation?: GeoLike | null;
}) {
  const uid = useId();
  const ids = { street: `${uid}-street`, list: `${uid}-list`, status: `${uid}-status`, error: `${uid}-error`, postal: `${uid}-postal`, city: `${uid}-city`, geo: `${uid}-geo` };
  const [state, setState] = useState<AddressState>(INITIAL_ADDRESS_STATE);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  /** Last value this field emitted (or received): anything else is an external replacement. */
  const lastEmitted = useRef<AddressValue>(value);
  const emit = (next: AddressValue) => {
    lastEmitted.current = next;
    latest.current.onChange(next);
  };
  const ctrlRef = useRef<AddressController | null>(null);
  if (ctrlRef.current === null)
    ctrlRef.current = createAddressController({
      search,
      reverse,
      geolocation: geolocation ?? null,
      onState: setState,
      onPick: (fields) => emit({ ...latest.current.value, ...fields }),
    });
  const ctrl = ctrlRef.current;
  ctrl.setDeps({ search, reverse, geolocation: geolocation ?? null });
  useEffect(() => () => ctrl.dispose(), [ctrl]);
  // New draft / reset from the parent: an old suggestion, request or confirmation must never
  // apply to the new value.
  useEffect(() => {
    if (isExternalChange(value, lastEmitted.current)) ctrl.reset();
    lastEmitted.current = value;
  }, [ctrl, value]);

  const canLocate = Boolean(geolocation && reverse);
  const listShown = state.open && state.status !== "idle";
  const activeId = listShown && state.active >= 0 ? `${ids.list}-${state.active}` : undefined;
  const statusText = state.status === "searching" ? ADDRESS_COPY.searching : state.status === "empty" ? ADDRESS_COPY.empty : state.status === "unavailable" ? state.message || ADDRESS_COPY.unavailable : "";

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      ctrl.move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      ctrl.move(-1);
    } else if (e.key === "Enter") {
      if (listShown && state.active >= 0) {
        e.preventDefault(); // never submits the form while choosing
        ctrl.choose();
      }
    } else if (e.key === "Escape") {
      if (listShown) {
        e.preventDefault();
        ctrl.close();
      }
    }
  };

  return (
    <div className={styles.root}>
      <div className={styles.field}>
        <label htmlFor={ids.street}>Adresse d’intervention</label>
        <div className={styles.combo}>
          <input
            id={ids.street}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listShown}
            aria-controls={ids.list}
            aria-activedescendant={activeId}
            aria-describedby={[statusText ? ids.status : "", error ? ids.error : ""].filter(Boolean).join(" ") || undefined}
            aria-invalid={error ? true : undefined}
            required
            minLength={5}
            maxLength={250}
            autoComplete="street-address"
            placeholder="Numéro et nom de rue"
            value={value.address}
            disabled={disabled}
            onChange={(e) => {
              emit({ ...latest.current.value, address: e.target.value });
              ctrl.input(e.target.value);
            }}
            onKeyDown={onKey}
            onBlur={() => ctrl.close()}
          />
          <div className={styles.popup} hidden={!listShown}>
            <ul id={ids.list} role="listbox" aria-label="Adresses suggérées" className={styles.list}>
              {state.candidates.map((c, i) => (
                <li
                  key={c.id}
                  id={`${ids.list}-${i}`}
                  role="option"
                  aria-selected={i === state.active}
                  className={styles.option}
                  // mousedown would blur the input (closing the list) before the click lands
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => ctrl.choose(i)}
                >
                  <strong>{c.address}</strong>
                  <span>
                    {c.postal_code} {c.city}
                  </span>
                </li>
              ))}
            </ul>
            {state.status === "results" && <p className={styles.attribution}>{attributionText(state.attribution)}</p>}
          </div>
        </div>
        <p id={ids.status} className={styles.status} role="status" aria-live="polite">
          {statusText}
        </p>
        {error && (
          <p id={ids.error} className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>

      {canLocate && (
        <div className={styles.geo} id={ids.geo}>
          {state.geo === "confirm" && state.geoCandidate ? (
            <div className={styles.confirm} role="group" aria-label="Adresse trouvée pour votre position">
              <p>
                <strong>{state.geoCandidate.address}</strong>
                <span>
                  {state.geoCandidate.postal_code} {state.geoCandidate.city}
                </span>
              </p>
              <div className={styles.confirmActions}>
                <button type="button" className={styles.primary} onClick={() => ctrl.confirmGeo(true)}>
                  {ADDRESS_COPY.confirmUse}
                </button>
                <button type="button" className={styles.secondary} onClick={() => ctrl.confirmGeo(false)}>
                  {ADDRESS_COPY.confirmNo}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.secondary} disabled={disabled || state.geo === "locating"} onClick={() => ctrl.locate()}>
              {state.geo === "locating" ? ADDRESS_COPY.locating : ADDRESS_COPY.locate}
            </button>
          )}
          <p className={styles.status} role="status" aria-live="polite">
            {state.geo === "message" ? state.geoMessage : ""}
          </p>
        </div>
      )}

      <div className={styles.columns}>
        <div className={styles.field}>
          <label htmlFor={ids.postal}>Code postal</label>
          <input
            id={ids.postal}
            required
            inputMode="numeric"
            pattern="[0-9]{5}"
            maxLength={5}
            autoComplete="postal-code"
            value={value.postal_code}
            disabled={disabled}
            onChange={(e) => emit({ ...latest.current.value, postal_code: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={ids.city}>Ville</label>
          <input
            id={ids.city}
            required
            minLength={2}
            maxLength={100}
            autoComplete="address-level2"
            value={value.city}
            disabled={disabled}
            onChange={(e) => emit({ ...latest.current.value, city: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
