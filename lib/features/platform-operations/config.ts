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
/** User-facing reason why refunds cannot be executed here (FIN-04). The provider state comes from
 *  the server (/me config): « non configuré » is only said when it is true; a configured provider
 *  (test or live) without the execution capability says exactly that. */
export function refundExecutionMessage(provider: Pick<FinanceConfig["payment_provider"], "configured" | "mode"> | null | undefined): string {
  const reason = !provider
    ? "état du fournisseur de paiement non vérifié"
    : !provider.configured
      ? "fournisseur de paiement non configuré"
      : `l’exécution des remboursements n’est pas activée pour votre accès sur ce service (fournisseur de paiement configuré${provider.mode === "test" ? ", mode test" : ""})`;
  return `Exécution indisponible : ${reason}. Une demande approuvée n’est pas un remboursement effectué.`;
}
/** FIN-06: the « estimated, not withheld » total excludes the estimates of payments whose
 *  commission is already withheld (confirmed) — that commission is counted once, as withheld.
 *  An absent or inconsistent correction leaves the server totals untouched. */
export function outstandingEstimate(report: { ledger: { commission_estimated_count: number; commission_estimated_cents: number }; commission_estimated_superseded?: { count: number; cents: number } | null }): { count: number; cents: number; superseded: { count: number; cents: number } | null } {
  const { commission_estimated_count: count, commission_estimated_cents: cents } = report.ledger, s = report.commission_estimated_superseded;
  const valid = !!s && Number.isSafeInteger(s.count) && Number.isSafeInteger(s.cents) && s.count > 0 && s.cents >= 0 && s.count <= count && s.cents <= cents;
  return valid ? { count: count - s.count, cents: cents - s.cents, superseded: { count: s.count, cents: s.cents } } : { count, cents, superseded: null };
}
export const COMMISSION_NOT_CONFIGURED = "Taux de commission non configuré : aucune estimation n’est calculée.";
