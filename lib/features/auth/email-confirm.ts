// Only two callback contracts are accepted. Opaque credentials are never decoded or logged.
type OtpType = "signup" | "email" | "recovery";
export type EmailConfirmation =
  | { kind: "pkce"; code: string }
  | { kind: "otp"; tokenHash: string; type: OtpType };
export type ConfirmationAuth = {
  exchangeCodeForSession(code: string): Promise<unknown>;
  verifyOtp(values: { token_hash: string; type: OtpType }): Promise<unknown>;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const opaque = (value: unknown, max = 2048): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max && !/[\s\u0000-\u001f\u007f]/u.test(value);

export function parseEmailConfirmation(params: URLSearchParams): EmailConfirmation | null {
  if (params.toString().length > 8192) return null;
  const allowed = ["code", "token_hash", "type"];
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return null;
  }
  if (params.has("code")) {
    const code = params.get("code");
    return params.size === 1 && opaque(code) ? { kind: "pkce", code } : null;
  }
  const tokenHash = params.get("token_hash"), type = params.get("type");
  return params.size === 2 && opaque(tokenHash) && (type === "signup" || type === "email" || type === "recovery")
    ? { kind: "otp", tokenHash, type }
    : null;
}

/** Require the SDK's actual authenticated session shape, including matching user identities.
 * Tokens are checked for presence only; their contents are never interpreted or returned. */
export function confirmedSession(result: unknown): boolean {
  if (!record(result) || result.error !== null || !record(result.data)) return false;
  const { user, session } = result.data;
  return record(user) && typeof user.id === "string" && UUID.test(user.id) &&
    record(session) && record(session.user) && session.user.id === user.id &&
    opaque(session.access_token, 16384) && opaque(session.refresh_token, 8192) &&
    session.token_type === "bearer" && Number.isSafeInteger(session.expires_in) && Number(session.expires_in) > 0;
}

export async function confirmEmail(input: EmailConfirmation, auth: ConfirmationAuth): Promise<boolean> {
  const result = input.kind === "pkce"
    ? await auth.exchangeCodeForSession(input.code)
    : await auth.verifyOtp({ token_hash: input.tokenHash, type: input.type });
  return confirmedSession(result);
}
