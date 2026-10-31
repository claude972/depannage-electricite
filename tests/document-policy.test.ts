import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as shared from "../lib/shared/document-policy";
import * as canonical from "../supabase/functions/_shared/document-policy.ts";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);
const jpeg = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const pdf = text("%PDF-1.7\n%âãÏÓ");
const webp = new Uint8Array([
  ...text("RIFF"),
  0x24,
  0x00,
  0x00,
  0x00,
  ...text("WEBP"),
  ...text("VP8 "),
]);

test("the Next entry point re-exports the canonical Deno-shared module", () => {
  assert.equal(shared.detectType, canonical.detectType);
  assert.equal(shared.validateDocumentUpload, canonical.validateDocumentUpload);
  assert.equal(shared.MAX_DOCUMENT_BYTES, canonical.MAX_DOCUMENT_BYTES);
});
test("limits match the private bucket created in migration 001", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/202610310001_initial.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /'intervention-documents',false,4194304,/);
  assert.equal(shared.MAX_DOCUMENT_BYTES, 4194304);
  assert.equal(shared.DOCUMENT_BUCKET, "intervention-documents");
  assert.ok(shared.MAX_REQUEST_BYTES > shared.MAX_DOCUMENT_BYTES);
  for (const mime of shared.ALLOWED_DOCUMENT_MIME)
    assert.ok(migration.includes(`'${mime}'`), `${mime} allowed by bucket`);
});
test("magic bytes identify the four allowed formats", () => {
  assert.equal(shared.detectType(jpeg), "image/jpeg");
  assert.equal(shared.detectType(png), "image/png");
  assert.equal(shared.detectType(pdf), "application/pdf");
  assert.equal(shared.detectType(webp), "image/webp");
});
test("other or truncated content is refused regardless of the declared type", () => {
  assert.equal(shared.detectType(text("GIF89a")), null);
  assert.equal(shared.detectType(text("<svg xmlns=")), null);
  assert.equal(shared.detectType(text("<!doctype html>")), null);
  assert.equal(shared.detectType(bytes()), null);
  assert.equal(shared.detectType(bytes(0xff, 0xd8)), null);
  assert.equal(shared.detectType(bytes(0x89, 0x50, 0x4e)), null);
  // RIFF container that is not WebP (WAVE audio renamed to .webp).
  assert.equal(
    shared.detectType(new Uint8Array([...text("RIFF"), 0, 0, 0, 0, ...text("WAVE")])),
    null,
  );
  // High-bit bytes never alias ASCII letters.
  assert.equal(shared.detectType(bytes(0x89, 0xd0, 0xce, 0xc7)), null);
});
test("declared MIME must equal the detected type", () => {
  assert.deepEqual(
    shared.validateDocumentUpload({ size: png.length, declaredType: "image/png", bytes: png }),
    { ok: true, mime: "image/png" },
  );
  assert.deepEqual(
    shared.validateDocumentUpload({ size: png.length, declaredType: "image/jpeg", bytes: png }),
    { ok: false, reason: "type_mismatch" },
  );
  assert.deepEqual(
    shared.validateDocumentUpload({ size: 6, declaredType: "image/gif", bytes: text("GIF89a") }),
    { ok: false, reason: "type_mismatch" },
  );
  assert.deepEqual(
    shared.validateDocumentUpload({ size: pdf.length, declaredType: "", bytes: pdf }),
    { ok: false, reason: "type_mismatch" },
  );
});
test("size bounds: empty refused, 4 MiB accepted, one more byte refused", () => {
  assert.deepEqual(
    shared.validateDocumentUpload({ size: 0, declaredType: "image/jpeg", bytes: bytes() }),
    { ok: false, reason: "empty" },
  );
  const max = new Uint8Array(shared.MAX_DOCUMENT_BYTES);
  max.set(jpeg);
  assert.deepEqual(
    shared.validateDocumentUpload({ size: max.length, declaredType: "image/jpeg", bytes: max }),
    { ok: true, mime: "image/jpeg" },
  );
  assert.deepEqual(
    shared.validateDocumentUpload({
      size: shared.MAX_DOCUMENT_BYTES + 1,
      declaredType: "image/jpeg",
      bytes: jpeg,
    }),
    { ok: false, reason: "too_large" },
  );
  const over = new Uint8Array(shared.MAX_DOCUMENT_BYTES + 1);
  over.set(jpeg);
  // The client-reported size is never trusted on its own.
  assert.deepEqual(
    shared.validateDocumentUpload({ size: 10, declaredType: "image/jpeg", bytes: over }),
    { ok: false, reason: "too_large" },
  );
});
test("document names are clipped to 160 characters and never empty", () => {
  assert.equal(shared.documentNameFor("x".repeat(200)).length, 160);
  assert.equal(shared.documentNameFor("photo.jpg"), "photo.jpg");
  assert.equal(shared.documentNameFor(""), "document");
  assert.equal(shared.documentNameFor("   "), "document");
});
test("uuid guard accepts RFC 4122 values only", () => {
  assert.equal(shared.isUuid("00000000-0000-4000-8000-000000000001"), true);
  assert.equal(shared.isUuid("00000000-0000-0000-0000-000000000001"), false);
  assert.equal(shared.isUuid("not-a-uuid"), false);
  assert.equal(shared.isUuid(42), false);
});
test("the canonical module stays runtime-neutral (no imports, no Node or Deno globals)", async () => {
  const source = await readFile(
    new URL("../supabase/functions/_shared/document-policy.ts", import.meta.url),
    "utf8",
  );
  const code = source.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /^\s*import\s/m);
  assert.doesNotMatch(code, /\bBuffer\b|\bDeno\b|\bprocess\b|\brequire\(/);
  const edge = await readFile(
    new URL("../supabase/functions/native-document-upload/handler.ts", import.meta.url),
    "utf8",
  );
  assert.match(edge, /from "\.\.\/_shared\/document-policy\.ts"/);
  assert.doesNotMatch(edge.replace(/\/\/.*$/gm, ""), /\bDeno\b/);
});
