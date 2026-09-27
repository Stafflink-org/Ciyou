// Lectures temps réel des commandes de l'établissement actif, horloge, épinglage
// et alerte sonore des nouvelles commandes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { limit, orderBy, query, where } from 'firebase/firestore';
import { COLLECTIONS, paths, type Order, type OrderEvent } from '@golink/shared';
import { usePersistentState } from '@golink/web';
import { useRestaurantAccess } from '@/auth/RestaurantAccess';
import { collectionAt, docAt, useCollection, useDoc } from '@/lib/firestore';
import { ACTIVE_STATUSES, isAwaitingPayment, type OrderRow } from './lib';

/** Pastille du menu : nouvelles commandes à accepter dans l'établissement actif. */
export function usePendingOrdersCount(): number | null {
  const { restaurantId, can } = useRestaurantAccess();
  const allowed = can('orders.view');
  const q = allowed
    ? query(collectionAt(COLLECTIONS.orders), where('restaurantId', '==', restaurantId), where('status', '==', 'new'), limit(50))
    : null;
  const { data } = useCollection<Order>(q);
  if (!allowed) return null;
  return data.filter((o) => !isAwaitingPayment(o)).length || null;
}

/** Commandes en cours (et programmées) de l'établissement, les plus récentes d'abord. */
export function useActiveOrders() {
  const { restaurantId } = useRestaurantAccess();
  const q = query(
    collectionAt(COLLECTIONS.orders),
    where('restaurantId', '==', restaurantId),
    where('status', 'in', [...ACTIVE_STATUSES, 'scheduled']),
    orderBy('createdAt', 'desc'),
    limit(200),
  );
  const state = useCollection<Order>(q);
  const data = useMemo(() => state.data.filter((o) => !isAwaitingPayment(o)) as OrderRow[], [state.data]);
  return { ...state, data };
}

export function useOrder(orderId: string | null | undefined) {
  return useDoc<Order>(orderId ? docAt(paths.order(orderId)) : null);
}

export function useOrderEvents(orderId: string | null | undefined) {
  const q = orderId ? query(collectionAt(paths.orderEvents(orderId)), orderBy('at', 'asc'), limit(100)) : null;
  return useCollection<OrderEvent>(q);
}

/** Horloge partagée pour les minuteurs (rafraîchie chaque seconde par défaut). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Commandes épinglées par l'utilisateur (mémorisées sur ce poste, par établissement). */
export function usePinnedOrders() {
  const { restaurantId } = useRestaurantAccess();
  const [pins, setPins] = usePersistentState<string[]>(`golink:restaurant:epingles:${restaurantId}`, []);
  const toggle = useCallback(
    (orderId: string) => setPins(pins.includes(orderId) ? pins.filter((id) => id !== orderId) : [orderId, ...pins].slice(0, 30)),
    [pins, setPins],
  );
  return { pins, toggle, isPinned: (orderId: string) => pins.includes(orderId) };
}

// ------------------------------------------------------------------ Alerte sonore

/** Carillon de deux notes généré localement (aucun fichier audio externe). */
function chime(context: AudioContext): void {
  const notes = [880, 1318.5];
  notes.forEach((frequency, index) => {
    const start = context.currentTime + index * 0.18;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    osc.connect(gain).connect(context.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

export interface OrderAlertState {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  /** Le navigateur attend un geste de l'utilisateur pour autoriser le son. */
  blocked: boolean;
  unlock: () => void;
}

/**
 * Tant qu'une nouvelle commande attend, un carillon retentit toutes les
 * 6 secondes et le titre de l'onglet clignote. Préférence mémorisée sur le poste.
 */
export function useNewOrderAlert(pendingCount: number): OrderAlertState {
  const [enabled, setEnabled] = usePersistentState<boolean>('golink:restaurant:alerte-sonore', true);
  const contextRef = useRef<AudioContext | null>(null);
  const [blocked, setBlocked] = useState(false);

  const ensureContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
    contextRef.current ??= new AudioContext();
    return contextRef.current;
  }, []);

  const unlock = useCallback(() => {
    const context = ensureContext();
    if (!context) return;
    void context.resume().then(() => {
      setBlocked(false);
      chime(context);
    });
  }, [ensureContext]);

  useEffect(() => {
    if (!enabled || pendingCount === 0) return;
    const ring = () => {
      const context = ensureContext();
      if (!context) return;
      if (context.state === 'suspended') {
        void context.resume().catch(() => undefined);
        if (context.state === 'suspended') {
          setBlocked(true);
          return;
        }
      }
      setBlocked(false);
      chime(context);
    };
    ring();
    const id = window.setInterval(ring, 6000);
    return () => window.clearInterval(id);
  }, [enabled, pendingCount, ensureContext]);

  // Titre de l'onglet : « (2) Nouvelle commande » en alternance.
  useEffect(() => {
    if (pendingCount === 0) return;
    const original = document.title;
    let flip = false;
    const id = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? `(${pendingCount}) Nouvelle commande · GoLink` : original;
    }, 1200);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [pendingCount]);

  return { enabled, setEnabled, blocked: enabled && blocked && pendingCount > 0, unlock };
}
