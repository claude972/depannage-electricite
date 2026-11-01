"use client";
// On-site settlement leaf (booking « règlement sur place »). Frozen DTO:
//   GET  /api/bookings/settlement/onsite?intervention_id=UUID   (owner client OR assigned artisan)
//   POST /api/bookings/settlement/onsite  { intervention_id }    (assigned approved artisan only)
// The server is the only source of truth: a 404 means « not an on-site booking dossier » (render
// nothing); an error or a malformed reply is never shown as settled. A client can NEVER declare.
// `onSettled` (the lead passes session.refresh) fires at most ONCE per mount, only for a verified
// « declared_received » reply under the unchanged identity (generation + UID) while mounted: the
// POST reply or any GET (first load, « Actualiser », re-read after a 503 / timeout): the parent
// dossier may be stale. The lead passes it only while the dossier is not « paid » (no loop).
// A declaration is the artisan's statement that the amount was received on site — not a bank
// payment, and it is never worded as one.
import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "../app/format";
import styles from "./onsite-settlement.module.css";

export const ONSITE_PATH = "/api/bookings/settlement/onsite";
export const ONSITE_TIMEOUT_MS = 15_000;

export type OnsiteDue = { method: "on_site"; status: "due_on_site"; amount_cents: number | null; currency: "eur"; can_declare: boolean; available: boolean };
export type OnsiteDeclared = { method: "on_site_declared"; status: "declared_received"; amount_cents: number | null; currency: "eur"; can_declare: false; available: false };
export type OnsiteSettlementState = OnsiteDue | OnsiteDeclared;
export type OnsiteReply = { status: number; body: unknown };
export type OnsiteApi = {
  get(interventionId: string): Promise<OnsiteReply>;
  post(body: { intervention_id: string }): Promise<OnsiteReply>;
};
export type OnsiteContext = { generation(): number; userId(): string | null };
export type Viewer = "client" | "artisan";

/** Strict parse of the frozen DTO; anything else is null (never « settled »). Extra keys dropped. */
export function parseOnsiteSettlement(raw: unknown): OnsiteSettlementState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const amount = v.amount_cents;
  if (!(amount === null || (Number.isSafeInteger(amount) && (amount as number) >= 0))) return null;
  if (v.currency !== "eur" || typeof v.can_declare !== "boolean" || typeof v.available !== "boolean") return null;
  const amount_cents = amount as number | null;
  if (v.method === "on_site" && v.status === "due_on_site")
    return { method: "on_site", status: "due_on_site", amount_cents, currency: "eur", can_declare: v.can_declare, available: v.available };
  if (v.method === "on_site_declared" && v.status === "declared_received" && v.can_declare === false && v.available === false)
    return { method: "on_site_declared", status: "declared_received", amount_cents, currency: "eur", can_declare: false, available: false };
  return null;
}

export const ONSITE_COPY = {
  loading: "Chargement du règlement sur place…",
  loadError: "Le règlement sur place n’a pas pu être vérifié pour le moment.",
  clientDue: (cents: number | null) =>
    cents === null
      ? "Règlement sur place prévu — montant à confirmer, à régler à l’artisan après l’intervention."
      : `Règlement sur place prévu (${money(cents)}) — à régler à l’artisan après l’intervention.`,
  artisanDue: (cents: number | null) =>
    cents === null ? "Règlement sur place prévu — montant à confirmer." : `Règlement sur place prévu (${money(cents)}) — à recevoir du client après l’intervention.`,
  artisanNoAmount: "La déclaration sera possible une fois le montant connu.",
  artisanUnavailable: "La déclaration du règlement reçu n’est pas disponible pour ce dossier pour le moment.",
  artisanNotAllowed: "Seul l’artisan affecté à ce dossier peut déclarer le règlement reçu.",
  declare: "Déclarer le règlement reçu sur place",
  confirm: (cents: number) => `Je confirme avoir reçu ${money(cents)} sur place`,
  cancel: "Annuler",
  sending: "Enregistrement de la déclaration…",
  declared: (cents: number | null) =>
    cents === null
      ? "Déclaré reçu sur place par l’artisan. Ce n’est pas un paiement bancaire."
      : `Déclaré reçu sur place par l’artisan (${money(cents)}). Ce n’est pas un paiement bancaire.`,
  retry: "Statut non confirmé. Vérifiez à nouveau ou reprenez la même déclaration.",
  conflict: "Ce dossier a changé entre-temps : la déclaration n’a pas été enregistrée. Actualisez pour voir son état.",
  forbidden: "Action réservée à l’artisan affecté.",
  unauthenticated: "Votre session a expiré : reconnectez-vous pour déclarer le règlement reçu.",
} as const;

// ---- Network (same-origin, credentials same-origin, no-store, 15 s timeout) -----------------
async function call(url: string, init: RequestInit, timeoutMs: number): Promise<OnsiteReply> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null }; // network failure or timeout: retryable, never a success
  } finally {
    clearTimeout(timer);
  }
}
export function createOnsiteApi(timeoutMs = ONSITE_TIMEOUT_MS): OnsiteApi {
  return {
    get: (id) => call(`${ONSITE_PATH}?intervention_id=${encodeURIComponent(id)}`, { method: "GET", headers: { accept: "application/json" } }, timeoutMs),
    post: (body) =>
      call(ONSITE_PATH, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}
const DEFAULT_API = createOnsiteApi();
/** Test default only: one fixed generation and identity. The lead passes the session's own. */
export const DEFAULT_ONSITE_CONTEXT: OnsiteContext = { generation: () => 0, userId: () => "current" };

// ---- Load ------------------------------------------------------------------------------------
export type LoadOutcome = { kind: "ready"; settlement: OnsiteSettlementState } | { kind: "hidden" } | { kind: "error" };
export async function loadOnsite(api: OnsiteApi, interventionId: string): Promise<LoadOutcome> {
  const r = await api.get(interventionId);
  if (r.status === 404 || r.status === 401 || r.status === 403) return { kind: "hidden" };
  if (r.status !== 200) return { kind: "error" };
  const settlement = parseOnsiteSettlement(r.body);
  return settlement ? { kind: "ready", settlement } : { kind: "error" };
}

// ---- Declare (single flight, identity-bound) ----------------------------------------------------
export type DeclareOutcome =
  | { kind: "declared"; settlement: OnsiteDeclared }
  | { kind: "retry" | "conflict" | "forbidden" | "unauthenticated" }
  | { kind: "busy" | "ignored" };
export type Flight = { current: boolean };
/** ONE POST at a time (a second call in the same tick is refused before React re-renders). The
 *  generation and the UID are captured before the first await; the reply is ignored when either
 *  changed or when `alive()` is false (unmounted / other dossier). Body is exactly {intervention_id}. */
export async function declareOnsite(flight: Flight, context: OnsiteContext, api: OnsiteApi, interventionId: string, alive: () => boolean): Promise<DeclareOutcome> {
  if (flight.current) return { kind: "busy" };
  const me = context.userId();
  if (!me) return { kind: "unauthenticated" };
  flight.current = true;
  const generation = context.generation();
  try {
    const r = await api.post({ intervention_id: interventionId });
    if (!alive() || context.generation() !== generation || context.userId() !== me) return { kind: "ignored" };
    if (r.status === 200 || r.status === 201) {
      const s = parseOnsiteSettlement(r.body);
      return s && s.status === "declared_received" ? { kind: "declared", settlement: s } : { kind: "conflict" };
    }
    if (r.status === 0 || r.status === 503 || r.status >= 500) return { kind: "retry" };
    if (r.status === 403) return { kind: "forbidden" };
    if (r.status === 401) return { kind: "unauthenticated" };
    return { kind: "conflict" }; // 404 / 409 / 422 / other: the dossier state must be re-read
  } finally {
    flight.current = false;
  }
}

// ---- Component ---------------------------------------------------------------------------------
export type OnsiteLoad = { phase: "loading" } | { phase: "hidden" } | { phase: "error" } | { phase: "ready"; settlement: OnsiteSettlementState };
export type OnsitePostError = "retry" | "conflict" | "forbidden" | "unauthenticated" | null;

export function OnsiteSettlement({
  interventionId,
  viewer,
  api = DEFAULT_API,
  context = DEFAULT_ONSITE_CONTEXT,
  onSettled,
}: {
  interventionId: string;
  viewer: Viewer;
  api?: OnsiteApi;
  context?: OnsiteContext;
  onSettled?: () => void;
}) {
  const [load, setLoad] = useState<OnsiteLoad>({ phase: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [postError, setPostError] = useState<OnsitePostError>(null);
  const flight = useRef<Flight>({ current: false });
  const mounted = useRef(true);
  const seq = useRef(0);
  const current = useRef(interventionId);
  current.current = interventionId;
  const settled = useRef(false); // onSettled already fired for this mount
  const settledCb = useRef(onSettled);
  settledCb.current = onSettled;
  const fireSettled = () => {
    if (settled.current) return;
    settled.current = true;
    settledCb.current?.();
  };

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const generation = context.generation();
    const me = context.userId();
    setLoad({ phase: "loading" });
    setConfirming(false);
    setPostError(null);
    const out = await loadOnsite(api, interventionId);
    if (!mounted.current || seq.current !== mine) return;
    const sameIdentity = context.generation() === generation && context.userId() === me;
    setLoad(out.kind === "ready" ? { phase: "ready", settlement: out.settlement } : { phase: out.kind });
    if (sameIdentity && out.kind === "ready" && out.settlement.status === "declared_received") fireSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, interventionId]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
      seq.current += 1;
    };
  }, [reload]);

  async function submit() {
    if (viewer !== "artisan") return; // a client can never declare, whatever the server flags say
    const id = interventionId;
    const loadSeq = seq.current;
    if (flight.current.current) return;
    setSending(true);
    setPostError(null);
    const out = await declareOnsite(flight.current, context, api, id, () => mounted.current && current.current === id && seq.current === loadSeq);
    if (out.kind === "busy" || !mounted.current) return;
    if (out.kind === "ignored") {
      setSending(false);
      return;
    }
    setSending(false);
    if (out.kind === "declared") {
      setConfirming(false);
      setLoad({ phase: "ready", settlement: out.settlement });
      fireSettled(); // declareOnsite already verified mount + generation + UID
      return;
    }
    setPostError(out.kind); // the confirm step stays open: « Réessayer » sends the identical body
  }

  return (
    <OnsiteView
      load={load}
      viewer={viewer}
      confirming={confirming}
      sending={sending}
      postError={postError}
      onReload={() => void reload()}
      onDeclare={() => {
        setPostError(null);
        setConfirming(true);
      }}
      onConfirm={() => void submit()}
      onCancel={() => {
        setConfirming(false);
        setPostError(null);
      }}
    />
  );
}

/** Stateless view (exported for SSR tests). A client view never contains a declare control. */
export function OnsiteView({
  load,
  viewer,
  confirming,
  sending,
  postError,
  onReload,
  onDeclare,
  onConfirm,
  onCancel,
}: {
  load: OnsiteLoad;
  viewer: Viewer;
  confirming: boolean;
  sending: boolean;
  postError: OnsitePostError;
  onReload(): void;
  onDeclare(): void;
  onConfirm(): void;
  onCancel(): void;
}) {
  if (load.phase === "hidden") return null;
  if (load.phase === "loading")
    return (
      <section className={styles.root} data-onsite-settlement="loading" aria-busy="true">
        <p className={styles.muted} role="status">
          {ONSITE_COPY.loading}
        </p>
      </section>
    );
  if (load.phase === "error")
    return (
      <section className={styles.root} data-onsite-settlement="error">
        <p className={styles.error} role="alert">
          {ONSITE_COPY.loadError}
        </p>
        <div className={styles.actions}>
          <button type="button" className="button outline" onClick={onReload} data-onsite-reload="">
            Réessayer
          </button>
        </div>
      </section>
    );

  const s = load.settlement;
  if (s.status === "declared_received")
    return (
      <section className={styles.root} data-onsite-settlement="declared_received">
        <p className={styles.declared} role="status">
          {ONSITE_COPY.declared(s.amount_cents)}
        </p>
      </section>
    );

  if (viewer === "client")
    return (
      <section className={styles.root} data-onsite-settlement="due_on_site">
        <p className={styles.text}>{ONSITE_COPY.clientDue(s.amount_cents)}</p>
      </section>
    );

  const amount = s.amount_cents;
  const canDeclare = s.can_declare && s.available && amount !== null;
  const reason = !s.can_declare ? ONSITE_COPY.artisanNotAllowed : !s.available ? ONSITE_COPY.artisanUnavailable : amount === null ? ONSITE_COPY.artisanNoAmount : null;
  return (
    <section className={styles.root} data-onsite-settlement="due_on_site">
      <p className={styles.text}>{ONSITE_COPY.artisanDue(amount)}</p>
      {!canDeclare && reason && <p className={styles.muted}>{reason}</p>}
      {canDeclare && !confirming && (
        <div className={styles.actions}>
          <button type="button" className="button outline" onClick={onDeclare} data-onsite-declare="">
            {ONSITE_COPY.declare}
          </button>
        </div>
      )}
      {canDeclare && confirming && amount !== null && (
        <div className={styles.confirm} role="group" aria-label="Confirmer le règlement reçu sur place">
          {postError && (
            <p className={postError === "retry" ? styles.error : styles.warning} role="alert" data-onsite-error={postError}>
              {ONSITE_COPY[postError]}
            </p>
          )}
          {sending && (
            <p className={styles.muted} role="status">
              {ONSITE_COPY.sending}
            </p>
          )}
          <div className={styles.actions}>
            {(postError === "conflict" || postError === "retry") && (
              <button type="button" className="button outline" disabled={sending} onClick={onReload} data-onsite-reload="">
                Actualiser
              </button>
            )}
            {postError === "conflict" || postError === "forbidden" || postError === "unauthenticated" ? null : (
              <button type="button" className="button primary" disabled={sending} onClick={onConfirm} data-onsite-confirm="">
                {postError === "retry" ? "Réessayer" : ONSITE_COPY.confirm(amount)}
              </button>
            )}
            <button type="button" className="button outline" disabled={sending} onClick={onCancel}>
              {ONSITE_COPY.cancel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
