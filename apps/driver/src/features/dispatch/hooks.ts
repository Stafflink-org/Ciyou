// Dispatch réel de l'app livreur : disponibilité, position, offres de course,
// réponse aux offres, étapes de la course active. Aucune donnée simulée — tout
// est lu/écrit sur golink-9f16d (docs/CONTRATS_APPS_MOBILES.md §24,
// docs/SCHEMA_FIRESTORE.md §6, firebase/rules/drivers.rules).
import { useCallback, useEffect, useRef, useState } from 'react';
import { GeoPoint, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { encodeGeohash, type Driver, type DriverLocation, type DispatchOffer, type Order, type WithId } from '@golink/shared';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';

export function useDriver(uid: string | null) {
  return useDoc<Driver>(uid ? docAt(`drivers/${uid}`) : null);
}

export function useDriverLocation(uid: string | null) {
  return useDoc<DriverLocation>(uid ? docAt(`driverLocations/${uid}`) : null);
}

/**
 * Offres en attente de réponse pour ce livreur, la plus ancienne en premier.
 * Pas de `orderBy` dans la requête : l'index composite déjà déployé
 * (`driverId`, `status`, `offeredAt desc`) trierait en sens inverse ; le tri
 * se fait donc côté app (un livreur n'a de toute façon jamais plus d'une ou
 * deux offres ouvertes en même temps).
 */
export function useIncomingOffers(uid: string | null): { offer: WithId<DispatchOffer> | null; loading: boolean } {
  const target = uid ? query(collectionAt('dispatchOffers'), where('driverId', '==', uid), where('status', '==', 'offered')) : null;
  const { data, loading } = useCollection<DispatchOffer>(target);
  const sorted = [...data].sort((a, b) => a.offeredAt.toMillis() - b.offeredAt.toMillis());
  return { offer: sorted[0] ?? null, loading };
}

export function useOrder(orderId: string | null) {
  return useDoc<Order>(orderId ? docAt(`orders/${orderId}`) : null);
}

export type Availability = Driver['availability'];

/** Bascule de disponibilité réelle : écrit directement drivers/{uid} (et driverLocations/{uid}
 * si le document existe déjà), conformément à firebase/rules/drivers.rules (seul champ
 * autorisé en écriture directe par le livreur). */
export function useAvailabilityToggle(uid: string | null) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAvailability = useCallback(
    async (next: Exclude<Availability, 'on_delivery'>) => {
      if (!uid) return;
      setError(null);
      setPending(true);
      try {
        await updateDoc(docAt(`drivers/${uid}`), {
          availability: next,
          lastSeenAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible de changer votre disponibilité.');
      } finally {
        setPending(false);
      }
    },
    [uid],
  );

  return { setAvailability, pending, error };
}

interface GeoWatchOptions {
  /** Le livreur doit être en ligne (ou en course) pour émettre sa position. */
  enabled: boolean;
  /** Fréquence minimale entre deux écritures (ms) — voir §24 (4-8 s en course, 30-60 s sinon). */
  minIntervalMs: number;
}

export type GeoStatus = 'idle' | 'watching' | 'unsupported' | 'denied' | 'error';

/**
 * Émission de la position en direct — dégradé web (Expo web n'a pas d'accès
 * natif complet) : utilise l'API `navigator.geolocation` du navigateur.
 * Le natif (development build) sera nécessaire pour la position en
 * arrière-plan réelle (écran éteint, app en arrière-plan) : documenté aussi
 * dans docs/CONTRAT_MODULES.md, section app livreur.
 */
export function useLiveLocation(uid: string | null, cityId: string | null, options: GeoWatchOptions): { status: GeoStatus } {
  const [status, setStatus] = useState<GeoStatus>('idle');
  const lastSentAt = useRef(0);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!options.enabled || !uid) {
      setStatus('idle');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unsupported');
      return;
    }
    setStatus('watching');
    watchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        if (now - lastSentAt.current < options.minIntervalMs) return;
        const { latitude, longitude, heading, speed, accuracy } = position.coords;
        // Une position peu fiable est écartée plutôt que transmise (§24 : mieux
        // vaut ne rien envoyer qu'une position trompeuse pour le suivi client).
        if (accuracy != null && accuracy > 100) return;
        lastSentAt.current = now;
        updateDoc(docAt(`driverLocations/${uid}`), {
          position: new GeoPoint(latitude, longitude),
          geohash: encodeGeohash({ lat: latitude, lng: longitude }, 9),
          heading: heading ?? null,
          speedKmh: speed != null ? Math.round(speed * 3.6) : null,
          accuracyMeters: accuracy != null ? Math.round(accuracy) : null,
          updatedAt: serverTimestamp(),
        }).catch(() => {
          // driverLocations/{uid} n'existe pas encore (aucune session en ligne
          // créée côté serveur) : rien à faire, la prochaine mise en ligne le créera.
        });
      },
      (err) => setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.enabled, uid, options.minIntervalMs, cityId]);

  return { status };
}

/** Réponse à une offre de course (functions/src/admin/operations/dispatch.ts). */
export const respondToOffer = callFunction<{ offerId: string; accept: boolean; reason?: string | null }, { status: DispatchOffer['status'] }>('respondToOffer');

/** Le livreur a récupéré la commande au commerce (functions/src/orders/transitions.ts). */
export const markOrderPickedUp = callFunction<{ orderId: string }, { status: Order['status'] }>('markOrderPickedUp');

/** Remise au client : code de remise exigé si `delivery.handoverCodeRequired`. */
export const completeOrder = callFunction<{ orderId: string; code?: string | null; geo?: { lat: number; lng: number } | null }, { status: Order['status'] }>('completeOrder');
