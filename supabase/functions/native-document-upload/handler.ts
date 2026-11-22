// Runtime-neutral request handler for the native document gateway.
// index.ts wires it to Deno and supabase-js; tests wire it to fakes.
import {
  MAX_DOCUMENT_BYTES,
  MAX_REQUEST_BYTES,
  documentNameFor,
  isUuid,
  validateDocumentUpload,
} from "../_shared/document-policy.ts";

export type DbFailure = { code?: string; message?: string } | null;
export type RpcResult<T> = { data: T | null; error: DbFailure };
export type DocumentRow = {
  id: string;
  name: string;
  mime_type: string;
  created_at: string;
};
// Full public.documents row returned by finalize_document_upload and by the readback.
export type FinalizedRow = DocumentRow & {
  path: string;
  owner_id: string;
  intervention_id: string | null;
};
export type ExpectedRow = {
  id: string;
  path: string;
  ownerId: string;
  name: string;
  mime: string;
  interventionId: string | null;
};
// A 201 is only answered for a row that is exactly the one this attempt asked for.
// Anything else ({} , [], another id/path, missing fields) is an uncertain outcome.
export function validateFinalizedRow(
  value: unknown,
  expected: ExpectedRow,
): FinalizedRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.id !== expected.id || row.path !== expected.path) return null;
  if (row.owner_id !== expected.ownerId) return null;
  if (row.name !== expected.name || row.mime_type !== expected.mime) return null;
  if ((row.intervention_id ?? null) !== expected.interventionId) return null;
  if (typeof row.created_at !== "string" || row.created_at.length === 0)
    return null;
  return {
    id: expected.id,
    path: expected.path,
    owner_id: expected.ownerId,
    name: expected.name,
    mime_type: expected.mime,
    intervention_id: expected.interventionId,
    created_at: row.created_at,
  };
}
export interface GatewayDeps {
  // Verifies the access token against the Auth server; null when refused.
  authenticate(token: string): Promise<{ id: string } | null>;
  // Under the caller's RLS: null when the dossier is not visible.
  selectInterventionArtisan(
    token: string,
    interventionId: string,
  ): Promise<{ artisan_id: string | null } | null>;
  // Under the caller's identity (auth.uid() is the real user).
  rpc<T>(
    token: string,
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<RpcResult<T>>;
  // Server-side Storage writes; the key never leaves the function.
  putObject(
    path: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ error: { message?: string } | null }>;
  removeObject(path: string): Promise<void>;
  // Server-side readback of the metadata row, used only to report a success whose
  // RPC response was lost. `error` set means the lookup itself failed. A "no row"
  // answer never proves a rollback (a transport-failed call may still commit).
  findDocument(id: string): Promise<{ row: unknown; error: DbFailure }>;
  randomUUID(): string;
  // Operational log for unexpected shapes; receives the attempt id only, never a path or user.
  log?(message: string, context: { id: string }): void;
}
// SQL states raised inside finalize_document_upload: the transaction rolled back,
// so the metadata row is known to be absent even without a readback.
export function isDefiniteRollback(code: string | undefined): boolean {
  return (
    typeof code === "string" &&
    /^(42501|P0001|P0002|53300|22[0-9A-Z]{3}|23[0-9A-Z]{3})$/.test(code)
  );
}
export const UNCERTAIN_MESSAGE =
  "L’enregistrement du fichier est incertain. Vérifiez la liste des documents du dossier avant de réessayer.";
export class GatewayError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info",
};
export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
// Same mapping as lib/supabase/server.ts dbError; duplicated because that file
// depends on next/headers and cannot load in Deno.
export function mapDbCode(code: string | undefined): GatewayError {
  if (code === "53300")
    return new GatewayError(
      429,
      "Trop de tentatives. Patientez une minute puis réessayez.",
    );
  if (code === "42501" || code === "PGRST301")
    return new GatewayError(403, "Vous n’avez pas accès à cette action.");
  if (code === "P0002")
    return new GatewayError(404, "Le fichier transmis est introuvable.");
  if (code === "23505" || code === "P0001")
    return new GatewayError(
      409,
      "L’état du dossier a changé ou cette action n’est plus disponible.",
    );
  if (
    code === "22023" ||
    code === "23514" ||
    code === "22P02" ||
    code === "22007" ||
    code === "22008" ||
    code === "23502"
  )
    return new GatewayError(422, "Vérifiez les informations saisies.");
  return new GatewayError(
    503,
    "Les données sont momentanément indisponibles. Réessayez.",
  );
}
function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
async function compensate(deps: GatewayDeps, path: string): Promise<void> {
  // Only the object this attempt created: the path carries a UUID chosen here.
  try {
    await deps.removeObject(path);
  } catch {
    // Best effort; the object is unreachable without metadata anyway.
  }
}
export async function handleNativeDocumentUpload(
  request: Request,
  deps: GatewayDeps,
): Promise<Response> {
  try {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      throw new GatewayError(405, "Méthode non autorisée.");
    const token = bearer(request);
    if (!token)
      throw new GatewayError(401, "Connectez-vous pour accéder à cet espace.");
    const user = await deps.authenticate(token);
    if (!user)
      throw new GatewayError(401, "Connectez-vous pour accéder à cet espace.");
    if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES)
      throw new GatewayError(413, "Le fichier doit faire moins de 4 Mo.");
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new GatewayError(422, "Le contenu envoyé est invalide.");
    }
    const file = form.get("file");
    const interventionField = form.get("intervention_id");
    if (!(file instanceof File) || file.size < 1)
      throw new GatewayError(
        422,
        "Choisissez un fichier PDF, JPEG, PNG ou WebP de moins de 4 Mo.",
      );
    if (file.size > MAX_DOCUMENT_BYTES)
      throw new GatewayError(413, "Le fichier doit faire moins de 4 Mo.");
    let interventionId: string | null = null;
    if (interventionField !== null && interventionField !== "") {
      if (!isUuid(interventionField))
        throw new GatewayError(422, "Dossier invalide.");
      interventionId = interventionField;
      const access = await deps.selectInterventionArtisan(token, interventionId);
      if (!access)
        throw new GatewayError(403, "Vous n’avez pas accès à ce dossier.");
      const [owner, admin] = await Promise.all([
        deps.rpc<boolean>(token, "owns_intervention", { target: interventionId }),
        deps.rpc<boolean>(token, "is_admin"),
      ]);
      if (owner.error) throw mapDbCode(owner.error.code);
      if (admin.error) throw mapDbCode(admin.error.code);
      if (
        owner.data !== true &&
        admin.data !== true &&
        access.artisan_id !== user.id
      )
        throw new GatewayError(
          403,
          "Votre accès à ce dossier est en lecture seule.",
        );
    }
    const throttle = await deps.rpc<null>(token, "check_upload_limit");
    if (throttle.error) throw mapDbCode(throttle.error.code);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const verdict = validateDocumentUpload({
      size: file.size,
      declaredType: file.type,
      bytes,
    });
    if (!verdict.ok) {
      if (verdict.reason === "too_large")
        throw new GatewayError(413, "Le fichier doit faire moins de 4 Mo.");
      if (verdict.reason === "empty")
        throw new GatewayError(
          422,
          "Choisissez un fichier PDF, JPEG, PNG ou WebP de moins de 4 Mo.",
        );
      throw new GatewayError(
        415,
        "Le contenu du fichier ne correspond pas à un format autorisé.",
      );
    }
    const id = deps.randomUUID();
    const path = `${user.id}/${id}`;
    let uploaded: { error: { message?: string } | null };
    try {
      uploaded = await deps.putObject(path, bytes, verdict.mime);
    } catch {
      uploaded = { error: { message: "upload failed" } };
    }
    if (uploaded.error) {
      // A network failure may still have written the object; it is ours alone.
      await compensate(deps, path);
      throw new GatewayError(
        503,
        "Le fichier n’a pas pu être enregistré. Réessayez.",
      );
    }
    const expected: ExpectedRow = {
      id,
      path,
      ownerId: user.id,
      name: documentNameFor(file.name || ""),
      mime: verdict.mime,
      interventionId,
    };
    let finalized: RpcResult<unknown>;
    try {
      finalized = await deps.rpc<unknown>(token, "finalize_document_upload", {
        p_id: id,
        p_path: path,
        p_name: expected.name,
        p_mime: expected.mime,
        p_intervention_id: interventionId,
      });
    } catch {
      finalized = { data: null, error: { code: "network" } };
    }
    if (!finalized.error && finalized.data) {
      const confirmed = validateFinalizedRow(finalized.data, expected);
      if (confirmed) return jsonResponse({ document: pick(confirmed) }, 201);
      deps.log?.("finalize_document_upload returned an unexpected row shape", { id });
    }
    {
      // A lost response after commit must not orphan a referenced object.
      let lookup: { row: unknown; error: DbFailure };
      try {
        lookup = await deps.findDocument(id);
      } catch {
        lookup = { row: null, error: { code: "network" } };
      }
      // The readback only confirms a success; it never decides a deletion.
      if (lookup.row) {
        const confirmed = validateFinalizedRow(lookup.row, expected);
        if (confirmed) return jsonResponse({ document: pick(confirmed) }, 201);
        deps.log?.("documents readback returned an unexpected row shape", { id });
      } else if (isDefiniteRollback(finalized.error?.code)) {
        // The database answered with an error raised inside the function: rolled back.
        await compensate(deps, path);
        throw mapDbCode(finalized.error?.code);
      }
      // Transport-level unknown (fetch threw, timeout, no PG error body): the
      // transaction may still commit after this point. Keep the object, never
      // claim failure; the client must re-check the documents list.
      return jsonResponse({ error: UNCERTAIN_MESSAGE, uncertain: true }, 503);
    }
  } catch (error) {
    if (error instanceof GatewayError)
      return jsonResponse({ error: error.message }, error.status);
    return jsonResponse(
      { error: "L’action n’a pas pu être effectuée. Réessayez." },
      500,
    );
  }
}
function pick(row: DocumentRow): DocumentRow {
  return {
    id: row.id,
    name: row.name,
    mime_type: row.mime_type,
    created_at: row.created_at,
  };
}
