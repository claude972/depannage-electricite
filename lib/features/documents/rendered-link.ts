import { adminClient, ApiError } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET } from "@/lib/shared/document-policy";
import { signPrivateDocument, unavailableDownload } from "./signed-url";

const MAX_RENDERED_BYTES = 4 * 1024 * 1024;
/**
 * Short-lived link to a PDF that the route has just rendered for an already authorised reader
 * (native application: a system browser cannot send the Bearer token of the app session).
 * The caller keeps its own authorisation (SQL command under the reader's JWT) and passes the bytes
 * it would otherwise have streamed. The copy lives in the private bucket under a prefix that no
 * `documents` row can reference (`rendered/…`), keyed by reader and immutable snapshot, and is only
 * reachable through the 60-second signed URL returned here.
 */
export async function renderedPdfLink(userId: string, key: string, bytes: Uint8Array): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[a-z0-9-]{1,120}$/.test(key))
    throw new ApiError(422, "Document invalide.");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RENDERED_BYTES) unavailableDownload();
  const admin = adminClient();
  const path = `rendered/${userId.toLowerCase()}/${key}.pdf`;
  let uploaded;
  try {
    uploaded = await admin.storage.from(DOCUMENT_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  } catch { unavailableDownload(); }
  if (uploaded.error) unavailableDownload();
  return signPrivateDocument(admin, path);
}
