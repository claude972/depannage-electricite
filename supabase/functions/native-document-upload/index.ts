// Deno entry point: environment, supabase-js clients and Deno.serve only.
// All request logic lives in handler.ts so Node tests exercise the same code.
import { createClient } from "@supabase/supabase-js";
import { DOCUMENT_BUCKET } from "../_shared/document-policy.ts";
import {
  handleNativeDocumentUpload,
  jsonResponse,
  type DocumentRow,
  type GatewayDeps,
} from "./handler.ts";

// Supabase Edge runtime exposes SUPABASE_URL plus key dictionaries
// (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS) and the legacy
// SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY. Read either form.
function keyFrom(dictionary: string | undefined, legacy: string | undefined) {
  if (dictionary) {
    try {
      const parsed = JSON.parse(dictionary) as Record<string, string>;
      const first = parsed.default ?? Object.values(parsed)[0];
      if (typeof first === "string" && first.length > 0) return first;
    } catch {
      // Fall through to the legacy variable.
    }
  }
  return legacy && legacy.length > 0 ? legacy : null;
}
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? null;
const publishableKey = keyFrom(
  Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
  Deno.env.get("SUPABASE_ANON_KEY"),
);
// Server-only credential: used for Storage writes and the post-failure
// metadata lookup. It is never placed in a response or sent to a client.
const serverKey = keyFrom(
  Deno.env.get("SUPABASE_SECRET_KEYS"),
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
);

function buildDeps(url: string, anon: string, server: string): GatewayDeps {
  const userClient = (token: string) =>
    createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  const admin = createClient(url, server, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return {
    async authenticate(token) {
      const { data, error } = await userClient(token).auth.getUser(token);
      if (error || !data.user) return null;
      return { id: data.user.id };
    },
    async selectInterventionArtisan(token, interventionId) {
      const { data, error } = await userClient(token)
        .from("interventions")
        .select("id,artisan_id")
        .eq("id", interventionId)
        .maybeSingle();
      if (error || !data) return null;
      return { artisan_id: (data as { artisan_id: string | null }).artisan_id };
    },
    async rpc<T>(token: string, fn: string, args?: Record<string, unknown>) {
      const { data, error } = await userClient(token).rpc(fn, args);
      return { data: (data as T | null) ?? null, error };
    },
    async putObject(path, bytes, mime) {
      const { error } = await admin.storage
        .from(DOCUMENT_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: false });
      return { error };
    },
    async removeObject(path) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    },
    async findDocument(id) {
      const { data, error } = await admin
        .from("documents")
        .select("id,name,mime_type,created_at")
        .eq("id", id)
        .maybeSingle();
      // Propagate the lookup error: a failed readback is "unknown", not "absent".
      return { row: (data as DocumentRow | null) ?? null, error };
    },
    randomUUID: () => crypto.randomUUID(),
  };
}

const deps =
  supabaseUrl && publishableKey && serverKey
    ? buildDeps(supabaseUrl, publishableKey, serverKey)
    : null;

Deno.serve((request: Request) => {
  if (!deps)
    return jsonResponse(
      { error: "Le service sécurisé est en cours de configuration." },
      503,
    );
  return handleNativeDocumentUpload(request, deps);
});
