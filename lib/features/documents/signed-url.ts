import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/supabase/server";
import { DOCUMENT_BUCKET as bucket } from "@/lib/shared/document-policy";

export function unavailableDownload(): never {
  throw new ApiError(503, "Le lien du document est momentanément indisponible. Réessayez.");
}

export async function signPrivateDocument(db: SupabaseClient, path: unknown): Promise<string> {
  if (typeof path !== "string" ||
    !path.length || path.length > 1024 || path.trim() !== path ||
    /[\u0000-\u001f\u007f\\]/.test(path) ||
    path.split("/").some((part: string) => !part || part === "." || part === ".."))
    unavailableDownload();
  let base: URL;
  try { base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""); }
  catch { unavailableDownload(); }
  if (base.protocol !== "https:" || base.username || base.password) unavailableDownload();
  const signed = await db.storage.from(bucket).createSignedUrl(path, 60);
  if (signed.error || typeof signed.data?.signedUrl !== "string") unavailableDownload();
  const value = signed.data.signedUrl;
  if (!value || value.length > 8192 || value.trim() !== value) unavailableDownload();
  try {
    const url = new URL(value);
    // Validate only origin/path, never decode or log the opaque signed query token.
    const expectedPath = `${base.pathname.replace(/\/$/, "")}/storage/v1/object/sign/${bucket}/${path}`;
    if (url.protocol !== "https:" || url.origin !== base.origin || url.username || url.password ||
      url.hash || decodeURIComponent(url.pathname) !== expectedPath) unavailableDownload();
    // Inspect parameter names and raw presence only. The signature value stays opaque:
    // never decode it, parse claims or expose it in diagnostics. Duplicate keys are ambiguous.
    const tokenEntries = url.search.slice(1).split("&").filter(part =>
      decodeURIComponent(part.split("=", 1)[0].replace(/\+/g, " ")) === "token");
    if (tokenEntries.length !== 1 || !/^token=.+$/s.test(tokenEntries[0])) unavailableDownload();
  } catch { unavailableDownload(); }
  return value;
}
