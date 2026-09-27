// Génération des visuels du kit de partage (canvas) : établissement, plat, offre.
// Les couleurs sont celles de la charte GoLink (le visuel sort de l'application).
import QRCode from 'qrcode';

export type VisualFormat = 'square' | 'story';
export type VisualSubject =
  | { kind: 'restaurant'; title: string; subtitle: string; rating: string | null; imageUrl: string | null }
  | { kind: 'product'; title: string; subtitle: string; price: string; imageUrl: string | null }
  | { kind: 'offer'; title: string; subtitle: string; discount: string; code: string | null; imageUrl: string | null };

export interface VisualInput {
  format: VisualFormat;
  subject: VisualSubject;
  restaurantName: string;
  accent: string;
  url: string;
}

const INK = '#19343b';
const INK_DEEP = '#0f2227';
const CREAM = '#f8f4ec';
const ORANGE = '#e8784b';
const MUTED = '#b8cbc5';

export const VISUAL_SIZES: Record<VisualFormat, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: 'Publication carrée (1080 × 1080)' },
  story: { width: 1080, height: 1920, label: 'Story (1080 × 1920)' },
};

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Image recadrée pour couvrir la zone (équivalent object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.width, h / img.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1] ?? '';
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

async function qrImage(url: string, size: number): Promise<HTMLImageElement | null> {
  const dataUrl = await QRCode.toDataURL(url, { width: size, margin: 1, color: { dark: INK, light: '#ffffff' }, errorCorrectionLevel: 'M' });
  return loadImage(dataUrl);
}

/** Dessine le visuel et renvoie le canvas (PNG téléchargeable). */
export async function renderVisual(input: VisualInput): Promise<HTMLCanvasElement> {
  const { width, height } = VISUAL_SIZES[input.format];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  await document.fonts?.ready;
  const story = input.format === 'story';
  const pad = 72;

  // Fond pétrole et photo en haut.
  ctx.fillStyle = INK_DEEP;
  ctx.fillRect(0, 0, width, height);
  const photoH = story ? 1080 : 600;
  const img = input.subject.imageUrl ? await loadImage(input.subject.imageUrl) : null;
  if (img) {
    drawCover(ctx, img, 0, 0, width, photoH);
  } else {
    const g = ctx.createLinearGradient(0, 0, width, photoH);
    g.addColorStop(0, input.accent || ORANGE);
    g.addColorStop(1, INK);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, photoH);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 70;
    ctx.beginPath();
    ctx.arc(width - 120, 60, 260, 0, Math.PI * 2);
    ctx.stroke();
  }
  const fade = ctx.createLinearGradient(0, photoH - 320, 0, photoH);
  fade.addColorStop(0, 'rgba(15,34,39,0)');
  fade.addColorStop(1, INK_DEEP);
  ctx.fillStyle = fade;
  ctx.fillRect(0, photoH - 320, width, 320);

  // Pastille du restaurant.
  ctx.font = '600 30px "DM Sans", sans-serif';
  const tag = input.restaurantName.toUpperCase();
  const tagW = Math.min(ctx.measureText(tag).width + 56, width - pad * 2);
  roundRect(ctx, pad, pad, tagW, 64, 32);
  ctx.fillStyle = 'rgba(15,34,39,0.72)';
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, pad + 28, pad + 33, tagW - 56);

  // Bloc de texte.
  let y = photoH + (story ? 40 : 10);
  ctx.textBaseline = 'alphabetic';
  const subject = input.subject;
  const headline = subject.kind === 'offer' ? subject.discount : subject.kind === 'product' ? subject.price : (subject.rating ?? 'Sur GoLink');
  ctx.fillStyle = ORANGE;
  ctx.font = `600 ${story ? 120 : 96}px "Space Grotesk", sans-serif`;
  ctx.fillText(headline, pad, y + (story ? 110 : 90), width - pad * 2);
  y += story ? 150 : 120;

  ctx.fillStyle = CREAM;
  ctx.font = `600 ${story ? 76 : 58}px "Space Grotesk", sans-serif`;
  const titleLines = wrap(ctx, subject.title, width - pad * 2 - (story ? 0 : 260), 2);
  titleLines.forEach((line, i) => ctx.fillText(line, pad, y + (story ? 80 : 62) * (i + 1)));
  y += (story ? 80 : 62) * titleLines.length + 18;

  ctx.fillStyle = MUTED;
  ctx.font = `400 ${story ? 40 : 32}px "DM Sans", sans-serif`;
  const subLines = wrap(ctx, subject.subtitle, width - pad * 2 - (story ? 0 : 260), story ? 3 : 2);
  subLines.forEach((line, i) => ctx.fillText(line, pad, y + (story ? 54 : 44) * (i + 1)));

  // Code promo.
  if (subject.kind === 'offer' && subject.code) {
    const codeY = story ? height - 520 : height - 150;
    ctx.font = '600 40px "DM Mono", monospace';
    const label = `CODE  ${subject.code}`;
    const w = ctx.measureText(label).width + 64;
    roundRect(ctx, pad, codeY - 52, w, 78, 18);
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = ORANGE;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CREAM;
    ctx.fillText(label, pad + 32, codeY);
  }

  // QR code et appel à l'action.
  const qrSize = story ? 300 : 210;
  const qr = await qrImage(input.url, qrSize * 2);
  const qrX = width - pad - qrSize;
  const qrY = story ? height - pad - qrSize - 120 : height - pad - qrSize;
  roundRect(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 28);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (qr) ctx.drawImage(qr, qrX, qrY, qrSize, qrSize);

  ctx.fillStyle = CREAM;
  ctx.font = `600 ${story ? 44 : 34}px "DM Sans", sans-serif`;
  const ctaY = story ? height - pad - 40 : height - pad - 8;
  ctx.fillText('Commandez sur GoLink', pad, ctaY);
  if (story) {
    ctx.fillStyle = MUTED;
    ctx.font = '400 34px "DM Sans", sans-serif';
    ctx.fillText('Scannez le code ou touchez le lien', pad, ctaY - 64);
  }
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, fileName: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
}

export function downloadText(content: string, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Affichette A5 à imprimer (comptoir, vitrine) : nom, QR code, lien. */
export async function downloadPoster(input: { restaurantName: string; url: string; tagline: string; fileName: string }) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a5' });
  const w = pdf.internal.pageSize.getWidth();
  const h = pdf.internal.pageSize.getHeight();
  pdf.setFillColor(15, 34, 39);
  pdf.rect(0, 0, w, h, 'F');
  pdf.setTextColor(232, 120, 75);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(11);
  pdf.text('COMMANDEZ EN LIGNE', w / 2, 24, { align: 'center' });
  pdf.setTextColor(248, 244, 236);
  pdf.setFontSize(26);
  pdf.text(pdf.splitTextToSize(input.restaurantName, w - 30) as string[], w / 2, 38, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  pdf.setTextColor(184, 203, 197);
  pdf.text(pdf.splitTextToSize(input.tagline, w - 36) as string[], w / 2, 56, { align: 'center' });
  const qr = await QRCode.toDataURL(input.url, { width: 800, margin: 1, color: { dark: INK, light: '#ffffff' }, errorCorrectionLevel: 'M' });
  const size = 78;
  pdf.setFillColor(255, 255, 255);
  pdf.roundedRect((w - size - 10) / 2, 72, size + 10, size + 10, 4, 4, 'F');
  pdf.addImage(qr, 'PNG', (w - size) / 2, 77, size, size);
  pdf.setTextColor(248, 244, 236);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Scannez pour commander', w / 2, 175, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(184, 203, 197);
  pdf.text(input.url, w / 2, 182, { align: 'center' });
  pdf.setTextColor(232, 120, 75);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text('GoLink', w / 2, h - 10, { align: 'center' });
  pdf.save(input.fileName);
}
