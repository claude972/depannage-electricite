import { ApiError, dbError } from "@/lib/supabase/server";
import { PLATFORM_MFA_MESSAGE, PLATFORM_MFA_REQUIRED } from "@/shared/platform-mfa";

class PlatformMfaRequired extends ApiError {
  constructor() {
    super(403, PLATFORM_MFA_MESSAGE);
  }
}

export function platformWriteError(error: { code?: string; message?: string } | null) {
  if (error?.code === "PT403" && error.message === PLATFORM_MFA_REQUIRED)
    throw new PlatformMfaRequired();
  dbError(error);
}

export function platformMfaRefusal(error: unknown) {
  return error instanceof PlatformMfaRequired
    ? { error: PLATFORM_MFA_MESSAGE, code: PLATFORM_MFA_REQUIRED }
    : null;
}
