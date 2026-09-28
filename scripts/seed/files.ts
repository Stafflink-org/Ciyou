// Fichiers de démonstration déposés dans Cloud Storage : logos (SVG) et
// justificatifs (PDF d'une page, clairement marqués « démonstration »).
import { createHash } from 'node:crypto';
import type { Bucket } from '@google-cloud/storage';
import type { StoredFile } from '@golink/shared';
import type { Timestamp } from './lib';

/** Envois simultanés maximum et tentatives par fichier (réseau instable). */
const UPLOAD_CONCURRENCY = 6;
const UPLOAD_ATTEMPTS = 5;

type Upload = { path: string; body: Buffer; contentType: string; token: string };

export class SeedFiles {
  private readonly queue: Upload[] = [];
  count = 0;

  constructor(private readonly bucket: Bucket) {}

  /** Dépose le fichier (jeton de téléchargement stable) et renvoie sa référence. */
  put(path: string, body: Buffer, contentType: string): { path: string; url: string; size: number } {
    const token = stableUuid(path);
    this.count += 1;
    this.queue.push({ path, body, contentType, token });
    const url = `https://firebasestorage.googleapis.com/v0/b/${this.bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
    return { path, url, size: body.length };
  }

  storedPdf(path: string, title: string, lines: string[], at: Timestamp, by: string): StoredFile {
    const file = this.put(path, simplePdf(title, lines), 'application/pdf');
    return { path: file.path, url: null, contentType: 'application/pdf', size: file.size, name: path.split('/').pop() ?? null, uploadedAt: at, uploadedBy: by };
  }

  /** Dépose les fichiers en file d'attente, en parallèle limité, avec reprise sur erreur réseau. */
  async done(): Promise<void> {
    const queue = this.queue.splice(0);
    const worker = async (): Promise<void> => {
      for (let item = queue.shift(); item; item = queue.shift()) await this.upload(item);
    };
    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
  }

  private async upload({ path, body, contentType, token }: Upload): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.bucket.file(path).save(body, {
          resumable: false,
          contentType,
          metadata: { cacheControl: 'public, max-age=86400', metadata: { firebaseStorageDownloadTokens: token, seed: 'true' } },
        });
        return;
      } catch (error) {
        if (attempt >= UPLOAD_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
}

function stableUuid(seed: string): string {
  const h = createHash('sha256').update(`golink-seed:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Logo monogramme : pastille arrondie à la couleur de marque. */
export function monogramSvg(mark: string, accent: string): Buffer {
  const size = mark.length > 2 ? 150 : 190;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" rx="120" fill="${accent}"/>
<rect x="18" y="18" width="476" height="476" rx="104" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="4"/>
<text x="256" y="256" dy=".35em" text-anchor="middle" font-family="'Space Grotesk','DM Sans',Helvetica,Arial,sans-serif" font-weight="600" font-size="${size}" letter-spacing="-6" fill="#ffffff">${mark}</text>
</svg>`,
  );
}

function pdfText(value: string): string {
  const latin = value.replace(/[’‘]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—]/g, '-');
  return Buffer.from(latin.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'), 'latin1').toString('latin1');
}

/** PDF A4 d'une page (Helvetica, encodage WinAnsi). */
export function simplePdf(title: string, lines: string[]): Buffer {
  const body = [
    'BT /F2 18 Tf 56 780 Td (' + pdfText(title) + ') Tj ET',
    'BT /F1 10 Tf 56 758 Td (' + pdfText('Document de démonstration Ciyou Eats - sans valeur légale') + ') Tj ET',
    ...lines.map((line, i) => `BT /F1 11 Tf 56 ${720 - i * 18} Td (${pdfText(line)}) Tj ET`),
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
