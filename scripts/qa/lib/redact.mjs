// Redaction of secrets in anything that may be logged or written to the evidence directory.
// Pure and testable. Known secrets are replaced verbatim; well-known token shapes are
// replaced by pattern even when they were never registered.
const REPLACEMENT = "[REDACTED]";
const MIN_SECRET_LENGTH = 8;

// [pattern, replacer]
const PATTERNS = [
  // URL / query / form parameters carrying session material: keep the name, drop the value.
  [/\b(access_token|refresh_token|token_hash|provider_token|code|apikey)=([^&\s"'<>]+)/gi, (_m, name) => `${name}=${REPLACEMENT}`],
  // Authorization headers (header text form).
  [/\b(authorization\s*[:=]\s*)(?:bearer\s+)?[A-Za-z0-9._~+/=-]{8,}/gi, (_m, prefix) => `${prefix}${REPLACEMENT}`],
  // Supabase auth cookies, possibly chunked (.0, .1).
  [/\bsb-[a-z0-9]+-auth-token(?:\.\d+)?=[^;\s"'<>]+/gi, () => REPLACEMENT],
  // JWT.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, () => REPLACEMENT],
  // New-style Supabase keys.
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}\b/g, () => REPLACEMENT],
  // Stripe keys (never expected here, redacted anyway).
  [/\b(?:sk|rk|whsec)_(?:live_|test_)?[A-Za-z0-9]{8,}\b/g, () => REPLACEMENT],
];
const SENSITIVE_KEY = /password|service_role|secret|authorization|cookie|api_key|apikey|token/i;

export function createRedactor(initialSecrets = []) {
  const secrets = new Set();
  const add = (secret) => {
    if (typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH) secrets.add(secret);
  };
  initialSecrets.forEach(add);

  function redactString(value) {
    let out = String(value);
    // Longest first so a secret that contains another is removed whole.
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) out = out.split(secret).join(REPLACEMENT);
    for (const [pattern, replacer] of PATTERNS) out = out.replace(pattern, replacer);
    return out;
  }

  /** Redacts strings, Error objects, arrays and plain objects (recursively, as new copies). */
  function redact(value, depth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value !== "object") return value;
    if (depth > 12) return "[depth]";
    if (value instanceof Error) return { name: value.name, message: redactString(value.message || "") };
    if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = SENSITIVE_KEY.test(key) ? REPLACEMENT : redact(v, depth + 1);
    return out;
  }

  return { add, redact, redactString, size: () => secrets.size, REPLACEMENT };
}
