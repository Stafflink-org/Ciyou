// Synchronisation `drivers/{uid}.availability` → `driverLocations/{uid}.availability`.
// L'app livreur écrit `availability` directement sur `drivers/{uid}` (geste courant, pas de
// Cloud Function — voir firebase/rules/drivers.rules), mais la règle `driverLocations` interdit
// au livreur d'écrire ce même champ (seules position/geohash/heading/speedKmh/accuracyMeters le
// sont) : sans ce déclencheur, `driverLocations.availability` ne bougeait plus jamais après la
// création du document, alors que le dispatch (functions/src/orders/dispatch.ts,
// dispatch-advanced.ts) interroge précisément CE champ pour trouver les livreurs en ligne — un
// livreur qui repasse « En ligne » après avoir été hors ligne restait donc invisible du dispatch.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { COLLECTIONS, type Driver } from '@golink/shared';
import { db } from '../lib/admin';

export const onDriverAvailabilityChanged = onDocumentWritten(
  { document: `${COLLECTIONS.drivers}/{driverId}`, maxInstances: 3, cpu: 'gcf_gen1' },
  async (event) => {
    const before = event.data?.before.data() as Driver | undefined;
    const after = event.data?.after.data() as Driver | undefined;
    if (!after || before?.availability === after.availability) return;
    // `on_delivery` est piloté par le dispatch lui-même (assignInTransaction /
    // releaseDriverInTransaction, dans la même transaction que l'attribution/libération) : ne pas
    // l'écraser ici pour éviter de concurrencer ces transactions.
    if (after.availability === 'on_delivery') return;
    const ref = db.collection(COLLECTIONS.driverLocations).doc(event.params.driverId);
    const snap = await ref.get();
    if (!snap.exists || snap.get('availability') === after.availability) return;
    await ref.update({ availability: after.availability });
  },
);
