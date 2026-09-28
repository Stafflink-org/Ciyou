// Dépôt des photos de la carte par le serveur : utilisé quand l'envoi direct vers
// Cloud Storage est refusé (droits relus dans Firestore indisponibles côté Storage).
// Les images arrivent déjà recadrées et compressées par le navigateur (JPEG).
import { randomUUID } from 'node:crypto';
import { STORAGE_PATHS } from '@golink/shared';
import { storage } from '../lib/admin';
import { callable } from '../lib/callable';
import { fail } from '../lib/errors';
import { z, zId } from '../lib/validation';
import { MENU_RUNTIME, requireMenuAccess } from './common';

/** Poids maximum d'une image compressée (base64 décodé). */
const MAX_BYTES = 2 * 1024 * 1024;

const schema = z.object({
  restaurantId: zId,
  /** Dossier sous `menu/` : `products/<id>` ou `sections/<id>`. */
  folder: z.string().regex(/^(products|sections)\/[A-Za-z0-9_-]{1,64}$/, 'Dossier de photo invalide.'),
  full: z.string().min(100).max(3_000_000),
  thumb: z.string().min(100).max(1_000_000),
});

export interface UploadMenuPhotoResult {
  path: string;
  url: string;
  thumbUrl: string;
}

function decodeJpeg(value: string): Buffer {
  const buffer = Buffer.from(value, 'base64');
  // Signature JPEG (FF D8 FF) : seules des photos compressées par l'application sont acceptées.
  if (buffer.length > MAX_BYTES || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) throw fail.invalid('Image invalide : envoyez une photo JPEG de 2 Mo au plus.');
  return buffer;
}

export const uploadMenuPhoto = callable(schema, async (data, request): Promise<UploadMenuPhotoResult> => {
  await requireMenuAccess(request, data.restaurantId, 'menu.edit');
  const full = decodeJpeg(data.full);
  const thumb = decodeJpeg(data.thumb);
  const bucket = storage.bucket();
  const id = randomUUID().replace(/-/g, '').slice(0, 20);
  const base = `${STORAGE_PATHS.restaurantPublic(data.restaurantId)}/menu/${data.folder}`;

  async function save(path: string, content: Buffer): Promise<string> {
    const token = randomUUID();
    await bucket.file(path).save(content, {
      resumable: false,
      contentType: 'image/jpeg',
      metadata: { cacheControl: 'public, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token } },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  }

  const fullPath = `${base}/${id}.jpg`;
  const [url, thumbUrl] = await Promise.all([save(fullPath, full), save(`${base}/${id}_thumb.jpg`, thumb)]);
  return { path: fullPath, url, thumbUrl };
}, { ...MENU_RUNTIME, memory: '512MiB' });
