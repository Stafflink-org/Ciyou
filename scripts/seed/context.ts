// Contexte partagé par les étapes du seed.
import type { Firestore } from '@google-cloud/firestore';
import type { Bucket } from '@google-cloud/storage';
import { SeedFiles } from './files';
import { parisDay, Rng, SeedWriter, ts, type Timestamp } from './lib';

export interface SeedContext {
  db: Firestore;
  w: SeedWriter;
  files: SeedFiles;
  rng: Rng;
  now: Date;
  today: string;
  nowTs: Timestamp;
  /** Identifiant du super administrateur (auteur des réglages). */
  superAdminUid: string;
}

export function createContext(db: Firestore, bucket: Bucket, superAdminUid: string): SeedContext {
  const now = new Date();
  return {
    db,
    w: new SeedWriter(db),
    files: new SeedFiles(bucket),
    rng: new Rng(20260925),
    now,
    today: parisDay(now),
    nowTs: ts(now),
    superAdminUid,
  };
}

/** Champs de traçabilité (Tracked). */
export function tracked(at: Timestamp, by: string | null) {
  return { createdAt: at, createdBy: by, updatedAt: at, updatedBy: by };
}
