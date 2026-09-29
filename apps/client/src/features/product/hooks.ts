// Données de la fiche produit (§6 client.md) : le produit et ses groupes
// d'options / options (`optionGroupIds` → `optionGroups` → `options`).
// Hypothèse documentée : au plus 30 groupes / 30 options par produit (largement
// suffisant pour une carte réelle), chargés par lots de 10 (`in`, limite Firestore).
import { collection, documentId, query, where } from 'firebase/firestore';
import { SUBCOLLECTIONS, type MenuOption, type OptionGroup } from '@golink/shared';
import { db } from '../../lib/firebase';
import { useCollection, type CollectionState } from '../../lib/firestore';

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Jusqu'à 30 documents d'une sous-collection par leurs identifiants (3 lots de 10 au plus). */
function useDocsByIds<T>(collectionPath: string | null, ids: string[]): CollectionState<T> {
  const chunks = collectionPath ? chunk(ids.slice(0, 30), 10) : [];
  const a = useCollection<T>(chunks[0] && collectionPath ? query(collection(db, collectionPath), where(documentId(), 'in', chunks[0])) : null);
  const b = useCollection<T>(chunks[1] && collectionPath ? query(collection(db, collectionPath), where(documentId(), 'in', chunks[1])) : null);
  const c = useCollection<T>(chunks[2] && collectionPath ? query(collection(db, collectionPath), where(documentId(), 'in', chunks[2])) : null);
  return { data: [...a.data, ...b.data, ...c.data], loading: a.loading || b.loading || c.loading, error: a.error ?? b.error ?? c.error };
}

export function useOptionGroups(restaurantId: string | null, groupIds: string[]) {
  return useDocsByIds<OptionGroup>(restaurantId ? `restaurants/${restaurantId}/${SUBCOLLECTIONS.restaurants.optionGroups}` : null, groupIds);
}

export function useMenuOptions(restaurantId: string | null, optionIds: string[]) {
  return useDocsByIds<MenuOption>(restaurantId ? `restaurants/${restaurantId}/${SUBCOLLECTIONS.restaurants.options}` : null, optionIds);
}
