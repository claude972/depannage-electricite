// Minimal PDF 1.4 writer: pages, text in the standard Type1 fonts Helvetica / Helvetica-Bold
// (WinAnsiEncoding), lines and filled rectangles, exact byte offsets in the xref table.
// No dependency: the project has no PDF library and none is added (contract ADV-DOCUMENTS-001).

export type FontName = "regular" | "bold";
export interface TextOptions {
  font?: FontName;
  size?: number;
  /** RGB in 0..1 */
  color?: [number, number, number];
}

// Unicode → WinAnsi (cp1252) for code points above 0x7E. Anything else becomes "?".
const HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  0x202f: 0xa0, 0x2009: 0xa0, 0x2007: 0xa0,
};
export function encodeWinAnsi(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out.push(0x20);
    else if (code < 0x20) out.push(0x3f);
    else if (code <= 0x7e) out.push(code);
    else if (code >= 0xa0 && code <= 0xff) out.push(code);
    else out.push(HIGH[code] ?? 0x3f);
  }
  return Uint8Array.from(out);
}
/** `(` `)` `\` escaped, non-printables octal-escaped, wrapped in parentheses. Returns latin1 text. */
export function pdfStringLiteral(bytes: Uint8Array): string {
  let s = "(";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s + ")";
}

// Helvetica and Helvetica-Bold advance widths (AFM, 1/1000 em) for 0x20..0x7E.
const REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const SPECIAL: Record<string, [number, number]> = {
  "€": [556, 556], "’": [222, 278], "‘": [222, 278], "“": [333, 500], "”": [333, 500], "œ": [944, 944], "Œ": [1000, 1000],
  "«": [556, 556], "»": [556, 556], "°": [400, 400], "–": [556, 556], "—": [1000, 1000], "…": [1000, 1000], "•": [350, 350],
  " ": [278, 278], "ß": [611, 611], "æ": [889, 889], "Æ": [1000, 1000], "ø": [611, 611], "Ø": [778, 778], "×": [584, 584], "·": [278, 278],
};
export function charWidth(char: string, font: FontName): number {
  const special = SPECIAL[char];
  if (special) return font === "bold" ? special[1] : special[0];
  const base = char.normalize("NFD")[0] ?? "?";
  const code = base.codePointAt(0) ?? 0x3f;
  const table = font === "bold" ? BOLD : REGULAR;
  return code >= 0x20 && code <= 0x7e ? table[code - 0x20] : 556;
}
/** Width of `text` at `size` points. */
export function textWidth(text: string, font: FontName, size: number): number {
  let total = 0;
  for (const char of text) total += charWidth(char, font);
  return (total * size) / 1000;
}
/** Greedy word wrap on spaces; words longer than the line are split by characters. */
export function wrapText(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.split(/[ \t]+/).filter(Boolean);
    let current = "";
    for (let word of words) {
      while (textWidth(word, font, size) > maxWidth) {
        let cut = 1;
        while (cut < word.length && textWidth(word.slice(0, cut + 1), font, size) <= maxWidth) cut++;
        if (current) lines.push(current);
        lines.push(word.slice(0, cut));
        current = "";
        word = word.slice(cut);
      }
      const candidate = current ? `${current} ${word}` : word;
      if (textWidth(candidate, font, size) <= maxWidth || !current) current = candidate;
      else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

export class PdfPage {
  private ops: string[] = [];
  constructor(public readonly width: number, public readonly height: number) {}
  text(x: number, y: number, value: string, options: TextOptions = {}) {
    const font = options.font === "bold" ? "/F2" : "/F1";
    const size = options.size ?? 10;
    const color = options.color ?? [0, 0, 0];
    this.ops.push(
      `BT ${num(color[0])} ${num(color[1])} ${num(color[2])} rg ${font} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(y)} Tm ${pdfStringLiteral(encodeWinAnsi(value))} Tj ET`,
    );
  }
  textRight(xRight: number, y: number, value: string, options: TextOptions = {}) {
    this.text(xRight - textWidth(value, options.font ?? "regular", options.size ?? 10), y, value, options);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.6) {
    this.ops.push(`${num(gray)} G ${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }
  rect(x: number, y: number, w: number, h: number, gray = 0.95) {
    this.ops.push(`${num(gray)} g ${num(x)} ${num(y)} ${num(w)} ${num(h)} re f 0 g`);
  }
  content(): string {
    return this.ops.join("\n") + "\n";
  }
}

export interface PdfInfo {
  title: string;
  subject?: string;
  producer?: string;
  /** ISO timestamp; written as a PDF date in UTC. */
  createdAt?: string;
}
function pdfDate(iso: string | undefined): string | null {
  const time = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(time)) return null;
  const d = new Date(time);
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export class PdfDocument {
  readonly pages: PdfPage[] = [];
  constructor(public readonly width = 595.28, public readonly height = 841.89) {}
  addPage(): PdfPage {
    const page = new PdfPage(this.width, this.height);
    this.pages.push(page);
    return page;
  }
  /** Serialises the document; every xref offset is the exact byte position of "n 0 obj". */
  build(info: PdfInfo): Uint8Array<ArrayBuffer> {
    if (!this.pages.length) this.addPage();
    const objects: Buffer[] = [];
    const pageIds = this.pages.map((_, i) => 6 + i * 2);
    // Info strings are PDFDocEncoding/UTF-16, not WinAnsi: write them as UTF-16BE hex with BOM.
    const literal = (s: string) => {
      let hex = "FEFF";
      for (const unit of Buffer.from(s, "utf16le")) hex += unit.toString(16).padStart(2, "0");
      // utf16le bytes are little-endian pairs; swap to big-endian.
      const swapped = hex.slice(4).replace(/(..)(..)/g, "$2$1");
      return `<FEFF${swapped}>`;
    };
    const infoParts = [`/Title ${literal(info.title)}`, `/Producer ${literal(info.producer ?? "Documents de devis")}`];
    if (info.subject) infoParts.push(`/Subject ${literal(info.subject)}`);
    const created = pdfDate(info.createdAt);
    if (created) infoParts.push(`/CreationDate (${created})`);
    objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));
    objects.push(Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${this.pages.length} >>`, "latin1"));
    objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "latin1"));
    objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>", "latin1"));
    objects.push(Buffer.from(`<< ${infoParts.join(" ")} >>`, "latin1"));
    this.pages.forEach((page, i) => {
      const content = Buffer.from(page.content(), "latin1");
      objects.push(
        Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
          "latin1",
        ),
      );
      objects.push(Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream", "latin1")]));
    });
    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let offset = chunks[0].length;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
      chunks.push(chunk);
      offset += chunk.length;
    });
    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, "latin1"));
    const joined = Buffer.concat(chunks);
    const out = new Uint8Array(new ArrayBuffer(joined.length));
    out.set(joined);
    return out;
  }
}
