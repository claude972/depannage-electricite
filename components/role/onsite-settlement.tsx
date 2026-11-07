"use client";
// After-intervention payment status of a booking dossier (historical code « on_site »). Platform-only
// payment decision (DESIGN.md, palette B): every payment is collected BY THE PLATFORM (client
// follow-up, secure link or QR code tied to the dossier) — never cash / personal terminal / personal
// transfer / artisan « received » declaration for new operations. This leaf is READ-ONLY:
//   GET /api/bookings/settlement/onsite?intervention_id=UUID   (owner client OR assigned artisan)
// The declaration POST is retired server-side (410) and has no UI here. A 404 means « not a booking
// dossier » (render nothing); an error or a malformed reply is never shown as paid.
// Historical « on_site_declared » rows stay visible, worded as a past declaration — never as a bank
// payment. `onSettled` (lead passes session.refresh) fires at most once per mount when a verified
// historical declaration is read under the unchanged identity (the parent dossier may be stale).
import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "../app/format";
import styles from "./onsite-settlement.module.css";

export const ONSITE_PATH = "/api/bookings/settlement/onsite";
export const ONSITE_TIMEOUT_MS = 15_000;

export type OnsiteDue = { method: "on_site"; status: "due_on_site"; amount_cents: number | null; currency: "eur"; can_declare: boolean; available: boolean };
export type OnsiteDeclared = { method: "on_site_declared"; status: "declared_received"; amount_cents: number; currency: "eur"; can_declare: false; available: false };
export type OnsiteSettlementState = OnsiteDue | OnsiteDeclared;
export type OnsiteReply = { status: number; body: unknown };
export type OnsiteApi = {
  get(interventionId: string): Promise<OnsiteReply>;
};
export type OnsiteContext = { generation(): number; userId(): string | null };
export type Viewer = "client" | "artisan";

/** Strict parse of the frozen DTO; anything else is null (never « settled »). Extra keys dropped. */
export function parseOnsiteSettlement(raw: unknown): OnsiteSettlementState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const amount = v.amount_cents;
  // A positive safe integer, or null only while due (the amount may not be known yet).
  if (!(amount === null || (Number.isSafeInteger(amount) && (amount as number) > 0))) return null;
  if (v.currency !== "eur" || typeof v.can_declare !== "boolean" || typeof v.available !== "boolean") return null;
  const amount_cents = amount as number | null;
  if (v.method === "on_site" && v.status === "due_on_site")
    return { method: "on_site", status: "due_on_site", amount_cents, currency: "eur", can_declare: v.can_declare, available: v.available };
  if (v.method === "on_site_declared" && v.status === "declared_received" && amount_cents !== null && v.can_declare === false && v.available === false)
    return { method: "on_site_declared", status: "declared_received", amount_cents, currency: "eur", can_declare: false, available: false };
  return null;
}

export const ONSITE_COPY = {
  loading: "Chargement du paiement après intervention…",
  loadError: "Le paiement après intervention n’a pas pu être vérifié pour le moment.",
  clientDue: (cents: number | null) =>
    cents === null
      ? "Paiement après l’intervention, sur la plateforme — montant à confirmer par le devis accepté."
      : `Paiement après l’intervention, sur la plateforme (${money(cents)}).`,
  clientHow: "Vous réglerez par carte via votre suivi, un lien sécurisé ou un QR code. Ne payez jamais l’artisan directement.",
  artisanDue: (cents: number | null) =>
    cents === null
      ? "Le client règle sur la plateforme après l’intervention — montant à confirmer par le devis accepté."
      : `Le client règle sur la plateforme après l’intervention (${money(cents)}).`,
  artisanHow: "Aucun encaissement direct : n’acceptez ni espèces, ni terminal ou virement personnel. Le paiement est encaissé par la plateforme.",
  linkPending: "Le lien de paiement sécurisé et le QR code seront proposés ici dès que le paiement en ligne sera activé. Aucun paiement n’est demandé pour l’instant.",
  declared: (cents: number | null) =>
    cents === null
      ? "Ancienne déclaration de l’artisan : règlement déclaré reçu sur place. Ce n’est pas un paiement bancaire."
      : `Ancienne déclaration de l’artisan : ${money(cents)} déclarés reçus sur place. Ce n’est pas un paiement bancaire.`,
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
  };
}
const DEFAULT_API = createOnsiteApi();
/** Test default only: one fixed generation and identity. The lead passes the session's own. */
export const DEFAULT_ONSITE_CONTEXT: OnsiteContext = { generation: () => 0, userId: () => "current" };

// ---- Load ------------------------------------------------------------------------------------
export type LoadOutcome = { kind: "ready"; settlement: OnsiteSettlementState } | { kind: "hidden" } | { kind: "error" };
export async function loadOnsite(api: OnsiteApi, interventionId: string): Promise<LoadOutcome> {
  let r: OnsiteReply;
  try {
    r = await api.get(interventionId);
  } catch {
    return { kind: "error" };
  }
  if (r.status === 404 || r.status === 401 || r.status === 403) return { kind: "hidden" };
  if (r.status !== 200) return { kind: "error" };
  const settlement = parseOnsiteSettlement(r.body);
  return settlement ? { kind: "ready", settlement } : { kind: "error" };
}

// ---- Component ---------------------------------------------------------------------------------
export type OnsiteLoad = { phase: "loading" } | { phase: "hidden" } | { phase: "error" } | { phase: "ready"; settlement: OnsiteSettlementState };

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
  const mounted = useRef(true);
  const seq = useRef(0);
  const settled = useRef(false); // onSettled already fired for this mount
  const settledCb = useRef(onSettled);
  settledCb.current = onSettled;

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    const generation = context.generation();
    const me = context.userId();
    setLoad({ phase: "loading" });
    const out = await loadOnsite(api, interventionId);
    // Stale reply (unmounted, newer load, or generation / UID changed): nothing is applied.
    if (!mounted.current || seq.current !== mine) return;
    if (context.generation() !== generation || context.userId() !== me) return;
    setLoad(out.kind === "ready" ? { phase: "ready", settlement: out.settlement } : { phase: out.kind });
    if (out.kind === "ready" && out.settlement.status === "declared_received" && !settled.current) {
      settled.current = true;
      settledCb.current?.();
    }
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

  return <OnsiteView load={load} viewer={viewer} onReload={() => void reload()} />;
}

/** Stateless view (exported for SSR tests). No declaration control exists for any viewer, and no
 *  payment link / QR is invented: until the platform payment is available the state says so. */
export function OnsiteView({ load, viewer, onReload }: { load: OnsiteLoad; viewer: Viewer; onReload(): void }) {
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
  return (
    <section className={styles.root} data-onsite-settlement="due_on_site">
      <p className={styles.text}>{viewer === "client" ? ONSITE_COPY.clientDue(s.amount_cents) : ONSITE_COPY.artisanDue(s.amount_cents)}</p>
      <p className={styles.muted}>{viewer === "client" ? ONSITE_COPY.clientHow : ONSITE_COPY.artisanHow}</p>
      <p className={styles.muted} role="status" data-onsite-payment-link="unavailable">
        {ONSITE_COPY.linkPending}
      </p>
    </section>
  );
}
