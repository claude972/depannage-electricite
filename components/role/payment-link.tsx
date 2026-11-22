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
// QR code (PAY-QR): generated LOCALLY with qrcode-generator (MIT, pinned) from the exact share URL
// (this page's origin + the contract's relative /#detail/<UUID>) — nothing else: no token, no
// tracking parameter, no image service. Rendered as inline SVG from the module matrix, only when the
// link parsed and the share URL is valid; otherwise the existing honest states.
// 401/403/404 ⇒ nothing rendered; 503 / network / malformed ⇒ error with « Réessayer », never paid.
import { useCallback, useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { money } from "../app/format";
import styles from "./onsite-settlement.module.css";
import qrStyles from "./payment-link.module.css";

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

/** QR module matrix (true = dark) of EXACTLY `url`: type number auto (0), error correction M.
 *  Only for an absolute http(s) share URL of the follow-up path; anything else ⇒ null (no QR). */
export function qrMatrix(url: string): boolean[][] | null {
  const m = /^https?:\/\/[^/?#\s]+\/#detail\/([0-9a-f-]{36})$/.exec(url);
  if (!m || !UUID.test(m[1])) return null;
  try {
    const qr = qrcode(0, "M");
    qr.addData(url, "Byte");
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  } catch {
    return null;
  }
}
/** Quiet zone in modules (QR spec: 4). */
export const QR_QUIET = 4;
/** SVG path of the dark modules, in module units, offset by the quiet zone. */
export function qrPath(matrix: boolean[][]): string {
  let d = "";
  matrix.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + QR_QUIET} ${r + QR_QUIET}h1v1h-1z`; }));
  return d;
}

/** Copy the exact share URL; false on any refusal (the visible URL stays selectable). */
export async function copyShareUrl(url: string, clipboard: { writeText(text: string): Promise<void> } | undefined): Promise<boolean> {
  try {
    if (!clipboard) return false;
    await clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function PaymentQr({ url }: { url: string }) {
  const matrix = qrMatrix(url);
  if (!matrix) return null;
  const size = matrix.length + QR_QUIET * 2;
  return (
    <figure className={qrStyles.qr} data-payment-qr="">
      <svg className={qrStyles.code} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${PAYMENT_LINK_COPY.qrLabel} ${url}`} shapeRendering="crispEdges" data-payment-qr-size={size}>
        <rect className={qrStyles.quiet} width={size} height={size} />
        <path className={qrStyles.modules} d={qrPath(matrix)} />
      </svg>
      <figcaption className={qrStyles.caption}>{PAYMENT_LINK_COPY.qrCaption}</figcaption>
    </figure>
  );
}

export type PaymentLinkLoad = { phase: "loading" } | { phase: "hidden" } | { phase: "error" } | { phase: "demo" } | { phase: "ready"; link: PaymentLink };
/** Demo never calls the route (no session, no dossier on the server). */
export async function resolvePaymentLink(api: PaymentLinkApi, interventionId: string, demo: boolean): Promise<PaymentLinkLoad> {
  return demo ? { phase: "demo" } : loadPaymentLink(api, interventionId);
}
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
  qrLabel: "QR code du lien de suivi :",
  qrCaption: "QR code du lien de suivi ci-dessus : le client le scanne puis se connecte à son compte. Il ne déclenche aucun paiement.",
  demo: "En démonstration, aucun lien de paiement n’est vérifié.",
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
  demo = false,
}: {
  interventionId: string;
  viewer: "client" | "artisan";
  amountCents: number | null;
  /** Client only: explicit Checkout under the client's identity (parent: session.checkout). */
  onPay?: () => void;
  busy?: boolean;
  api?: PaymentLinkApi;
  origin?: string;
  /** Demo: no route call, honest note only. */
  demo?: boolean;
}) {
  const [load, setLoad] = useState<PaymentLinkLoad>({ phase: "loading" });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoad({ phase: "loading" });
    const out = await resolvePaymentLink(api, interventionId, demo);
    if (seq.current === mine) setLoad(out);
  }, [api, interventionId, demo]);
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
  if (load.phase === "demo") return <p className={styles.muted} role="status" data-payment-link="demo">{PAYMENT_LINK_COPY.demo}</p>;
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
                void copyShareUrl(url, typeof navigator !== "undefined" ? navigator.clipboard : undefined).then((ok) => setCopy(ok ? PAYMENT_LINK_COPY.copied : PAYMENT_LINK_COPY.copyFailed));
              }}
            >
              Copier le lien de suivi
            </button>
          </div>
          {copy && <p className={styles.muted} role="status">{copy}</p>}
          <PaymentQr url={url} />
        </>
      ) : (
        <p className={styles.error} role="alert">{PAYMENT_LINK_COPY.error}</p>
      )}
    </div>
  );
}
