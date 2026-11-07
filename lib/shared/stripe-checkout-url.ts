/** Checkout can include an opaque fragment. Preserve it while requiring Stripe's exact origin. */
export function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === "https://checkout.stripe.com" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
