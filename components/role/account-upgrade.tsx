"use client";
// Optional email access for a phone-verified client (docs/GUEST_CHECKOUT_CONTRACT.md): the SAME
// account (same uid, same requests) gains an email + password login. Never mandatory, never a
// sign-up, never a new account: only GET /api/auth/phone/session and POST /api/auth/phone/upgrade
// (the server calls updateUser on the current uid). Renders nothing unless the server says the
// session is an eligible client. The password lives only in this component's state while typed
// (never stored, logged or kept after success).
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Field } from "../app/ui";
import styles from "./account-upgrade.module.css";

export type UpgradeResult = { status: number; body: unknown; retryAfter: number | null };
export type AccountApi = {
  session(): Promise<UpgradeResult>;
  upgrade(body: { email: string; password: string }): Promise<UpgradeResult>;
};
export const UPGRADE_TIMEOUT_MS = 15_000;
export const UPGRADE_TIMEOUT = -1;

async function timed(fetcher: typeof fetch, path: string, init: RequestInit, timeoutMs: number): Promise<UpgradeResult> {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut: UpgradeResult = { status: UPGRADE_TIMEOUT, body: null, retryAfter: null };
  const deadline = new Promise<UpgradeResult>((resolve) => {
    timer = setTimeout(() => {
      controller?.abort();
      resolve(timedOut);
    }, timeoutMs);
  });
  const request = (async (): Promise<UpgradeResult> => {
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
/** Same-origin, credentials same-origin, no-store, 15 s deadline. */
export function createAccountApi(fetcher: typeof fetch = (...a) => fetch(...a), { timeoutMs = UPGRADE_TIMEOUT_MS } = {}): AccountApi {
  const base: RequestInit = { credentials: "same-origin", cache: "no-store" };
  return {
    session: () => timed(fetcher, "/api/auth/phone/session", { ...base, method: "GET" }, timeoutMs),
    upgrade: (body) => timed(fetcher, "/api/auth/phone/upgrade", { ...base, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs),
  };
}

// ---- Pure rules ---------------------------------------------------------------------------------
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
/** Only an explicit, complete server answer makes the card visible; anything else ⇒ hidden. */
export function isEligible(r: UpgradeResult | null): boolean {
  if (!r || r.status !== 200 || !isObj(r.body)) return false;
  const b = r.body;
  return b.authenticated === true && b.verified_phone === true && b.role === "client" && b.email_account === false;
}
export type UpgradeFields = { email: string; password: string; confirm: string };
export type FieldErrors = Partial<Record<keyof UpgradeFields, string>>;
export function upgradeErrors(f: UpgradeFields): FieldErrors {
  const e: FieldErrors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) || f.email.trim().length > 254) e.email = "Indiquez une adresse email valide.";
  if (f.password.length < 10 || f.password.length > 128) e.password = "Le mot de passe doit contenir de 10 à 128 caractères.";
  if (f.confirm !== f.password) e.confirm = "Les deux mots de passe ne sont pas identiques.";
  return e;
}
export const UPGRADE_COPY = {
  sent: "Un email de confirmation vous est envoyé si l’adresse est valide ; confirmez-la pour vous connecter aussi par email.",
  used: "Cette adresse est déjà utilisée par un compte ; connectez-vous avec ce compte ou utilisez une autre adresse.",
  invalid: "Vérifiez l’adresse email et le mot de passe (10 à 128 caractères).",
  tooMany: (s: number) => `Trop de tentatives. Réessayez dans ${s} s.`,
  unavailable: "Service momentanément indisponible, réessayez dans un instant. Rien n’a été modifié.",
  timeout: "Délai dépassé, réessayez. Rien n’a été confirmé.",
  failed: "La création de l’accès n’a pas abouti. Rien n’a été modifié ; réessayez.",
} as const;
export type UpgradeOutcome = { done: boolean; message: string; fieldErrors: FieldErrors };
export function applyUpgrade(r: UpgradeResult): UpgradeOutcome {
  if (r.status === 200 && isObj(r.body) && r.body.confirmation_required === true) return { done: true, message: UPGRADE_COPY.sent, fieldErrors: {} };
  if (r.status === 409) return { done: false, message: UPGRADE_COPY.used, fieldErrors: {} };
  if (r.status === 422 || r.status === 400) {
    const field = isObj(r.body) && r.body.field === "password" ? "password" : "email";
    return { done: false, message: "", fieldErrors: { [field]: UPGRADE_COPY.invalid } };
  }
  if (r.status === 429) return { done: false, message: UPGRADE_COPY.tooMany(r.retryAfter ?? 60), fieldErrors: {} };
  if (r.status === 503) return { done: false, message: UPGRADE_COPY.unavailable, fieldErrors: {} };
  if (r.status === UPGRADE_TIMEOUT) return { done: false, message: UPGRADE_COPY.timeout, fieldErrors: {} };
  return { done: false, message: UPGRADE_COPY.failed, fieldErrors: {} };
}

/** Single flight (a ref, not state) + replies ignored once detached. */
export function createUpgradeController({ api, onResult }: { api: () => AccountApi; onResult: (o: UpgradeOutcome) => void }) {
  let inFlight = false;
  let attached = true;
  return {
    get busy() {
      return inFlight;
    },
    submit(f: UpgradeFields): Promise<boolean> | false {
      if (inFlight) return false;
      inFlight = true;
      return (async () => {
        let r: UpgradeResult;
        try {
          r = await api().upgrade({ email: f.email.trim(), password: f.password });
        } catch {
          r = { status: 0, body: null, retryAfter: null };
        } finally {
          inFlight = false;
        }
        if (!attached) return false;
        onResult(applyUpgrade(r));
        return true;
      })();
    },
    attach() {
      attached = true;
    },
    detach() {
      attached = false;
    },
  };
}

// ---- View ---------------------------------------------------------------------------------------
const EMPTY: UpgradeFields = { email: "", password: "", confirm: "" };

export function AccountUpgrade({ api, onDone, initialEligible }: { api?: AccountApi; onDone?: () => void; /** Tests only. */ initialEligible?: boolean }) {
  const uid = useId();
  const [eligible, setEligible] = useState(initialEligible ?? false);
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<UpgradeFields>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const latest = useRef({ api, onDone });
  latest.current = { api, onDone };
  const client = useRef<AccountApi | null>(null);
  const getApi = useCallback(() => (client.current ??= latest.current.api ?? createAccountApi()), []);
  const controller = useRef<ReturnType<typeof createUpgradeController> | null>(null);
  if (!controller.current)
    controller.current = createUpgradeController({
      api: getApi,
      onResult: (o) => {
        setBusy(false);
        setErrors(o.fieldErrors);
        setMessage(o.message);
        if (o.done) {
          setDone(true);
          setFields(EMPTY); // the password is not kept after success
          latest.current.onDone?.();
        }
      },
    });
  const ctrl = controller.current;

  useEffect(() => {
    ctrl.attach();
    let alive = true;
    if (initialEligible === undefined)
      void getApi()
        .session()
        .then((r) => alive && setEligible(isEligible(r)), () => alive && setEligible(false));
    return () => {
      alive = false;
      ctrl.detach();
    };
  }, [ctrl, getApi, initialEligible]);

  if (!eligible) return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = upgradeErrors(fields);
    setErrors(found);
    setMessage("");
    if (Object.keys(found).length) return;
    if (ctrl.submit(fields) !== false) setBusy(true);
  };
  const set = (patch: Partial<UpgradeFields>) => setFields((f) => ({ ...f, ...patch }));
  const panel = `${uid}-upgrade`;

  return (
    <section className={styles.card} aria-labelledby={`${uid}-title`} data-account-upgrade="">
      <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={panel} onClick={() => setOpen((o) => !o)}>
        <span id={`${uid}-title`}>Créer un accès par email (facultatif)</span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div id={panel} className={styles.body}>
          <p className={styles.lead}>Facultatif : c’est le même compte, avec les mêmes demandes. Vous pourrez aussi vous connecter avec votre email. Si vous ne le faites pas, rien ne change.</p>
          {done ? (
            <p className={styles.done} role="status">{message}</p>
          ) : (
            <form className={styles.form} onSubmit={submit} noValidate>
              <Field label="Adresse email" error={errors.email}>
                <input type="email" autoComplete="email" inputMode="email" maxLength={254} value={fields.email} disabled={busy} onChange={(e) => set({ email: e.target.value })} />
              </Field>
              <Field label="Mot de passe" hint="10 à 128 caractères" error={errors.password}>
                <input type="password" autoComplete="new-password" maxLength={128} value={fields.password} disabled={busy} onChange={(e) => set({ password: e.target.value })} />
              </Field>
              <Field label="Confirmer le mot de passe" error={errors.confirm}>
                <input type="password" autoComplete="new-password" maxLength={128} value={fields.confirm} disabled={busy} onChange={(e) => set({ confirm: e.target.value })} />
              </Field>
              {message && <p className={styles.error} role="alert">{message}</p>}
              <button type="submit" className={styles.submit} disabled={busy} data-upgrade-submit="">
                {busy ? "Envoi…" : "Créer mon accès par email"}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
