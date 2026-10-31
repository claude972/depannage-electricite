import type { FinanceConfig } from "./types";
/** True only in a build that ships the private PDF route app/api/platform-operations/finance/invoices/[id]/pdf/route.ts
 * (CODEX-INVOICE-PDF-001). Flip to false if that route is ever removed from the build; /me and the links follow it. */
export const INVOICE_RENDERING_AVAILABLE = true;
/** Reads process-level configuration without ever exposing a secret. Pure for tests. */
export function checkoutCommissionBps(env: Record<string, string | undefined>): number | null {
  const raw = env.PLATFORM_FEE_BPS;
  if (!raw || !/^\d{1,5}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= 0 && value <= 10000 ? value : null;
}
export function paymentProviderState(env: Record<string, string | undefined>): FinanceConfig["payment_provider"] {
  const key = env.STRIPE_SECRET_KEY ?? "";
  const configured = key.length > 0;
  const mode = !configured ? null : /^(sk|rk)_live_/.test(key) ? "live" : "test";
  return { configured, mode, live_enabled: env.STRIPE_LIVE_PAYMENTS_ENABLED === "true" };
}
export function financeConfig(
  env: Record<string, string | undefined>,
  setting: { bps: number; version: number } | null,
  issuerConfigured: boolean,
): FinanceConfig {
  const checkout = checkoutCommissionBps(env);
  return {
    commission: {
      setting_bps: setting?.bps ?? null,
      setting_version: setting?.version ?? null,
      checkout_bps: checkout,
      aligned: setting === null || checkout === null ? null : setting.bps === checkout,
    },
    payment_provider: paymentProviderState(env),
    invoice_issuer: { configured: issuerConfigured },
  };
}
/** User-facing availability of real money actions: never available in this lot. */
export const REFUND_EXECUTION_MESSAGE = "Exécution indisponible : fournisseur de paiement non configuré. Une demande approuvée n’est pas un remboursement effectué.";
export const COMMISSION_NOT_CONFIGURED = "Taux de commission non configuré : aucune estimation n’est calculée.";
