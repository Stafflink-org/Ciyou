// Générateur PDF minimal (A4, polices standard Helvetica, encodage WinAnsi) :
// texte, rectangles et traits, plusieurs pages. Sans dépendance externe.
// Les coordonnées sont exprimées depuis le coin supérieur gauche, en points.

export type Rgb = readonly [number, number, number];

export const PDF_COLORS = {
  ink: [0.098, 0.204, 0.231] as Rgb, // pétrole 900
  muted: [0.345, 0.439, 0.439] as Rgb,
  subtle: [0.53, 0.59, 0.576] as Rgb,
  border: [0.91, 0.878, 0.824] as Rgb,
  surface: [0.98, 0.965, 0.937] as Rgb,
  brand: [0.91, 0.471, 0.294] as Rgb,
  danger: [0.839, 0.325, 0.247] as Rgb,
  success: [0.29, 0.518, 0.424] as Rgb,
  white: [1, 1, 1] as Rgb,
};

// Largeurs des glyphes (1/1000 em) des caractères 32 à 126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const HELVETICA_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Caractères hors ASCII de la page de code Windows-1252.
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, 'Œ': 0x8c, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94,
  '•': 0x95, '–': 0x96, '—': 0x97, 'œ': 0x9c, 'Ÿ': 0x9f, ' ': 0xa0, ' ': 0xa0,
};

function encode(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code >= 32 && code < 127) bytes.push(code);
    else if (CP1252[char] !== undefined) bytes.push(CP1252[char]);
    else if (code >= 160 && code <= 255) bytes.push(code);
    else bytes.push(63);
  }
  return bytes;
}

function glyphWidth(byte: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  if (byte >= 32 && byte <= 126) return table[byte - 32] ?? 556;
  if (byte === 0xa0) return 278;
  if (byte === 0x92 || byte === 0x91) return bold ? 278 : 222;
  if (byte === 0x97) return 1000;
  if (byte === 0x95) return 350;
  if (byte === 0x85) return 1000;
  // Lettres accentuées : largeur de la lettre de base.
  const base = String.fromCharCode(byte).normalize('NFD').charCodeAt(0);
  if (base >= 32 && base <= 126) return table[base - 32] ?? 556;
  return 556;
}

export interface TextOptions {
  size?: number;
  bold?: boolean;
  color?: Rgb;
  align?: 'left' | 'right' | 'center';
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

export class PdfDocument {
  readonly width = 595.28;
  readonly height = 841.89;
  private pages: string[][] = [];

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.pages.push([]);
  }

  private get ops(): string[] {
    const page = this.pages[this.pages.length - 1];
    if (!page) throw new Error('Aucune page');
    return page;
  }

  textWidth(text: string, size = 10, bold = false): number {
    return (encode(text).reduce((total, byte) => total + glyphWidth(byte, bold), 0) * size) / 1000;
  }

  /** Texte sur une ligne ; `y` = ligne de base depuis le haut de la page. */
  text(x: number, y: number, text: string, options: TextOptions = {}): void {
    const size = options.size ?? 10;
    const bold = options.bold ?? false;
    const width = this.textWidth(text, size, bold);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    const [r, g, b] = options.color ?? PDF_COLORS.ink;
    const hex = encode(text)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    this.ops.push(`BT ${fmt(r)} ${fmt(g)} ${fmt(b)} rg /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${fmt(left)} ${fmt(this.height - y)} Td <${hex}> Tj ET`);
  }

  /** Découpe un texte en lignes d'au plus `maxWidth` points. */
  wrap(text: string, maxWidth: number, size = 10, bold = false): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (this.textWidth(candidate, size, bold) <= maxWidth || !line) line = candidate;
        else {
          lines.push(line);
          line = word;
        }
      }
      lines.push(line);
    }
    return lines;
  }

  /** Tronque un texte avec « … » pour tenir dans `maxWidth`. */
  fit(text: string, maxWidth: number, size = 10, bold = false): string {
    if (this.textWidth(text, size, bold) <= maxWidth) return text;
    let result = text;
    while (result.length > 1 && this.textWidth(`${result}…`, size, bold) > maxWidth) result = result.slice(0, -1);
    return `${result.trimEnd()}…`;
  }

  rect(x: number, y: number, w: number, h: number, options: { fill?: Rgb; stroke?: Rgb; lineWidth?: number; radius?: number } = {}): void {
    const ops: string[] = [];
    if (options.fill) ops.push(`${options.fill.map(fmt).join(' ')} rg`);
    if (options.stroke) ops.push(`${options.stroke.map(fmt).join(' ')} RG ${fmt(options.lineWidth ?? 0.75)} w`);
    const top = this.height - y;
    const r = Math.min(options.radius ?? 0, w / 2, h / 2);
    if (r > 0) {
      const k = r * 0.5523;
      const x2 = x + w;
      const bottom = top - h;
      ops.push(
        `${fmt(x + r)} ${fmt(top)} m ${fmt(x2 - r)} ${fmt(top)} l ${fmt(x2 - r + k)} ${fmt(top)} ${fmt(x2)} ${fmt(top - r + k)} ${fmt(x2)} ${fmt(top - r)} c`,
        `${fmt(x2)} ${fmt(bottom + r)} l ${fmt(x2)} ${fmt(bottom + r - k)} ${fmt(x2 - r + k)} ${fmt(bottom)} ${fmt(x2 - r)} ${fmt(bottom)} c`,
        `${fmt(x + r)} ${fmt(bottom)} l ${fmt(x + r - k)} ${fmt(bottom)} ${fmt(x)} ${fmt(bottom + r - k)} ${fmt(x)} ${fmt(bottom + r)} c`,
        `${fmt(x)} ${fmt(top - r)} l ${fmt(x)} ${fmt(top - r + k)} ${fmt(x + r - k)} ${fmt(top)} ${fmt(x + r)} ${fmt(top)} c h`,
      );
    } else {
      ops.push(`${fmt(x)} ${fmt(top - h)} ${fmt(w)} ${fmt(h)} re`);
    }
    ops.push(options.fill && options.stroke ? 'B' : options.fill ? 'f' : 'S');
    this.ops.push(`q ${ops.join(' ')} Q`);
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color?: Rgb; width?: number } = {}): void {
    const [r, g, b] = options.color ?? PDF_COLORS.border;
    this.ops.push(
      `q ${fmt(r)} ${fmt(g)} ${fmt(b)} RG ${fmt(options.width ?? 0.75)} w ${fmt(x1)} ${fmt(this.height - y1)} m ${fmt(x2)} ${fmt(this.height - y2)} l S Q`,
    );
  }

  /** Symbole GoLink : tuile orange arrondie portant un « G ». */
  logo(x: number, y: number, size = 22): void {
    this.rect(x, y, size, size, { fill: PDF_COLORS.brand, radius: size * 0.28 });
    this.text(x + size / 2, y + size * 0.72, 'G', { size: size * 0.62, bold: true, color: PDF_COLORS.white, align: 'center' });
    this.text(x + size + 7, y + size * 0.7, 'Go', { size: size * 0.62, bold: true });
    this.text(x + size + 7 + this.textWidth('Go', size * 0.62, true), y + size * 0.7, 'Link', { size: size * 0.62, bold: true, color: PDF_COLORS.brand });
  }

  toBuffer(): Buffer {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length;
    };
    const catalog = add('');
    const pagesId = add('');
    const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pageIds: number[] = [];
    for (const page of this.pages) {
      const content = page.join('\n');
      const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
      pageIds.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`,
        ),
      );
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = Buffer.byteLength(out, 'latin1');
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info << /Producer (GoLink) /Creator (GoLink) >> >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }
}

/** Montant en euros au format français, pour le PDF (espace fine insécable remplacée). */
export function pdfEuros(cents: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100).replace(/[  ]/g, ' ');
}

export function pdfNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(value)
    .replace(/[  ]/g, ' ');
}
