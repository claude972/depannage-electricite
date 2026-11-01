import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, dbError } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET } from "@/lib/shared/document-policy";
import {
  isDefiniteRollback,
  validateFinalizedRow,
  type ExpectedRow,
  type FinalizedRow,
} from "@/supabase/functions/native-document-upload/handler";

/** 502 is the existing web upload queue's uncertain-result state; it never retries silently. */
export class WebUploadError extends ApiError {
  constructor(status: number, message: string, public readonly details: { uncertain?: true; cleanup?: "incomplete" } = {}) {
    super(status, message);
  }
}
const uncertain = () => new WebUploadError(
  502,
  "L’enregistrement du fichier est incertain. Vérifiez la liste des documents du dossier avant de réessayer.",
  { uncertain: true },
);
const cleanupIncomplete = () => new WebUploadError(
  503,
  "Le document n’a pas été enregistré, mais le retrait du fichier temporaire n’a pas été confirmé. Réessayez plus tard.",
  { cleanup: "incomplete" },
);
function publicDocument(row: FinalizedRow) {
  return { id: row.id, name: row.name, mime_type: row.mime_type, created_at: row.created_at };
}
async function compensate(admin: SupabaseClient, path: string) {
  try {
    const result = await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    return !result.error && Array.isArray(result.data);
  } catch { return false; }
}

/** Storage alone uses the server credential. Metadata is committed by the caller's JWT RPC,
 * which rechecks current rights while holding the existing organisation/dossier locks (013).
 * Readback may confirm a commit; a momentarily absent row never proves a transport rollback. */
export async function storeWebDocument(
  db: SupabaseClient,
  admin: SupabaseClient,
  expected: ExpectedRow,
  bytes: Uint8Array,
) {
  let uploaded;
  try {
    uploaded = await admin.storage.from(DOCUMENT_BUCKET).upload(expected.path, bytes, { contentType: expected.mime, upsert: false });
  } catch { uploaded = { error: { message: "Upload transport unavailable" } }; }
  if (uploaded.error) {
    // A duplicate-path refusal did not create this attempt's object: do not delete an older one.
    if ("statusCode" in uploaded.error && String(uploaded.error.statusCode) === "409")
      throw new ApiError(409, "L’état du fichier a changé. Rechargez les documents avant de réessayer.");
    if (!await compensate(admin, expected.path)) throw cleanupIncomplete();
    throw new ApiError(503, "Le fichier n’a pas pu être envoyé. Réessayez dans quelques instants.");
  }
  let finalized: { data: unknown; error: { code?: string } | null };
  try {
    finalized = await db.rpc("finalize_document_upload", {
      p_id: expected.id,
      p_path: expected.path,
      p_name: expected.name,
      p_mime: expected.mime,
      p_intervention_id: expected.interventionId,
    });
  } catch { finalized = { data: null, error: { code: "network" } }; }
  if (!finalized.error) {
    const row = validateFinalizedRow(finalized.data, expected);
    if (row) return publicDocument(row);
  }
  let lookup: { data: unknown; error: unknown };
  try {
    lookup = await admin.from("documents")
      .select("id,intervention_id,owner_id,name,path,mime_type,created_at")
      .eq("id", expected.id).maybeSingle();
  } catch { throw uncertain(); }
  if (lookup.error) throw uncertain();
  if (lookup.data !== null) {
    const row = validateFinalizedRow(lookup.data, expected);
    if (row) return publicDocument(row);
    throw uncertain();
  }
  if (isDefiniteRollback(finalized.error?.code)) {
    if (!await compensate(admin, expected.path)) throw cleanupIncomplete();
    dbError(finalized.error);
  }
  // Unknown commit state: keeping this exact object avoids deleting a committed document.
  throw uncertain();
}
