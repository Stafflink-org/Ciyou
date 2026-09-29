// Dépôt de fichiers privés (justificatifs) dans Cloud Storage, repris tel quel du
// pattern apps/restaurant/src/features/parametres/kit/storage.ts (uploadPrivateDocument).
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { STORAGE_PATHS } from '@golink/shared';
import { storage } from './firebase';

export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

function extensionOf(mimeType: string | undefined, name: string): string {
  return (mimeType && EXTENSIONS[mimeType]) ?? (name.split('.').pop() || 'bin').toLowerCase().slice(0, 5);
}

export interface PickedFile {
  /** URI locale (fichier `expo-document-picker`) — utilisée seulement si `file` est absent (natif). */
  uri: string;
  name: string;
  mimeType?: string;
  /** Objet `File` déjà disponible sur web (`expo-document-picker`, `DocumentPickerAsset.file`). */
  file?: File;
}

/**
 * Justificatif privé du livreur ; renvoie le chemin à transmettre à uploadDriverDocument.
 * Fonctionne sur web (objet `File` direct) comme en natif (relit l'URI locale en Blob,
 * pattern standard Expo pour Firebase Storage).
 */
export async function uploadPrivateDriverDocument(
  driverId: string,
  type: string,
  picked: PickedFile,
  onProgress?: (ratio: number) => void,
): Promise<string> {
  const blob: Blob = picked.file ?? (await (await fetch(picked.uri)).blob());
  const contentType = picked.mimeType || picked.file?.type || 'application/octet-stream';
  const path = `${STORAGE_PATHS.driverPrivate(driverId)}/documents/${type}-${Date.now()}.${extensionOf(contentType, picked.name)}`;
  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), blob, { contentType });
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0),
      reject,
      () => resolve(),
    );
  });
  return path;
}

/** Lien de téléchargement temporaire d'un justificatif (lecture autorisée par les règles). */
export function privateDriverFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}
