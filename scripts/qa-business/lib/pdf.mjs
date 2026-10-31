// Checks on a privately downloaded PDF (bytes from the real route, never from the overview JSON).
// The application writes uncompressed WinAnsi text literals (lib/features/quote-documents/pdf-writer.ts),
// whose high bytes are octal-escaped (\\260 for °): text is decoded from the Tj literals before matching.

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

// cp1252 bytes 0x80..0x9f → Unicode (inverse of the writer's HIGH table); 0xa0..0xff are latin1.
const CP1252 = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178 };
const fromWinAnsi = (bytes) => bytes.map((b) => String.fromCodePoint(b >= 0x80 && b <= 0x9f ? CP1252[b] ?? 0xfffd : b)).join("");

/**
 * Decodes one PDF literal string body (between the outer parentheses): `\(`, `\)`, `\\`,
 * `\n \r \t \b \f`, octal `\d{1,3}`, line continuation, balanced inner parentheses.
 * Returns the raw bytes (WinAnsi for the application's fonts).
 */
export function decodeLiteral(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      out.push(body.charCodeAt(i) & 0xff);
      continue;
    }
    const n = body[++i];
    if (n === undefined) break;
    if (/[0-7]/.test(n)) {
      let digits = n;
      while (digits.length < 3 && /[0-7]/.test(body[i + 1] ?? "")) digits += body[++i];
      out.push(parseInt(digits, 8) & 0xff);
    } else if (n === "n") out.push(0x0a);
    else if (n === "r") out.push(0x0d);
    else if (n === "t") out.push(0x09);
    else if (n === "b") out.push(0x08);
    else if (n === "f") out.push(0x0c);
    else if (n === "\r" || n === "\n") {
      if (n === "\r" && body[i + 1] === "\n") i++;
    } else out.push(n.charCodeAt(0) & 0xff); // \( \) \\ and any other escaped char
  }
  return out;
}
/** Text shown by `Tj` operators of uncompressed content streams, decoded from WinAnsi, one literal per line. */
export function extractPdfText(buffer) {
  const raw = Buffer.from(buffer).toString("latin1");
  const parts = [];
  let i = 0;
  while ((i = raw.indexOf("(", i)) >= 0) {
    let depth = 1;
    let j = i + 1;
    for (; j < raw.length && depth > 0; j++) {
      if (raw[j] === "\\") j++;
      else if (raw[j] === "(") depth++;
      else if (raw[j] === ")") depth--;
    }
    if (depth !== 0) break;
    const body = raw.slice(i + 1, j - 1);
    if (/^\s*Tj\b/.test(raw.slice(j, j + 8))) parts.push(fromWinAnsi(decodeLiteral(body)));
    i = j;
  }
  return parts.join("\n");
}
const normalize = (text) => String(text).replace(/[\u00a0\u202f\u2007\u2009]/g, " ");

/**
 * Inspects the bytes of a real private download. Expectations are matched against the DECODED
 * page text (PDF literals, octal escapes, WinAnsi), never against raw bytes nor the overview JSON.
 */
export function inspectPdf(bytes, { status, contentType, contentLength, expect = [] } = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const raw = buffer.toString("latin1");
  const text = normalize(extractPdfText(buffer));
  const missing = expect.filter((needle) => !text.includes(normalize(needle)));
  const verdict = {
    status: status ?? null,
    content_type: contentType ?? null,
    bytes: buffer.length,
    is_pdf: buffer.length > 8 && raw.startsWith("%PDF-"),
    has_eof: /%%EOF\s*$/.test(raw.slice(-32)),
    length_matches: contentLength === undefined || contentLength === null ? null : Number(contentLength) === buffer.length,
    text_literals: text ? text.split("\n").length : 0,
    found: expect.filter((needle) => text.includes(normalize(needle))),
    missing,
  };
  verdict.ok =
    verdict.status === 200 &&
    typeof verdict.content_type === "string" &&
    verdict.content_type.startsWith("application/pdf") &&
    verdict.is_pdf &&
    verdict.has_eof &&
    verdict.bytes > 0 &&
    verdict.length_matches !== false &&
    missing.length === 0;
  return verdict;
}

/** Expected ETag of a document route response: "<sha256[0:32]>-r<revision>" with quotes. */
export function expectedEtag(document) {
  return `"${String(document.snapshot_sha256).slice(0, 32)}-r${document.revision}"`;
}
