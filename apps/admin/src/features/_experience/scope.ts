// Filtre pays / ville appliqué aux requêtes des rubriques Affichage, Avis et Support.
import { useMemo } from 'react';
import { where, type QueryConstraint } from 'firebase/firestore';
import { useAdminAccess } from '@/auth/AdminAccess';
import { useGeoScope } from '@/layout/GeoScope';

export interface ScopeFilter {
  /** Contraintes Firestore à ajouter à la requête (vide = tous les marchés). */
  constraints: QueryConstraint[];
  /** Clé stable pour les dépendances. */
  key: string;
  /** Test côté client d'un document portant cityId / countryId. */
  covers: (doc: { cityId?: string | null; countryId?: string | null }) => boolean;
  /** Villes visibles (identifiant → nom). */
  cityNames: Map<string, string>;
  label: string;
}

export function useScopeFilter(): ScopeFilter {
  const geo = useGeoScope();
  return useMemo(() => {
    const cityNames = new Map(geo.cities.map((c) => [c.id, c.name]));
    if (geo.cityIds) {
      const ids = geo.cityIds.slice(0, 30);
      return {
        constraints: [ids.length === 1 ? where('cityId', '==', ids[0]) : where('cityId', 'in', ids.length ? ids : ['__aucune__'])],
        key: `city:${ids.join(',')}`,
        covers: (doc) => Boolean(doc.cityId && ids.includes(doc.cityId)),
        cityNames,
        label: geo.label,
      };
    }
    if (geo.countryId) {
      const countryId = geo.countryId;
      return {
        constraints: [where('countryId', '==', countryId)],
        key: `country:${countryId}`,
        covers: (doc) => doc.countryId === countryId,
        cityNames,
        label: geo.label,
      };
    }
    return { constraints: [], key: 'all', covers: () => true, cityNames, label: geo.label };
  }, [geo.cityIds, geo.countryId, geo.cities, geo.label]);
}

/**
 * Périmètre de l'administrateur seul (sans le filtre de la barre supérieure) :
 * utilisable hors de <GeoScopeProvider>, notamment par les pastilles de navigation.
 */
export function useAdminPerimeter(): { constraints: QueryConstraint[]; key: string } {
  const { admin } = useAdminAccess();
  return useMemo(() => {
    if (admin.cityIds.length > 0) {
      const ids = admin.cityIds.slice(0, 30);
      return { constraints: [ids.length === 1 ? where('cityId', '==', ids[0]) : where('cityId', 'in', ids)], key: `city:${ids.join(',')}` };
    }
    if (admin.countryIds.length > 0) {
      const ids = admin.countryIds.slice(0, 30);
      return { constraints: [ids.length === 1 ? where('countryId', '==', ids[0]) : where('countryId', 'in', ids)], key: `country:${ids.join(',')}` };
    }
    return { constraints: [], key: 'all' };
  }, [admin.cityIds, admin.countryIds]);
}
