// Génération de fichiers tabulaires (CSV, Excel, PDF) pour les exports et les rapports
// programmés, sans dépendance externe : CSV UTF-8 (séparateur « ; », lisible par Excel
// en français), classeur Excel minimal (Office Open XML, archive ZIP non compressée)
// et PDF A4 paysage mis en page aux couleurs Ciyou Eats.
import { PDF_COLORS, PdfDocument } from '../../hr/pdf';

export type ColumnType = 'text' | 'number' | 'money' | 'percent' | 'date' | 'datetime';

export interface TableColumn {
  key: string;
  label: string;
  type?: ColumnType;
  /** Largeur relative dans le PDF (1 par défaut). */
  width?: number;
}

export type TableValue = string | number | boolean | null | undefined;

export interface TableDocument {
  title: string;
  subtitle?: string;
  columns: TableColumn[];
  rows: Array<Record<string, TableValue>>;
  /** Chiffres clés affichés en tête du PDF et en première feuille Excel. */
  summary?: Array<{ label: string; value: string }>;
}

// ------------------------------------------------------------------ Formats

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const pct = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const clean = (text: string) => text.replace(/[  ]/g, ' ');

/** Valeur affichée (PDF) : montants en centimes, taux entre 0 et 1, dates ISO. */
export function displayValue(value: TableValue, type: ColumnType = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  switch (type) {
    case 'money':
      return clean(eur.format(Number(value) / 100));
    case 'percent':
      return clean(pct.format(Number(value)));
    case 'number':
      return clean(num.format(Number(value)));
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : clean(dateFmt.format(new Date(String(value))));
    case 'datetime':
      return clean(dateTimeFmt.format(new Date(String(value))));
    default:
      return String(value);
  }
}

// ------------------------------------------------------------------ CSV

function csvCell(value: TableValue, type: ColumnType = 'text'): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'boolean') text = value ? 'Oui' : 'Non';
  else if (type === 'money') text = (Number(value) / 100).toFixed(2).replace('.', ',');
  else if (type === 'percent') text = (Math.round(Number(value) * 10_000) / 100).toString().replace('.', ',');
  else if (type === 'number') text = String(value).replace('.', ',');
  else if (type === 'date' || type === 'datetime') text = displayValue(value, type);
  else text = String(value);
  // Neutralise les formules (injection CSV) et échappe les guillemets.
  if (/^[=+\-@\t\r]/.test(text) && type === 'text') text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(doc: TableDocument): Buffer {
  const header = doc.columns.map((c) => csvCell(c.type === 'money' ? `${c.label} (€)` : c.type === 'percent' ? `${c.label} (%)` : c.label)).join(';');
  const lines = doc.rows.map((row) => doc.columns.map((c) => csvCell(row[c.key], c.type)).join(';'));
  return Buffer.from(`﻿${[header, ...lines].join('\r\n')}\r\n`, 'utf8');
}

// ------------------------------------------------------------------ Excel (OOXML)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Archive ZIP sans compression (suffisant pour un classeur de quelques mégaoctets). */
function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, file.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

const xmlEscape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

// Styles : 0 normal, 1 en-tête, 2 montant, 3 pourcentage, 4 nombre, 5 date, 6 titre.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF19343B"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF19343B"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8F4EC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE8E0D2"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

function excelDate(value: string): number | null {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Date.parse(value);
  if (Number.isNaN(time)) return null;
  return time / 86_400_000 + 25569;
}

function sheetXml(rows: Array<Array<{ value: TableValue; type: ColumnType; style?: number }>>, widths: number[]): string {
  const body = rows
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const { value, type } = cell;
          if (value === null || value === undefined || value === '') return '';
          const numeric = type === 'money' || type === 'percent' || type === 'number';
          if (numeric && typeof value === 'number' && Number.isFinite(value)) {
            const v = type === 'money' ? value / 100 : value;
            const style = cell.style ?? (type === 'money' ? 2 : type === 'percent' ? 3 : 4);
            return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
          }
          if ((type === 'date' || type === 'datetime') && typeof value === 'string') {
            const serial = excelDate(value);
            if (serial !== null) return `<c r="${ref}" s="5"><v>${serial}</v></c>`;
          }
          const text = typeof value === 'boolean' ? (value ? 'Oui' : 'Non') : String(value);
          return `<c r="${ref}" t="inlineStr"${cell.style ? ` s="${cell.style}"` : ''}><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${xml}</row>`;
    })
    .join('');
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${cols}</cols><sheetData>${body}</sheetData></worksheet>`;
}

export function toXlsx(doc: TableDocument): Buffer {
  const header = doc.columns.map((c) => ({ value: c.label, type: 'text' as ColumnType, style: 1 }));
  const data = doc.rows.map((row) => doc.columns.map((c) => ({ value: row[c.key], type: c.type ?? 'text' })));
  const widths = doc.columns.map((c) => {
    const longest = Math.max(c.label.length, ...doc.rows.slice(0, 200).map((row) => displayValue(row[c.key], c.type).length));
    return Math.min(48, Math.max(10, longest + 2));
  });
  const sheets: Array<{ name: string; xml: string }> = [{ name: 'Données', xml: sheetXml([header, ...data], widths) }];
  if (doc.summary?.length) {
    const rows = [
      [{ value: doc.title, type: 'text' as ColumnType, style: 6 }],
      [{ value: doc.subtitle ?? '', type: 'text' as ColumnType }],
      [],
      ...doc.summary.map((s) => [
        { value: s.label, type: 'text' as ColumnType, style: 1 },
        { value: s.value, type: 'text' as ColumnType },
      ]),
    ];
    sheets.unshift({ name: 'Synthèse', xml: sheetXml(rows, [36, 28]) });
  }
  const files = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('')}</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
          .map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(s.xml) })),
  ];
  return zip(files);
}

// ------------------------------------------------------------------ PDF

/** PDF A4 paysage : en-tête Ciyou Eats, chiffres clés, tableau paginé avec en-têtes répétés. */
export function toPdf(doc: TableDocument): Buffer {
  const pdf = new PdfDocument();
  // Format paysage : on permute les dimensions de la page A4.
  Object.assign(pdf, { width: 841.89, height: 595.28 });
  const margin = 36;
  const usable = pdf.width - margin * 2;
  const totalWeight = doc.columns.reduce((s, c) => s + (c.width ?? 1), 0);
  const widths = doc.columns.map((c) => ((c.width ?? 1) / totalWeight) * usable);
  const generated = clean(dateTimeFmt.format(new Date()));
  let page = 1;
  let y = 0;

  const footer = () => {
    pdf.line(margin, pdf.height - 28, pdf.width - margin, pdf.height - 28);
    pdf.text(margin, pdf.height - 16, `Ciyou Eats · ${doc.title}`, { size: 7.5, color: PDF_COLORS.subtle });
    pdf.text(pdf.width - margin, pdf.height - 16, `Page ${page} · généré le ${generated}`, { size: 7.5, color: PDF_COLORS.subtle, align: 'right' });
  };
  const tableHeader = () => {
    pdf.rect(margin, y, usable, 20, { fill: PDF_COLORS.surface, radius: 4 });
    let x = margin;
    doc.columns.forEach((c, i) => {
      const w = widths[i] ?? 60;
      const right = c.type === 'money' || c.type === 'number' || c.type === 'percent';
      pdf.text(right ? x + w - 6 : x + 6, y + 13, pdf.fit(c.label.toUpperCase(), w - 12, 6.5, true), { size: 6.5, bold: true, color: PDF_COLORS.muted, align: right ? 'right' : 'left' });
      x += w;
    });
    y += 24;
  };

  pdf.logo(margin, 28, 20);
  pdf.text(pdf.width - margin, 42, generated, { size: 8, color: PDF_COLORS.subtle, align: 'right' });
  y = 76;
  pdf.text(margin, y, doc.title, { size: 17, bold: true });
  y += 16;
  if (doc.subtitle) {
    pdf.text(margin, y, pdf.fit(doc.subtitle, usable, 9.5), { size: 9.5, color: PDF_COLORS.muted });
    y += 18;
  }
  if (doc.summary?.length) {
    const perRow = Math.min(4, doc.summary.length);
    const cardW = (usable - (perRow - 1) * 10) / perRow;
    doc.summary.forEach((item, index) => {
      const col = index % perRow;
      if (index > 0 && col === 0) y += 52;
      const x = margin + col * (cardW + 10);
      pdf.rect(x, y, cardW, 44, { stroke: PDF_COLORS.border, radius: 6 });
      pdf.text(x + 10, y + 16, pdf.fit(item.label, cardW - 20, 7.5), { size: 7.5, color: PDF_COLORS.muted });
      pdf.text(x + 10, y + 34, pdf.fit(item.value, cardW - 20, 13, true), { size: 13, bold: true });
    });
    y += 60;
  }
  if (!doc.rows.length) {
    pdf.text(margin, y + 20, 'Aucune donnée pour cette période et ce périmètre.', { size: 10, color: PDF_COLORS.muted });
    footer();
    return pdf.toBuffer();
  }
  tableHeader();
  doc.rows.forEach((row, index) => {
    if (y > pdf.height - 52) {
      footer();
      pdf.addPage();
      page += 1;
      y = 36;
      tableHeader();
    }
    if (index % 2 === 1) pdf.rect(margin, y - 4, usable, 16, { fill: [0.992, 0.984, 0.968] });
    let x = margin;
    doc.columns.forEach((c, i) => {
      const w = widths[i] ?? 60;
      const right = c.type === 'money' || c.type === 'number' || c.type === 'percent';
      const text = pdf.fit(displayValue(row[c.key], c.type), w - 12, 7.5);
      pdf.text(right ? x + w - 6 : x + 6, y + 7, text, { size: 7.5, align: right ? 'right' : 'left' });
      x += w;
    });
    y += 16;
  });
  footer();
  return pdf.toBuffer();
}

export const MIME_TYPES = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export function render(doc: TableDocument, format: 'csv' | 'xlsx' | 'pdf'): Buffer {
  if (format === 'xlsx') return toXlsx(doc);
  if (format === 'pdf') return toPdf(doc);
  return toCsv(doc);
}
