// Données de démonstration complémentaires des rubriques Croissance du super admin :
// messages automatiques manquants, réglages du mini CRM, parrainages commerces et
// livreurs, commissions des commerciaux, prospects du responsable de Metz, annonces.
// Idempotent (identifiants fixes, préfixe « acro- ») : npx tsx scripts/seed/only/a-croissance.ts
import { Timestamp, type DocumentReference } from '@google-cloud/firestore';
import {
  COLLECTIONS,
  SETTINGS_DOCS,
  SUBCOLLECTIONS,
  type Announcement,
  type CrmSettings,
  type MessageTemplate,
  type Prospect,
  type ProspectActivity,
  type Referral,
  type SalesCommission,
} from '@golink/shared';
import { db, PROJECT_ID } from '../../lib/admin.mjs';

const MARK = { seed: true, seedModule: 'a-croissance' };
const SUPER = 'test-super-admin';
const SALES = 'test-sales';
const METZ = 'test-city-metz';
const DAY = 86_400_000;
const now = Date.now();
const at = (offsetDays: number, hour = 10) => {
  const d = new Date(now + offsetDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return Timestamp.fromDate(d);
};

const writes: Array<[DocumentReference, object, boolean]> = [];
const put = (path: string, data: object) => writes.push([db.doc(path), { ...data, ...MARK }, false]);
const merge = (path: string, data: object) => writes.push([db.doc(path), data, true]);

// ------------------------------------------------------------------ Messages automatiques
const TEMPLATES: Array<[string, string, MessageTemplate['audience'], MessageTemplate['channels'], string, string, string[]]> = [
  ['invoice_available', 'Facture disponible', 'restaurant', ['email', 'in_app'], 'Votre facture {{invoiceNumber}} est disponible', 'La facture {{invoiceNumber}} de {{amount}} pour la période {{period}} est disponible dans votre espace Factures.', ['invoiceNumber', 'amount', 'period']],
  ['referral_rewarded', 'Parrainage récompensé', 'client', ['push', 'in_app'], 'Parrainage récompensé', '{{amount}} ont été ajoutés à votre solde GoLink en tant que {{role}}. Merci de faire connaître GoLink !', ['amount', 'role']],
  ['order_ready_pickup', 'Commande prête à retirer', 'client', ['push', 'sms'], 'Votre commande est prête', '{{restaurantName}} a préparé votre commande {{orderNumber}}. Présentez le code {{code}} au comptoir.', ['restaurantName', 'orderNumber', 'code']],
  ['restaurant_inactivity_warning', 'Commerce sans commande depuis 15 jours', 'restaurant', ['email'], 'Votre établissement n’a pas reçu de commande depuis 15 jours', 'Aucune commande n’a été passée chez {{restaurantName}} depuis le {{date}}. Sans activité d’ici 30 jours, l’établissement sera retiré de GoLink. Contactez-nous pour relancer vos ventes.', ['restaurantName', 'date']],
  ['restaurant_auto_paused', 'Pause automatique après commandes manquées', 'restaurant', ['push', 'email', 'in_app'], 'Établissement mis en pause', '{{restaurantName}} a manqué {{count}} commandes d’affilée : l’établissement est en pause. Rouvrez-le depuis votre back-office dès que vous êtes prêt.', ['restaurantName', 'count']],
  ['restaurant_documents_missing', 'Dossier d’inscription incomplet', 'restaurant', ['email'], 'Il manque des pièces à votre dossier', 'Pour valider {{restaurantName}}, merci de déposer : {{documents}}.', ['restaurantName', 'documents']],
];
for (const [key, event, audience, channels, title, body, variables] of TEMPLATES) {
  const tpl: MessageTemplate = {
    key,
    event,
    audience,
    channels,
    subject: channels.includes('email') ? { fr: title } : null,
    title: { fr: title },
    body: { fr: body },
    emailHtml: null,
    variables,
    active: true,
    brevoTemplateId: null,
    updatedAt: at(-3),
    updatedBy: SUPER,
  };
  put(`${COLLECTIONS.messageTemplates}/${key}`, tpl);
}

// ------------------------------------------------------------------ Réglages du mini CRM
const crm: CrmSettings = { signupBonusCents: 15_000, revenueShareBps: 0, revenueShareMonths: 0, defaultFollowUpDays: 3, followUpReminders: true, updatedAt: at(-10), updatedBy: SUPER };
put(`${COLLECTIONS.settings}/${SETTINGS_DOCS.crm}`, crm);

// ------------------------------------------------------------------ Parrainages commerces et livreurs
const referrals: Array<[string, Referral]> = [
  [
    'acro-parrainage-commerce-1',
    { program: 'restaurant', referrerId: 'santo-smash', referrerType: 'restaurant', refereeId: 'le-petit-pho', refereeType: 'restaurant', code: 'SANTO-PRO', status: 'rewarded', qualifyingOrderId: null, referrerRewardCents: 10_000, refereeRewardCents: 0, createdAt: at(-60), qualifiedAt: at(-52), rewardedAt: at(-52) },
  ],
  [
    'acro-parrainage-commerce-2',
    { program: 'restaurant', referrerId: 'mina-kitchen', referrerType: 'restaurant', refereeId: 'maison-pita', refereeType: 'restaurant', code: 'MINA-PRO', status: 'pending', qualifyingOrderId: null, referrerRewardCents: 10_000, refereeRewardCents: 0, createdAt: at(-4), qualifiedAt: null, rewardedAt: null },
  ],
  [
    'acro-parrainage-commerce-3',
    { program: 'restaurant', referrerId: 'onda-pasta-club', referrerType: 'restaurant', refereeId: 'brasserie-des-remparts', refereeType: 'restaurant', code: 'ONDA-PRO', status: 'pending', qualifyingOrderId: null, referrerRewardCents: 10_000, refereeRewardCents: 0, createdAt: at(-2), qualifiedAt: null, rewardedAt: null },
  ],
  [
    'acro-parrainage-livreur-1',
    { program: 'driver', referrerId: 'seed-driver-001', referrerType: 'driver', refereeId: 'seed-driver-004', refereeType: 'driver', code: 'MAXIME-GO', status: 'rewarded', qualifyingOrderId: null, referrerRewardCents: 5000, refereeRewardCents: 0, createdAt: at(-80), qualifiedAt: at(-40), rewardedAt: at(-40) },
  ],
  [
    'acro-parrainage-livreur-2',
    { program: 'driver', referrerId: 'seed-driver-002', referrerType: 'driver', refereeId: 'ops-applicant-03', refereeType: 'driver', code: 'MATEUS-GO', status: 'pending', qualifyingOrderId: null, referrerRewardCents: 5000, refereeRewardCents: 0, createdAt: at(-6), qualifiedAt: null, rewardedAt: null },
  ],
];
for (const [id, r] of referrals) put(`${COLLECTIONS.referrals}/${id}`, r);

// ------------------------------------------------------------------ Prospects : noms des commerciaux, dernière activité
async function enrichExistingProspects() {
  const snap = await db.collection(COLLECTIONS.prospects).get();
  for (const doc of snap.docs) {
    const p = doc.data() as Prospect;
    if (p.ownerName) continue;
    merge(doc.ref.path, { ownerName: p.ownerId === SALES ? 'Julien Mercier' : p.ownerId === METZ ? 'Nadia Schwartz' : 'Claire Vautrin', lastActivityAt: p.updatedAt ?? p.createdAt });
  }
}

// Portefeuille du responsable de Metz (relances échues pour la démonstration).
const METZ_PROSPECTS: Array<[string, string, string, Prospect['stage'], number | null, string]> = [
  ['acro-prospect-1', 'Le Bouchon Messin', 'Bistrot', 'contacted', -2, 'Gérant intéressé, veut comparer avec sa plateforme actuelle.'],
  ['acro-prospect-2', 'Tacos Saint-Louis', 'Tex-mex', 'demo', 0, 'Démo faite, attend la grille de commission.'],
  ['acro-prospect-3', 'Fleurs du Pontiffroy', 'Fleuriste', 'to_contact', 1, 'Commerce non alimentaire, livraison le samedi.'],
  ['acro-prospect-4', 'Pharmacie de la Cathédrale', 'Pharmacie', 'negotiation', 3, 'Veut livrer avec son propre coursier salarié.'],
  ['acro-prospect-5', 'Boulangerie Serpenoise', 'Boulangerie', 'lost', null, 'Pas de volume suffisant le soir.'],
];
METZ_PROSPECTS.forEach(([id, name, cuisine, stage, followDays, note], i) => {
  const created = at(-20 + i * 2);
  const prospect: Prospect = {
    name,
    countryId: 'FR',
    cityId: 'metz',
    address: null,
    cuisine,
    contactName: ['Sébastien Klein', 'Yasmine Haddou', 'Élodie Weber', 'Dr Paul Marchal', 'Luc Hoffmann'][i] ?? null,
    contactEmail: `contact@${id}.test`,
    contactPhone: `+33 3 87 55 ${String(10 + i * 7).padStart(2, '0')} ${String(20 + i).padStart(2, '0')}`,
    source: (['field', 'inbound', 'event', 'referral', 'field'] as const)[i] ?? 'field',
    stage,
    ownerId: METZ,
    ownerName: 'Nadia Schwartz',
    estimatedMonthlyOrders: [220, 480, 60, 150, 90][i] ?? null,
    nextFollowUpAt: followDays === null ? null : at(followDays, 11),
    lostReason: stage === 'lost' ? note : null,
    restaurantId: null,
    signedUpAt: null,
    notes: stage === 'lost' ? null : note,
    lastActivityAt: at(-3 + i),
    createdAt: created,
    createdBy: METZ,
    updatedAt: at(-3 + i),
    updatedBy: METZ,
  };
  put(`${COLLECTIONS.prospects}/${id}`, prospect);
  const acts: ProspectActivity[] = [
    { type: 'note', summary: 'Fiche prospect créée.', fromStage: null, toStage: 'to_contact', by: METZ, at: created },
    ...(stage !== 'to_contact' ? [{ type: 'call' as const, summary: 'Premier appel : présentation de GoLink et des commissions réduites en livraison propre.', fromStage: null, toStage: null, by: METZ, at: at(-15 + i) }] : []),
    ...(stage === 'demo' || stage === 'negotiation' ? [{ type: 'demo' as const, summary: 'Démonstration du back-office sur tablette.', fromStage: 'contacted' as const, toStage: 'demo' as const, by: METZ, at: at(-8 + i) }] : []),
    ...(stage === 'lost' ? [{ type: 'stage_change' as const, summary: `Perdu : ${note}`, fromStage: 'contacted' as const, toStage: 'lost' as const, by: METZ, at: at(-5) }] : []),
  ];
  acts.forEach((a, j) => put(`${COLLECTIONS.prospects}/${id}/${SUBCOLLECTIONS.prospects.activities}/a${j + 1}`, a));
});

// ------------------------------------------------------------------ Commissions
const COMMISSIONS: Array<[string, SalesCommission]> = [
  ['acro-commission-1', { salesRepId: SALES, restaurantId: 'le-petit-pho', prospectId: null, basis: 'signup_bonus', amountCents: 15_000, period: '2026-07', status: 'paid', createdAt: at(-70), paidAt: at(-40) }],
  ['acro-commission-2', { salesRepId: SALES, restaurantId: 'santo-smash', prospectId: null, basis: 'signup_bonus', amountCents: 15_000, period: '2026-08', status: 'approved', createdAt: at(-30), paidAt: null }],
  ['acro-commission-3', { salesRepId: METZ, restaurantId: 'onda-pasta-club', prospectId: null, basis: 'signup_bonus', amountCents: 15_000, period: '2026-08', status: 'paid', createdAt: at(-45), paidAt: at(-15) }],
];
for (const [id, c] of COMMISSIONS) put(`${COLLECTIONS.salesCommissions}/${id}`, c);

// ------------------------------------------------------------------ Annonces
const ANNOUNCEMENTS: Array<[string, Announcement]> = [
  [
    'acro-annonce-conditions',
    {
      audience: 'restaurants', countryIds: ['FR'], cityIds: null, planCodes: null,
      title: 'Nouvelles conditions partenaires au 1er novembre',
      body: 'Les frais de paiement par carte apparaissent désormais sur une ligne dédiée de votre relevé. Consultez le détail dans votre espace Abonnement.',
      severity: 'important', link: '/abonnement', publishedAt: at(-1, 9), expiresAt: at(35), active: true, requiresAcknowledgement: true,
      createdAt: at(-1, 9), createdBy: SUPER, updatedAt: at(-1, 9), updatedBy: SUPER,
    },
  ],
  [
    'acro-annonce-programmee',
    {
      audience: 'restaurants', countryIds: null, cityIds: ['metz'], planCodes: ['pro', 'premium'],
      title: 'Atelier photo gratuit à Metz',
      body: 'Un photographe GoLink passe le 14 octobre pour mettre en valeur vos plats. Inscrivez-vous auprès de votre responsable de ville.',
      severity: 'info', link: null, publishedAt: at(4, 9), expiresAt: at(20), active: true, requiresAcknowledgement: false,
      createdAt: at(0, 9), createdBy: METZ, updatedAt: at(0, 9), updatedBy: METZ,
    },
  ],
];
for (const [id, a] of ANNOUNCEMENTS) put(`${COLLECTIONS.announcements}/${id}`, a);

async function main() {
  await enrichExistingProspects();
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const [ref, data, isMerge] of writes.slice(i, i + 400)) batch.set(ref, data, isMerge ? { merge: true } : {});
    await batch.commit();
  }
  console.log(`a-croissance : ${writes.length} documents écrits dans ${PROJECT_ID}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
