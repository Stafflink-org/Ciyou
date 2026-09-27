// Exports tableur (CSV compatible Excel : séparateur « ; », BOM UTF-8).
import Papa from 'papaparse';

export function downloadCsv(fileName: string, rows: Array<Record<string, string | number | null | undefined>>): void {
  const csv = Papa.unparse(rows, { delimiter: ';' });
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Montant en euros pour un tableur (virgule décimale, sans symbole). */
export function csvEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function csvNumber(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}
