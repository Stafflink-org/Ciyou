// Données de base des automatismes décidés par le client (exécution seule, idempotente) :
//   npx tsx scripts/seed/only/cdc-fix-b.ts            (écrit)
//   npx tsx scripts/seed/only/cdc-fix-b.ts --dry-run  (affiche sans écrire)
//
// 1. Messages automatiques : crée les gabarits qui manquent (valeurs par défaut du socle) ;
//    un gabarit déjà présent (donc éventuellement modifié par le super admin) n'est jamais écrasé.
// 2. settings/merchantValidation : règle de validation automatique des commerces (décision n° 14).
// 3. settings/notificationDelivery : envoi des messages en simulation (dry-run) tant que le super
//    admin ne l'active pas.
// 4. settings/orderRules : nouveaux paramètres (clôture automatique client absent, retard toléré,
//    contrôles des réclamations), ajoutés seulement s'ils sont absents.
import { Timestamp } from '@google-cloud/firestore';
import {
  COLLECTIONS,
  DEFAULT_MERCHANT_VALIDATION,
  DEFAULT_NOTIFICATION_DELIVERY,
  DEFAULT_ORDER_RULES,
  PLATFORM_MESSAGE_DEFAULTS,
  SETTINGS_DOCS,
  type MessageTemplate,
} from '@golink/shared';
import { db } from '../../lib/admin.mjs';
import { account } from '../accounts';

const DRY_RUN = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const by = account('superAdmin').uid;
  const now = Timestamp.now();
  const log = (verb: string, path: string) => console.log(`${verb.padEnd(11)} ${path}`);

  // 1. Messages automatiques manquants.
  for (const def of Object.values(PLATFORM_MESSAGE_DEFAULTS)) {
    const ref = db.doc(`${COLLECTIONS.messageTemplates}/${def.key}`);
    if ((await ref.get()).exists) {
      log('conservé', ref.path);
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

  // Gabarit d'inactivité d'origine : texte figé (« d'ici 30 jours ») remplacé par des variables, seulement s'il n'a jamais été modifié.
  const inactivityRef = db.doc(`${COLLECTIONS.messageTemplates}/restaurant_inactivity_warning`);
  const inactivity = (await inactivityRef.get()).data();
  if (inactivity && String(inactivity.body?.fr ?? '').includes('Sans activité d’ici 30 jours')) {
    const def = PLATFORM_MESSAGE_DEFAULTS.restaurant_inactivity_warning;
    log('mise à jour', `${inactivityRef.path} (variables jours et date de retrait)`);
    if (!DRY_RUN) await inactivityRef.update({ subject: { fr: def.subject }, title: { fr: def.title }, body: { fr: def.body }, variables: def.variables, updatedAt: now, updatedBy: by });
  }

  // 2 et 3. Réglages créés seulement s'ils n'existent pas.
  const settings: Array<[string, object]> = [
    [SETTINGS_DOCS.merchantValidation, DEFAULT_MERCHANT_VALIDATION],
    [SETTINGS_DOCS.notificationDelivery, DEFAULT_NOTIFICATION_DELIVERY],
  ];
  for (const [id, data] of settings) {
    const ref = db.doc(`${COLLECTIONS.settings}/${id}`);
    if ((await ref.get()).exists) {
      log('conservé', ref.path);
      continue;
    }
    log('création', ref.path);
    if (!DRY_RUN) await ref.set({ ...data, updatedAt: now, updatedBy: by, seed: true });
  }

  // 4. Nouveaux paramètres des règles de commande (uniquement s'ils sont absents).
  const rulesRef = db.doc(`${COLLECTIONS.settings}/${SETTINGS_DOCS.orderRules}`);
  const rules = (await rulesRef.get()).data() ?? {};
  const patch: Record<string, unknown> = {};
  if (rules.customerAbsent && rules.customerAbsent.autoCloseGraceMinutes === undefined) patch['customerAbsent.autoCloseGraceMinutes'] = DEFAULT_ORDER_RULES.customerAbsent.autoCloseGraceMinutes;
  if (rules.lateToleranceMinutes === undefined) patch.lateToleranceMinutes = DEFAULT_ORDER_RULES.lateToleranceMinutes;
  if (rules.claims === undefined) patch.claims = DEFAULT_ORDER_RULES.claims;
  if (Object.keys(patch).length === 0) log('conservé', rulesRef.path);
  else {
    log('mise à jour', `${rulesRef.path} (${Object.keys(patch).join(', ')})`);
    if (!DRY_RUN) await rulesRef.update({ ...patch, updatedAt: now, updatedBy: by });
  }
  console.log(DRY_RUN ? '\nSimulation : rien n’a été écrit.' : '\nTerminé.');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
