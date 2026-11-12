export const PLATFORM_MFA_REQUIRED = "platform_mfa_required";
export const PLATFORM_MFA_MESSAGE = "Vérifiez votre identité avec votre application d’authentification avant de confirmer cette action.";

export function platformMfaRequired(status: number, body: unknown): boolean {
  return status === 403 && body !== null && typeof body === "object"
    && "code" in body && body.code === PLATFORM_MFA_REQUIRED;
}
