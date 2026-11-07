"use client";
// Payment after the intervention, on the platform (deferred Checkout contract, ROOT 21cd76d).
//   GET /api/payments/link?intervention_id=UUID  (requester client OR assigned approved artisan)
//   → { url: "/#detail/<UUID>", available: true, payment_available: false,
//       reason: "not_completed" | "already_settled" | "configuration_required" | "checkout_required" }
// The link is the AUTHENTICATED follow-up of the dossier, resolved against this page's origin: it
// carries no provider URL, token or personal data and never starts a payment by itself.
// - Client: the only payment action is the explicit « Payer » of the parent (POST
//   /api/payments/checkout under the client's own identity), offered only for checkout_required.
// - Artisan: may copy / share the follow-up link. No Checkout is ever created by or for the artisan,
//   and there is no « received » / collect action.
// No QR code is rendered: no QR library exists in this project, so the state says so.
// 401/403/404 ⇒ nothing rendered; 503 / network / malformed ⇒ error with « Réessayer », never paid.
import { useCallback, useEffect, useRef, useState } from "react";
import { money } from "../app/format";
import styles from "./onsite-settlement.module.css";

export const PAYMENT_LINK_PATH = "/api/payments/link";
export type PaymentLinkReason = "not_completed" | "already_settled" | "configuration_required" | "checkout_required";
export type PaymentLink = { url: string; available: true; payment_available: boolean; reason: PaymentLinkReason };
export type PaymentLinkReply = { status: number; body: unknown };
export type PaymentLinkApi = { get(interventionId: string): Promise<PaymentLinkReply> };
const REASONS: readonly PaymentLinkReason[] = ["not_completed", "already_settled", "configuration_required", "checkout_required"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strict parse: the url must be exactly the relative follow-up of THIS dossier. */
export function parsePaymentLink(raw: unknown, interventionId: string): PaymentLink | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (!UUID.test(interventionId) || v.url !== `/#detail/${interventionId.toLowerCase()}`) return null;
  if (v.available !== true || typeof v.payment_available !== "boolean" || !REASONS.includes(v.reason as PaymentLinkReason)) return null;
  return { url: v.url, available: true, payment_available: v.payment_available, reason: v.reason as PaymentLinkReason };
}
/** Absolute share URL: this page's origin only (never a server Host or another deployment). */
export function shareUrl(link: PaymentLink, origin: string): string | null {
  try {
    const o = new URL(origin);
    if (o.origin !== origin || !(o.protocol === "https:" || o.protocol === "http:")) return null;
    return origin + link.url;
  } catch {
    return null;
  }
}

export type PaymentLinkLoad = { phase: "loading" } | { phase: "hidden" } | { phase: "error" } | { phase: "ready"; link: PaymentLink };
export async function loadPaymentLink(api: PaymentLinkApi, interventionId: string): Promise<PaymentLinkLoad> {
  let r: PaymentLinkReply;
  try {
    r = await api.get(interventionId);
  } catch {
    return { phase: "error" };
  }
  if (r.status === 401 || r.status === 403 || r.status === 404) return { phase: "hidden" };
  if (r.status !== 200) return { phase: "error" };
  const link = parsePaymentLink(r.body, interventionId);
  return link ? { phase: "ready", link } : { phase: "error" };
}
export function createPaymentLinkApi(timeoutMs = 15_000): PaymentLinkApi {
  return {
    async get(id) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${PAYMENT_LINK_PATH}?intervention_id=${encodeURIComponent(id)}`, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
        let body: unknown = null;
        try { body = await res.json(); } catch { body = null; }
        return { status: res.status, body };
      } catch {
        return { status: 0, body: null };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
const DEFAULT_API = createPaymentLinkApi();

export const PAYMENT_LINK_COPY = {
  loading: "Vérification du paiement en ligne…",
  error: "Le paiement en ligne n’a pas pu être vérifié pour le moment. Aucun paiement n’est demandé.",
  notCompleted: "Le paiement sera proposé sur la plateforme une fois l’intervention terminée.",
  settled: "Ce dossier est réglé sur la plateforme.",
  configuration: "Le paiement en ligne n’est pas encore activé sur ce service. Aucun paiement n’est demandé pour l’instant.",
  clientPay: (cents: number | null) => (cents === null ? "Payer sur la plateforme" : `Payer ${money(cents)} sur la plateforme`),
  clientPayNote: "Vous serez redirigé vers la page de paiement sécurisée. Le paiement n’est confirmé qu’après vérification par la plateforme, jamais sur la seule redirection.",
  clientNoQuote: "Le devis accepté de ce dossier n’est pas encore chargé : actualisez le dossier pour régler.",
  artisanShare: "Lien de suivi à transmettre au client : il s’y connecte avec son compte pour régler sur la plateforme. Ce lien ne déclenche aucun paiement.",
  artisanConfiguration: "Le paiement en ligne n’est pas encore activé : le client ne peut pas encore régler par ce lien.",
  qrUnavailable: "Le QR code n’est pas disponible sur ce service ; transmettez le lien.",
  copied: "Lien copié.",
  copyFailed: "Copie impossible : sélectionnez le lien ci-dessus.",
} as const;

export function PaymentLinkPanel({
  interventionId,
  viewer,
  amountCents,
  onPay,
  busy = false,
  api = DEFAULT_API,
  origin,
}: {
  interventionId: string;
  viewer: "client" | "artisan";
  amountCents: number | null;
  /** Client only: explicit Checkout under the client's identity (parent: session.checkout). */
  onPay?: () => void;
  busy?: boolean;
  api?: PaymentLinkApi;
  origin?: string;
}) {
  const [load, setLoad] = useState<PaymentLinkLoad>({ phase: "loading" });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoad({ phase: "loading" });
    const out = await loadPaymentLink(api, interventionId);
    if (seq.current === mine) setLoad(out);
  }, [api, interventionId]);
  useEffect(() => {
    void reload();
    return () => { seq.current += 1; };
  }, [reload]);
  return (
    <PaymentLinkView
      load={load}
      viewer={viewer}
      amountCents={amountCents}
      onPay={onPay}
      busy={busy}
      origin={origin ?? (typeof window !== "undefined" ? window.location.origin : "")}
      onReload={() => void reload()}
    />
  );
}

/** Stateless view (exported for SSR tests). */
export function PaymentLinkView({ load, viewer, amountCents, onPay, busy = false, origin, onReload }: {
  load: PaymentLinkLoad; viewer: "client" | "artisan"; amountCents: number | null; onPay?: () => void; busy?: boolean; origin: string; onReload(): void;
}) {
  const [copy, setCopy] = useState("");
  if (load.phase === "hidden") return null;
  if (load.phase === "loading") return <p className={styles.muted} role="status" data-payment-link="loading">{PAYMENT_LINK_COPY.loading}</p>;
  if (load.phase === "error")
    return (
      <div data-payment-link="error">
        <p className={styles.error} role="alert">{PAYMENT_LINK_COPY.error}</p>
        <div className={styles.actions}>
          <button type="button" className="button outline" onClick={onReload} data-payment-link-reload="">Réessayer</button>
        </div>
      </div>
    );
  const { link } = load;
  if (link.reason === "already_settled") return <p className={styles.muted} role="status" data-payment-link="already_settled">{PAYMENT_LINK_COPY.settled}</p>;
  if (link.reason === "not_completed") return <p className={styles.muted} role="status" data-payment-link="not_completed">{PAYMENT_LINK_COPY.notCompleted}</p>;
  if (viewer === "client") {
    if (link.reason === "configuration_required")
      return <p className={styles.muted} role="status" data-payment-link="configuration_required">{PAYMENT_LINK_COPY.configuration}</p>;
    // checkout_required: the only action is the client's explicit payment.
    if (!onPay) return <p className={styles.muted} role="status" data-payment-link="no_quote">{PAYMENT_LINK_COPY.clientNoQuote}</p>;
    return (
      <div data-payment-link="checkout_required">
        <div className={styles.actions}>
          <button type="button" className="button primary" disabled={busy} onClick={onPay} data-payment-pay="">
            {busy ? "Veuillez patienter…" : PAYMENT_LINK_COPY.clientPay(amountCents)}
          </button>
        </div>
        <p className={styles.muted}>{PAYMENT_LINK_COPY.clientPayNote}</p>
      </div>
    );
  }
  // Artisan: share the authenticated follow-up only. Never a Checkout, never a collect action.
  const url = shareUrl(link, origin);
  return (
    <div data-payment-link={link.reason}>
      <p className={styles.muted}>{link.reason === "configuration_required" ? PAYMENT_LINK_COPY.artisanConfiguration : PAYMENT_LINK_COPY.artisanShare}</p>
      {url ? (
        <>
          <p className={styles.text}><code data-payment-link-url="">{url}</code></p>
          <div className={styles.actions}>
            <button
              type="button"
              className="button outline"
              data-payment-link-copy=""
              onClick={() => {
                const done = (ok: boolean) => setCopy(ok ? PAYMENT_LINK_COPY.copied : PAYMENT_LINK_COPY.copyFailed);
                try {
                  void navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
                } catch {
                  done(false);
                }
              }}
            >
              Copier le lien de suivi
            </button>
          </div>
          {copy && <p className={styles.muted} role="status">{copy}</p>}
        </>
      ) : (
        <p className={styles.error} role="alert">{PAYMENT_LINK_COPY.error}</p>
      )}
      <p className={styles.muted} data-payment-qr="unavailable">{PAYMENT_LINK_COPY.qrUnavailable}</p>
    </div>
  );
}
