// Données de base du volet « argent » des correctifs du cahier (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/cdc-fix-c.ts            (écrit)
//   npx tsx scripts/seed/only/cdc-fix-c.ts --dry-run  (affiche sans écrire)
//
// 1. Messages automatiques financiers (facture, reversement, relances d'abonnement, plafond d'espèces) :
//    crée les gabarits qui manquent ; un gabarit déjà présent (donc éventuellement modifié) n'est jamais écrasé.
// 2. Prestataires de paiement : Stripe (France, Belgique, Luxembourg) et virement local manuel
//    (Algérie, Maroc, Tunisie), rattachés à leur pays. Un prestataire existant n'est pas écrasé.
// 3. settings/promotions : seuil « client fidèle » et délai « client inactif » par défaut, ajoutés seulement s'ils sont absents.
// 4. Formules : mode d'héritage du barème du pays explicite (false = la formule impose ses taux), seulement s'il est absent.
import { Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, PLATFORM_MESSAGE_DEFAULTS, SETTINGS_DOCS, type MessageTemplate, type PaymentProvider } from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';

const DRY_RUN = process.argv.includes('--dry-run');
const NEW_KEYS = ['restaurant_payout_paid', 'invoice_available', 'subscription_payment_due', 'subscription_restricted', 'subscription_suspended', 'subscription_restored', 'cash_limit_reached', 'driver_payout_paid'] as const;

async function main(): Promise<void> {
  const by = account('superAdmin').uid;
  const now = Timestamp.now();
  const log = (verb: string, path: string) => console.log(`${verb.padEnd(11)} ${path}`);

  // 1. Messages automatiques financiers.
  for (const key of NEW_KEYS) {
    const def = PLATFORM_MESSAGE_DEFAULTS[key];
    const ref = db.doc(`${COLLECTIONS.messageTemplates}/${def.key}`);
    const existing = await ref.get();
    if (existing.exists) {
      // Gabarit d'origine jamais modifié (corps sans variable de détail) : remplacé par la version détaillée.
      const stored = existing.data() as { body?: { fr?: string }; seed?: boolean } | undefined;
      const marker = key === 'restaurant_payout_paid' ? '{{sales}}' : key === 'invoice_available' ? '{{settlement}}' : null;
      const untouched = stored?.seed === true && marker !== null && !(stored.body?.fr ?? '').includes(marker);
      if (!untouched) {
        log('conservé', ref.path);
        continue;
      }
      log('mise à jour', `${ref.path} (version détaillée)`);
      if (!DRY_RUN) await ref.update({ channels: def.channels, subject: def.subject ? { fr: def.subject } : null, title: { fr: def.title }, body: { fr: def.body }, variables: def.variables, updatedAt: now, updatedBy: by });
      continue;
    }
    const template: MessageTemplate = {
      key: def.key,
      event: def.event,
      audience: def.audience,
      channels: def.channels,
      subject: def.subject ? { fr: def.subject } : null,
      title: { fr: def.title },
      body: { fr: def.body },
      emailHtml: null,
      variables: def.variables,
      active: true,
      brevoTemplateId: null,
      updatedAt: now,
      updatedBy: by,
    };
    log('création', ref.path);
    if (!DRY_RUN) await ref.set({ ...template, seed: true });
  }

  // 2. Prestataires de paiement par pays.
  const providers: Array<[string, Omit<PaymentProvider, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>]> = [
    ['stripe', { code: 'stripe', label: 'Stripe', countryIds: ['FR', 'BE', 'LU'], currencies: ['EUR'], supports: { collect: true, payout: true }, kinds: ['card'], mode: 'api', enabled: true, note: 'Encaissement par carte, Apple Pay et Google Pay ; reversements Stripe Connect.' }],
    ['virement_dz', { code: 'virement_dz', label: 'Virement bancaire — Algérie', countryIds: ['DZ'], currencies: ['DZD'], supports: { collect: false, payout: true }, kinds: ['bank_transfer'], mode: 'manual', enabled: true, note: 'Reversements virés à la main par l’équipe finance (référence bancaire saisie). Prestataire d’encaissement à contractualiser.' }],
    ['virement_ma', { code: 'virement_ma', label: 'Virement bancaire — Maroc', countryIds: ['MA'], currencies: ['MAD'], supports: { collect: false, payout: true }, kinds: ['bank_transfer'], mode: 'manual', enabled: true, note: 'Reversements virés à la main par l’équipe finance (référence bancaire saisie). Prestataire d’encaissement à contractualiser.' }],
    ['virement_tn', { code: 'virement_tn', label: 'Virement bancaire — Tunisie', countryIds: ['TN'], currencies: ['TND'], supports: { collect: false, payout: true }, kinds: ['bank_transfer'], mode: 'manual', enabled: true, note: 'Reversements virés à la main par l’équipe finance (référence bancaire saisie). Prestataire d’encaissement à contractualiser.' }],
  ];
  for (const [id, provider] of providers) {
    const ref = db.doc(`${COLLECTIONS.paymentProviders}/${id}`);
    if ((await ref.get()).exists) {
      log('conservé', ref.path);
    } else {
      log('création', ref.path);
      if (!DRY_RUN) await ref.set({ ...provider, createdAt: now, createdBy: by, updatedAt: now, updatedBy: by, seed: true });
    }
    for (const countryId of provider.countryIds) {
      const countryRef = db.doc(`${COLLECTIONS.countries}/${countryId}`);
      const country = await countryRef.get();
      if (!country.exists) continue;
      const linked = (country.get('paymentProviderIds') as string[] | undefined) ?? [];
      if (linked.includes(id)) continue;
      log('rattachement', `${countryRef.path} → ${id}`);
      if (!DRY_RUN) await countryRef.update({ paymentProviderIds: [...linked, id], updatedAt: now, updatedBy: by });
    }
  }

  // 3. Ciblage des promotions.
  const promoRef = db.doc(`${COLLECTIONS.settings}/${SETTINGS_DOCS.promotions}`);
  const promo = (await promoRef.get()).data() ?? {};
  const patch: Record<string, number> = {};
  if (promo.loyalOrdersThreshold === undefined) patch.loyalOrdersThreshold = 5;
  if (promo.inactiveDaysDefault === undefined) patch.inactiveDaysDefault = 30;
  if (Object.keys(patch).length) {
    log('ajout', `${promoRef.path} ${JSON.stringify(patch)}`);
    if (!DRY_RUN) await promoRef.set({ ...patch, updatedAt: now, updatedBy: by }, { merge: true });
  } else log('conservé', promoRef.path);

  // 4. Formules : héritage du barème du pays explicite.
  for (const code of ['basic', 'pro', 'premium']) {
    const ref = db.doc(`${COLLECTIONS.plans}/${code}`);
    const plan = await ref.get();
    if (!plan.exists || plan.get('commissionInherit') !== undefined) continue;
    log('ajout', `${ref.path} commissionInherit=false`);
    if (!DRY_RUN) await ref.update({ commissionInherit: false });
  }
  console.log(DRY_RUN ? 'Simulation terminée.' : 'Terminé.');
}

void main().then(() => process.exit(0));
