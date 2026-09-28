# Check-list « prêt pour la production » — super admin

Ce document liste ce qui est encore en configuration de test dans le super
admin, à corriger avant d'ouvrir l'accès à de vrais utilisateurs. Cocher
chaque ligne quand c'est fait.

## 1. Paiements (Stripe)

- [ ] `functions/.env.local.secrets` (ou secret Firebase déployé) : `STRIPE_SECRET_KEY`
      est actuellement une clé **de test** (`sk_test_…`). La remplacer par la clé
      **live** (`sk_live_…`) : Tableau de bord Stripe → Développeurs → Clés API
      (basculer en mode « Live » en haut de l'écran).
      Déploiement : `firebase functions:secrets:set STRIPE_SECRET_KEY --project golink-9f16d`
      puis redéployer les fonctions qui la déclarent (`payments.ts`, `webhook.ts`, `connect.ts`, `driver-connect.ts`…).
- [ ] `STRIPE_WEBHOOK_SECRET` : recréer le point de terminaison webhook Stripe
      en mode live (il a une URL identique mais un secret de signature différent
      du mode test) et mettre à jour le secret.
- [ ] `.env.local` / Build Variable Coolify `VITE_STRIPE_PUBLISHABLE_KEY` :
      remplacer `pk_test_…` par la clé **publiable live** (`pk_live_…`), puis
      reconstruire l'image (variable figée au build, voir
      `docs/DEPLOIEMENT_COOLIFY_ADMIN.md`).
- [ ] Stripe Connect : vérifier que les comptes connectés livreurs/restaurants
      de test ne sont pas mélangés avec le mode live (les comptes Connect sont
      spécifiques au mode test/live, ils ne se basculent pas automatiquement).

## 2. E-mails (Brevo)

- [ ] `settings/notificationDelivery` (réglages plateforme, rubrique messages
      automatiques) : le champ `dryRun` doit passer à `false` pour que les
      messages automatiques (relances, avoirs, alertes…) soient réellement
      envoyés au lieu d'être simulés.
- [ ] Vérifier `BREVO_SENDER_EMAIL` : adresse d'expéditeur définitive, avec un
      domaine authentifié (SPF/DKIM) côté Brevo pour éviter le classement en
      indésirables.
- [ ] Envoyer un e-mail de test réel (invitation admin, ou via
      `scripts/create-first-admin.mjs --apply`) et vérifier sa bonne réception.

## 3. Rapports programmés

- [ ] Rubrique **Rapports** de l'admin (`scheduledReports`) : les adresses
      destinataires (`recipients`) pointent peut-être encore vers des adresses
      de test/développement — les remplacer par les vraies adresses (direction,
      finance…) avant l'ouverture.

## 4. Double authentification (2FA)

- [ ] Le ou les comptes super admin réels (créés via
      `scripts/create-first-admin.mjs`) doivent **enrôler leur 2FA dès la
      première connexion** (scanner le QR code proposé par l'application).
- [ ] Une fois tous les administrateurs réels enrôlés, rendre la 2FA
      **obligatoire pour tout le monde** : régler `requireMfaForAdmins: true`
      (et éventuellement `mfaEnforcedFrom`) dans `settings/security`
      (rubrique Sécurité de l'admin). Tant que ce n'est pas fait, la 2FA reste
      seulement obligatoire pour les comptes qui l'ont déjà activée eux-mêmes.
- [ ] Ne jamais activer cette règle avant que le(s) super admin(s) réel(s)
      aient enrôlé leur 2FA : ils seraient invités à l'activer à la prochaine
      action sensible, sans être bloqués hors de l'app, mais autant l'anticiper.

## 5. Comptes de test

- [ ] Avant l'ouverture réelle, désactiver ou supprimer tous les comptes de
      `.test-accounts.local.md` (`*@golink.test`) : équipe interne, restaurants,
      livreurs et clients de démonstration. Ne pas les laisser actifs sur la
      base de production partagée avec de vrais utilisateurs.
- [ ] Vérifier qu'aucune donnée de démonstration (commandes, avis, promotions
      de test) ne reste visible publiquement sur le site.

## 6. Premier super administrateur réel

- [ ] Créer le compte avec sa vraie adresse e-mail :
      ```
      node scripts/create-first-admin.mjs --email <e-mail réel> --admin-url https://<domaine choisi> --dry-run
      node scripts/create-first-admin.mjs --email <e-mail réel> --admin-url https://<domaine choisi> --apply
      ```
- [ ] Vérifier la réception de l'e-mail d'invitation et la définition du mot
      de passe.
- [ ] Enrôler la 2FA à la première connexion (voir § 4).
- [ ] Inviter les administrateurs suivants depuis l'application elle-même
      (Équipe interne → Inviter), plus besoin du script une fois le premier
      compte créé.

## 7. Domaine et intégrations Google/Firebase

- [ ] Une fois le domaine définitif choisi :
      `node scripts/setup-domain.mjs <domaine> --apply` (voir
      `docs/DEPLOIEMENT_COOLIFY_ADMIN.md` § 6).
- [ ] `functions/.env` (ou secret) : positionner `ADMIN_APP_URL=https://<domaine>`
      pour que les liens des e-mails (invitations, mots de passe, rapports,
      relevés de virement…) pointent vers la bonne adresse au lieu de
      `http://localhost:5174`. Redéployer les fonctions concernées après
      modification (`FUNCTIONS_DISCOVERY_TIMEOUT=120 firebase deploy --only
      functions:<noms> --project golink-9f16d --force`).

## 7bis. Traduction automatique (Azure Translator)

- [ ] Le client crée sa ressource Azure Translator (portal.azure.com → Créer une
      ressource → « Translator ») et récupère la clé d'abonnement + la région
      (portail Azure → ressource → « Clés et point de terminaison »).
- [ ] Super admin → Plateforme & sécurité → Traduction : coller la clé et la
      région, cocher les langues actives (fr/en/ar), régler un plafond mensuel
      de caractères (maîtrise du coût Azure, facturé au caractère), cliquer
      « Tester la connexion » puis « Enregistrer ». Voir `docs/I18N.md` pour le
      détail.
- [ ] La clé n'est jamais visible ensuite dans le navigateur : seuls l'état
      (configurée / erreur) et les 4 derniers caractères s'affichent.
- [ ] `npm run i18n:translate` (aperçu) puis `--apply` pour compléter les
      traductions d'interface manquantes une fois la clé enregistrée.

## 8. Divers

- [ ] Vérifier qu'aucune clé de test (Maps, Stripe) n'est restée dans les
      Build Variables Coolify si elles doivent différer de `.env.local`.
- [ ] Repasser cette check-list une seconde fois juste avant l'ouverture
      publique, certains réglages (2FA, dry-run Brevo) étant faciles à oublier
      s'ils ont été testés puis oubliés en configuration de test.
