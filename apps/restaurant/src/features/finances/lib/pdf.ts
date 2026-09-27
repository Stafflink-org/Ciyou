// Mise en page PDF commune (rapports, factures, relevés de reversement) :
// en-tête GoLink, blocs d'informations, tableaux et pied de page numéroté.
// jsPDF est chargé à la demande pour ne pas alourdir les écrans.
import type { jsPDF as JsPdf } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { triggerDownload } from './export';

type Rgb = [number, number, number];

export const PDF_COLORS = {
  ink: [25, 52, 59] as Rgb,
  muted: [88, 112, 112] as Rgb,
  subtle: [135, 151, 147] as Rgb,
  brand: [232, 120, 75] as Rgb,
  line: [232, 224, 210] as Rgb,
  soft: [250, 246, 239] as Rgb,
  success: [74, 132, 108] as Rgb,
  danger: [214, 83, 63] as Rgb,
};

/** Les polices standard du PDF ne connaissent pas les espaces fines ni le signe moins typographique. */
export function pdfText(value: string): string {
  return value.replace(/[  ]/g, ' ').replace(/−/g, '-');
}

export interface PdfMeta {
  title: string;
  /** Lignes sous le titre (établissement, période…). */
  subtitle: string[];
  /** Mention du pied de page. */
  footer: string;
}

export class PdfWriter {
  readonly doc: JsPdf;
  private readonly autoTable: (doc: JsPdf, options: UserOptions) => void;
  readonly margin = 16;
  readonly width: number;
  readonly height: number;
  y = 0;
  private readonly meta: PdfMeta;

  constructor(doc: JsPdf, autoTable: (doc: JsPdf, options: UserOptions) => void, meta: PdfMeta) {
    this.doc = doc;
    this.meta = meta;
    this.autoTable = autoTable;
    this.width = doc.internal.pageSize.getWidth();
    this.height = doc.internal.pageSize.getHeight();
    this.header();
  }

  private header(): void {
    const { doc, margin } = this;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text('Go', margin, margin + 6);
    doc.setTextColor(...PDF_COLORS.brand);
    doc.text('Link', margin + doc.getTextWidth('Go'), margin + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...PDF_COLORS.subtle);
    doc.text('ESPACE RESTAURANT', margin, margin + 11);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...PDF_COLORS.ink);
    doc.text(pdfText(this.meta.title), this.width - margin, margin + 5, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_COLORS.muted);
    this.meta.subtitle.forEach((line, index) => {
      doc.text(pdfText(line), this.width - margin, margin + 10.5 + index * 4.2, { align: 'right' });
    });
    const bottom = margin + 14 + Math.max(0, this.meta.subtitle.length - 1) * 4.2;
    doc.setDrawColor(...PDF_COLORS.line);
    doc.setLineWidth(0.3);
    doc.line(margin, bottom, this.width - margin, bottom);
    this.y = bottom + 8;
  }

  /** Saut de page si la place manque. */
  ensure(space: number): void {
    if (this.y + space > this.height - 22) {
      this.doc.addPage();
      this.y = this.margin + 4;
    }
  }

  heading(text: string): void {
    this.ensure(14);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(10.5);
    this.doc.setTextColor(...PDF_COLORS.ink);
    this.doc.text(pdfText(text), this.margin, this.y);
    this.y += 5;
  }

  paragraph(text: string, options: { size?: number; color?: Rgb } = {}): void {
    const { doc } = this;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(options.size ?? 8.5);
    doc.setTextColor(...(options.color ?? PDF_COLORS.muted));
    const lines = doc.splitTextToSize(pdfText(text), this.width - this.margin * 2) as string[];
    this.ensure(lines.length * 4 + 2);
    doc.text(lines, this.margin, this.y);
    this.y += lines.length * 4 + 2;
  }

  /** Blocs côte à côte (émetteur, destinataire…) : titre + lignes. */
  columns(blocks: Array<{ title: string; lines: string[] }>): void {
    const { doc } = this;
    const gap = 8;
    const colWidth = (this.width - this.margin * 2 - gap * (blocks.length - 1)) / blocks.length;
    const heights = blocks.map((block) => 9 + block.lines.length * 4.2);
    const height = Math.max(...heights);
    this.ensure(height + 4);
    blocks.forEach((block, index) => {
      const x = this.margin + index * (colWidth + gap);
      doc.setFillColor(...PDF_COLORS.soft);
      doc.setDrawColor(...PDF_COLORS.line);
      doc.roundedRect(x, this.y, colWidth, height, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.subtle);
      doc.text(pdfText(block.title.toUpperCase()), x + 4, this.y + 5.5);
      doc.setFontSize(8.5);
      block.lines.forEach((line, lineIndex) => {
        doc.setFont('helvetica', lineIndex === 0 ? 'bold' : 'normal');
        doc.setTextColor(...(lineIndex === 0 ? PDF_COLORS.ink : PDF_COLORS.muted));
        const text = doc.splitTextToSize(pdfText(line), colWidth - 8) as string[];
        doc.text(text[0] ?? '', x + 4, this.y + 10.5 + lineIndex * 4.2);
      });
    });
    this.y += height + 6;
  }

  /** Rangée d'indicateurs clés (libellé + valeur). */
  kpis(items: Array<{ label: string; value: string; accent?: boolean }>): void {
    const { doc } = this;
    const perRow = Math.min(items.length, 4);
    const gap = 4;
    const boxWidth = (this.width - this.margin * 2 - gap * (perRow - 1)) / perRow;
    const rows = Math.ceil(items.length / perRow);
    this.ensure(rows * 20);
    items.forEach((item, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const x = this.margin + col * (boxWidth + gap);
      const y = this.y + row * 20;
      doc.setDrawColor(...PDF_COLORS.line);
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(x, y, boxWidth, 16, 2, 2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.subtle);
      doc.text(pdfText(item.label.toUpperCase()), x + 3.5, y + 5.5);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(...(item.accent ? PDF_COLORS.brand : PDF_COLORS.ink));
      doc.text(pdfText(item.value), x + 3.5, y + 12.3);
    });
    this.y += rows * 20 + 2;
  }

  table(options: {
    head: string[];
    body: string[][];
    foot?: string[];
    /** Index des colonnes alignées à droite (montants). */
    rightAligned?: number[];
    columnWidths?: Record<number, number>;
  }): void {
    const right = new Set(options.rightAligned ?? []);
    const columnStyles: NonNullable<UserOptions['columnStyles']> = {};
    options.head.forEach((_, index) => {
      columnStyles[index] = {
        halign: right.has(index) ? 'right' : 'left',
        ...(options.columnWidths?.[index] ? { cellWidth: options.columnWidths[index] } : {}),
      };
    });
    this.autoTable(this.doc, {
      startY: this.y,
      margin: { left: this.margin, right: this.margin, bottom: 22 },
      head: [options.head.map(pdfText)],
      body: options.body.map((row) => row.map(pdfText)),
      foot: options.foot ? [options.foot.map(pdfText)] : undefined,
      theme: 'plain',
      styles: { font: 'helvetica', fontSize: 8, textColor: PDF_COLORS.ink, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, lineColor: PDF_COLORS.line },
      headStyles: { fillColor: PDF_COLORS.ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
      footStyles: { fillColor: PDF_COLORS.soft, textColor: PDF_COLORS.ink, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [253, 251, 247] },
      bodyStyles: { lineWidth: { bottom: 0.1 } },
      columnStyles,
      didParseCell: (data) => {
        if ((data.section === 'head' || data.section === 'foot') && right.has(data.column.index)) data.cell.styles.halign = 'right';
      },
    });
    const last = (this.doc as JsPdf & { lastAutoTable?: { finalY: number } }).lastAutoTable;
    this.y = (last?.finalY ?? this.y) + 7;
  }

  /** Tampon de statut (PAYÉE, ÉCHOUÉ…) en haut à droite de la première page. */
  stamp(text: string, tone: 'success' | 'danger' | 'muted'): void {
    const { doc } = this;
    const color = tone === 'success' ? PDF_COLORS.success : tone === 'danger' ? PDF_COLORS.danger : PDF_COLORS.subtle;
    doc.setPage(1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const label = pdfText(text.toUpperCase());
    const w = doc.getTextWidth(label) + 8;
    // À droite du logo : ne chevauche ni le titre ni les blocs d'adresses.
    const x = this.margin + 44;
    const y = this.margin + 0.5;
    doc.setDrawColor(...color);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, w, 7, 1.5, 1.5, 'S');
    doc.setTextColor(...color);
    doc.text(label, x + 4, y + 4.9);
    doc.setPage(doc.getNumberOfPages());
  }

  save(fileName: string): void {
    const { doc } = this;
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor(...PDF_COLORS.line);
      doc.setLineWidth(0.2);
      doc.line(this.margin, this.height - 14, this.width - this.margin, this.height - 14);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...PDF_COLORS.subtle);
      doc.text(pdfText(this.meta.footer), this.margin, this.height - 9);
      doc.text(`Page ${page} / ${pages}`, this.width - this.margin, this.height - 9, { align: 'right' });
    }
    triggerDownload(doc.output('blob'), `${fileName}.pdf`);
  }
}

/** Crée un document A4 avec l'en-tête GoLink. */
export async function createPdf(meta: PdfMeta): Promise<PdfWriter> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: meta.title, creator: 'GoLink', author: 'GoLink' });
  return new PdfWriter(doc, autoTableModule.autoTable, meta);
}

/** Pied de page standard : date de génération. */
export function generatedFooter(restaurantName: string): string {
  const now = new Date();
  return `${restaurantName} · Document généré par GoLink le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}
