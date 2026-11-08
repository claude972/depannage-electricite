import { randomUUID } from "node:crypto";
import {
  authenticatedClient,
  adminClient,
  ApiError,
  apiError,
  assertOrigin,
  dbError,
} from "@/lib/supabase/server";
import { uuid } from "@/lib/supabase/validation";
import {
  MAX_DOCUMENT_BYTES,
  MAX_REQUEST_BYTES,
  documentNameFor,
  validateDocumentUpload,
} from "@/lib/shared/document-policy";
import { storeWebDocument, WebUploadError } from "@/lib/features/documents/web-upload";
import { signPrivateDocument, unavailableDownload } from "@/lib/features/documents/signed-url";
export const runtime = "nodejs";
async function readDocuments(request: Request) {
  let signedRequest = false;
  try {
    const { db } = await authenticatedClient();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      const { data, error } = await db
        .from("documents")
        .select("id,intervention_id,name,mime_type,created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      dbError(error);
      return Response.json({ documents: data });
    }
    signedRequest = true;
    if (!uuid.safeParse(id).success)
      throw new ApiError(422, "Document invalide.");
    const { data, error } = await db
      .from("documents")
      .select("path")
      .eq("id", id)
      .maybeSingle();
    if (error) unavailableDownload();
    if (data === null) throw new ApiError(404, "Ce document est introuvable.");
    return Response.json({ url: await signPrivateDocument(db, data?.path) });
  } catch (error) {
    if (!signedRequest) return apiError(error);
    if (error instanceof ApiError && [401, 422, 404].includes(error.status)) return apiError(error);
    return Response.json({ error: "Le lien du document est momentanément indisponible. Réessayez." }, { status: 503 });
  }
}
export async function GET(request: Request) {
  const response = await readDocuments(request);
  response.headers.set("Cache-Control", "private, no-store");
  if (response.status === 503) response.headers.set("Retry-After", "2");
  return response;
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient();
    if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES)
      throw new ApiError(413, "Le fichier doit faire moins de 4 Mo.");
    const form = await request.formData();
    const file = form.get("file");
    const interventionId = form.get("intervention_id");
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > MAX_DOCUMENT_BYTES
    )
      throw new ApiError(
        422,
        "Choisissez un fichier PDF, JPEG, PNG ou WebP de moins de 4 Mo.",
      );
    if (interventionId) {
      if (
        typeof interventionId !== "string" ||
        !uuid.safeParse(interventionId).success
      )
        throw new ApiError(422, "Dossier invalide.");
      const access = await db
        .from("interventions")
        .select("id,artisan_id")
        .eq("id", interventionId)
        .single();
      if (access.error || !access.data)
        throw new ApiError(403, "Vous n’avez pas accès à ce dossier.");
      const [owner, adminAccess] = await Promise.all([
        db.rpc("owns_intervention", { target: interventionId }),
        db.rpc("is_admin"),
      ]);
      dbError(owner.error);
      dbError(adminAccess.error);
      if (
        !owner.data &&
        !adminAccess.data &&
        access.data.artisan_id !== user.id
      )
        throw new ApiError(
          403,
          "Votre accès à ce dossier est en lecture seule.",
        );
    }
    const throttle = await db.rpc("check_upload_limit");
    dbError(throttle.error);
    const buffer = new Uint8Array(await file.arrayBuffer());
    // Shared policy with the native gateway: magic bytes must match the declared MIME.
    const verdict = validateDocumentUpload({
      size: file.size,
      declaredType: file.type,
      bytes: buffer,
    });
    if (!verdict.ok)
      throw new ApiError(
        422,
        "Le contenu du fichier ne correspond pas à un format autorisé.",
      );
    const mime = verdict.mime;
    const id = randomUUID();
    const path = `${user.id}/${id}`;
    const admin = adminClient();
    const document = await storeWebDocument(db, admin, {
      id,
      path,
      ownerId: user.id,
      interventionId: typeof interventionId === "string" && interventionId ? interventionId : null,
      name: documentNameFor(file.name),
      mime,
    }, buffer);
    return Response.json({ document }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = error instanceof WebUploadError
      ? Response.json({ error: error.message, ...error.details }, { status: error.status })
      : apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    if (response.status === 503) response.headers.set("Retry-After", "2");
    return response;
  }
}
