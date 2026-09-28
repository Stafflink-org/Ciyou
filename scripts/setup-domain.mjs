/**
 * Prépare le projet Firebase/Google Cloud pour un nouveau domaine du super
 * admin (ou du back-office restaurant) : domaine autorisé pour Firebase Auth
 * + référent HTTP autorisé pour la clé Google Maps. Idempotent (ne duplique
 * rien si déjà présent).
 *
 * Usage :
 *   node scripts/setup-domain.mjs admin.exemple.com            (dry-run, par défaut)
 *   node scripts/setup-domain.mjs admin.exemple.com --apply    (applique réellement)
 */
import { gcp, PROJECT_ID } from './gcp-token.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const domain = args.find((a) => !a.startsWith('--'));

if (!domain) {
  console.error('Usage : node scripts/setup-domain.mjs <domaine> [--apply]');
  console.error('Exemple : node scripts/setup-domain.mjs admin.golink.fr');
  process.exit(1);
}
if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) {
  console.error(`Domaine invalide : "${domain}" (attendu : nom d'hôte seul, sans protocole ni chemin, ex. admin.golink.fr)`);
  process.exit(1);
}

const MAPS_KEY_DISPLAY_NAME = 'Ciyou Eats Web Maps';

console.log(`Domaine ciblé : ${domain}`);
console.log(apply ? 'Mode : --apply (modifications réelles)' : 'Mode : --dry-run (aucune modification, ajouter --apply pour appliquer)');
console.log('');

// ------------------------------------------------------------------ 1) Firebase Auth : domaines autorisés
async function setupAuthorizedDomains() {
  const base = `https://identitytoolkit.googleapis.com/v2/projects/${PROJECT_ID}`;
  const current = await gcp(`${base}/config`);
  if (current.status !== 200) {
    console.error('Échec lecture config Auth :', JSON.stringify(current.data).slice(0, 300));
    return;
  }
  const authorizedDomains = current.data.authorizedDomains ?? [];
  console.log('Domaines Auth autorisés actuels :', authorizedDomains.join(', '));
  if (authorizedDomains.includes(domain)) {
    console.log(`✓ "${domain}" est déjà dans les domaines autorisés Firebase Auth (rien à faire).`);
    return;
  }
  const next = [...authorizedDomains, domain];
  console.log(`→ Ajout de "${domain}" aux domaines autorisés Firebase Auth.`);
  if (!apply) {
    console.log('  (dry-run) PATCH config?updateMask=authorizedDomains avec :', JSON.stringify(next));
    return;
  }
  const res = await gcp(`${base}/config?updateMask=authorizedDomains`, {
    method: 'PATCH',
    body: { authorizedDomains: next },
  });
  console.log(res.status === 200 ? '✓ Domaine ajouté aux domaines autorisés Firebase Auth.' : `✗ Échec (${res.status}) : ${JSON.stringify(res.data).slice(0, 300)}`);
}

// ------------------------------------------------------------------ 2) Clé Google Maps : référents autorisés
async function setupMapsKeyReferrers() {
  const list = await gcp(`https://apikeys.googleapis.com/v2/projects/${PROJECT_ID}/locations/global/keys`);
  if (list.status !== 200) {
    console.error('Échec liste des clés API :', JSON.stringify(list.data).slice(0, 300));
    return;
  }
  const key = (list.data.keys ?? []).find((k) => k.displayName === MAPS_KEY_DISPLAY_NAME);
  if (!key) {
    console.error(`✗ Clé "${MAPS_KEY_DISPLAY_NAME}" introuvable (créer avec scripts/gcp-maps-key.mjs).`);
    return;
  }
  const current = key.restrictions?.browserKeyRestrictions?.allowedReferrers ?? [];
  console.log('Référents Maps actuels :', current.join(', '));
  const wanted = [`https://${domain}/*`];
  // Domaine apex (2 segments, ex. "golink.fr") : ajoute aussi le sous-domaine "www."
  // Sous-domaine (ex. "admin.golink.fr") : on n'ajoute que celui-ci, pas de "www." fictif.
  if (domain.split('.').length === 2) wanted.push(`https://www.${domain}/*`);
  const missing = wanted.filter((r) => !current.includes(r));
  if (missing.length === 0) {
    console.log('✓ Les référents pour ce domaine sont déjà autorisés (rien à faire).');
    return;
  }
  const next = [...current, ...missing];
  console.log(`→ Ajout de ${missing.join(', ')} aux référents autorisés de la clé Maps.`);
  if (!apply) {
    console.log('  (dry-run) PATCH sur', key.name, 'avec allowedReferrers =', JSON.stringify(next));
    return;
  }
  let op = await gcp(`https://apikeys.googleapis.com/v2/${key.name}?updateMask=restrictions.browser_key_restrictions.allowed_referrers`, {
    method: 'PATCH',
    body: { restrictions: { browserKeyRestrictions: { allowedReferrers: next }, apiTargets: key.restrictions?.apiTargets } },
  });
  for (let i = 0; i < 20 && op.data.name && !op.data.done; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    op = await gcp(`https://apikeys.googleapis.com/v2/${op.data.name}`);
  }
  console.log(op.data.done || op.status === 200 ? '✓ Référents Maps mis à jour.' : `✗ Échec : ${JSON.stringify(op.data).slice(0, 300)}`);
}

await setupAuthorizedDomains();
console.log('');
await setupMapsKeyReferrers();

console.log('');
console.log('À faire en plus (hors de ce script, une fois le domaine choisi) :');
console.log(`  - functions/.env : ADMIN_APP_URL=https://${domain} (ou RESTAURANT_APP_URL selon l'app), puis redéployer les`);
console.log('    fonctions qui envoient des liens (invitations, mots de passe, rapports, parrainage, virements…).');
console.log('  - CORS : non nécessaire — les fonctions callable Firebase (onCall) acceptent déjà toute origine (cors: true)');
console.log('    et vérifient l’identité via le jeton Firebase Auth, pas via le domaine d’origine.');
console.log('  - Modèles d’e-mail Firebase Auth (console > Authentication > Templates) : « URL d’action » — non utilisée en');
console.log('    pratique ici (les liens d’invitation/mot de passe sont envoyés par Brevo avec un oobCode extrait côté');
console.log('    serveur), mais on peut l’aligner sur le nouveau domaine par cohérence.');
if (!apply) console.log('\nRien n’a été modifié (dry-run). Relancer avec --apply pour appliquer.');
