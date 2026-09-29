// Adresses (§15 client.md) — CRUD réel de `users/{uid}/addresses` (même
// collection que le formulaire inline du checkout, lot 2), adresse par défaut
// (`users/{uid}.defaultAddressId`, champ autorisé par `userEditableFields()`).
import { useCallback } from 'react';
import { GeoPoint, collection, deleteDoc, doc, updateDoc, setDoc } from 'firebase/firestore';
import type { UserAddress } from '@golink/shared';
import { db } from '../../lib/firebase';
import { docAt, useCollection, useDoc, createdFields, updatedFields } from '../../lib/firestore';
import { useAuth } from '../../auth/AuthContext';
import { useDefaultCity } from '../home/hooks';

export interface AddressFormInput {
  label: string;
  line1: string;
  details?: string | null;
  instructions?: string | null;
  floor?: string | null;
  doorCode?: string | null;
}

export function useAddresses() {
  const { user } = useAuth();
  const q = user ? collection(db, `users/${user.uid}/addresses`) : null;
  return useCollection<UserAddress>(q);
}

export function useAddress(addressId: string | undefined) {
  const { user } = useAuth();
  return useDoc<UserAddress>(user && addressId ? docAt(`users/${user.uid}/addresses/${addressId}`) : null);
}

export function useDefaultAddressId() {
  const { user } = useAuth();
  const { data } = useDoc<{ defaultAddressId?: string | null }>(user ? docAt(`users/${user.uid}`) : null);
  return data?.defaultAddressId ?? null;
}

export function useAddressActions() {
  const { user } = useAuth();
  const { city } = useDefaultCity();

  const create = useCallback(
    async (input: AddressFormInput, makeDefault: boolean) => {
      if (!user) return;
      const ref = doc(collection(db, `users/${user.uid}/addresses`));
      // Pas de géocodage dans ce lot (aucune intégration cartographique livrée côté client,
      // même limite que le formulaire inline du checkout lot 2) : point géographique par
      // défaut au centre de la ville active.
      const center = city?.center ?? { lat: 0, lng: 0 };
      const address: UserAddress = {
        label: input.label.trim() || 'Adresse',
        line1: input.line1.trim(),
        line2: null,
        postalCode: '00000',
        city: city?.name ?? '',
        countryCode: 'FR',
        geo: new GeoPoint(center.lat, center.lng),
        geohash: null,
        placeId: null,
        details: input.details?.trim() || null,
        instructions: input.instructions?.trim() || null,
        floor: input.floor?.trim() || null,
        doorCode: input.doorCode?.trim() || null,
        isDefault: makeDefault,
        ...createdFields(user.uid),
      } as unknown as UserAddress;
      await setDoc(ref, address);
      if (makeDefault) await updateDoc(docAt(`users/${user.uid}`), { defaultAddressId: ref.id, updatedAt: updatedFields(user.uid).updatedAt, updatedBy: user.uid });
      return ref.id;
    },
    [user, city],
  );

  const update = useCallback(
    async (addressId: string, input: AddressFormInput) => {
      if (!user) return;
      await updateDoc(docAt(`users/${user.uid}/addresses/${addressId}`), {
        label: input.label.trim() || 'Adresse',
        line1: input.line1.trim(),
        details: input.details?.trim() || null,
        instructions: input.instructions?.trim() || null,
        floor: input.floor?.trim() || null,
        doorCode: input.doorCode?.trim() || null,
        ...updatedFields(user.uid),
      });
    },
    [user],
  );

  const remove = useCallback(
    async (addressId: string) => {
      if (!user) return;
      await deleteDoc(docAt(`users/${user.uid}/addresses/${addressId}`));
    },
    [user],
  );

  const setDefault = useCallback(
    async (addressId: string) => {
      if (!user) return;
      await updateDoc(docAt(`users/${user.uid}`), { defaultAddressId: addressId, ...updatedFields(user.uid) });
    },
    [user],
  );

  return { create, update, remove, setDefault };
}
