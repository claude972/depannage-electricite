import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { confirmEmail, parseEmailConfirmation } from "@/lib/features/auth/email-confirm";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = parseEmailConfirmation(url.searchParams);
  let destination = "/?auth=expired";
  if (input) {
    try {
      const db = await serverClient();
      if (await confirmEmail(input, db.auth)) {
        destination = input.kind === "otp" && input.type === "recovery"
          ? "/auth/reset-password?verified=1"
          : "/?auth=confirmed";
      }
    } catch {
      // Invalid/provider failures remain recoverable; no opaque code or provider text escapes.
    }
  }
  const response = NextResponse.redirect(new URL(destination, url.origin));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
