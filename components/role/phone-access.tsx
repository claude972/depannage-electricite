"use client";
// Phone access (docs/GUEST_CHECKOUT_CONTRACT.md): verified phone identity without a password, for
// a booking (purpose "booking") or to find one's requests again (purpose "lookup"). Talks ONLY to
// POST /api/auth/phone/start and /api/auth/phone/verify (Supabase SSR cookies are set by the
// server; no JWT, token or code is ever read, logged or stored here). Pure state machine + thin
// React view; the fetcher is injected (tests use a fake, never a real SMS).
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { normalizePhone } from "../app/booking-draft";
import { Field } from "../app/ui";
import { PublicChrome } from "./public-chrome";
import { serviceChromeHandlers } from "./public-service-page";
import styles from "./phone-access.module.css";

export type PhonePurpose = "booking" | "lookup";
export type PhoneKind = "sms" | "phone_change";
export type ApiResult = { status: number; body: unknown; retryAfter: number | null };
export type PhoneApi = {
  start(body: { phone: string; first_name: string; last_name: string; purpose: PhonePurpose }): Promise<ApiResult>;
  verify(body: { phone: string; token: string; kind: PhoneKind }): Promise<ApiResult>;
};

/** Same-origin JSON POST, credentials same-origin, no-store; Retry-After parsed (seconds). */
export function createPhoneApi(fetcher: typeof fetch = (...a) => fetch(...a)): PhoneApi {
  const post = async (path: string, body: unknown): Promise<ApiResult> => {
    const response = await fetcher(path, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const retry = Number(response.headers.get("Retry-After"));
    return { status: response.status, body: await response.json().catch(() => null), retryAfter: Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : null };
  };
  return { start: (body) => post("/api/auth/phone/start", body), verify: (body) => post("/api/auth/phone/verify", body) };
}

// ---- Pure state machine -------------------------------------------------------------------------
export type PhoneStage = "form" | "sending" | "code" | "verifying" | "verified";
export type PhoneState = {
  stage: PhoneStage;
  phone: string;
  first_name: string;
  last_name: string;
  code: string;
  kind: PhoneKind | null;
  suffix: string;
  /** Epoch ms before which « Renvoyer le code » stays disabled. */
  resendAt: number;
  /** Epoch ms before which a new attempt is refused (429 Retry-After). */
  blockedUntil: number;
  message: string;
  error: string;
  fieldErrors: Partial<Record<"phone" | "first_name" | "last_name" | "code", string>>;
};
export function initialPhoneState(prefill: { phone?: string; first_name?: string; last_name?: string } = {}): PhoneState {
  return { stage: "form", phone: prefill.phone ?? "", first_name: prefill.first_name ?? "", last_name: prefill.last_name ?? "", code: "", kind: null, suffix: "", resendAt: 0, blockedUntil: 0, message: "", error: "", fieldErrors: {} };
}
export const PHONE_COPY = {
  sentBooking: (suffix: string) => `Code envoyé au •••• ${suffix}.`,
  sentLookup: "Si ce numéro est connu, un code vous a été envoyé.",
  unavailable: {
    booking: "Service SMS indisponible, réessayez dans un instant ; ou revenez plus tard : votre demande reste conservée dans ce navigateur.",
    lookup: "Service SMS indisponible, réessayez dans un instant ; ou connectez-vous avec votre email si vous avez un compte.",
  },
  wrongCode: "Code incorrect ou expiré. Vérifiez les 6 chiffres reçus.",
  tooMany: (s: number) => `Trop de tentatives. Réessayez dans ${s} s.`,
  refused: "Ce numéro ne peut pas être utilisé ici. Connectez-vous avec votre compte habituel.",
  invalid: "Vérifiez le numéro de téléphone, votre nom et votre prénom.",
  failed: "La vérification n’a pas abouti. Rien n’a été confirmé ; réessayez.",
} as const;

export function phoneFormErrors(s: PhoneState): PhoneState["fieldErrors"] {
  const e: PhoneState["fieldErrors"] = {};
  if (!normalizePhone(s.phone)) e.phone = "Indiquez un numéro de mobile valide (ex. 0696 12 34 56).";
  if (!s.first_name.trim()) e.first_name = "Indiquez votre prénom.";
  if (!s.last_name.trim()) e.last_name = "Indiquez votre nom.";
  return e;
}
export const codeError = (code: string) => (/^\d{6}$/.test(code.trim()) ? "" : "Saisissez le code à 6 chiffres.");
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const seconds = (r: ApiResult, fallback = 60) => r.retryAfter ?? fallback;

/** Result of POST /start applied to the state. Never a success that the server did not give. */
export function applyStart(s: PhoneState, r: ApiResult, purpose: PhonePurpose, now: number): PhoneState {
  const base = { ...s, error: "", message: "", fieldErrors: {} };
  const body = isObj(r.body) ? r.body : {};
  if (r.status === 200 && body.status === "verified") return { ...base, stage: "verified" };
  if (r.status === 200 && body.status === "code_requested" && (body.kind === "sms" || body.kind === "phone_change")) {
    const suffix = typeof body.phone_suffix === "string" ? body.phone_suffix.slice(-4) : "";
    const retry = typeof body.retry_after === "number" && body.retry_after > 0 ? body.retry_after : 60;
    return { ...base, stage: "code", kind: body.kind, suffix, code: "", resendAt: now + retry * 1000, message: purpose === "lookup" ? PHONE_COPY.sentLookup : PHONE_COPY.sentBooking(suffix) };
  }
  const stage: PhoneStage = s.kind ? "code" : "form";
  if (r.status === 429) return { ...base, stage, blockedUntil: now + seconds(r) * 1000, error: PHONE_COPY.tooMany(seconds(r)) };
  if (r.status === 503) return { ...base, stage, error: PHONE_COPY.unavailable[purpose] };
  if (r.status === 409) return { ...base, stage, error: PHONE_COPY.refused };
  if (r.status === 400 || r.status === 422) return { ...base, stage, error: PHONE_COPY.invalid };
  return { ...base, stage, error: PHONE_COPY.failed };
}
/** Result of POST /verify. 422 keeps the typed code so it can be corrected. */
export function applyVerify(s: PhoneState, r: ApiResult, purpose: PhonePurpose, now: number): PhoneState {
  const base = { ...s, stage: "code" as PhoneStage, error: "", fieldErrors: {} };
  if (r.status === 200 && isObj(r.body) && r.body.verified === true) return { ...base, stage: "verified", message: "" };
  if (r.status === 422) return { ...base, error: PHONE_COPY.wrongCode };
  if (r.status === 429) return { ...base, blockedUntil: now + seconds(r) * 1000, error: PHONE_COPY.tooMany(seconds(r)) };
  if (r.status === 503) return { ...base, error: PHONE_COPY.unavailable[purpose] };
  return { ...base, error: PHONE_COPY.failed };
}
export function phoneActionLabel(s: PhoneState): string {
  if (s.stage === "sending") return "Envoi…";
  if (s.stage === "verifying") return "Vérification…";
  if (s.stage === "code") return "Valider le code";
  if (s.stage === "verified") return "Téléphone vérifié";
  return "Recevoir un code";
}

// ---- View ---------------------------------------------------------------------------------------
export function PhoneAccess({
  purpose,
  prefill,
  api,
  onVerified,
  formId: givenFormId,
  onStateChange,
  initial,
  clock = () => Date.now(),
}: {
  purpose: PhonePurpose;
  prefill?: { phone?: string; first_name?: string; last_name?: string };
  api?: PhoneApi;
  onVerified: () => void;
  formId?: string;
  onStateChange?: (s: PhoneState) => void;
  /** Tests only: render a given stage. */
  initial?: PhoneState;
  clock?: () => number;
}) {
  const uid = useId();
  const formId = givenFormId ?? `${uid}-phone`;
  const client = useRef<PhoneApi | null>(api ?? null);
  const [state, setState] = useState<PhoneState>(initial ?? initialPhoneState(prefill));
  const [now, setNow] = useState(() => clock());
  const verifiedOnce = useRef(false);
  const namesPrefilled = !!(prefill?.first_name?.trim() && prefill?.last_name?.trim());

  useEffect(() => onStateChange?.(state), [state, onStateChange]);
  useEffect(() => {
    if (state.stage === "verified" && !verifiedOnce.current) {
      verifiedOnce.current = true;
      onVerified();
    }
  }, [state.stage, onVerified]);
  // One-second tick only while a countdown is visible.
  const waiting = state.resendAt > now || state.blockedUntil > now;
  useEffect(() => {
    setNow(clock());
    if (!(state.resendAt || state.blockedUntil)) return;
    const timer = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(timer);
  }, [state.resendAt, state.blockedUntil, clock, waiting]);

  const call = () => (client.current ??= createPhoneApi());
  const start = async () => {
    const fieldErrors = phoneFormErrors(state);
    if (Object.keys(fieldErrors).length) return setState((s) => ({ ...s, fieldErrors, error: "" }));
    if (state.blockedUntil > clock()) return;
    const phone = normalizePhone(state.phone)!;
    setState((s) => ({ ...s, stage: "sending", error: "" }));
    let result: ApiResult;
    try {
      result = await call().start({ phone, first_name: state.first_name.trim(), last_name: state.last_name.trim(), purpose });
    } catch {
      result = { status: 0, body: null, retryAfter: null };
    }
    setState((s) => applyStart(s, result, purpose, clock()));
  };
  const verify = async () => {
    const error = codeError(state.code);
    if (error) return setState((s) => ({ ...s, fieldErrors: { code: error }, error: "" }));
    if (state.blockedUntil > clock() || !state.kind) return;
    setState((s) => ({ ...s, stage: "verifying", error: "" }));
    let result: ApiResult;
    try {
      result = await call().verify({ phone: normalizePhone(state.phone)!, token: state.code.trim(), kind: state.kind });
    } catch {
      result = { status: 0, body: null, retryAfter: null };
    }
    setState((s) => applyVerify(s, result, purpose, clock()));
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (state.stage === "form") void start();
    else if (state.stage === "code") void verify();
  };
  const busy = state.stage === "sending" || state.stage === "verifying";
  const resendIn = Math.max(0, Math.ceil((state.resendAt - now) / 1000));
  const blockedIn = Math.max(0, Math.ceil((state.blockedUntil - now) / 1000));
  const set = (patch: Partial<PhoneState>) => setState((s) => ({ ...s, ...patch }));

  return (
    <div className={styles.root} data-phone-access={purpose} data-phone-stage={state.stage}>
      <form id={formId} className={styles.form} onSubmit={submit} noValidate>
        {(state.stage === "form" || state.stage === "sending") && (
          <>
            {!namesPrefilled && (
              <div className={styles.grid}>
                <Field label="Prénom" error={state.fieldErrors.first_name}>
                  <input autoComplete="given-name" maxLength={60} value={state.first_name} disabled={busy} onChange={(e) => set({ first_name: e.target.value })} />
                </Field>
                <Field label="Nom" error={state.fieldErrors.last_name}>
                  <input autoComplete="family-name" maxLength={60} value={state.last_name} disabled={busy} onChange={(e) => set({ last_name: e.target.value })} />
                </Field>
              </div>
            )}
            <Field label="Téléphone mobile" hint="Un code à 6 chiffres sera demandé pour vérifier ce numéro." error={state.fieldErrors.phone}>
              <input type="tel" autoComplete="tel" inputMode="tel" maxLength={30} value={state.phone} disabled={busy} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
          </>
        )}
        {(state.stage === "code" || state.stage === "verifying") && (
          <>
            {state.message && <p className={styles.message} role="status">{state.message}</p>}
            <Field label="Code reçu par SMS" hint="6 chiffres" error={state.fieldErrors.code}>
              <input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={state.code} disabled={busy} onChange={(e) => set({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })} />
            </Field>
            <div className={styles.row}>
              <button type="button" className={styles.link} disabled={busy || resendIn > 0 || blockedIn > 0} onClick={() => { set({ code: "" }); void start(); }}>
                {resendIn > 0 ? `Renvoyer le code dans ${resendIn} s` : "Renvoyer le code"}
              </button>
              <button type="button" className={styles.link} disabled={busy} onClick={() => setState((s) => ({ ...s, stage: "form", code: "", kind: null, message: "", error: "" }))}>
                Modifier le numéro
              </button>
            </div>
          </>
        )}
        {state.stage === "verified" && <p className={styles.message} role="status">Téléphone vérifié.</p>}
        {state.error && <p className={styles.error} role="alert">{blockedIn > 0 ? PHONE_COPY.tooMany(blockedIn) : state.error}</p>}
        {state.stage !== "verified" && (
          <button type="submit" className={styles.submit} disabled={busy || blockedIn > 0} data-phone-submit={state.stage}>
            {phoneActionLabel(state)}
          </button>
        )}
      </form>
    </div>
  );
}

// ---- /suivi: find one's requests with a verified phone (no public lookup, no listing before) ----
export function PhoneLookupPage({ api, go = (href: string) => window.location.assign(href) }: { api?: PhoneApi; go?: (href: string) => void }) {
  return (
    <PublicChrome current="suivi" handlers={serviceChromeHandlers(go)} onHome={() => go("/")}>
      <div className={styles.page}>
        <h1>Suivre ma demande</h1>
        <p className={styles.lead}>Indiquez le téléphone utilisé pour votre demande, avec votre nom et votre prénom. Après vérification du code, vos demandes s’affichent dans votre espace.</p>
        <div className={styles.card}>
          <PhoneAccess purpose="lookup" api={api} onVerified={() => go("/#requests")} />
        </div>
      </div>
    </PublicChrome>
  );
}
