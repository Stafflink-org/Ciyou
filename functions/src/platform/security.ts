// Sécurité des administrateurs (cahier §27) : suivi des sessions et appareils,
// double authentification TOTP obligatoire (enrôlement par QR code, vérification à
// chaque connexion, codes de secours), déconnexion à distance, anomalies.
import {
  COLLECTIONS,
  type AdminSessionRecord,
  type AdminSessionState,
  type AdminMfaSecret,
  type AdminUser,
} from '@golink/shared';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { auth, db, FieldValue, Timestamp } from '../lib/admin';
import { actorFromCaller, writeAudit } from '../lib/audit';
import { fail } from '../lib/errors';
import { requireAdmin } from '../lib/permissions';
import { z, zId, zReason } from '../lib/validation';
import {
  PLATFORM_SCHEDULE_RUNTIME,
  TIMEZONE,
  TOTP_ENCRYPTION_KEY,
  authTimeOf,
  describeDevice,
  ipHashOf,
  loadSecurityPolicy,
  mfaRequiredNow,
  platformCallable,
  raiseSecurityAlert,
  requireSecureAdmin,
  sessionIdFor,
  sha256,
} from './runtime';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  verifyTotp as checkTotp,
  currentStep,
} from './totp';

const SECRET_OPTIONS = { secrets: [TOTP_ENCRYPTION_KEY] };
const HEARTBEAT_MS = 2 * 60 * 1000;

function secretRef(uid: string) {
  return db.collection(COLLECTIONS.adminSecrets).doc(uid);
}

function sessionRef(id: string) {
  return db.collection(COLLECTIONS.adminSessions).doc(id);
}

// ------------------------------------------------------------------ Session courante

/**
 * Appelée par le super admin à l'ouverture puis périodiquement : enregistre la
 * session (appareil, empreinte IP), la prolonge, et renvoie l'état de la double
 * authentification et de la politique applicable.
 */
export const trackAdminSession = platformCallable(z.object({}).optional(), async (_data, request) => {
  const { caller, admin } = await requireAdmin(request, undefined, { skipMfa: true });
  const authTime = authTimeOf(request);
  const sessionId = sessionIdFor(caller.uid, authTime);
  const policy = await loadSecurityPolicy();
  const ref = sessionRef(sessionId);
  const snap = await ref.get();
  const now = Date.now();
  const expiresAtMs = authTime ? (authTime * 1000) + policy.adminSessionMaxHours * 3_600_000 : null;
  let session = snap.data() as AdminSessionRecord | undefined;

  if (!session) {
    const userAgent = (request.rawRequest?.get('user-agent') ?? '').slice(0, 300);
    const device = describeDevice(userAgent);
    const ipHash = ipHashOf(request) ?? 'inconnu';
    const previous = await db.collection(COLLECTIONS.adminSessions).where('adminId', '==', caller.uid).limit(50).get();
    const known = previous.docs.some((doc) => doc.get('device') === device);
    const record: Omit<AdminSessionRecord, 'createdAt' | 'lastSeenAt'> & { createdAt: FieldValue; lastSeenAt: FieldValue } = {
      adminId: caller.uid,
      adminEmail: admin.email,
      adminName: admin.displayName,
      device,
      userAgent,
      ipHash,
      approximateLocation: null,
      authTime,
      createdAt: FieldValue.serverTimestamp(),
      lastSeenAt: FieldValue.serverTimestamp(),
      expiresAt: expiresAtMs ? Timestamp.fromMillis(expiresAtMs) : null,
      revokedAt: null,
      revokedBy: null,
      mfaVerifiedAt: null,
      mfaMethod: null,
    };
    await ref.set(record);
    await db.collection(COLLECTIONS.admins).doc(caller.uid).update({ lastLoginAt: FieldValue.serverTimestamp(), lastLoginIp: ipHash });
    // Connexion inhabituelle : adresse jamais vue pour ce compte, ou ouverture dans la plage horaire inhabituelle (heure de Paris).
    const knownIp = previous.docs.some((doc) => doc.get('ipHash') === ipHash);
    const hours = policy.unusualLoginHours ?? { fromHour: 0, toHour: 5 };
    const parisHour = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: TIMEZONE }).format(new Date()));
    const unusualHour = hours.fromHour !== hours.toHour && (hours.fromHour < hours.toHour ? parisHour >= hours.fromHour && parisHour < hours.toHour : parisHour >= hours.fromHour || parisHour < hours.toHour);
    const reasons: string[] = [];
    if (previous.size > 0 && !knownIp && ipHash !== 'inconnu') reasons.push('adresse réseau jamais utilisée par ce compte');
    if (previous.size > 0 && unusualHour) reasons.push(`ouverture à ${parisHour} h (heure de Paris), hors des heures habituelles`);
    if (reasons.length > 0) {
      await raiseSecurityAlert({
        type: 'unusual_login',
        adminId: caller.uid,
        severity: 'warning',
        details: `Connexion inhabituelle de ${admin.displayName} : ${reasons.join(' ; ')}.`,
      });
    }
    if (!known && previous.size > 0 && policy.alertOnNewDevice !== false) {
      await raiseSecurityAlert({
        type: 'new_device',
        adminId: caller.uid,
        severity: 'info',
        details: `Connexion de ${admin.displayName} depuis un nouvel appareil (${device}).`,
      });
    }
    session = { ...(record as unknown as AdminSessionRecord) };
  } else if (!session.revokedAt && now - (session.lastSeenAt?.toMillis?.() ?? 0) > HEARTBEAT_MS) {
    await ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
  }

  const expired = expiresAtMs !== null && now > expiresAtMs;
  if (expired && !session.revokedAt) {
    await ref.update({ revokedAt: FieldValue.serverTimestamp(), revokedBy: 'system', revokeReason: 'Durée maximale de session atteinte' });
  }
  const required = mfaRequiredNow(policy, admin, now);
  const deadline = !admin.mfaEnrolled && policy.requireMfaForAdmins && !required ? (policy.mfaEnforcedFrom?.toMillis() ?? null) : null;
  const state: AdminSessionState = {
    sessionId,
    mfaEnrolled: admin.mfaEnrolled,
    mfaVerified: Boolean(session.mfaVerifiedAt),
    mfaRequired: required,
    enforcementDeadline: deadline,
    revoked: Boolean(session.revokedAt),
    expired,
    expiresAt: expiresAtMs,
  };
  return state;
});

// ------------------------------------------------------------------ Enrôlement

export const enrollTotp = platformCallable(
  z.discriminatedUnion('action', [
    z.object({ action: z.literal('start') }),
    z.object({ action: z.literal('confirm'), code: z.string().trim().min(6).max(8) }),
  ]),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, undefined, { skipMfa: true });
    const key = TOTP_ENCRYPTION_KEY.value();
    const ref = secretRef(caller.uid);
    const snap = await ref.get();
    const secret = snap.data() as AdminMfaSecret | undefined;

    if (data.action === 'start') {
      if (admin.mfaEnrolled && secret?.totpSecretEnc) {
        throw fail.precondition('La double authentification est déjà active sur ce compte.');
      }
      const plain = generateTotpSecret();
      await ref.set(
        {
          pendingSecretEnc: encryptSecret(plain, key),
          pendingCreatedAt: FieldValue.serverTimestamp(),
          totpSecretEnc: secret?.totpSecretEnc ?? null,
          enrolledAt: secret?.enrolledAt ?? null,
          recoveryCodeHashes: secret?.recoveryCodeHashes ?? [],
          lastUsedStep: null,
          failedAttempts: 0,
          lockedUntil: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { secret: plain, uri: otpauthUri(plain, admin.email), account: admin.email };
    }

    if (!secret?.pendingSecretEnc) throw fail.precondition('Recommencez l’activation : aucun enrôlement en cours.');
    const created = secret.pendingCreatedAt?.toMillis() ?? 0;
    if (Date.now() - created > 30 * 60 * 1000) throw fail.precondition('L’enrôlement a expiré. Recommencez pour obtenir un nouveau QR code.');
    const plain = decryptSecret(secret.pendingSecretEnc, key);
    const step = checkTotp(plain, data.code, null);
    if (step === null) throw fail.invalid('Code incorrect. Vérifiez l’heure de votre téléphone et saisissez le code affiché.');

    const recoveryCodes = generateRecoveryCodes();
    const sessionId = sessionIdFor(caller.uid, authTimeOf(request));
    const batch = db.batch();
    batch.set(ref, {
      totpSecretEnc: secret.pendingSecretEnc,
      pendingSecretEnc: null,
      pendingCreatedAt: null,
      enrolledAt: FieldValue.serverTimestamp(),
      recoveryCodeHashes: recoveryCodes.map((code) => sha256(normalizeRecoveryCode(code))),
      lastUsedStep: step,
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.update(db.collection(COLLECTIONS.admins).doc(caller.uid), { mfaEnrolled: true, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
    batch.set(sessionRef(sessionId), { mfaVerifiedAt: FieldValue.serverTimestamp(), mfaMethod: 'totp' }, { merge: true });
    await batch.commit();
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: 'admin.mfa_enrolled',
      target: { type: 'admin', id: caller.uid, label: admin.email },
      sensitive: true,
      request,
    });
    return { recoveryCodes };
  },
  SECRET_OPTIONS,
);

// ------------------------------------------------------------------ Vérification

export const verifyTotp = platformCallable(
  z.object({ code: z.string().trim().min(6).max(12), method: z.enum(['totp', 'recovery_code']).default('totp') }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, undefined, { skipMfa: true });
    if (!admin.mfaEnrolled) throw fail.precondition('La double authentification n’est pas activée sur ce compte.');
    const ref = secretRef(caller.uid);
    const snap = await ref.get();
    const secret = snap.data() as AdminMfaSecret | undefined;
    if (!secret?.totpSecretEnc) throw fail.precondition('Aucun secret enregistré : demandez la réinitialisation de votre double authentification.');
    const lockedUntil = secret.lockedUntil?.toMillis() ?? 0;
    if (lockedUntil > Date.now()) {
      const minutes = Math.ceil((lockedUntil - Date.now()) / 60_000);
      throw fail.precondition(`Trop d’essais. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`);
    }
    const sessionId = sessionIdFor(caller.uid, authTimeOf(request));
    const session = (await sessionRef(sessionId).get()).data() as AdminSessionRecord | undefined;
    if (!session || session.revokedAt) throw fail.unauthenticated();

    let accepted = false;
    const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (data.method === 'recovery_code') {
      const hash = sha256(normalizeRecoveryCode(data.code));
      if (secret.recoveryCodeHashes.includes(hash)) {
        accepted = true;
        update.recoveryCodeHashes = FieldValue.arrayRemove(hash);
      }
    } else {
      const step = checkTotp(decryptSecret(secret.totpSecretEnc, TOTP_ENCRYPTION_KEY.value()), data.code, secret.lastUsedStep ?? null);
      if (step !== null) {
        accepted = true;
        update.lastUsedStep = step;
      }
    }

    if (!accepted) {
      const policy = await loadSecurityPolicy();
      const attempts = (secret.failedAttempts ?? 0) + 1;
      const max = policy.mfaMaxAttempts ?? 5;
      const lock = attempts >= max;
      await ref.update({
        failedAttempts: lock ? 0 : attempts,
        lockedUntil: lock ? Timestamp.fromMillis(Date.now() + (policy.mfaLockMinutes ?? 15) * 60_000) : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Échecs de vérification de la dernière heure : au-delà du seuil réglable, alerte « connexions échouées ».
      await ref.collection('failures').add({ at: Timestamp.now(), ipHash: ipHashOf(request) });
      const recentFailures = (await ref.collection('failures').where('at', '>=', Timestamp.fromMillis(Date.now() - 3_600_000)).count().get()).data().count;
      const failedThreshold = policy.alerts?.failedLoginsPerHour ?? 8;
      if (recentFailures >= failedThreshold) {
        const open = await db.collection(COLLECTIONS.securityAlerts).where('adminId', '==', caller.uid).where('type', '==', 'failed_logins').where('status', '==', 'open').limit(1).get();
        if (open.empty) {
          await raiseSecurityAlert({
            type: 'failed_logins',
            adminId: caller.uid,
            severity: 'warning',
            details: `${recentFailures} vérifications de code échouées en une heure pour ${admin.displayName} (seuil : ${failedThreshold}).`,
          });
        }
      }
      if (lock) {
        await raiseSecurityAlert({
          type: 'mfa_failed',
          adminId: caller.uid,
          severity: 'warning',
          details: `${max} codes de vérification erronés pour ${admin.displayName} : compte verrouillé ${policy.mfaLockMinutes ?? 15} minutes.`,
        });
      }
      throw fail.invalid(lock ? 'Trop d’essais : la vérification est verrouillée quelques minutes.' : `Code incorrect. Il vous reste ${max - attempts} essai${max - attempts > 1 ? 's' : ''}.`);
    }

    update.failedAttempts = 0;
    update.lockedUntil = null;
    await ref.update(update);
    await sessionRef(sessionId).update({ mfaVerifiedAt: FieldValue.serverTimestamp(), mfaMethod: data.method, lastSeenAt: FieldValue.serverTimestamp() });
    if (data.method === 'recovery_code') {
      const remaining = secret.recoveryCodeHashes.length - 1;
      await writeAudit({
        actor: actorFromCaller(caller, 'admin'),
        action: 'admin.mfa_recovery_used',
        target: { type: 'admin', id: caller.uid, label: admin.email },
        after: { remainingCodes: remaining },
        sensitive: true,
        request,
      });
      return { verified: true, remainingRecoveryCodes: remaining };
    }
    return { verified: true, remainingRecoveryCodes: secret.recoveryCodeHashes.length };
  },
  SECRET_OPTIONS,
);

/** Nouveaux codes de secours (les anciens deviennent invalides) ; exige un code valide. */
export const regenerateRecoveryCodes = platformCallable(
  z.object({ code: z.string().trim().min(6).max(8) }),
  async (data, request) => {
    const { caller, admin } = await requireSecureAdmin(request);
    const ref = secretRef(caller.uid);
    const secret = (await ref.get()).data() as AdminMfaSecret | undefined;
    if (!admin.mfaEnrolled || !secret?.totpSecretEnc) throw fail.precondition('La double authentification n’est pas activée.');
    const step = checkTotp(decryptSecret(secret.totpSecretEnc, TOTP_ENCRYPTION_KEY.value()), data.code, secret.lastUsedStep ?? null);
    if (step === null) throw fail.invalid('Code incorrect.');
    const codes = generateRecoveryCodes();
    await ref.update({ recoveryCodeHashes: codes.map((c) => sha256(normalizeRecoveryCode(c))), lastUsedStep: step, updatedAt: FieldValue.serverTimestamp() });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'admin.mfa_recovery_regenerated', target: { type: 'admin', id: caller.uid, label: admin.email }, sensitive: true, request });
    return { recoveryCodes: codes };
  },
  SECRET_OPTIONS,
);

/** État de la double authentification du compte connecté (codes restants). */
export const getMfaStatus = platformCallable(z.object({}).optional(), async (_data, request) => {
  const { caller, admin } = await requireAdmin(request, undefined, { skipMfa: true });
  const secret = (await secretRef(caller.uid).get()).data() as AdminMfaSecret | undefined;
  return {
    enrolled: admin.mfaEnrolled && Boolean(secret?.totpSecretEnc),
    enrolledAt: secret?.enrolledAt?.toMillis() ?? null,
    recoveryCodesLeft: secret?.recoveryCodeHashes?.length ?? 0,
    currentStep: currentStep(),
  };
});

// ------------------------------------------------------------------ Réinitialisation et sessions

async function revokeAll(adminId: string, by: string, reason: string): Promise<number> {
  const open = await db.collection(COLLECTIONS.adminSessions).where('adminId', '==', adminId).where('revokedAt', '==', null).get();
  const batch = db.batch();
  for (const doc of open.docs) batch.update(doc.ref, { revokedAt: FieldValue.serverTimestamp(), revokedBy: by, revokeReason: reason });
  await batch.commit();
  try {
    await auth.revokeRefreshTokens(adminId);
  } catch (error) {
    logger.warn('Révocation des jetons impossible', { adminId, error: String(error) });
  }
  return open.size;
}

/** Réinitialise la double authentification d'un administrateur (appareil perdu). */
export const resetAdminMfa = platformCallable(z.object({ adminId: zId, reason: zReason }), async (data, request) => {
  const { caller, admin } = await requireSecureAdmin(request, 'admins.manage');
  if (data.adminId === caller.uid) throw fail.forbidden('Un autre administrateur doit réinitialiser votre double authentification.');
  const targetSnap = await db.collection(COLLECTIONS.admins).doc(data.adminId).get();
  if (!targetSnap.exists) throw fail.notFound('Administrateur');
  const target = targetSnap.data() as AdminUser;
  if (target.role === 'super_admin' && admin.role !== 'super_admin') throw fail.forbidden('Seul un super administrateur peut réinitialiser un super administrateur.');
  await secretRef(data.adminId).delete();
  await targetSnap.ref.update({ mfaEnrolled: false, updatedAt: FieldValue.serverTimestamp(), updatedBy: caller.uid });
  const revoked = await revokeAll(data.adminId, caller.uid, 'Double authentification réinitialisée');
  await raiseSecurityAlert({ type: 'mfa_disabled', adminId: data.adminId, severity: 'warning', details: `Double authentification de ${target.displayName} réinitialisée par ${admin.displayName} : ${data.reason}` });
  await writeAudit({
    actor: actorFromCaller(caller, 'admin'),
    action: 'admin.mfa_reset',
    target: { type: 'admin', id: data.adminId, label: target.email },
    reason: data.reason,
    after: { sessionsRevoked: revoked },
    sensitive: true,
    request,
  });
  return { sessionsRevoked: revoked };
});

/**
 * Déconnexion à distance : une session précise (marquée révoquée, l'application se
 * déconnecte aussitôt) ou toutes les sessions d'un administrateur (jetons révoqués).
 */
export const revokeSessions = platformCallable(
  z.object({ adminId: zId, sessionId: z.string().regex(/^[a-f0-9]{32}$/).nullish(), reason: zReason }),
  async (data, request) => {
    const self = request.auth?.uid === data.adminId;
    const { caller, admin } = await requireSecureAdmin(request, self ? undefined : 'security.manage');
    const targetSnap = await db.collection(COLLECTIONS.admins).doc(data.adminId).get();
    if (!targetSnap.exists) throw fail.notFound('Administrateur');
    const target = targetSnap.data() as AdminUser;
    if (!self && target.role === 'super_admin' && admin.role !== 'super_admin') throw fail.forbidden();

    let count = 0;
    if (data.sessionId) {
      const ref = sessionRef(data.sessionId);
      const snap = await ref.get();
      if (!snap.exists || snap.get('adminId') !== data.adminId) throw fail.notFound('Session');
      if (!snap.get('revokedAt')) {
        await ref.update({ revokedAt: FieldValue.serverTimestamp(), revokedBy: caller.uid, revokeReason: data.reason });
        count = 1;
      }
    } else {
      count = await revokeAll(data.adminId, caller.uid, data.reason);
    }
    if (!self) {
      await raiseSecurityAlert({ type: 'session_revoked', adminId: data.adminId, severity: 'info', details: `${count} session${count > 1 ? 's' : ''} de ${target.displayName} fermée${count > 1 ? 's' : ''} par ${admin.displayName} : ${data.reason}` });
    }
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: data.sessionId ? 'admin.session_revoked' : 'admin.sessions_revoked',
      target: { type: 'admin', id: data.adminId, label: target.email },
      reason: data.reason,
      after: { sessions: count, sessionId: data.sessionId ?? null },
      sensitive: true,
      request,
    });
    return { revoked: count };
  },
);

/** Prise en charge d'une alerte de sécurité (statut + auteur), auditée. */
export const handleSecurityAlert = platformCallable(
  z.object({ alertId: zId, status: z.enum(['acknowledged', 'resolved', 'dismissed']), note: z.string().trim().max(500).nullish() }),
  async (data, request) => {
    const { caller } = await requireSecureAdmin(request, 'security.manage');
    const ref = db.collection(COLLECTIONS.securityAlerts).doc(data.alertId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Alerte');
    await ref.update({ status: data.status, handledBy: caller.uid, handledAt: FieldValue.serverTimestamp(), note: data.note ?? null });
    await writeAudit({
      actor: actorFromCaller(caller, 'admin'),
      action: `security_alert.${data.status}`,
      target: { type: 'other', id: data.alertId, label: String(snap.get('details') ?? 'Alerte de sécurité').slice(0, 120) },
      reason: data.note ?? null,
      request,
    });
    return { status: data.status };
  },
);

// ------------------------------------------------------------------ Anomalies (planifiée)

/**
 * Toutes les heures : remboursements en série par agent (journal d'audit) et
 * sessions expirées fermées. Une seule alerte ouverte par agent et par type.
 */
export const detectSecurityAnomalies = onSchedule(
  { schedule: 'every 60 minutes', timeZone: TIMEZONE, ...PLATFORM_SCHEDULE_RUNTIME },
  async () => {
    const policy = await loadSecurityPolicy();
    const since = Timestamp.fromMillis(Date.now() - 3_600_000);
    const logs = await db.collection(COLLECTIONS.auditLogs).where('at', '>=', since).get();
    const refunds = new Map<string, { name: string; count: number }>();
    for (const doc of logs.docs) {
      const action = String(doc.get('action') ?? '');
      const actor = doc.get('actor') as { uid: string; type: string; name: string } | undefined;
      if (!actor || actor.type !== 'admin' || !action.startsWith('refund.')) continue;
      const entry = refunds.get(actor.uid) ?? { name: actor.name, count: 0 };
      entry.count += 1;
      refunds.set(actor.uid, entry);
    }
    for (const [uid, entry] of refunds) {
      if (entry.count < policy.alerts.refundsPerAgentPerHour) continue;
      const open = await db.collection(COLLECTIONS.securityAlerts).where('adminId', '==', uid).where('type', '==', 'refund_spike').where('status', '==', 'open').limit(1).get();
      if (!open.empty) continue;
      await raiseSecurityAlert({ type: 'refund_spike', adminId: uid, severity: 'warning', details: `${entry.count} remboursements en une heure par ${entry.name} (seuil ${policy.alerts.refundsPerAgentPerHour}).` });
    }

    const now = Timestamp.now();
    const expired = await db.collection(COLLECTIONS.adminSessions).where('revokedAt', '==', null).where('expiresAt', '<=', now).limit(300).get();
    if (!expired.empty) {
      const batch = db.batch();
      for (const doc of expired.docs) batch.update(doc.ref, { revokedAt: now, revokedBy: 'system', revokeReason: 'Durée maximale de session atteinte' });
      await batch.commit();
    }
    logger.info('Anomalies de sécurité analysées', { refundActors: refunds.size, expiredSessions: expired.size });
  },
);
