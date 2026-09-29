import { docAt, useDoc } from '../../lib/firestore';
import type { Driver } from '@golink/shared';

export function useDriverProfile(uid: string | null) {
  return useDoc<Driver>(uid ? docAt(`drivers/${uid}`) : null);
}
