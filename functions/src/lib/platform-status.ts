// Mode maintenance et version minimale (§30) : source unique (settings/maintenance,
// appVersions/{app}) lue par le serveur ET consommable directement par les applications
// (documents publics en lecture, cf. docs/CONTRATS_APPS_MOBILES.md). Sans ce module, le
// bouton « maintenance » et la mise à jour forcée n'ont aucun effet réel.
import { COLLECTIONS, type AppKey, type AppVersionPolicy, type MaintenanceSettings } from '@golink/shared';
import { db } from './admin';
import { fail } from './errors';

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Lève une erreur claire si l'application est en maintenance (sauf comptes de test). */
export async function assertNotInMaintenance(app: AppKey, isTest = false): Promise<void> {
  if (isTest) return;
  const snap = await db.collection(COLLECTIONS.settings).doc('maintenance').get();
  const state = (snap.data() as MaintenanceSettings | undefined)?.apps?.[app];
  if (!state?.enabled) return;
  if (state.until && state.until.toMillis() <= Date.now()) return;
  const message = state.message?.fr ?? 'GoLink est momentanément en maintenance. Réessayez dans quelques minutes.';
  throw fail.unavailable(message);
}

/** Lève une erreur « mise à jour requise » si la version appelante est sous le minimum exigé. */
export async function assertMinimumVersion(app: AppKey, version: string | null | undefined): Promise<void> {
  if (!version) return;
  const snap = await db.collection(COLLECTIONS.appVersions).doc(app).get();
  const policy = snap.data() as AppVersionPolicy | undefined;
  if (!policy || !policy.forceUpdate) return;
  if (compareVersions(version, policy.minimumVersion) >= 0) return;
  throw fail.precondition(policy.message?.fr ?? 'Une mise à jour de l’application est nécessaire pour continuer.');
}
