// Contrôles automatiques d'une photo de réclamation, sans dépendance externe :
// empreinte SHA-256 (doublons), format et dimensions (JPEG, PNG, WebP), date de prise de vue
// lue dans les métadonnées EXIF d'un JPEG (cohérence avec la livraison).
import { createHash } from 'node:crypto';

export interface PhotoAnalysis {
  sha256: string;
  /** Format reconnu et lisible. */
  readable: boolean;
  width: number | null;
  height: number | null;
  /** Date de prise de vue (EXIF), en millisecondes, si présente. */
  takenAtMs: number | null;
}

/** Instant UTC d'une date/heure « murale » exprimée dans un fuseau (les dates EXIF n'ont pas de fuseau). */
export function zonedToUtcMs(year: number, month: number, day: number, hour: number, minute: number, second: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return guess - (asUtc - guess);
}

function readJpeg(buf: Buffer, timeZone: string): { width: number | null; height: number | null; takenAtMs: number | null } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let width: number | null = null;
  let height: number | null = null;
  let takenAtMs: number | null = null;
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1] as number;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    const segment = offset + 4;
    if (marker === 0xe1 && buf.toString('latin1', segment, segment + 6) === 'Exif\0\0') {
      takenAtMs = readExifDate(buf.subarray(segment + 6, offset + 2 + length), timeZone) ?? takenAtMs;
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && segment + 5 < buf.length) {
      height = buf.readUInt16BE(segment + 1);
      width = buf.readUInt16BE(segment + 3);
    }
    offset += 2 + length;
  }
  return { width, height, takenAtMs };
}

/** Lit DateTimeOriginal (0x9003) ou DateTime (0x0132) dans un bloc TIFF/EXIF. */
function readExifDate(tiff: Buffer, timeZone: string): number | null {
  if (tiff.length < 8) return null;
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o: number) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const readDate = (entry: number): string | null => {
    const count = u32(entry + 4);
    const valueOffset = count > 4 ? u32(entry + 8) : entry + 8;
    if (valueOffset + count > tiff.length || count < 19) return null;
    return tiff.toString('latin1', valueOffset, valueOffset + 19);
  };
  const scan = (ifdOffset: number): { original: string | null; modified: string | null; exifPointer: number | null } => {
    const out = { original: null as string | null, modified: null as string | null, exifPointer: null as number | null };
    if (ifdOffset + 2 > tiff.length) return out;
    const entries = u16(ifdOffset);
    for (let i = 0; i < entries; i += 1) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      const tag = u16(entry);
      if (tag === 0x8769) out.exifPointer = u32(entry + 8);
      if (tag === 0x9003) out.original = readDate(entry);
      if (tag === 0x0132) out.modified = readDate(entry);
    }
    return out;
  };
  const first = scan(u32(4));
  const exif = first.exifPointer ? scan(first.exifPointer) : null;
  const raw = exif?.original ?? first.original ?? first.modified;
  const match = raw ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number];
  if (y < 2000) return null;
  return zonedToUtcMs(y, mo, d, h, mi, s, timeZone);
}

function readPng(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function readWebp(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/** HEIC/HEIF : lisible mais sans dimensions ni date exploitables sans bibliothèque d'image. */
function isHeif(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp' && /heic|heix|mif1|msf1|hevc/.test(buf.toString('latin1', 8, 12));
}

export function analyzePhoto(buf: Buffer, timeZone: string): PhotoAnalysis {
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const jpeg = readJpeg(buf, timeZone);
  if (jpeg) return { sha256, readable: true, width: jpeg.width, height: jpeg.height, takenAtMs: jpeg.takenAtMs };
  const png = readPng(buf);
  if (png) return { sha256, readable: true, width: png.width, height: png.height, takenAtMs: null };
  const webp = readWebp(buf);
  if (webp) return { sha256, readable: true, width: webp.width, height: webp.height, takenAtMs: null };
  if (isHeif(buf)) return { sha256, readable: true, width: null, height: null, takenAtMs: null };
  return { sha256, readable: false, width: null, height: null, takenAtMs: null };
}
