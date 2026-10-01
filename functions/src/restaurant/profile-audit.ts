// Historique de la fiche restaurant (§5, « Notes internes et historique ») : une modification
// faite par l'équipe (adminUpdateRestaurant, Cloud Function) écrit déjà une entrée d'audit.
// Une modification que le restaurant fait LUI-MÊME sur sa propre fiche (description, téléphone,
// e-mail, logo, couverture, photos, cuisines, tags, gamme de prix, délais, livraison propre)
// passe directement par le SDK client (autorisé par les règles Firestore,
// `can(rid,'settings.manage') && onlyChanges(restaurantProfileFields())`) : aucune trace n'en
// restait jusqu'ici dans `auditLogs`, incohérent avec le reste du module où toute écriture
// équivalente est tracée.
import { COLLECTIONS, SUBCOLLECTIONS, type Restaurant, type RestaurantMember } from '@golink/shared';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { db } from '../lib/admin';
import { writeAudit } from '../lib/audit';
import { CONFIG_TRIGGER_OPTIONS } from './config-context';

/** Champs d'identité de la fiche modifiables directement par le restaurant (hors isOpen/busyExtraMinutes : bascules opérationnelles fréquentes, hors périmètre de cet historique). */
const AUDITED_PROFILE_FIELDS = [
  'description', 'phone', 'email', 'logo', 'cover', 'photos', 'accent', 'mark',
  'cuisineIds', 'tags', 'priceLevel', 'prepMinutes', 'etaMinutes', 'ownDeliveryFeeCents', 'ownDeliveryRadiusMeters',
] as const;

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const onRestaurantProfileWritten = onDocumentWritten({ document: `${COLLECTIONS.restaurants}/{rid}`, ...CONFIG_TRIGGER_OPTIONS }, async (event) => {
  const before = event.data?.before.data() as Restaurant | undefined;
  const after = event.data?.after.data() as Restaurant | undefined;
  if (!before || !after) return; // création ou suppression : hors périmètre (déjà des Cloud Functions dédiées).

  const changed: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const field of AUDITED_PROFILE_FIELDS) {
    const b = (before as unknown as Record<string, unknown>)[field];
    const a = (after as unknown as Record<string, unknown>)[field];
    if (stable(b) !== stable(a)) {
      changed[field] = a ?? null;
      previous[field] = b ?? null;
    }
  }
  if (Object.keys(changed).length === 0) return;

  const updatedBy = after.updatedBy;
  if (!updatedBy || updatedBy === 'system') return; // resynchronisation interne (onRestaurantSettingsWrite) : pas une saisie du restaurant.

  // Modification par l'équipe interne (adminUpdateRestaurant) : déjà auditée par la Cloud
  // Function elle-même (action `restaurant.profile_updated`, avec motif) — ne pas dupliquer.
  const adminSnap = await db.collection(COLLECTIONS.admins).doc(updatedBy).get();
  if (adminSnap.exists && adminSnap.get('active') === true) return;

  const { rid } = event.params;
  const memberSnap = await db.collection(COLLECTIONS.restaurants).doc(rid).collection(SUBCOLLECTIONS.restaurants.members).doc(updatedBy).get();
  const member = memberSnap.exists ? (memberSnap.data() as RestaurantMember) : null;

  await writeAudit({
    actor: { uid: updatedBy, type: 'restaurant', role: member?.role ?? null, name: member?.displayName ?? updatedBy },
    action: 'restaurant.profile_self_updated',
    target: { type: 'restaurant', id: rid, label: after.name },
    before: previous,
    after: changed,
    countryId: after.countryId,
    cityId: after.cityId,
  });
});
