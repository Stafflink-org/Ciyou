import { useCallback, useState } from 'react';
import { orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import type { Driver, DriverSanction, PartnerDocument, PartnerDocumentType, VehicleType, WithId } from '@golink/shared';
import { callFunction, collectionAt, docAt, useCollection, useDoc } from '../../lib/firestore';

export function useDriverProfile(uid: string | null) {
  return useDoc<Driver>(uid ? docAt(`drivers/${uid}`) : null);
}

/**
 * Sanction active du livreur (`drivers/{uid}.activeSanctionId`), s'il y en a une.
 * Permet de la lire et, si elle n'a pas déjà été contestée, de la contester
 * (`docs/AUDIT_COUVERTURE_CDC.md` §6, point P0 « Contestation »).
 */
export function useActiveSanction(driver: WithId<Driver> | null): { data: WithId<DriverSanction> | null; loading: boolean } {
  const sanctionState = useDoc<DriverSanction>(driver?.activeSanctionId ? docAt(`driverSanctions/${driver.activeSanctionId}`) : null);
  if (!driver?.activeSanctionId) return { data: null, loading: false };
  return { data: sanctionState.data, loading: sanctionState.loading };
}

/**
 * Contestation réelle par le livreur : écriture directe `driverSanctions/{id}`
 * (autorisée par `firebase/rules/drivers.rules`, self-service, une seule fois
 * par sanction). La décision (maintenue/annulée) est ensuite prise par l'équipe
 * (`decideSanctionContest`, back-office).
 */
export function useContestSanction(uid: string | null) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (sanctionId: string, message: string) => {
      if (!uid) return false;
      setError(null);
      setPending(true);
      try {
        await updateDoc(docAt(`driverSanctions/${sanctionId}`), {
          status: 'contested',
          contest: { message, submittedAt: serverTimestamp(), decision: null },
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible d’envoyer votre contestation.');
        return false;
      } finally {
        setPending(false);
      }
    },
    [uid],
  );

  return { submit, pending, error };
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
