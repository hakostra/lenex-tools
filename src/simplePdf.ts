// Minimal PDF writer: standard Helvetica fonts, text and straight lines only.

export type PdfFont = 'regular' | 'bold';

// Helvetica / Helvetica-Bold advance widths (1/1000 em) for ASCII 32..126.
const regularWidths = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const boldWidths = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

const specialWidths: Record<string, [number, number]> = {
  'æ': [889, 889], 'Æ': [1000, 1000], 'ø': [611, 611], 'Ø': [778, 778]
};

const charWidth = (char: string, font: PdfFont): number => {
  const special = specialWidths[char];
  if (special) return special[font === 'bold' ? 1 : 0];
  const code = char.charCodeAt(0);
  if (code >= 32 && code <= 126) return (font === 'bold' ? boldWidths : regularWidths)[code - 32];
  const base = char.normalize('NFD').charAt(0);
  const baseCode = base.charCodeAt(0);
  return baseCode >= 32 && baseCode <= 126 ? (font === 'bold' ? boldWidths : regularWidths)[baseCode - 32] : 556;
};

export const measureText = (text: string, font: PdfFont, size: number): number =>
  Array.from(text).reduce((total, char) => total + charWidth(char, font), 0) * size / 1000;

export const fitText = (text: string, font: PdfFont, size: number, maxWidth: number): string => {
  if (measureText(text, font, size) <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && measureText(`${chars.join('')}...`, font, size) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}...`;
};

const replacements: Record<string, string> = { '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"' };

// Characters outside Latin-1 are replaced, since the standard fonts use WinAnsiEncoding.
const encodePdfString = (text: string): string => {
  let out = '';
  for (const char of text) {
    const mapped = replacements[char] ?? char;
    const code = mapped.charCodeAt(0);
    const safe = mapped.length === 1 && code >= 32 && code <= 255 && !(code >= 127 && code <= 159) ? mapped : '?';
    out += safe === '(' || safe === ')' || safe === '\\' ? `\\${safe}` : safe;
  }
  return `(${out})`;
};

const num = (value: number) => (Math.round(value * 100) / 100).toString();

export class PdfDocument {
  private readonly pages: string[][] = [];

  constructor(readonly width: number, readonly height: number) {}

  addPage() {
    this.pages.push([]);
  }

  text(x: number, y: number, text: string, font: PdfFont, size: number) {
    this.currentPage().push(`BT /${font === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf ${num(x)} ${num(y)} Td ${encodePdfString(text)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number, lineWidth = 0.5) {
    this.currentPage().push(`q ${num(lineWidth)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    if (this.pages.length === 0) this.addPage();
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${this.pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${this.pages.length} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    ];
    for (const [index, operations] of this.pages.entries()) {
      const content = operations.join('\n');
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
      );
    }

    let output = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const [index, body] of objects.entries()) {
      offsets.push(output.length);
      output += `${index + 1} 0 obj\n${body}\nendobj\n`;
    }
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const bytes = new Uint8Array(output.length);
    for (let index = 0; index < output.length; index++) bytes[index] = output.charCodeAt(index) & 0xff;
    return bytes;
  }

  private currentPage() {
    if (this.pages.length === 0) this.addPage();
    return this.pages[this.pages.length - 1];
  }
}
