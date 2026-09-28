// Journal d'audit : ajout seul. Les règles interdisent toute écriture côté client
// et aucune fonction ne modifie ni ne supprime une entrée.
import { COLLECTIONS, type AuditLog, type EntityRef } from '@golink/shared';
import { createHash } from 'node:crypto';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { db, FieldValue } from './admin';
import type { Caller } from './permissions';

export type AuditActor = AuditLog['actor'];

export const SYSTEM_ACTOR: AuditActor = { uid: 'system', type: 'system', role: null, name: 'GoLink (automatique)' };

const ACTOR_TYPES: Record<string, AuditActor['type']> = {
  admin: 'admin',
  restaurant: 'restaurant',
  driver: 'driver',
  client: 'client',
};

export function actorFromCaller(caller: Caller, type?: AuditActor['type']): AuditActor {
  const resolved = type ?? ACTOR_TYPES[caller.claims.role ?? 'client'] ?? 'client';
  return {
    uid: caller.uid,
    type: resolved,
    role: resolved === 'admin' ? (caller.claims.adminRole ?? null) : (caller.claims.role ?? null),
    name: caller.name,
  };
}

export interface AuditInput {
  actor: AuditActor;
  action: string;
  target: EntityRef;
  reason?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  countryId?: string | null;
  cityId?: string | null;
  sensitive?: boolean;
  impersonationSessionId?: string | null;
  /** Requête d'origine : empreinte de l'adresse IP et navigateur. */
  request?: CallableRequest<unknown>;
}

function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Écrit une entrée d'audit et renvoie son identifiant. */
export async function writeAudit(input: AuditInput): Promise<string> {
  const raw = input.request?.rawRequest;
  const entry: Omit<AuditLog, 'at'> & { at: FieldValue } = {
    actor: input.actor,
    action: input.action,
    target: input.target,
    countryId: input.countryId ?? null,
    cityId: input.cityId ?? null,
    reason: input.reason ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    impersonationSessionId: input.impersonationSessionId ?? null,
    ipHash: hashIp(raw?.ip),
    userAgent: raw?.get('user-agent')?.slice(0, 300) ?? null,
    sensitive: input.sensitive ?? false,
    at: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection(COLLECTIONS.auditLogs).add(entry);
  return ref.id;
}
