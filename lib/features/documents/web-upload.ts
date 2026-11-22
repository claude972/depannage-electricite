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
const uncertain = (scope: "du dossier" | "du site") => new WebUploadError(
  502,
  `L’enregistrement du fichier est incertain. Vérifiez la liste des documents ${scope} avant de réessayer.`,
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
function isExistingObjectError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as Record<string, unknown>;
  // storage-js preserves HTTP status separately when statusCode/code is semantic.
  const conflicts = new Set(["409", "ResourceAlreadyExists", "Duplicate"]);
  return [value.status, value.statusCode, value.code].some(code => conflicts.has(String(code)));
}
async function compensate(admin: SupabaseClient, path: string) {
  try {
    const result = await admin.storage.from(DOCUMENT_BUCKET).remove([path]);
    // Empty, unrelated or malformed acknowledgements do not prove this object was removed.
    return !result.error && Array.isArray(result.data) && result.data.length === 1 && result.data[0]?.name === path;
  } catch { return false; }
}

type PersistOptions<T> = {
  path: string;
  mime: string;
  bytes: Uint8Array;
  scope: "du dossier" | "du site";
  finalize(): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  readback(): PromiseLike<{ data: unknown; error: unknown }>;
  project(value: unknown): T | null;
  // Stable site upload paths may already have bytes from an interrupted or concurrent attempt.
  resumeUploadedObject?(): Promise<boolean>;
};

/** Only Storage uses the server credential. The supplied metadata writer runs under the caller.
 * An absent row after a transport failure does not prove rollback. */
export async function persistPrivateWebDocument<T>(
  admin: SupabaseClient,
  { path, mime, bytes, scope, finalize, readback, project, resumeUploadedObject }: PersistOptions<T>,
): Promise<T> {
  let uploaded;
  try {
    uploaded = await admin.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
  } catch { uploaded = { error: { message: "Upload transport unavailable" } }; }
  if (uploaded.error) {
    if (isExistingObjectError(uploaded.error)) {
      if (!resumeUploadedObject || !await resumeUploadedObject())
        throw new ApiError(409, "L’état du fichier a changé. Rechargez les documents avant de réessayer.");
    } else {
      if (resumeUploadedObject) throw uncertain(scope);
      if (!await compensate(admin, path)) throw cleanupIncomplete();
      throw new ApiError(503, "Le fichier n’a pas pu être envoyé. Réessayez dans quelques instants.");
    }
  }

  let finalized: Awaited<ReturnType<PersistOptions<T>["finalize"]>>;
  try {
    finalized = await finalize();
  } catch { finalized = { data: null, error: { code: "network" } }; }
  if (!finalized.error) {
    const row = project(finalized.data);
    if (row) return row;
  }

  let lookup: Awaited<ReturnType<PersistOptions<T>["readback"]>>;
  try {
    lookup = await readback();
  } catch { throw uncertain(scope); }
  if (lookup.error) throw uncertain(scope);
  if (lookup.data !== null) {
    const row = project(lookup.data);
    if (row) return row;
    throw uncertain(scope);
  }
  if (isDefiniteRollback(finalized.error?.code)) {
    // A parallel retry may be finalizing the exact same stable object; never remove it here.
    if (!resumeUploadedObject && !await compensate(admin, path)) throw cleanupIncomplete();
    dbError(finalized.error);
  }
  throw uncertain(scope);
}

export function storeWebDocument(db: SupabaseClient, admin: SupabaseClient, expected: ExpectedRow, bytes: Uint8Array) {
  return persistPrivateWebDocument(admin, {
    path: expected.path,
    mime: expected.mime,
    bytes,
    scope: "du dossier",
    finalize: () => db.rpc("finalize_document_upload", {
      p_id: expected.id,
      p_path: expected.path,
      p_name: expected.name,
      p_mime: expected.mime,
      p_intervention_id: expected.interventionId,
    }),
    readback: () => admin.from("documents")
      .select("id,intervention_id,owner_id,name,path,mime_type,created_at")
      .eq("id", expected.id).maybeSingle(),
    project(value) {
      const row = validateFinalizedRow(value, expected);
      return row ? publicDocument(row) : null;
    },
  });
}
