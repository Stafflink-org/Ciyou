// Photos de la carte : lecture, recadrage 4:3, compression JPEG (grande taille et
// vignette) puis dépôt dans Cloud Storage (restaurants/{rid}/public/menu/…).
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { STORAGE_PATHS, type ImageRef } from '@golink/shared';
import { storage } from '@/lib/firebase';
import { callFunction } from '@/lib/firestore';

const uploadMenuPhoto = callFunction<{ restaurantId: string; folder: string; full: string; thumb: string }, { path: string; url: string; thumbUrl: string }>(
  'uploadMenuPhoto',
);

/** Envoi direct déjà refusé pendant cette session : on passe directement par le serveur. */
let directDenied = false;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Lecture impossible. Réessayez avec une autre image.'));
    reader.readAsDataURL(blob);
  });
}

export const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp';
/** Poids maximum du fichier choisi, avant compression. */
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
export const CROP_ASPECT = 4 / 3;
const FULL = { width: 1200, height: 900 };
const THUMB = { width: 480, height: 360 };

/** Zone recadrée, en pixels de l'image d'origine. */
export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.split(',').includes(file.type)) return 'Choisissez une image JPG, PNG ou WebP.';
  if (file.size > MAX_SOURCE_BYTES) return 'L’image ne doit pas dépasser 12 Mo.';
  return null;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Lecture impossible. Réessayez avec une autre image.'));
    image.src = src;
  });
}

function render(image: HTMLImageElement, area: CropArea, size: { width: number; height: number }, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  // Pas d'agrandissement au-delà de la résolution d'origine.
  const scale = Math.min(1, area.width / size.width);
  canvas.width = Math.round(size.width * Math.max(scale, 0.5));
  canvas.height = Math.round(size.height * Math.max(scale, 0.5));
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Impossible de traiter cette image.'));
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Impossible de traiter cette image.'))), 'image/jpeg', quality),
  );
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Recadre, compresse et dépose une photo ; renvoie la référence à enregistrer sur le document. */
export async function uploadMenuImage(
  restaurantId: string,
  folder: string,
  image: HTMLImageElement,
  area: CropArea,
  alt: string,
): Promise<ImageRef> {
  const [full, thumb] = await Promise.all([render(image, area, FULL, 0.84), render(image, area, THUMB, 0.8)]);
  const size = { width: FULL.width, height: FULL.height, alt: alt || null };
  try {
    if (directDenied) throw Object.assign(new Error('refus'), { code: 'storage/unauthorized' });
    return { ...(await uploadDirect(restaurantId, folder, full, thumb)), ...size };
  } catch (caught) {
    // Envoi direct refusé par Storage : dépôt par le serveur, qui vérifie les mêmes droits.
    if ((caught as { code?: string }).code !== 'storage/unauthorized') throw caught;
    directDenied = true;
    const [fullData, thumbData] = await Promise.all([toBase64(full), toBase64(thumb)]);
    return { ...(await uploadMenuPhoto({ restaurantId, folder, full: fullData, thumb: thumbData })), ...size };
  }
}

async function uploadDirect(restaurantId: string, folder: string, full: Blob, thumb: Blob): Promise<{ path: string; url: string; thumbUrl: string }> {
  const id = randomId();
  const base = `${STORAGE_PATHS.restaurantPublic(restaurantId)}/menu/${folder}`;
  const fullRef = ref(storage, `${base}/${id}.jpg`);
  const thumbRef = ref(storage, `${base}/${id}_thumb.jpg`);
  const metadata = { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' };
  await Promise.all([uploadBytes(fullRef, full, metadata), uploadBytes(thumbRef, thumb, metadata)]);
  const [url, thumbUrl] = await Promise.all([getDownloadURL(fullRef), getDownloadURL(thumbRef)]);
  return { path: fullRef.fullPath, url, thumbUrl };
}
