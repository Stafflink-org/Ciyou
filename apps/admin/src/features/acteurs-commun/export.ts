// Exports CSV (séparateur « ; », BOM UTF-8 pour Excel) et Excel des listes
// restaurants et clients. Les montants sont exportés en euros.
export type ExportCell = string | number | null | undefined;

export interface ExportSheet {
  name: string;
  columns: Array<{ header: string; kind?: 'text' | 'number' | 'money' | 'percent' }>;
  rows: ExportCell[][];
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cellValue(value: ExportCell, kind: ExportSheet['columns'][number]['kind']): string | number {
  if (value === null || value === undefined) return '';
  if (kind === 'money' && typeof value === 'number') return Math.round(value) / 100;
  if (kind === 'percent' && typeof value === 'number') return Math.round(value) / 10000;
  return value;
}

export function downloadCsv(sheet: ExportSheet, filename: string) {
  const escape = (v: string | number) => {
    const text = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    sheet.columns.map((c) => escape(c.header)).join(';'),
    ...sheet.rows.map((row) => row.map((v, i) => escape(cellValue(v, sheet.columns[i]?.kind))).join(';')),
  ];
  download(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`);
}

export async function downloadXlsx(sheet: ExportSheet, filename: string) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GoLink';
  const ws = workbook.addWorksheet(sheet.name.slice(0, 31));
  ws.columns = sheet.columns.map((c) => ({ header: c.header, width: Math.max(12, Math.min(40, c.header.length + 6)) }));
  sheet.rows.forEach((row) => ws.addRow(row.map((v, i) => cellValue(v, sheet.columns[i]?.kind))));
  sheet.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.kind === 'money') col.numFmt = '#,##0.00 "€"';
    if (c.kind === 'percent') col.numFmt = '0.0 %';
  });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  download(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${filename}.xlsx`);
}

/** Lecture d'un fichier d'import (CSV ou Excel) en lignes d'objets indexés par en-tête. */
export async function readTabularFile(file: File): Promise<Array<Record<string, string>>> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const ws = workbook.worksheets[0];
    if (!ws) return [];
    const headers: string[] = [];
    const rows: Array<Record<string, string>> = [];
    ws.eachRow((row, index) => {
      const values = (row.values as unknown[]).slice(1).map((v) => {
        if (v === null || v === undefined) return '';
        if (typeof v === 'object' && v && 'text' in v) return String((v as { text: unknown }).text);
        if (typeof v === 'object' && v && 'result' in v) return String((v as { result: unknown }).result);
        return String(v);
      });
      if (index === 1) values.forEach((v) => headers.push(v.trim()));
      else rows.push(Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').trim()])));
    });
    return rows.filter((r) => Object.values(r).some(Boolean));
  }
  const Papa = (await import('papaparse')).default;
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim() });
  return parsed.data.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()])));
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
