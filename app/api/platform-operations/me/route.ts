import { authenticatedClient } from "@/lib/supabase/server";
import { describeAccess, failed, ok } from "@/lib/features/platform-operations/http";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Probe route (shared contract §3): the caller's own server-side rights and configuration states. */
export async function GET() {
  try {
    const { db } = await authenticatedClient();
    return ok(await describeAccess(db));
  } catch (error) { return failed(error); }
}
