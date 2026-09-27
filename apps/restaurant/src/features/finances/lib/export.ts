// Exports tabulaires (CSV pour tableur français, classeur Excel) des écrans
// financiers. Les montants sont transmis en centimes et convertis ici.
import { csvAmount } from './format';

export type CellKind = 'text' | 'money' | 'number' | 'percent' | 'date';

export interface SheetColumn {
  header: string;
  kind?: CellKind;
  /** Largeur indicative (caractères) dans le classeur. */
  width?: number;
}

/** Valeur brute : centimes pour `money`, ratio (0,12) pour `percent`, AAAA-MM-JJ ou Date pour `date`. */
export type Cell = string | number | Date | null | undefined;

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: Cell[][];
  /** Ligne de totaux (mise en gras dans le classeur). */
  totals?: Cell[];
}

export function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function csvCell(value: Cell, kind: CellKind = 'text'): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toLocaleString('fr-FR');
  else if (typeof value === 'number') {
    if (kind === 'money') text = csvAmount(value);
    else if (kind === 'percent') text = (value * 100).toFixed(1).replace('.', ',');
    else text = String(value).replace('.', ',');
  } else text = value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV compatible Excel France : BOM UTF-8, séparateur « ; », virgule décimale. */
export function downloadCsv(sheet: Sheet, fileName: string): void {
  const kinds = sheet.columns.map((column) => column.kind ?? 'text');
  const lines = [
    sheet.columns.map((column) => csvCell(column.header)).join(';'),
    ...sheet.rows.map((row) => row.map((value, index) => csvCell(value, kinds[index])).join(';')),
    ...(sheet.totals ? [sheet.totals.map((value, index) => csvCell(value, kinds[index])).join(';')] : []),
  ];
  triggerDownload(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`);
}

const EXCEL_FORMATS: Record<CellKind, string | undefined> = {
  text: undefined,
  money: '#,##0.00 "€";[Red]-#,##0.00 "€"',
  number: '#,##0',
  percent: '0.0 %',
  date: 'dd/mm/yyyy',
};

function excelValue(value: Cell, kind: CellKind): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (kind === 'money' && typeof value === 'number') return value / 100;
  if (kind === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  }
  return value;
}

/** Classeur Excel (une feuille par tableau), en-têtes figés, formats monétaires. */
export async function downloadXlsx(sheets: Sheet[], fileName: string, meta: { title: string; subtitle: string }): Promise<void> {
  const loaded = await import('exceljs');
  // Paquet CommonJS : selon l'outil de build, l'API est exposée directement ou sous `default`.
  const ExcelJS = (loaded as unknown as { default?: typeof loaded }).default ?? loaded;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Ciyou Eats';
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4 }] });
    ws.getCell('A1').value = meta.title;
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF19343B' } };
    ws.getCell('A2').value = meta.subtitle;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF587070' } };
    const header = ws.getRow(4);
    sheet.columns.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF19343B' } };
      cell.alignment = { vertical: 'middle', horizontal: column.kind && column.kind !== 'text' ? 'right' : 'left' };
      ws.getColumn(index + 1).width = column.width ?? Math.max(12, column.header.length + 4);
    });
    header.height = 20;
    const addRow = (values: Cell[], bold: boolean) => {
      const row = ws.addRow(values.map((value, index) => excelValue(value, sheet.columns[index]?.kind ?? 'text')));
      sheet.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1);
        const numFmt = EXCEL_FORMATS[column.kind ?? 'text'];
        if (numFmt) cell.numFmt = numFmt;
        if (bold) {
          cell.font = { bold: true };
          cell.border = { top: { style: 'thin', color: { argb: 'FF19343B' } } };
        }
      });
    };
    sheet.rows.forEach((row) => addRow(row, false));
    if (sheet.totals) addRow(sheet.totals, true);
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: sheet.columns.length } };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${fileName}.xlsx`,
  );
}
