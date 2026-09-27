// Fichiers d'équipe dans Cloud Storage (restaurants/{rid}/team/…) : dépôt et ouverture.
import { Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { STORAGE_PATHS, type StoredFile } from '@golink/shared';
import { toast } from '@golink/ui';
import { storage } from '@/lib/firebase';
import { errorMessage } from '@/lib/firestore';

/** Taille maximale acceptée par les règles Storage (15 Mo). */
export const TEAM_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const TEAM_FILE_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'pdf';
  return `${base || 'document'}.${ext}`;
}

/** Dépose un fichier sous restaurants/{rid}/team/{dossier}/ et renvoie sa référence. */
export async function uploadTeamFile(restaurantId: string, folder: string, file: File, uid: string): Promise<StoredFile> {
  const path = `${STORAGE_PATHS.restaurantTeam(restaurantId)}/${folder}/${Date.now()}-${safeName(file.name)}`;
  await uploadBytes(ref(storage, path), file, { contentType: file.type || 'application/pdf' });
  return {
    path,
    url: null,
    contentType: file.type || 'application/pdf',
    size: file.size,
    name: file.name,
    // Horodatage local : ce champ décrit le fichier, pas le document Firestore.
    uploadedAt: Timestamp.now(),
    uploadedBy: uid,
  };
}

/** Ouvre un fichier privé dans un nouvel onglet (lien de téléchargement signé par Firebase). */
export async function openStoredFile(file: Pick<StoredFile, 'path'>): Promise<void> {
  const tab = window.open('', '_blank');
  try {
    const url = await getDownloadURL(ref(storage, file.path));
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (error) {
    tab?.close();
    toast.error(errorMessage(error, 'Impossible d’ouvrir ce fichier.'));
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
}
