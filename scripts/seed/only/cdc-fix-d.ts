// Données de base du volet « sécurité et audit » des correctifs du cahier (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/cdc-fix-d.ts                 (écrit)
//   npx tsx scripts/seed/only/cdc-fix-d.ts --dry-run       (affiche sans écrire)
//   npx tsx scripts/seed/only/cdc-fix-d.ts --enforce-mfa   (rend la double authentification obligatoire)
//
// 1. Interrupteurs « Fidélité » et « Chat en direct » : alignés sur le comportement réellement livré
//    (les modules lisent désormais ces interrupteurs ; ils étaient éteints par le jeu d'essai initial
//    alors que la fidélité et le chat du support fonctionnent). Chaque changement est historisé
//    (settingsHistory) et tracé (journal d'audit) avec son motif, comme par la fonction setFeatureFlag.
// 2. settings/refunds : montant maximal d'un avoir (500 €), ajouté seulement s'il est absent.
// 3. settings/branding : couleurs alignées sur le thème réellement livré (la couleur principale est désormais
//    appliquée aux back-offices ; le jeu d'essai initial portait une couleur sans rapport avec le thème).
// 4. --enforce-mfa : settings/security.requireMfaForAdmins = true. Ne touche à aucun compte : la double
//    authentification déjà activée sur un compte n'est jamais désactivée ni réinitialisée.
import { FieldValue, Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, FEATURE_LABELS, SETTINGS_DOCS, type FeatureKey } from '@golink/shared';
import { db } from '../../lib/admin.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const ENFORCE_MFA = process.argv.includes('--enforce-mfa');
const SYSTEM = { uid: 'system', type: 'system', role: null, name: 'Ciyou Eats (alignement des données)' };

const log = (verb: string, path: string, detail = '') => console.log(`${verb.padEnd(11)} ${path}${detail ? ` : ${detail}` : ''}`);

async function history(docPath: string, before: Record<string, unknown> | null, after: Record<string, unknown>, reason: string, action: string, label: string, sensitive = false): Promise<void> {
  const fields = Object.keys(after).filter((k) => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after[k]));
  const pick = (source: Record<string, unknown> | null) => Object.fromEntries(fields.map((f) => [f, source?.[f] ?? null]));
  await db.collection(COLLECTIONS.settingsHistory).add({ docPath, changedFields: fields, before: pick(before), after: pick(after), reason, changedBy: 'system', changedByName: SYSTEM.name, changedAt: FieldValue.serverTimestamp() });
  await db.collection(COLLECTIONS.auditLogs).add({
    actor: SYSTEM,
    action,
    target: { type: 'setting', id: docPath, label },
    countryId: null,
    cityId: null,
    reason,
    before: pick(before),
    after: pick(after),
    impersonationSessionId: null,
    ipHash: null,
    userAgent: null,
    sensitive,
    at: FieldValue.serverTimestamp(),
  });
}

async function main(): Promise<void> {
  // 1. Interrupteurs alignés.
  const align: Array<[FeatureKey, string]> = [
    ['loyalty', 'Alignement : le programme de fidélité fonctionne et les modules lisent désormais l’interrupteur ; il était éteint par le jeu d’essai initial.'],
    ['live_chat', 'Alignement : le chat du support fonctionne et le module lit désormais l’interrupteur ; il était éteint par le jeu d’essai initial.'],
  ];
  for (const [key, reason] of align) {
    const ref = db.doc(`${COLLECTIONS.featureFlags}/${key}`);
    const snap = await ref.get();
    const flag = snap.data() as { enabled?: boolean; locked?: boolean } | undefined;
    if (flag?.locked) {
      log('ignoré', ref.path, 'verrouillé');
      continue;
    }
    if (flag?.enabled === true) {
      log('conservé', ref.path, 'déjà activé');
      continue;
    }
    log('activation', ref.path);
    if (DRY_RUN) continue;
    await history(ref.path, { enabled: flag?.enabled ?? null }, { enabled: true }, reason, 'feature.updated', FEATURE_LABELS[key]);
    await ref.set({ key, enabled: true, overrides: [], locked: false, description: FEATURE_LABELS[key], updatedAt: Timestamp.now(), updatedBy: 'system' }, { merge: true });
  }

  // 2. Montant maximal d'un avoir.
  const refundsRef = db.doc(`${COLLECTIONS.settings}/${SETTINGS_DOCS.refunds}`);
  const refunds = (await refundsRef.get()).data() as { maxCreditCents?: number } | undefined;
  if (typeof refunds?.maxCreditCents === 'number') {
    log('conservé', refundsRef.path, `maxCreditCents = ${refunds.maxCreditCents}`);
  } else {
    log('ajout', refundsRef.path, 'maxCreditCents = 50000 (500 €)');
    if (!DRY_RUN) await refundsRef.set({ maxCreditCents: 50_000, updatedAt: Timestamp.now(), updatedBy: 'system' }, { merge: true });
  }

  // 3. Couleurs de la marque alignées sur le thème livré.
  const brandingRef = db.doc(`${COLLECTIONS.settings}/${SETTINGS_DOCS.branding}`);
  const branding = (await brandingRef.get()).data() as { colors?: { primary?: string }; seed?: boolean } | undefined;
  if (branding?.colors?.primary && branding.colors.primary.toLowerCase() !== '#e8784b' && branding.seed === true) {
    log('alignement', brandingRef.path, `couleur principale ${branding.colors.primary} -> #e8784b`);
    if (!DRY_RUN) {
      const colors = { primary: '#e8784b', secondary: '#19343b', accent: '#f7f2e8', background: '#f7f2e8' };
      await history(brandingRef.path, { colors: branding.colors }, { colors }, 'Alignement : couleurs de la marque reprises du thème livré (la couleur principale est désormais appliquée aux back-offices).', 'settings.updated', 'Marque');
      await brandingRef.set({ colors, updatedAt: Timestamp.now(), updatedBy: 'system' }, { merge: true });
    }
  } else {
    log('conservé', brandingRef.path);
  }

  // 4. Double authentification obligatoire.
  const securityRef = db.doc(`${COLLECTIONS.settings}/${SETTINGS_DOCS.security}`);
  const security = (await securityRef.get()).data() as { requireMfaForAdmins?: boolean } | undefined;
  if (!ENFORCE_MFA) {
    log('non demandé', securityRef.path, `requireMfaForAdmins = ${security?.requireMfaForAdmins ?? 'absent'} (utiliser --enforce-mfa)`);
  } else if (security?.requireMfaForAdmins === true) {
    log('conservé', securityRef.path, 'requireMfaForAdmins déjà vrai');
  } else {
    log('activation', securityRef.path, 'requireMfaForAdmins = true, effet immédiat');
    if (!DRY_RUN) {
      await history(securityRef.path, { requireMfaForAdmins: security?.requireMfaForAdmins ?? false, mfaEnforcedFrom: null }, { requireMfaForAdmins: true, mfaEnforcedFrom: null }, 'Double authentification obligatoire pour tous les administrateurs (cahier §27).', 'settings.updated', 'Politique de sécurité', true);
      await securityRef.set({ requireMfaForAdmins: true, mfaEnforcedFrom: null, updatedAt: Timestamp.now(), updatedBy: 'system' }, { merge: true });
    }
  }
  console.log(DRY_RUN ? 'Simulation terminée.' : 'Terminé.');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
