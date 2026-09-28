// Import en masse de commerces (arrivée d'une chaîne, reprise d'un fichier) :
// chaque ligne crée la fiche, le compte du propriétaire, ses accès et ses réglages.
// `dryRun` produit le rapport ligne par ligne sans rien écrire. La création d'un
// commerce à l'unité par l'équipe passe par la même fonction (une seule ligne).
import {
  COLLECTIONS,
  MERCHANT_TYPES,
  RESTAURANT_PRIVATE_DOCS,
  RESTAURANT_SETTINGS_DOCS,
  SUBCOLLECTIONS,
  normalizeText,
  type BulkJob,
  type City,
  type RestaurantHours,
  type RestaurantImportReport,
  type Zone,
} from '@golink/shared';
import { buildUserProfile, ensureUserProfile, getOrCreateAuthUser } from '../../lib/accounts';
import { auth, db, Timestamp } from '../../lib/admin';
import { writeAudit } from '../../lib/audit';
import { fail } from '../../lib/errors';
import { sendEmail } from '../../lib/brevo';
import { syncClaims } from '../../lib/claims';
import { APP_URLS } from '../../lib/config';
import { loadLimitsSettings } from '../../lib/limits';
import { requireAdmin } from '../../lib/permissions';
import { currencyOfCountry } from '../../lib/currency';
import {
  defaultWeeklyHours,
  loadMerchantDefaults,
  newCommercialDoc,
  newLegalDoc,
  newOrderSettings,
  newRestaurantDoc,
  ownerMemberDoc,
  zonesContaining,
} from '../../lib/restaurants';
import { EMAIL_SECRETS } from '../../lib/secrets';
import { z, zPhone, zReason } from '../../lib/validation';
import { ACTEURS_HEAVY_RUNTIME, acteursCallable, adminActor, isReservedAddress } from './common';
import { ownerAccessEmail } from './emails';

/** Plafond technique absolu (protection du payload) ; la limite réelle est `LimitsSettings.exports.importMaxRows` (paramètre modifiable, voir loadLimitsSettings). */
const HARD_MAX_ROWS = 2000;

const rowSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court').max(80),
  merchantType: z.enum(MERCHANT_TYPES).nullish(),
  cityId: z.string().trim().min(2, 'Ville manquante').max(60),
  line1: z.string().trim().min(3, 'Adresse manquante').max(120),
  postalCode: z.string().trim().regex(/^(L-)?\d{4,5}$/, 'Code postal invalide'),
  city: z.string().trim().min(2).max(80),
  phone: zPhone,
  email: z.string().trim().toLowerCase().pipe(z.email('E-mail du commerce invalide')),
  ownerFirstName: z.string().trim().min(1, 'Prénom du gérant manquant').max(60),
  ownerLastName: z.string().trim().min(1, 'Nom du gérant manquant').max(60),
  ownerEmail: z.string().trim().toLowerCase().pipe(z.email('E-mail du gérant invalide')),
  legalName: z.string().trim().max(120).nullish(),
  siret: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ''))
    .pipe(z.string().regex(/^(\d{14}|[A-Z]?\d{5,9})$/, 'SIRET ou RCS invalide'))
    .nullish(),
  planCode: z.enum(['basic', 'pro', 'premium']).nullish(),
  cuisineIds: z.array(z.string().trim().min(1).max(60)).max(5).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  groupId: z.string().trim().max(128).nullish(),
});

const schema = z.object({
  rows: z.array(z.unknown()).min(1).max(HARD_MAX_ROWS),
  dryRun: z.boolean().default(true),
  /** Envoi du lien d'accès aux propriétaires créés. */
  inviteOwners: z.boolean().default(true),
  /** Commerces créés comme données de test (nettoyables, e-mails simulés). */
  test: z.boolean().default(false),
  /** Motif de l'import : obligatoire pour une création réelle. */
  reason: zReason.nullish(),
});

type Row = z.output<typeof rowSchema>;

export const importRestaurants = acteursCallable(
  schema,
  async (data, request): Promise<RestaurantImportReport> => {
    const { caller, admin } = await requireAdmin(request, data.rows.length > 1 ? 'restaurants.import' : 'restaurants.edit');
    if (!data.dryRun && !data.reason) throw fail.invalid('Indiquez le motif de la création (import) des commerces.');
    const importMaxRows = (await loadLimitsSettings()).exports.importMaxRows;
    if (data.rows.length > importMaxRows) throw fail.invalid(`Un import est limité à ${importMaxRows} lignes à la fois.`);
    const report: RestaurantImportReport = { dryRun: data.dryRun, jobId: null, created: 0, skipped: 0, errors: [], warnings: [], restaurantIds: [] };

    // Référentiels : villes, zones, restaurants existants (doublons), groupes.
    const [citiesSnap, existingSnap] = await Promise.all([
      db.collection(COLLECTIONS.cities).get(),
      db.collection(COLLECTIONS.restaurants).select('name', 'address.postalCode', 'cityId').get(),
    ]);
    const cities = new Map(citiesSnap.docs.map((d) => [d.id, { ...(d.data() as City), id: d.id }]));
    const existing = new Set(existingSnap.docs.map((d) => `${normalizeText(String(d.get('name') ?? ''))}|${d.get('address.postalCode') ?? ''}`));
    const zonesByCity = new Map<string, Array<Zone & { id: string }>>();
    const seen = new Set<string>();
    const valid: Array<{ line: number; row: Row; city: City & { id: string } }> = [];

    data.rows.forEach((raw, index) => {
      const line = index + 2;
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        report.errors.push({ row: line, message: issue ? `${issue.path.join('.') || 'ligne'} : ${issue.message}` : 'Ligne invalide' });
        return;
      }
      const row = parsed.data;
      const city = cities.get(row.cityId) ?? [...cities.values()].find((c) => normalizeText(c.name) === normalizeText(row.cityId));
      if (!city) return void report.errors.push({ row: line, message: `Ville inconnue : ${row.cityId}` });
      if (admin.role !== 'super_admin' && admin.cityIds.length > 0 && !admin.cityIds.includes(city.id)) {
        return void report.errors.push({ row: line, message: `${city.name} est hors de votre périmètre` });
      }
      if (!city.active) report.warnings.push({ row: line, message: `${city.name} n’est pas encore lancée : le commerce restera en attente` });
      const key = `${normalizeText(row.name)}|${row.postalCode}`;
      if (existing.has(key)) {
        report.skipped += 1;
        return void report.warnings.push({ row: line, message: `${row.name} existe déjà (${row.postalCode}) : ligne ignorée` });
      }
      if (seen.has(key)) return void report.errors.push({ row: line, message: 'Commerce en double dans le fichier' });
      seen.add(key);
      if (row.lat == null || row.lng == null) report.warnings.push({ row: line, message: 'Sans coordonnées : zones de livraison à rattacher à la main' });
      if (!row.siret) report.warnings.push({ row: line, message: 'SIRET absent : à compléter avant validation' });
      valid.push({ line, row, city });
    });

    if (data.dryRun || valid.length === 0) return report;

    const now = Timestamp.now();
    const jobRef = db.collection(COLLECTIONS.bulkJobs).doc();
    const job: BulkJob = {
      type: 'import_restaurants',
      entity: 'restaurants',
      params: { rows: data.rows.length, inviteOwners: data.inviteOwners },
      input: null,
      format: null,
      status: 'running',
      total: valid.length,
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      output: null,
      reason: null,
      startedAt: now,
      finishedAt: null,
      createdAt: now,
      createdBy: caller.uid,
      updatedAt: now,
      updatedBy: caller.uid,
    };
    await jobRef.set(job);
    report.jobId = jobRef.id;

    // Valeurs initiales des réglages de commande (H3) et devise : une lecture par ville/pays distincte du lot.
    const merchantDefaultsByCity = new Map<string, Awaited<ReturnType<typeof loadMerchantDefaults>>>();
    const currencyByCountry = new Map<string, Awaited<ReturnType<typeof currencyOfCountry>>>();

    for (const { line, row, city } of valid) {
      try {
        const displayName = `${row.ownerFirstName} ${row.ownerLastName}`;
        const { user, created } = await getOrCreateAuthUser({ email: row.ownerEmail, displayName });
        const uid = user.uid;
        if (!merchantDefaultsByCity.has(city.id)) merchantDefaultsByCity.set(city.id, await loadMerchantDefaults(city.countryId, city.id));
        const merchantDefaults = merchantDefaultsByCity.get(city.id)!;
        if (!currencyByCountry.has(city.countryId)) currencyByCountry.set(city.countryId, await currencyOfCountry(city.countryId));
        const currency = currencyByCountry.get(city.countryId)!;
        if (!zonesByCity.has(city.id)) {
          const zs = await db.collection(COLLECTIONS.zones).where('cityId', '==', city.id).get();
          zonesByCity.set(city.id, zs.docs.map((d) => ({ ...(d.data() as Zone), id: d.id })));
        }
        const location = row.lat != null && row.lng != null ? { lat: row.lat, lng: row.lng } : null;
        const address = { line1: row.line1, line2: null, postalCode: row.postalCode, city: row.city, countryCode: city.countryId, placeId: null };
        const ref = db.collection(COLLECTIONS.restaurants).doc();
        const restaurant = newRestaurantDoc({
          name: row.name,
          ownerId: uid,
          countryId: city.countryId,
          cityId: city.id,
          timezone: city.timezone,
          address,
          location,
          zoneIds: zonesContaining(location, zonesByCity.get(city.id) ?? []),
          phone: row.phone,
          email: row.email,
          cuisineIds: row.cuisineIds ?? [],
          createdBy: caller.uid,
          merchantDefaults,
          currency,
          // Compte créé avec un mot de passe provisoire inconnu : le lien ci-dessous est envoyé aussitôt.
          ownerCredentialsDelivered: data.inviteOwners && !data.test && !isReservedAddress(row.ownerEmail),
        });
        const legal = newLegalDoc({
          legalName: row.legalName || row.name,
          siret: row.siret ?? '',
          address,
          managerName: displayName,
          managerEmail: row.ownerEmail,
          managerPhone: row.phone,
          termsVersion: '',
        });
        const hours: RestaurantHours = { ...defaultWeeklyHours(city.timezone), updatedAt: now, updatedBy: caller.uid };
        const marker = data.test ? { test: true } : {};
        const batch = db.batch();
        batch.set(ref, {
          ...restaurant,
          merchantType: row.merchantType ?? 'restaurant',
          planCode: row.planCode ?? 'basic',
          groupId: row.groupId ?? null,
          onboardingStatus: 'documents_missing',
          importedBy: caller.uid,
          importJobId: jobRef.id,
          ...marker,
        });
        batch.set(ref.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.commercial), { ...newCommercialDoc(caller.uid), planCode: row.planCode ?? 'basic', ...marker });
        // Contrat non signé : le propriétaire l'accepte à sa première connexion.
        batch.set(ref.collection(SUBCOLLECTIONS.restaurants.private).doc(RESTAURANT_PRIVATE_DOCS.legal), {
          ...legal,
          partnerTermsVersion: null,
          partnerTermsAcceptedAt: null,
          ...marker,
        });
        batch.set(ref.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.orders), { ...newOrderSettings(caller.uid, merchantDefaults), ...marker });
        batch.set(ref.collection(SUBCOLLECTIONS.restaurants.settings).doc(RESTAURANT_SETTINGS_DOCS.hours), { ...hours, ...marker });
        batch.set(ref.collection(SUBCOLLECTIONS.restaurants.members).doc(uid), {
          ...ownerMemberDoc({ uid, restaurantId: ref.id, displayName, email: row.ownerEmail }),
          invitedBy: caller.uid,
          joinedAt: null,
          lastAccessAt: null,
          ...marker,
        });
        await batch.commit();
        await ensureUserProfile(
          uid,
          buildUserProfile({
            role: 'restaurant',
            firstName: row.ownerFirstName,
            lastName: row.ownerLastName,
            email: row.ownerEmail,
            emailVerified: false,
            phone: row.phone,
            countryId: city.countryId,
            cityId: city.id,
          }),
        );
        if (data.test) await db.collection(COLLECTIONS.users).doc(uid).set({ test: true }, { merge: true });
        await syncClaims(uid);
        if (data.inviteOwners && !data.test && !isReservedAddress(row.ownerEmail)) {
          let link = `${APP_URLS.restaurant}/connexion`;
          if (created) {
            const action = await auth.generatePasswordResetLink(row.ownerEmail);
            const oobCode = new URL(action).searchParams.get('oobCode');
            if (oobCode) link = `${APP_URLS.restaurant}/definir-mot-de-passe?oobCode=${encodeURIComponent(oobCode)}`;
          }
          await sendEmail({
            to: { email: row.ownerEmail, name: displayName },
            message: ownerAccessEmail({ restaurantName: row.name, firstName: row.ownerFirstName, link }),
            recipientType: 'restaurant',
            recipientId: ref.id,
            templateKey: 'restaurant_imported_access',
          });
        }
        report.created += 1;
        report.restaurantIds.push(ref.id);
      } catch (error) {
        report.errors.push({ row: line, message: error instanceof Error ? error.message : 'Création impossible' });
      }
    }

    await jobRef.update({
      status: report.created === 0 ? 'failed' : 'completed',
      processed: valid.length,
      succeeded: report.created,
      failed: valid.length - report.created,
      errors: report.errors.slice(0, 100).map((e) => ({ row: e.row, id: null, message: e.message })),
      finishedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    await writeAudit({
      actor: adminActor(caller),
      action: valid.length > 1 ? 'restaurants.imported' : 'restaurant.created',
      target:
        report.restaurantIds.length === 1
          ? { type: 'restaurant', id: report.restaurantIds[0]!, label: valid[0]?.row.name ?? null }
          : { type: 'other', id: jobRef.id, label: `Import de ${report.created} commerces` },
      reason: data.reason,
      after: { created: report.created, skipped: report.skipped, errors: report.errors.length, restaurantIds: report.restaurantIds.slice(0, 50) },
      request,
    });
    return report;
  },
  { ...ACTEURS_HEAVY_RUNTIME, secrets: EMAIL_SECRETS },
);
