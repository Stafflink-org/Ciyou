# Déploiement du super admin (apps/admin) sur Coolify

Pas-à-pas pour mettre en ligne le back-office super administrateur (`apps/admin`)
via Coolify, à partir du dépôt GitHub `SECRETCHOICE/golink`, branche `main`. Le
back-office restaurant (`apps/restaurant`) n'est **pas** concerné par ce guide :
il se déploiera plus tard, de la même façon (Dockerfile `apps/restaurant/Dockerfile`).

Le build Docker et le déploiement sont faits par l'utilisateur dans l'interface
Coolify — ce document liste exactement quoi cliquer et quoi renseigner.

## 1. Créer l'application dans Coolify

1. **New Resource → Application → Public/Private Git Repository**.
2. **Source** : GitHub, dépôt `SECRETCHOICE/golink`.
3. **Branche** : `main`.
4. **Build Pack** : `Dockerfile`.
5. **Dockerfile Location** : `apps/admin/Dockerfile`.
6. **Base Directory** (contexte de build) : `/` — important, le Dockerfile copie
   des fichiers depuis `packages/shared`, `packages/ui`, `packages/web` et
   `apps/admin` : le contexte doit être la racine du dépôt, pas `apps/admin`.
7. **Port exposé** : `80` (nginx sert l'app statique sur ce port dans le
   conteneur ; Coolify se charge du HTTPS en façade).

## 2. Domaine et HTTPS

1. Renseigner le domaine choisi pour le super admin (ex. `admin.mondomaine.fr`)
   dans l'onglet **Domains** de l'application.
2. Activer **HTTPS** (Coolify génère un certificat Let's Encrypt automatiquement
   dès que le DNS du domaine pointe vers le serveur).
3. Créer l'enregistrement DNS (A ou CNAME) chez le registrar avant l'activation
   HTTPS, sinon la génération du certificat échoue.
4. HSTS : Coolify (Traefik) l'ajoute normalement lui-même une fois HTTPS actif ;
   vérifier dans l'onglet **Advanced** / configuration du proxy si l'option
   existe, sinon l'en-tête peut être ajouté côté proxy Coolify (pas dans
   `docker/nginx-spa.conf`, qui tourne en HTTP interne — voir le commentaire en
   tête de ce fichier).

## 3. Health check

- **Path** : `/`
- **Port** : `80`
- Réponse attendue : `200` avec le HTML de l'app (nginx sert `index.html` en
  fallback SPA sur toute route inconnue, donc n'importe quel chemin répond 200).

## 4. Auto-déploiement sur push

- Activer le **webhook automatique** de Coolify pour cette application
  (onglet **Webhooks** / **Automatic Deployment**), branché sur `main`.
- Chaque push sur `main` reconstruit et redéploie automatiquement le super admin.

## 5. Build Variables (variables lues au moment du `docker build`)

Ces variables sont des `VITE_*` : Vite les fige dans le code au moment du
build, elles ne peuvent **pas** être changées après coup sans reconstruire
l'image. À renseigner dans l'onglet **Build Variables** (ou **Build Args**
selon la version de Coolify) de l'application, avec exactement ces noms :

| Nom | Où trouver la valeur | Obligatoire |
|---|---|---|
| `VITE_GOOGLE_MAPS_API_KEY` | Google Cloud Console → APIs & Services → Identifiants (projet `golink-9f16d`) → clé **« Ciyou Eats Web Maps »**. Copier la chaîne de clé (`AIza...`). | Non — sans elle, les cartes affichent un message « indisponible » au lieu de planter. Fortement recommandé. |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Tableau de bord Stripe → Développeurs → Clés API → **clé publiable** (`pk_live_...` en production, `pk_test_...` en test). | Non — sans elle, les écrans liés aux paiements/Connect se dégradent, mais l'admin reste utilisable. À renseigner avant l'ouverture réelle. |
| `VITE_RESTAURANT_APP_URL` | URL du back-office restaurant une fois déployé (ex. `https://restaurant.mondomaine.fr`). Laisser vide tant qu'il n'est pas en ligne : le lien « Voir comme le restaurant » utilisera alors une valeur de repli locale, sans casser le reste de l'app. | Non. |

Ne **pas** définir `VITE_FIREBASE_EMULATORS` (absente = production ; si elle
vaut `"true"`, l'app tente de se connecter aux émulateurs Firebase locaux et
rien ne fonctionne).

Important : après avoir modifié une Build Variable, il faut relancer un build
complet (« Redeploy » avec option de reconstruction, pas juste un restart) pour
qu'elle soit prise en compte, puisqu'elle est figée au build.

## 6. Avant le tout premier déploiement — côté Firebase/Google

À faire une fois le domaine définitif choisi (remplacer `admin.mondomaine.fr`
par le vrai domaine) :

```
node scripts/setup-domain.mjs admin.mondomaine.fr --dry-run   # vérifier ce qui va changer
node scripts/setup-domain.mjs admin.mondomaine.fr --apply     # appliquer
```

Ce script (voir aussi `docs/MISE_EN_PRODUCTION.md`) :
- ajoute le domaine à la liste des **domaines autorisés** de Firebase Auth
  (sinon la connexion peut être bloquée par Firebase côté client) ;
- ajoute `https://admin.mondomaine.fr/*` (et `https://www.…` pour un domaine
  apex) aux **référents HTTP autorisés** de la clé Google Maps.

Pas d'action CORS nécessaire : les fonctions callable Firebase (`onCall`)
acceptent déjà toute origine et vérifient l'identité par jeton, pas par domaine.

Si `ADMIN_APP_URL` (variable des Cloud Functions, distincte des `VITE_*` du
build) n'a pas encore été positionnée sur le nouveau domaine, les liens dans
les e-mails d'invitation/mot de passe pointeront vers `http://localhost:5174` :
voir `docs/MISE_EN_PRODUCTION.md` § Cloud Functions.

## 7. Vérifications après déploiement

- [ ] L'URL du domaine affiche bien la page de connexion du super admin (pas
      d'erreur nginx, pas de page blanche).
- [ ] Console navigateur sans erreur de Content-Security-Policy (F12 → Console
      → filtrer « Content Security Policy »). Si une ressource légitime est
      bloquée, ajouter son origine dans `docker/nginx-spa.conf` puis redéployer.
- [ ] Connexion avec un compte administrateur réel fonctionne (nécessite que le
      domaine soit dans les domaines autorisés Firebase Auth — étape 6).
- [ ] Une fiche restaurant avec adresse affiche la carte Google Maps (pas le
      message « Carte indisponible ») si `VITE_GOOGLE_MAPS_API_KEY` a été fournie.
- [ ] `curl -I https://admin.mondomaine.fr/` : `Cache-Control: no-cache` (ou
      équivalent) sur `index.html`.
- [ ] `curl -I https://admin.mondomaine.fr/assets/<un-fichier>.js` : `Cache-Control: public, immutable`.
- [ ] Le cadenas HTTPS est valide (certificat Let's Encrypt actif, pas d'alerte).
- [ ] Un push sur `main` déclenche bien un redéploiement automatique (tester
      avec un commit anodin, ou vérifier les logs de webhook Coolify).
- [ ] Le health check Coolify est vert en continu (pas de redémarrage en boucle).
- [ ] Avant l'ouverture réelle : suivre la check-list `docs/MISE_EN_PRODUCTION.md`
      (clés Stripe live, MFA obligatoire, suppression des comptes de test, etc.).
