import { adminClient, authenticatedClient, apiError, ApiError, assertOrigin, dbError } from "@/lib/supabase/server";
import { validated } from "@/lib/supabase/validation";
import { preferencesSchema } from "@/lib/features/notifications/schemas";
import { NOTIFICATION_KINDS } from "@/lib/features/notifications/types";
import { KIND_LABELS } from "@/lib/features/notifications/kinds";
import { CHANNELS_NOTE, detectChannels } from "@/lib/features/notifications/channels";
import { resendConfiguration } from "@/lib/features/notifications/external-delivery/resend";
// Preferences are the recipient's own row (version 0 = not yet saved). Reading them never sends.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store" };
const defaults = { muted_kinds: [], email_enabled: false, sms_enabled: false, push_enabled: false, version: 0 };
function failed(error: unknown) { const response = apiError(error); response.headers.set("Cache-Control", "private, no-store"); return response; }
async function view(preferences: unknown, emailVerified: boolean) {
  const channels = detectChannels();
  if (resendConfiguration(process.env)) {
    channels.reasons.email = "L’envoi des notifications e-mail est désactivé.";
    if (emailVerified) {
      try {
        const gate = await adminClient().rpc("external_notification_dispatch_enabled");
        if (!gate.error && gate.data === true) {
          channels.email = "available";
          channels.reasons.email = "Les notifications e-mail peuvent être activées dans vos préférences.";
        }
      } catch {
        // Preferences and in-app notifications still work when external readiness is unknown.
      }
    } else channels.reasons.email = "Confirmez votre adresse e-mail pour recevoir des notifications.";
  }
  return { preferences, kinds: NOTIFICATION_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind] })), channels, channels_note: CHANNELS_NOTE };
}
export async function GET(request: Request) {
  try {
    const { db, user } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Aucun paramètre n’est attendu.");
    const row = await db.from("notification_preferences").select("user_id,muted_kinds,email_enabled,sms_enabled,push_enabled,version,updated_at").eq("user_id", user.id).maybeSingle();
    dbError(row.error);
    return Response.json(await view(row.data ?? { user_id: user.id, ...defaults }, Boolean(user.email && user.email_confirmed_at)), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    if (new URL(request.url).searchParams.size) throw new ApiError(422, "Aucun paramètre n’est attendu.");
    const data = await validated(request, preferencesSchema);
    const result = await db.rpc("save_notification_preferences", {
      p_muted_kinds: [...new Set(data.muted_kinds)], p_email: data.email_enabled, p_sms: data.sms_enabled, p_push: data.push_enabled, p_expected_version: data.expected_version,
    });
    dbError(result.error);
    const saved = (result.data as { preferences?: unknown } | null)?.preferences;
    if (!saved || typeof saved !== "object") throw new ApiError(503, "L’enregistrement des préférences n’a pas été confirmé.");
    return Response.json(await view(saved, Boolean(user.email && user.email_confirmed_at)), { headers: privateHeaders });
  } catch (error) { return failed(error); }
}
