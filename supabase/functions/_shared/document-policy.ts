// Canonical document upload policy shared by the Next route (via lib/shared)
// and the native-document-upload Edge Function. Pure module: no Node or Deno
// globals, no imports, so both runtimes evaluate exactly the same rules.
export const DOCUMENT_BUCKET = "intervention-documents";
// Bucket file_size_limit in migration 001; the server never trusts the client size.
export const MAX_DOCUMENT_BYTES = 4194304;
// Content-Length ceiling: the 4 MiB file plus multipart framing.
export const MAX_REQUEST_BYTES = 4400000;
export const DOCUMENT_NAME_MAX = 160;
export const ALLOWED_DOCUMENT_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export type AllowedMime = (typeof ALLOWED_DOCUMENT_MIME)[number];
export function isAllowedMime(value: unknown): value is AllowedMime {
  return (
    typeof value === "string" &&
    (ALLOWED_DOCUMENT_MIME as readonly string[]).includes(value)
  );
}
function ascii(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let i = start; i < end && i < bytes.length; i++)
    text += String.fromCharCode(bytes[i]);
  return text;
}
// Content sniffing by magic bytes; the declared MIME or extension is never trusted.
export function detectType(bytes: Uint8Array): AllowedMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG")
    return "image/png";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP")
    return "image/webp";
  return null;
}
export type UploadRejection = "empty" | "too_large" | "type_mismatch";
export type UploadValidation =
  | { ok: true; mime: AllowedMime }
  | { ok: false; reason: UploadRejection };
export function validateDocumentUpload(input: {
  size: number;
  declaredType: string;
  bytes: Uint8Array;
}): UploadValidation {
  if (!Number.isFinite(input.size) || input.size < 1)
    return { ok: false, reason: "empty" };
  if (input.size > MAX_DOCUMENT_BYTES || input.bytes.length > MAX_DOCUMENT_BYTES)
    return { ok: false, reason: "too_large" };
  const mime = detectType(input.bytes);
  if (!mime || mime !== input.declaredType)
    return { ok: false, reason: "type_mismatch" };
  return { ok: true, mime };
}
export function documentNameFor(name: string): string {
  const clipped = name.slice(0, DOCUMENT_NAME_MAX);
  return clipped.trim().length > 0 ? clipped : "document";
}
export function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
