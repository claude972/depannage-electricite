import { handleEmailDispatch } from "@/lib/features/notifications/external-delivery/resend";
import { adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleEmailDispatch(request, process.env, adminClient, fetch);
}
