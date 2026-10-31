// Checks on a privately downloaded PDF (bytes from the real route, never from the overview JSON).
// The application writes uncompressed WinAnsi text literals (lib/features/quote-documents/pdf-writer.ts),
// so references and amounts are searchable in the latin1-decoded bytes.

/** Digits and separators of a euro amount as the writer prints them: "120,00". */
export function euroDigits(cents) {
  const abs = Math.abs(Math.trunc(cents));
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Quote reference as the SQL `quote_document_reference` builds it (015): DEV-<6 hex of the id>. */
export function quoteReference(quoteId, amendmentVersion = null) {
  const core = `DEV-${quoteId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  return amendmentVersion === null ? core : `AV-${amendmentVersion}-${core}`;
}

/**
 * Inspects the bytes of a download. `expect` lists strings that must appear (reference, amounts,
 * title). Returns a verdict object; the caller asserts on it and stores it as evidence.
 */
export function inspectPdf(bytes, { status, contentType, contentLength, expect = [] } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const text = buffer.toString("latin1");
  const missing = expect.filter((needle) => !text.includes(needle));
  const verdict = {
    status: status ?? null,
    content_type: contentType ?? null,
    bytes: buffer.length,
    is_pdf: buffer.length > 8 && text.startsWith("%PDF-"),
    has_eof: /%%EOF\s*$/.test(text.slice(-32)),
    length_matches: contentLength === undefined || contentLength === null ? null : Number(contentLength) === buffer.length,
    found: expect.filter((needle) => text.includes(needle)),
    missing,
  };
  verdict.ok =
    verdict.status === 200 &&
    typeof verdict.content_type === "string" &&
    verdict.content_type.startsWith("application/pdf") &&
    verdict.is_pdf &&
    verdict.bytes > 0 &&
    verdict.length_matches !== false &&
    missing.length === 0;
  return verdict;
}

/** Expected ETag of a document route response: "<sha256[0:32]>-r<revision>" with quotes. */
export function expectedEtag(document) {
  return `"${String(document.snapshot_sha256).slice(0, 32)}-r${document.revision}"`;
}
