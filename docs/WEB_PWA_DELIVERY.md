# Livraison autonome Web/PWA puis iOS/Android

## Autorisation et ordre

Le propriétaire autorise la réalisation autonome selon le plan, avec split Claude/Codex, commits/push réguliers et previews. L’audit initial reste historique ; la consigne active est l’exécution. Web responsive/PWA en premier, puis applications iOS et Android après vérification du Web/PWA. Aucun lancement commercial, débit réel ou publication publique App Store/Google Play n’est implicitement autorisé.

Le 31 octobre2026 à00:00 America/Martinique, tout le codage passe à Claude, avec1 à10 agents selon besoin. Codex pilote, revoit, exécute les tests, intègre et publie les preuves. Le relais unique programmé et les missions/corrections distantes permettent la reprise. L’absence du propriétaire devant son ordinateur ne suspend pas les lots indépendants ; Stripe reste une dépendance d’accès au compte test.

## Révision couverte

État documentaire fondé sur l’intégration `8cdf5af3e30a0a8138ae9943e0bc62417fd93cf3` et le frontend Claude `9fdb1e5cb09933e5b7e77d2962023ea386ba5310`. Les corrections ultérieures ne sont réputées vérifiées qu’après relecture de leur SHA et preuves propres. Aucune affirmation ci-dessous ne clôt les76 capacités.

## Code et revues disponibles

- Backend `0a01406` : candidature, disponibilités/éligibilité, opérations terrain et accès organisationnels ; revue et scénarios SQL isolés.
- Paiements/devis `4ae3bd1` : tentatives Checkout, échec/expiration sans downgrade paid, acceptation sur version exacte. Tests isolés et revue, sans transaction Stripe réelle.
- Organisations `c1e80a2` (migration006) : invitation à email confirmé, usage unique, owner/manager/viewer, retrait et transfert.
- Performance `409a082` (007) : agrégats artisan sur périmètre complet et rendez-vous des dossiers autorisés. Pas de CA déduit de la fenêtre workspace ; aucune ponctualité inventée.
- Suspension `1d93445` (008) : statut suspendu préservé, garde des commandes self-service et requête d’offres resserrée. Claude a recontrôlé CL-001/CL-002 sur ce SHA :30 tests, typecheck,29 groupes SQL principaux et6 performance réussis, aucun nouveau finding actionnable dans ce périmètre. Aucun navigateur/build/cloud par ce reviewer.
- Sites `c04b752` (009), intégrés dans `1e2eaed` : portées all/selected et droits par site, invitations atomiques, règles RLS/Storage/rapports/commandes. Revue indépendante sans nouveau contournement bloquant dans le périmètre :8 groupes sites,29 principaux,6 performance. Requêtes service-role déjà en vol et URL signées conservant leur TTL restent des limites explicites.
- Frontend Claude `9fdb1e5` intégré avec les backends dans `8cdf5af` : espaces public/client/artisan/entreprise/Super Admin, structures dédiées M35/M43/M66, sélection exacte de devis, candidatures, opérations, membres/site scopes, PWA dans profils/aide et états indisponibles honnêtes. Captures locales et21 tests UI réussis ; cela ne prouve pas une recette en ligne ni un cycle métier complet.
- Contrôles partagés `f132f6a`, intégrés par `8cdf5af` : tests UI inclus dans `check`, `agentRules:false` pour préserver les instructions projet. Résultat CI/build de ce SHA à confirmer dans la PR.

## Supabase dédié : blocage levé, preuves cloud bornées

Après confirmation du règlement, le projet **depannage-web-pwa** (`kcpyjzndybfdlnhvscbs`, Paris/eu-west-3) a été créé et déclaré ACTIVE_HEALTHY. Les neuf migrations001–009 ont été appliquées ; un second dry-run confirme la base à jour. Aucun projet existant n’a servi de repli. Les variables Supabase sont configurées uniquement sur la preview Vercel de `integration/web-pwa` ; la clé de service reste serveur/sensible et hors Git. Aucun seed de démonstration n’a été chargé.

Vérifications réelles datées du31 octobre2026 UTC, sur ce seul nouveau projet :

| Périmètre | Preuve réelle | Limites |
| --- | --- | --- |
| Clients/Auth/Storage |22 contrôles réussis : login password de comptes QA confirmés, trigger profil, refus escalade rôle/statut, création/relecture, isolation clients, anonymes refusés, bucket privé et signatures autorisées/refusées | Pas de confirmation email publique, navigateur, Stripe ni cycle devis complet |
| Organisations/sites/artisan |30 contrôles réussis : invitation email confirmé/scope selected/usage unique, lectures/écritures granted/excluded, manager→viewer, retrait, refus signing après retrait, artisan non approuvé refusé puis QA approuvé attribué, suspension empêchant réactivation | Pas de concurrence réelle, authenticité légale des pièces, UI, SLA ou cycle commercial complet |
| Nettoyage QA |6 contrôles de readback clients puis14 contrôles de récupération/readback professionnels réussis ; aucune ressource QA suivie restante | Un premier nettoyage était bloqué par FK professional_audit ; corrigé sur les seules lignes QA, historique conservé dans le rapport |

Ces contrôles utilisent Auth/PostgREST/Storage hébergés, pas les stubs SQL. Ils ne transforment pas les tests ciblés en validation de toutes les capacités. Les rapports sans secret et les détails de revue sont consignés dans la branche de coordination `missions/web-pwa` ; les artefacts temporaires seuls ne sont pas une livraison documentaire pérenne.

## Défauts et vérifications encore ouverts

- **Connexion UI, CL-UI-007/UI-REV-001 :** sur `9fdb1e5`, clearSessionState invalide sa propre continuation après login/signup ; défaut reproduit par la revue. Une correction poussée ne sera clôturée qu’après recheck du contrôleur et recette Auth navigateur. Le login cloud direct réussi ne prouve pas le login UI.
- **Révocation UI, CL-UI-008/UI-REV-002 :** revalidation focus/visibility et invalidation centralisée des contextes professionnel/organisation/site à corriger et tester. Le serveur refuse les nouvelles requêtes, mais les données déjà affichées peuvent rester en cache. Les octets déjà vus et URL signées jusqu’à expiration ne sont pas révocables instantanément.
- **Invitations, CL-UI-009/UI-REV-003 :** formulaire limité à30jours au SHA revu contre14 côté API ; alignement et limites à recontrôler.
- **Nouvelle UI :** comparaison aux maquettes, QA responsive/clavier/focus/erreurs et parcours combinés en ligne en attente. Ne pas présenter une capture locale comme un contrôle Vercel.
- **Auth complet :** confirmation/récupération email, URLs de retour autorisées, session persistante multi-navigateurs, retour réseau/session expirée et cycle métier à prouver.
- **Stripe test :** compte non connecté et secrets test non configurés. `STRIPE_LIVE_PAYMENTS_ENABLED=false` ; aucun paiement réel. Pays/commission/responsabilités/payeur et règles de remboursement ne doivent pas être inventés. Poursuivre les autres lots pendant l’absence d’accès.
- **PWA :** `6aaa1b3` intégré dans `b0fa1df` avait passé14 tests ciblés et13 contrôles navigateur (ancienne UI), cache exclusivement de la notice publique et correction PWA002 déployée. Régression nouvelle UI encore en attente. Installation OS réelle et mise à jour multi-onglets sur deux déploiements non prouvées ; CDP installability n’est pas une installation appareil.
- **Fonctions avancées :** photos dans la demande, brouillons/PDF de devis/validité, annuaires serveur paginés, finance/factures/avoirs/payouts, support, notifications, cartes/ETA, verticales, documents/contrats/budgets complets et rôles opérateurs restent suivis par capacité.
- **Exploitation :** restauration/sauvegarde/supervision et données commerciales/légales réelles avant ouverture. Aucun pourcentage global ne doit être déduit des fichiers ou tests.

## Suite native

Après le Web/PWA vérifié, Claude réalise les lots iOS/Android avec backend partagé. Proposition : Expo/React Native et distribution de test EAS, après lecture d’expo-overview et skills/versionnements adaptés. Prévoir Auth native et stockage jetons, liens Auth/Stripe, médias/localisation, erreurs réseau et tests iOS/Android réels/cloud. Les back-offices desktop restent Web sauf besoin défini. Une PWA n’est pas renommée application native ; pas de publication publique aux stores sans autorisation correspondante.

## Traçabilité et liens

[WEB_PWA_TRACKING.csv](WEB_PWA_TRACKING.csv) conserve les76 IDs, leur ordre, phase et état initial historique, puis sépare code UI/backend, preuve cloud bornée et reste à réaliser. Aucun ID n’est annoncé terminé à cette mise à jour.

- [Missions et corrections](https://github.com/claude972/depannage-electricite/tree/missions/web-pwa)
- [Draft PR1 : contrôles CI et déploiements par SHA](https://github.com/claude972/depannage-electricite/pull/1)
- [Preview intégration](https://depannage-electricite-git-integration-web-pwa-brafas-projects.vercel.app) : alias évolutif protégé Vercel, QA de la nouvelle UI encore en attente. Une preuve se rattache au déploiement unique et au SHA, pas seulement à cet alias.


## Complément : preview combinée vérifiée

Le déploiement unique0017b48 a passé41 contrôles de navigation/rendu sur les quatre rôles démo à360/1280 et13 contrôles PWA. Aucun appel API/Supabase en démonstration et aucune erreur console/page pendant ces parcours. Rapport et captures : [revue en ligne](verification/online-0017/UI_ONLINE_REVIEW.md). Cela ne vérifie pas les mutations métier ni le login réel ; les findings Auth/cache restent ouverts, ainsi que VIS-001 sur la densité artisan. Les mentions « QA en attente » de la matrice concernent la recette métier complète, pas ce smoke borné.

Les contrôles GitHub du combiné8cdf5af (typecheck, tests dont UI, build et SQL isolé) ont réussi. Le commitc583f3c versionne la configuration Auth preview : site URL corrigée et templates SSR token_hash de confirmation/récupération appliqués au projet dédié ; confirmation requise et autres réglages conservés. Livraison réelle des e-mails non vérifiée.


## Complément : connexion réelle et dossiers admin hors fenêtre

Surfe4c9c9,19 contrôles navigateur/API réels ont réussi : connexion formulaire clientA → déconnexion → clientB sans cacheA, refus client/anonyme admin, pagination117 dossiers filtrés au-delà de100, recherches/curseurs/filtres cohérents et détail ancien. Dix contrôles de suppression/readback ont confirmé le nettoyage des seules ressources QA. [Rapport](verification/online-fe4/AUTH_ADMIN_ONLINE_REVIEW.md). Cela ne prouve pas encore le branchement de la pagination dans l’interface Super Admin.

Le correctif Auth823b021 a fermé les défauts de réponses tardives signalés en revue déterministe (34 contrôles). Un P2 supplémentaire après logout était présent au2e3 utilisé parfe4 ; il a été corrigé au823 puis intégré5cfad13. Les liens SSR de confirmation/récupération ont passé12 contrôles réels, sans envoi d’e-mail, sur0017 et après configuration du projet. [Rapport](verification/online-0017/AUTH_SSR_ONLINE_REVIEW.md).

Les photos6962/766 sont intégrées pour recette corrective mais ne sont pas acceptées : résultat réseau incertain, remplacement d’une file précédente et effet storage tardif restent assignés Claude. La révocation entreprise et les limites d’invitation ont été corrigées dans la source ; recette navigateur en cours.
