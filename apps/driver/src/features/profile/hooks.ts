import { useCallback, useState } from 'react';
import { orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import type { Driver, PartnerDocument, PartnerDocumentType, VehicleType, WithId } from '@golink/shared';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';

export function useDriverProfile(uid: string | null) {
  return useDoc<Driver>(uid ? docAt(`drivers/${uid}`) : null);
}

/**
 * Modification réelle du véhicule et de la distance maximale : écriture directe
 * drivers/{uid} (autorisée par firebase/rules/drivers.rules, self-service, jamais
 * en cours de course), conformément à docs/DECISIONS_CLIENT.md
 * (« Distance max : choisie par le livreur »).
 */
export function useUpdateDriverSettings(uid: string | null) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (input: { vehicle: Driver['vehicle']; maxDistanceMeters: number }) => {
      if (!uid) return false;
      setError(null);
      setPending(true);
      try {
        await updateDoc(docAt(`drivers/${uid}`), {
          vehicle: {
            type: input.vehicle.type,
            plate: input.vehicle.plate || null,
            model: input.vehicle.model || null,
            color: input.vehicle.color || null,
          },
          maxDistanceMeters: input.maxDistanceMeters,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible d’enregistrer ces réglages.');
        return false;
      } finally {
        setPending(false);
      }
    },
    [uid],
  );

  return { save, pending, error };
}

/** Justificatifs déjà déposés par ce livreur, les plus récents en premier. */
export function useDriverDocuments(uid: string | null) {
  const target = uid
    ? query(collectionAt('partnerDocuments'), where('ownerType', '==', 'driver'), where('ownerId', '==', uid), orderBy('createdAt', 'desc'))
    : null;
  return useCollection<PartnerDocument>(target);
}

interface UploadDriverDocumentInput {
  driverId: string;
  type: PartnerDocumentType;
  storagePath: string;
  fileName: string;
  number: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
}

/** Enregistrement serveur du justificatif déjà déposé dans Storage (functions/src/drivers/documents.ts). */
export const uploadDriverDocument = callFunction<UploadDriverDocumentInput, { documentId: string }>('uploadDriverDocument');

export type { PartnerDocumentType, VehicleType, WithId };
