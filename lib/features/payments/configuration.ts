type PaymentEnvironment = Record<string, string | undefined>;

export function stripePaymentMode(env: PaymentEnvironment): "test" | "live" | null {
  const key = env.STRIPE_SECRET_KEY ?? "";
  if (/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(key)) return "test";
  if (/^(sk|rk)_live_[A-Za-z0-9_]+$/.test(key) && env.STRIPE_LIVE_PAYMENTS_ENABLED === "true") return "live";
  return null;
}

export function paymentOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    return !url.username && !url.password && (url.protocol === "https:" || local) ? url.origin : null;
  } catch {
    return null;
  }
}

export function transferCommissionConfigured(env: PaymentEnvironment): boolean {
  const fee = env.PLATFORM_FEE_BPS?.trim();
  const bps = Number(fee);
  return !!fee && Number.isInteger(bps) && bps >= 0 && bps < 10000;
}

export function guestSettlementConfigured(env: PaymentEnvironment): boolean {
  const mode = stripePaymentMode(env);
  return env.GUEST_SETTLEMENT_ENABLED === "true"
    && transferCommissionConfigured(env)
    && (mode === "test" || (mode === "live" && env.GUEST_SETTLEMENT_LIVE_ENABLED === "true"));
}
