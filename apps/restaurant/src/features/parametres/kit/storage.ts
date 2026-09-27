// Dépôt de fichiers dans Cloud Storage : visuels publics de l'établissement et
// justificatifs privés (chemins de STORAGE_PATHS, contrôlés par les règles Storage).
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { STORAGE_PATHS, type ImageRef } from '@golink/shared';
import { storage } from '@/lib/firebase';

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

function extensionOf(file: File): string {
  return EXTENSIONS[file.type] ?? (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 5);
}

/** Dimensions d'une image locale (0 × 0 si illisible, ex. HEIC). */
export function readImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: 0, height: 0 });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

function upload(path: string, file: File, onProgress?: (ratio: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type || 'application/octet-stream' });
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      () => resolve(),
    );
  });
}

/** Visuel public (logo, couverture, galerie). */
export async function uploadPublicImage(
  restaurantId: string,
  kind: 'logo' | 'cover' | 'gallery',
  file: File,
  alt: string,
  onProgress?: (ratio: number) => void,
): Promise<ImageRef> {
  const size = await readImageSize(file);
  const path = `${STORAGE_PATHS.restaurantPublic(restaurantId)}/branding/${kind}-${Date.now()}.${extensionOf(file)}`;
  await upload(path, file, onProgress);
  const url = await getDownloadURL(ref(storage, path));
  return { path, url, thumbUrl: url, width: size.width || null, height: size.height || null, alt };
}

/** Supprime un visuel déposé par le back-office (les images de démonstration externes sont ignorées). */
export async function deletePublicImage(restaurantId: string, image: ImageRef | null | undefined): Promise<void> {
  if (!image?.path || !image.path.startsWith(`${STORAGE_PATHS.restaurantPublic(restaurantId)}/branding/`)) return;
  try {
    await deleteObject(ref(storage, image.path));
  } catch {
    // Fichier déjà absent : rien à faire.
  }
}

/** Justificatif privé ; renvoie le chemin à transmettre à uploadDocument. */
export async function uploadPrivateDocument(
  restaurantId: string,
  type: string,
  file: File,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const path = `${STORAGE_PATHS.restaurantPrivate(restaurantId)}/documents/${type}-${Date.now()}.${extensionOf(file)}`;
  await upload(path, file, onProgress);
  return path;
}

/** Lien de téléchargement temporaire d'un justificatif (lecture autorisée par les règles). */
export function privateFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}
