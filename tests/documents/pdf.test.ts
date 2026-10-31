import test from "node:test";
import assert from "node:assert/strict";
import { PdfDocument, encodeWinAnsi, pdfStringLiteral, textWidth, wrapText } from "../../lib/features/quote-documents/pdf-writer";
import { renderQuoteDocumentPdf } from "../../lib/features/quote-documents/pdf";
import { parseSnapshot } from "../../lib/features/quote-documents/snapshot";
import { latin1, sampleSnapshot } from "./harness";

const META = { revision: 2, generated_at: "2026-10-31T14:05:00Z", snapshot_sha256: "ab".repeat(32) };

/** Independent xref reader: every entry must point at exactly "<n> 0 obj". */
function checkStructure(bytes: Uint8Array) {
  const text = latin1(bytes);
  assert.ok(text.startsWith("%PDF-1.4\n"), "header");
  assert.ok(text.endsWith("%%EOF\n"), "eof");
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref", "startxref points at the xref table");
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(startxref))!;
  const count = Number(header[1]);
  const entries = text.slice(startxref + header[0].length, startxref + header[0].length + count * 20);
  const rows = entries.match(/[\s\S]{20}/g)!;
  assert.equal(rows.length, count);
  assert.equal(rows[0], "0000000000 65535 f \n");
  for (let i = 1; i < count; i++) {
    assert.match(rows[i], /^\d{10} 00000 n \n$/);
    const offset = Number(rows[i].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${i} 0 obj\n`), `object ${i} offset ${offset}`);
  }
  assert.match(text, new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>`));
  // Each stream length matches its bytes exactly.
  for (const m of text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = m.index! + m[0].length;
    assert.equal(text.slice(start + Number(m[1]), start + Number(m[1]) + 10), "\nendstream");
  }
  return { text, count };
}

test("WinAnsi encoding covers French punctuation, euro and oe; unmappable characters become '?'", () => {
  assert.deepEqual([...encodeWinAnsi("é€’œ a")], [0xe9, 0x80, 0x92, 0x9c, 0xa0, 0x61]);
  assert.deepEqual([...encodeWinAnsi("→\n\t")], [0x3f, 0x20, 0x20]);
  assert.deepEqual([...encodeWinAnsi(" ")], [0xa0], "narrow no-break space maps to no-break space");
});
test("string literals escape parentheses and backslashes and octal-escape high bytes", () => {
  assert.equal(pdfStringLiteral(encodeWinAnsi("(a)\\b")), "(\\(a\\)\\\\b)");
  assert.equal(pdfStringLiteral(encodeWinAnsi("5 €")), "(5 \\200)");
  assert.equal(pdfStringLiteral(encodeWinAnsi("é")), "(\\351)");
});
test("text metrics and wrapping follow Helvetica widths", () => {
  assert.equal(textWidth("iii", "regular", 10), 6.66);
  assert.ok(textWidth("iii", "bold", 10) > textWidth("iii", "regular", 10), "bold i is wider (278 vs 222)");
  assert.deepEqual(wrapText("un deux trois", "regular", 10, 40), ["un deux", "trois"]);
  assert.deepEqual(wrapText("", "regular", 10, 40), [""]);
  const longWord = wrapText("abcdefghijklmnopqrstuvwxyz", "regular", 10, 30);
  assert.ok(longWord.length > 1 && longWord.every((l) => textWidth(l, "regular", 10) <= 30));
});
test("a bare document serialises with exact xref offsets, two standard fonts and UTF-16 metadata", () => {
  const doc = new PdfDocument();
  doc.addPage().text(10, 10, "Bonjour (monde) é€");
  doc.addPage().line(0, 0, 10, 10);
  const { text, count } = checkStructure(doc.build({ title: "Devis — test", createdAt: "2026-10-31T14:05:00Z" }));
  assert.equal(count, 1 + 5 + 4, "catalog, pages, 2 fonts, info, 2 × (page + content)");
  assert.match(text, /\/BaseFont \/Helvetica \/Encoding \/WinAnsiEncoding/);
  assert.match(text, /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/);
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/Title <FEFF004400650076006900730020201400200074006500730074>/i);
  assert.match(text, /\/CreationDate \(D:20261031140500Z\)/);
  assert.ok(text.includes("(Bonjour \\(monde\\) \\351\\200) Tj"));
});
test("a 30-line quote renders on two pages with totals, validity, issuer and footer on each page", () => {
  const snapshot = parseSnapshot(sampleSnapshot());
  const bytes = renderQuoteDocumentPdf(snapshot, META);
  const { text } = checkStructure(bytes);
  assert.match(text, /\/Count 2/);
  const streams = [...text.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]);
  assert.equal(streams.length, 2);
  const enc = (s: string) => pdfStringLiteral(encodeWinAnsi(s)).slice(1, -1);
  assert.ok(streams[0].includes(enc("DEVIS")), "title on page 1");
  assert.ok(streams[0].includes(enc("SIRET 12345678901234")));
  assert.ok(streams[0].includes(enc("Valable jusqu’au 15/11/2026 inclus (état constaté à la génération).")));
  assert.ok(streams[0].includes(enc("Non renseigné dans le dossier professionnel : numéro de")), "unset optional issuer data stated, never invented");
  assert.ok(streams[1].includes(enc("Total TTC")));
  assert.ok(streams[1].includes(enc("5 388,00 €")), "server total printed with French formatting");
  assert.ok(streams[1].includes(enc("Ce document n’est pas une facture.")));
  for (const [i, stream] of streams.entries()) {
    assert.ok(stream.includes(enc(`Page ${i + 1} / 2`)), `page number ${i + 1}`);
    assert.ok(stream.includes(enc("DEV-100000 — révision 2 — généré le 31/10/2026 14:05 UTC — empreinte abababababab")));
  }
  assert.ok(!text.includes("Jean QA") || text.includes(enc("Contact : Jean QA — 0696000000")));
});
test("an amendment renders its own lines, the accepted quote total and the cumulative total", () => {
  const snapshot = parseSnapshot(sampleSnapshot({ kind: "amendment", lineCount: 3 }));
  const { text } = checkStructure(renderQuoteDocumentPdf(snapshot, { ...META, revision: 1 }));
  const enc = (s: string) => pdfStringLiteral(encodeWinAnsi(s)).slice(1, -1);
  assert.match(text, /\/Count 1/);
  assert.ok(text.includes(enc("AVENANT N° 3 AU DEVIS DEV-100000")));
  assert.ok(text.includes(enc("Validité non renseignée par l’émetteur (état constaté à la génération).")));
  assert.ok(text.includes(enc("Total TTC des avenants acceptés antérieurs : 50,00 €.")));
  assert.ok(text.includes(enc("Total cumulé TTC (devis + avenants acceptés + cet avenant) : ")));
  assert.ok(text.includes(enc("le montant réglé en ligne reste celui du devis accepté.")));
  assert.ok(text.includes(enc("Commentaire de décision : OK pour les deux départs")));
});
test("rendering is deterministic for the same snapshot and metadata", () => {
  const snapshot = parseSnapshot(sampleSnapshot({ lineCount: 2 }));
  assert.deepEqual(renderQuoteDocumentPdf(snapshot, META), renderQuoteDocumentPdf(snapshot, META));
});
