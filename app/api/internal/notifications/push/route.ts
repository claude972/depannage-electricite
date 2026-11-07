import { handleWebPushDispatch } from "@/lib/features/notifications/external-delivery/web-push";
import { adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: Request) {
  return handleWebPushDispatch(request, process.env, adminClient, fetch);
}
