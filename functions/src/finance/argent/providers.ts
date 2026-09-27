// Prestataires de paiement par pays (Stripe, prestataires locaux Algérie / Maroc / Tunisie),
// comptes de paiement des commerces et des livreurs, et reversement manuel là où Stripe n'existe pas.
import {
  COLLECTIONS,
  CURRENCY_CODES,
  RESTAURANT_PRIVATE_DOCS,
  SUBCOLLECTIONS,
  type Driver,
  type Payout,
  type PayoutAccount,
  type PaymentProvider,
  type Restaurant,
} from '@golink/shared';
import { db, FieldValue, Timestamp } from '../../lib/admin';
import { actorFromCaller, writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { assertAdminCovers, requireAdmin, requireAuth, requireRestaurantAccess } from '../../lib/permissions';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zId, zReason } from '../../lib/validation';
import { loadCountry } from './common';
import { finalizePaid } from './payouts';
import { argentCallable } from './runtime';

// ------------------------------------------------------------------ Prestataires

const providerSchema = z.object({
  providerId: zId.nullish(),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{2,30}$/, 'Code : lettres minuscules, chiffres et _'),
  label: z.string().trim().min(2).max(60),
  countryIds: z.array(z.string().length(2)).min(1).max(10),
  currencies: z.array(z.enum(CURRENCY_CODES)).min(1),
  supports: z.object({ collect: z.boolean(), payout: z.boolean() }),
  kinds: z.array(z.enum(['card', 'bank_transfer', 'mobile_wallet', 'cash'])).min(1),
  mode: z.enum(['api', 'manual']),
  enabled: z.boolean(),
  note: z.string().trim().max(300).nullish(),
  reason: zReason,
});

/** Crée ou modifie un prestataire de paiement (Stripe ou local) et les pays qu'il dessert. */
export const savePaymentProvider = argentCallable(providerSchema, async (data, request) => {
  const { caller } = await requireAdmin(request, 'payments.configure');
  const { reason, providerId, ...values } = data;
  const ref = providerId ? db.collection(COLLECTIONS.paymentProviders).doc(providerId) : db.collection(COLLECTIONS.paymentProviders).doc(values.code);
  const snap = await ref.get();
  if (!providerId && snap.exists) throw fail.alreadyExists('Un prestataire porte déjà ce code.');
  if (providerId && !snap.exists) throw fail.notFound('Prestataire');
  const before = snap.exists ? (snap.data() as PaymentProvider) : null;
  const now = Timestamp.now();
  await ref.set({ ...values, note: values.note ?? null, updatedAt: now, updatedBy: caller.uid, ...(before ? {} : { createdAt: now, createdBy: caller.uid }) }, { merge: true });
  await db.collection(COLLECTIONS.settingsHistory).add({ docPath: `${COLLECTIONS.paymentProviders}/${ref.id}`, changedFields: Object.keys(values), before: before ?? {}, after: values, reason, changedBy: caller.uid, changedAt: FieldValue.serverTimestamp() });
  await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: before ? 'payment_provider.updated' : 'payment_provider.created', target: { type: 'setting', id: `${COLLECTIONS.paymentProviders}/${ref.id}`, label: values.label }, reason, before: before ? { enabled: before.enabled, countryIds: before.countryIds } : null, after: { enabled: values.enabled, countryIds: values.countryIds, mode: values.mode }, request, sensitive: true });
  return { providerId: ref.id };
});

/** Prestataires proposés dans un pays (encaissement et reversement). */
export const setCountryProviders = argentCallable(
  z.object({ countryId: z.string().length(2), providerIds: z.array(zId).max(10), reason: zReason }),
  async (data, request) => {
    const { caller } = await requireAdmin(request, 'payments.configure');
    const countryRef = db.collection(COLLECTIONS.countries).doc(data.countryId);
    const country = await countryRef.get();
    if (!country.exists) throw fail.notFound('Pays');
    const currency = country.get('currency') as string;
    for (const id of data.providerIds) {
      const p = await db.collection(COLLECTIONS.paymentProviders).doc(id).get();
      if (!p.exists) throw fail.notFound('Prestataire');
      const provider = p.data() as PaymentProvider;
      if (!provider.countryIds.includes(data.countryId)) throw fail.invalid(`« ${provider.label} » ne dessert pas ce pays.`);
      if (!provider.currencies.includes(currency as PaymentProvider['currencies'][number])) throw fail.invalid(`« ${provider.label} » ne gère pas la devise ${currency}.`);
    }
    const before = (country.get('paymentProviderIds') as string[] | undefined) ?? [];
    await countryRef.update({ paymentProviderIds: data.providerIds, updatedAt: Timestamp.now(), updatedBy: caller.uid });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: 'country.providers_updated', target: { type: 'country', id: data.countryId, label: String(country.get('name') ?? data.countryId) }, reason: data.reason, before: { paymentProviderIds: before }, after: { paymentProviderIds: data.providerIds }, countryId: data.countryId, request, sensitive: true });
    return { countryId: data.countryId };
  },
);

// ------------------------------------------------------------------ Comptes de paiement

const accountSchema = z.object({
  provider: z.enum(['bank_transfer', 'mobile_wallet']),
  paymentProviderId: zId.nullish(),
  holderName: z.string().trim().min(2).max(80),
  /** Numéro complet saisi par le partenaire : seul un extrait masqué est conservé. */
  accountNumber: z.string().trim().min(6).max(40),
});

const mask = (value: string): string => {
  const compact = value.replace(/\s+/g, '');
  return `${compact.slice(0, 4)} •••• ${compact.slice(-4)}`;
};

async function storeAccount(refPath: { restaurantId?: string; driverId?: string }, data: z.output<typeof accountSchema>, countryId: string, byUid: string): Promise<PayoutAccount> {
  const country = await loadCountry(countryId);
  if (!country || country.stripeAvailable !== false) throw fail.precondition('Ce pays utilise Stripe : ouvrez votre compte Stripe Connect plutôt qu’un compte local.');
  if (data.paymentProviderId) {
    const p = await db.collection(COLLECTIONS.paymentProviders).doc(data.paymentProviderId).get();
    const provider = p.data() as PaymentProvider | undefined;
    if (!provider?.enabled || !provider.supports.payout || !provider.countryIds.includes(countryId)) throw fail.invalid('Ce prestataire ne verse pas de fonds dans ce pays.');
  }
  const account: PayoutAccount = { provider: data.provider, paymentProviderId: data.paymentProviderId ?? null, holderName: data.holderName, accountMasked: mask(data.accountNumber), currency: country.currency, verified: false, verifiedAt: null, verifiedBy: null, updatedAt: Timestamp.now() };
  if (refPath.restaurantId) {
    await db.collection(COLLECTIONS.restaurants).doc(refPath.restaurantId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).set({ payoutAccount: account, updatedAt: Timestamp.now(), updatedBy: byUid }, { merge: true });
  } else if (refPath.driverId) {
    await db.collection(COLLECTIONS.driverPrivate).doc(refPath.driverId).set({ payoutAccount: account, updatedAt: Timestamp.now() }, { merge: true });
  }
  return account;
}

/** Compte de paiement local du commerce (pays sans Stripe). Vérifié ensuite par l'équipe finance. */
export const setRestaurantPayoutAccount = argentCallable(z.object({ restaurantId: zId, account: accountSchema }), async (data, request) => {
  const actor = await requireRestaurantAccess(request, data.restaurantId, 'settings.manage', 'restaurants.commercial');
  const restaurant = (await db.collection(COLLECTIONS.restaurants).doc(data.restaurantId).get()).data() as Restaurant | undefined;
  if (!restaurant) throw fail.notFound('Commerce');
  const account = await storeAccount({ restaurantId: data.restaurantId }, data.account, restaurant.countryId, actor.caller.uid);
  await writeAudit({ actor: actorFromCaller(actor.caller, actor.kind === 'admin' ? 'admin' : 'restaurant'), action: 'restaurant.payout_account_set', target: { type: 'restaurant', id: data.restaurantId, label: restaurant.name }, after: { provider: account.provider, accountMasked: account.accountMasked }, countryId: restaurant.countryId, cityId: restaurant.cityId, request, sensitive: true });
  return { accountMasked: account.accountMasked, verified: false };
});

/** Compte de paiement local du livreur indépendant (pays sans Stripe). */
export const setDriverPayoutAccount = argentCallable(z.object({ account: accountSchema }), async (data, request) => {
  const caller = requireAuth(request);
  const driver = (await db.collection(COLLECTIONS.drivers).doc(caller.uid).get()).data() as Driver | undefined;
  if (!driver) throw fail.notFound('Livreur');
  if (driver.type !== 'platform') throw fail.precondition('Les livreurs salariés d’un commerce sont payés par leur employeur.');
  const account = await storeAccount({ driverId: caller.uid }, data.account, driver.countryId, caller.uid);
  await writeAudit({ actor: actorFromCaller(caller, 'driver'), action: 'driver.payout_account_set', target: { type: 'driver', id: caller.uid, label: driver.displayName }, after: { provider: account.provider, accountMasked: account.accountMasked }, countryId: driver.countryId, cityId: driver.cityId, sensitive: true });
  return { accountMasked: account.accountMasked, verified: false };
});

/** Vérification d'un compte de paiement local par l'équipe finance (avant le premier virement). */
export const verifyPayoutAccount = argentCallable(
  z.object({ beneficiaryType: z.enum(['restaurant', 'driver']), beneficiaryId: zId, verified: z.boolean(), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.payouts');
    const isRestaurant = data.beneficiaryType === 'restaurant';
    const ref = isRestaurant
      ? db.collection(COLLECTIONS.restaurants).doc(data.beneficiaryId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial)
      : db.collection(COLLECTIONS.driverPrivate).doc(data.beneficiaryId);
    const [snap, entity] = await Promise.all([ref.get(), db.collection(isRestaurant ? COLLECTIONS.restaurants : COLLECTIONS.drivers).doc(data.beneficiaryId).get()]);
    const account = snap.get('payoutAccount') as PayoutAccount | undefined;
    if (!account) throw fail.precondition('Aucun compte de paiement local enregistré.');
    assertAdminCovers(admin, (entity.get('cityId') as string | undefined) ?? null);
    const now = Timestamp.now();
    await ref.set({ payoutAccount: { ...account, verified: data.verified, verifiedAt: data.verified ? now : null, verifiedBy: data.verified ? caller.uid : null } }, { merge: true });
    await writeAudit({ actor: actorFromCaller(caller, 'admin'), action: data.verified ? 'payout_account.verified' : 'payout_account.unverified', target: { type: isRestaurant ? 'restaurant' : 'driver', id: data.beneficiaryId, label: String(entity.get(isRestaurant ? 'name' : 'displayName') ?? data.beneficiaryId) }, reason: data.reason, after: { accountMasked: account.accountMasked, verified: data.verified }, countryId: (entity.get('countryId') as string | undefined) ?? null, cityId: (entity.get('cityId') as string | undefined) ?? null, request, sensitive: true });
    return { verified: data.verified };
  },
);

// ------------------------------------------------------------------ Reversement manuel

/**
 * Reversement d'un pays sans Stripe : l'équipe finance vire depuis la banque, puis enregistre
 * la référence du virement. Le compte du bénéficiaire doit avoir été vérifié.
 */
export const markPayoutPaidManually = argentCallable(
  z.object({ payoutId: zId, reference: z.string().trim().min(4).max(60), reason: zReason }),
  async (data, request) => {
    const { caller, admin } = await requireAdmin(request, 'finance.payouts');
    const ref = db.collection(COLLECTIONS.payouts).doc(data.payoutId);
    const snap = await ref.get();
    if (!snap.exists) throw fail.notFound('Reversement');
    const payout = snap.data() as Payout;
    assertAdminCovers(admin, payout.cityId ?? null);
    const country = await loadCountry(payout.countryId);
    if ((payout.provider ?? (country?.stripeAvailable === false ? 'manual' : 'stripe')) !== 'manual') throw fail.precondition('Ce reversement se vire par Stripe : utilisez « Verser » (le virement manuel est réservé aux pays sans Stripe).');
    if (!['scheduled', 'failed'].includes(payout.status)) throw fail.precondition(payout.status === 'on_hold' ? 'Ce reversement est bloqué : levez le blocage avant de le virer.' : 'Ce reversement n’est plus à virer.');
    if (payout.netCents <= 0) throw fail.precondition('Montant net nul ou négatif : rien à virer.');
    const accountSnap = payout.beneficiaryType === 'restaurant'
      ? await db.collection(COLLECTIONS.restaurants).doc(payout.beneficiaryId).collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial).get()
      : await db.collection(COLLECTIONS.driverPrivate).doc(payout.beneficiaryId).get();
    const account = accountSnap.get('payoutAccount') as PayoutAccount | undefined;
    if (!account?.verified) throw fail.precondition('Le compte de paiement du bénéficiaire n’est pas vérifié : enregistrez et vérifiez ses coordonnées avant de virer.');
    await ref.update({ status: 'processing', updatedAt: Timestamp.now() });
    try {
      await finalizePaid(data.payoutId, payout, actorFromCaller(caller, 'admin'), { transferId: null, manualReference: data.reference, live: false }, request);
    } catch (error) {
      await ref.update({ status: payout.status, updatedAt: Timestamp.now() });
      throw error;
    }
    return { status: 'paid' as const, reference: data.reference };
  },
  { secrets: [...EMAIL_SECRETS] },
);
