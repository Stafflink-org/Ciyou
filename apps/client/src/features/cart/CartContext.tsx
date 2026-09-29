// Panier client (§18.1, §7 client.md) — mono-restaurant, persistant localement
// (AsyncStorage, équivalent RN de `shoplink-client-cart`). Le prix affiché ici
// n'est qu'un aperçu : le montant qui fait foi est celui renvoyé par la Cloud
// Function `placeOrder` au moment de la confirmation (voir CheckoutScreen).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartLineInput } from '@golink/shared';

/** Option choisie sur une ligne, telle qu'affichée (nom lisible conservé en plus des identifiants). */
export interface CartLineOption {
  optionId: string;
  groupId: string;
  groupName: string;
  name: string;
  priceCents: number;
  quantity: number;
}

/** Ligne de panier côté app : suffisamment de détails pour l'affichage (nom, image, prix)
 * et assez pour reconstruire l'entrée `CartLineInput` envoyée à `placeOrder`. */
export interface CartLine {
  lineId: string;
  productId: string;
  restaurantId: string;
  name: string;
  imageUrl?: string | null;
  unitPriceCents: number;
  optionsPriceCents: number;
  quantity: number;
  options: CartLineOption[];
  comment?: string | null;
  stock: number | null;
}

interface CartState {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
}

const EMPTY_STATE: CartState = { restaurantId: null, restaurantName: null, lines: [] };
const STORAGE_KEY = 'ciyoueats-client-cart';

export interface AddLineInput {
  restaurantId: string;
  restaurantName: string;
  productId: string;
  name: string;
  imageUrl?: string | null;
  unitPriceCents: number;
  optionsPriceCents: number;
  quantity: number;
  options: CartLineOption[];
  comment?: string | null;
  stock: number | null;
  /** Présent en mode « mettre à jour » depuis le panier : remplace la ligne au lieu d'en ajouter une. */
  editingLineId?: string;
}

export interface CartContextValue {
  restaurantId: string | null;
  restaurantName: string | null;
  lines: CartLine[];
  itemsCount: number;
  subtotalCents: number;
  loaded: boolean;
  /** true si l'ajout demande de confirmer le remplacement du panier (autre restaurant). */
  belongsToOtherRestaurant: (restaurantId: string) => boolean;
  quantityInCart: (productId: string) => number;
  /** Ajoute ou remplace une ligne. Lève si le panier appartient à un autre restaurant (appeler
   * `belongsToOtherRestaurant` puis `clear()` avant, après confirmation de l'utilisateur). */
  addLine: (input: AddLineInput) => { ok: true } | { ok: false; reason: 'stock' };
  increaseLine: (lineId: string) => { ok: true } | { ok: false; reason: 'stock' };
  decreaseLine: (lineId: string) => void;
  removeLine: (lineId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function cartLineTotal(line: CartLine): number {
  return (line.unitPriceCents + line.optionsPriceCents) * line.quantity;
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CartState>(EMPTY_STATE);
  const [loaded, setLoaded] = useState(false);
  const hydrating = useRef(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setState(JSON.parse(raw) as CartState);
      } catch {
        // Panier illisible (format ancien, stockage plein…) : on repart d'un panier vide.
      } finally {
        hydrating.current = false;
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (hydrating.current) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => undefined);
  }, [state]);

  const belongsToOtherRestaurant = useCallback(
    (restaurantId: string) => state.restaurantId !== null && state.restaurantId !== restaurantId && state.lines.length > 0,
    [state.restaurantId, state.lines.length],
  );

  const quantityInCart = useCallback(
    (productId: string) => state.lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0),
    [state.lines],
  );

  const addLine = useCallback(
    (input: AddLineInput): { ok: true } | { ok: false; reason: 'stock' } => {
      let result: { ok: true } | { ok: false; reason: 'stock' } = { ok: true };
      setState((prev) => {
        const base: CartState = prev.restaurantId && prev.restaurantId !== input.restaurantId ? EMPTY_STATE : prev;
        const others = base.lines.filter((l) => l.lineId !== input.editingLineId);
        const currentQty = others.filter((l) => l.productId === input.productId).reduce((s, l) => s + l.quantity, 0);
        if (input.stock !== null && currentQty + input.quantity > input.stock) {
          result = { ok: false, reason: 'stock' };
          return prev;
        }
        const lineId = input.editingLineId ?? `c${Date.now()}${Math.round(Math.random() * 1000)}`;
        const line: CartLine = {
          lineId,
          productId: input.productId,
          restaurantId: input.restaurantId,
          name: input.name,
          imageUrl: input.imageUrl,
          unitPriceCents: input.unitPriceCents,
          optionsPriceCents: input.optionsPriceCents,
          quantity: input.quantity,
          options: input.options,
          comment: input.comment,
          stock: input.stock,
        };
        result = { ok: true };
        return { restaurantId: input.restaurantId, restaurantName: input.restaurantName, lines: [...others, line] };
      });
      return result;
    },
    [],
  );

  const increaseLine = useCallback((lineId: string): { ok: true } | { ok: false; reason: 'stock' } => {
    let result: { ok: true } | { ok: false; reason: 'stock' } = { ok: true };
    setState((prev) => {
      const target = prev.lines.find((l) => l.lineId === lineId);
      if (!target) return prev;
      // Le cumul de toutes les lignes du même plat compte pour le stock (§7 client.md).
      const totalForProduct = prev.lines.filter((l) => l.productId === target.productId).reduce((s, l) => s + l.quantity, 0);
      if (target.stock !== null && totalForProduct + 1 > target.stock) {
        result = { ok: false, reason: 'stock' };
        return prev;
      }
      result = { ok: true };
      return { ...prev, lines: prev.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: l.quantity + 1 } : l)) };
    });
    return result;
  }, []);

  const decreaseLine = useCallback((lineId: string) => {
    setState((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity - 1) } : l)) }));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setState((prev) => {
      const lines = prev.lines.filter((l) => l.lineId !== lineId);
      return lines.length ? { ...prev, lines } : EMPTY_STATE;
    });
  }, []);

  const clear = useCallback(() => setState(EMPTY_STATE), []);

  const value = useMemo<CartContextValue>(() => {
    const itemsCount = state.lines.reduce((s, l) => s + l.quantity, 0);
    const subtotalCents = state.lines.reduce((s, l) => s + cartLineTotal(l), 0);
    return {
      restaurantId: state.restaurantId,
      restaurantName: state.restaurantName,
      lines: state.lines,
      itemsCount,
      subtotalCents,
      loaded,
      belongsToOtherRestaurant,
      quantityInCart,
      addLine,
      increaseLine,
      decreaseLine,
      removeLine,
      clear,
    };
  }, [state, loaded, belongsToOtherRestaurant, quantityInCart, addLine, increaseLine, decreaseLine, removeLine, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart doit être utilisé sous CartProvider.');
  return ctx;
}

/** Reconstruit les lignes au format attendu par la Cloud Function `placeOrder`. */
export function cartLinesToInput(lines: CartLine[]): CartLineInput[] {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    // Toujours un tableau (jamais `undefined`) : la sérialisation des Cloud Functions callable
    // transforme `undefined` en `null` sur le fil, ce que le schéma serveur (z.array().optional()) refuse.
    options: l.options.map((o) => ({ optionId: o.optionId, groupId: o.groupId, quantity: o.quantity })),
    comment: l.comment || null,
  }));
}

export { cartLineTotal };
