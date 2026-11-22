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
    const { db } = await authenticatedClient(request);
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
    const { db, user } = await authenticatedClient(request);
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

// CLI-02 — true deletion of a REQUEST photo by the client who uploaded it, only while the request
// is still open (« requested », no artisan). Every rule is checked on the server:
//   1. the document is an image owned by the caller and attached to a dossier (else 404, no leak);
//   2. `set_mission_offer_photo(…, false)` runs under the CALLER: it re-checks in SQL, with the
//      dossier row locked, that the caller is the requesting client, that the dossier is still
//      « requested » without artisan and that the image is theirs — and withdraws the photo from
//      the offer first, so no eligible artisan can still read it;
//   3. the row is deleted (the offer consent and photo review rows cascade; a photo referenced by a
//      message or a report is refused by its foreign key ⇒ 409), then the private file is removed.
// Once an artisan is assigned the photo belongs to the dossier evidence and cannot be deleted.
const REQUEST_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const notFound = () => new ApiError(404, "Ce document est introuvable.");
const noLongerOpen = () => new ApiError(409, "La demande n’est plus en recherche d’artisan : cette photo fait désormais partie du dossier et ne peut plus être supprimée.");
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const { db, user } = await authenticatedClient(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (params.size !== 1 || !id || !uuid.safeParse(id).success) throw new ApiError(422, "Document invalide.");
    const admin = adminClient();
    const found = await admin.from("documents").select("id,owner_id,intervention_id,path,mime_type").eq("id", id).maybeSingle();
    if (found.error) throw new ApiError(503, "La suppression est momentanément indisponible. Réessayez.");
    const doc = found.data;
    if (!doc || doc.owner_id !== user.id || !doc.intervention_id || !REQUEST_PHOTO_TYPES.includes(doc.mime_type)) throw notFound();
    const withdrawn = await db.rpc("set_mission_offer_photo", { p_id: doc.intervention_id, p_document_id: id, p_shared: false });
    if (withdrawn.error?.code === "P0001") throw noLongerOpen();
    if (withdrawn.error?.code === "42501") throw notFound();
    dbError(withdrawn.error);
    if (withdrawn.data !== false) throw new ApiError(503, "La suppression est momentanément indisponible. Réessayez.");
    // Last read before the irreversible step (an acceptance may have landed since the check above).
    const job = await admin.from("interventions").select("client_id,status,artisan_id").eq("id", doc.intervention_id).maybeSingle();
    if (job.error || !job.data) throw new ApiError(503, "La suppression est momentanément indisponible. Réessayez.");
    if (job.data.client_id !== user.id) throw notFound();
    if (job.data.status !== "requested" || job.data.artisan_id) throw noLongerOpen();
    const removed = await admin.from("documents").delete().eq("id", id).eq("owner_id", user.id).eq("intervention_id", doc.intervention_id).select("id");
    if (removed.error?.code === "23503")
      throw new ApiError(409, "Cette photo est utilisée dans un message ou un rapport du dossier : elle ne peut pas être supprimée.");
    if (removed.error) throw new ApiError(503, "La suppression est momentanément indisponible. Réessayez.");
    if (!removed.data?.length) throw notFound();
    let cleaned = false;
    for (let attempt = 0; attempt < 2 && !cleaned; attempt++) {
      try {
        const result = await admin.storage.from("intervention-documents").remove([doc.path]);
        cleaned = !result.error && Array.isArray(result.data) && result.data.some((entry) => entry?.name === doc.path);
      } catch { cleaned = false; }
    }
    // Trace of the destructive action (who, which dossier); never blocks the answer.
    try { await admin.from("audit_log").insert({ actor_id: user.id, intervention_id: doc.intervention_id, action: "request_photo_deleted" }); } catch { /* best effort */ }
    if (!cleaned) {
      console.error("request photo file not removed", { document: id });
      return Response.json({ error: "La photo a été retirée du dossier, mais l’effacement du fichier n’a pas été confirmé. Signalez-le à l’assistance.", deleted: true, cleanup: "incomplete" }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    return Response.json({ deleted: true, id }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const response = apiError(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
