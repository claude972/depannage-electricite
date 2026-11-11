# Recette DomDépannage · Web et PWA

11 novembre 2026 · Branche `feat/pwa-autonomie-2026-11-11` · Base `4a753922`

[Ouvrir la preview Vercel](https://depannage-electricite-git-feat-pwa-auton-e327e4-brafas-projects.vercel.app/)

## Résumé

La preview exécute le commit `2c94a484` avec le statut Vercel `READY`. L’inscription utilise un e-mail et un mot de passe, avec confirmation par lien. Le téléphone est obligatoire pour le contact. La carte est intégrée à l’étape du lieu d’intervention. Après connexion, l’espace client affiche les coordonnées, les adresses et les demandes. La recette publique est passée à 390 et 1440 px. L’inscription, la récupération du mot de passe et la création de demande ont aussi été rejouées avec une base Supabase et une boîte e-mail isolées.

Fable 5.2 a réalisé les changements d’authentification Web et d’espace client. Astra a réalisé la carte, sa persistance et les tests associés. Codex a intégré les changements, vérifié les parcours, corrigé les défauts trouvés et déployé la preview. Les deux migrations ont été appliquées après les 127 migrations existantes sur la base de recette. L’URL par défaut d’Auth sur la base de recette cible l’alias de la branche. Les liens de confirmation et de récupération ont été ajoutés à la liste autorisée existante. L’accès à la preview est protégé par l’authentification Vercel. La production n’a reçu aucun déploiement ni migration.

## Modifications

- Inscription Web avec prénom, nom, e-mail, mot de passe et téléphone. Contrôle de format dans le formulaire et l’API, avec normalisation pour `+596`, `+590` et `+33`. La connexion et la récupération du mot de passe partagent le même écran. Les écrans, routes Web et appels de validation SMS ont été retirés. Les anciens binaires natifs gardent leurs routes dédiées.
- Carte Leaflet à l’étape adresse depuis l’accueil, la fiche de prestation et la nouvelle demande connectée. Tuiles OpenStreetMap et centre initial en Martinique, repère fixe, commande « Ma position », recherche et géocodage inverse via l’IGN. Adresse et complément sont conservés dans le brouillon. Le serveur enregistre latitude, longitude et complément avec la demande, dans une table privée et dans la même transaction.
- Profil client affiché dès la connexion ordinaire. Il contient les coordonnées, les adresses et les demandes en cours et passées, avec accès à la liste complète. L’icône Paramètres ouvre les réglages existants. Le retour d’un lien de suivi ou d’une demande commencée avant connexion conserve sa destination.
- Le menu « Je suis un », le créneau demandé et les options de règlement suivent les contrats existants. Le chargement des espaces privés est différé jusqu’à leur ouverture. Le résumé d’offre électricien accepte désormais l’estimation nette renvoyée par l’API.

## Audits à 390 et 1440 px

Les lignes indiquent l’environnement et le niveau de preuve. Les lignes conformes recensent les parcours rejoués. Les anomalies externes et vérifications incomplètes restent identifiées séparément.

| Audit et écran | Constat vérifié | Gravité | Preuve | Correctif ou suite |
| --- | --- | --- | --- | --- |
| A · Accueil → choix du profil | Les cartes changent pour Restaurant. Les deux largeurs tiennent dans le viewport. | Conforme | Chromium sur la preview, `components/role/public-home.tsx:103` | Fonctionnement conservé. |
| A · Fiche → problème → créneau | La fiche ouvre la demande et le créneau « Demain » est conservé au récapitulatif. | Conforme | Chromium sur la preview, `tests/ui/interactive-journey.test.ts:25` pour le parcours de démonstration | Fonctionnement conservé. |
| A · Inscription et confirmation | Le téléphone invalide est rejeté. Le compte est créé, la connexion avant confirmation est refusée, le lien reçu dans Mailpit ouvre la session. | Conforme en recette locale | Inscription HTTP 201, erreur Auth `email_not_confirmed`, `lib/features/auth/signup.ts:13` et `supabase/config.toml:8` | Vérifier la délivrabilité sur la preview hébergée avec une boîte e-mail de recette. |
| A · Connexion, oubli et profil | Un formulaire de connexion. Le lien de récupération reçu permet de changer le mot de passe. Le profil client est la page d’arrivée. | Conforme | Chromium et Mailpit, `components/role/public-site.tsx:249`, `components/app/session.ts:101`, `components/role/client-space.tsx:2187` | Réglages déplacés vers l’icône dédiée. |
| A/E · Lieu d’intervention | La carte s’affiche avec repère fixe, elle répond au clavier. Le GPS précis positionne la carte. Refus, imprécision, recherche sans résultat et hors ligne laissent la saisie manuelle disponible. | Conforme, géocodage simulé pour les cas positifs | Six scénarios Chromium. Premier chargement des tuiles OSM en HTTP 200. `components/app/booking-location.tsx:11` | Correction du cas où un géocodage inverse tardif effaçait le message de recherche. |
| A · Recherche et géocodage inverse réels | IGN renvoie HTTP 504 à l’appel direct. La preview renvoie HTTP 503 sur les deux routes. La saisie manuelle reste disponible. | Majeur externe, ouvert | `GET /api/addresses/search` et `GET /api/addresses/reverse`, `lib/features/addresses/server.ts:33` | Rejouer la recherche et le géocodage inverse quand le service répond. [Documentation IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) |
| A · Confirmation → suivi | Une demande « Après intervention » est créée en HTTP 201 et apparaît au suivi. Les coordonnées test et le complément existent dans la table privée. | Conforme | Chromium et lecture de la base isolée, `supabase/migrations/20261111120000_booking_location.sql:3` | Fonctionnement conservé et enrichi avec la localisation. |
| A/B · Stripe et encaissement | Le règlement différé aboutit à l’état attendu. Aucun identifiant Stripe de test n’était disponible dans la branche de preview pour vérifier un encaissement fournisseur. | Majeur, vérification ouverte | Récapitulatif navigateur et parcours démonstration, configuration de preview `STRIPE_LIVE_PAYMENTS_ENABLED=false` | Rejouer l’empreinte, la capture et le versement avec un compte Connect de test. |
| B · Inscription, candidature et connexion électricien | L’électricien s’inscrit depuis la candidature, confirme son e-mail, ouvre son dossier puis se reconnecte. L’approbation du compte a été préparée dans la base de recette. | Conforme sur le compte de recette | Chromium sur la base isolée, `components/role/public-site.tsx:534` et `components/role/artisan-space.tsx:1039` | Examiner le dépôt de candidature et l’approbation via le back-office lors de la prochaine recette métier. |
| B · Missions → détail → acceptation | Le détail d’offre répondait HTTP 200 mais l’écran rejetait `net_estimate` et masquait le bouton d’acceptation. | Bloquant, corrigé | Reproduit aux deux largeurs. `components/features/available-missions/available-missions-model.ts:159`, commit `2c94a484` | Le parseur lit un montant valide ou l’absence d’estimation. L’offre reste anonymisée et son acceptation passe à 390 et 1440 px. |
| B · Devis → intervention → règlement | Devis de 108,50 € TTC, accepté par le client. Le serveur refuse la clôture sans photos (HTTP 409), accepte les deux photos en stockage privé puis clôture le dossier. Le client voit le règlement attendu. | Conforme en recette locale | Chromium aux deux largeurs, `app/api/interventions/[id]/actions/route.ts:21`, `app/api/documents/route.ts:57` et `tests/ui/interactive-journey.test.ts:25` pour la démonstration | Vérifier les opérations Stripe dans l’environnement de test fournisseur. |
| C · Connexion → tableau de bord | La page et ses lectures sont accessibles au compte de recette. Un compte client reçoit HTTP 403 sur l’API admin. | Conforme | Chromium, `#admin`, `app/api/admin/dashboard/route.ts:1` et refus HTTP 403 | Contrôles conservés. |
| C · Interventions, artisans et clients | Les trois écrans se chargent avec HTTP 200 aux deux largeurs. Le dossier clôturé pendant la recette apparaît au back-office. | Conforme pour les lectures | Chromium, `app/api/admin/interventions/route.ts:93`, `app/api/admin/artisans/route.ts:15`, `app/api/admin/directory/route.ts:81` | Les décisions d’approbation sont couvertes par `tests/admin-artisan-approval.test.ts:22`. Les mutations administratives n’ont pas toutes été rejouées dans le navigateur. |
| C · Devis, factures et finance | Les écrans Devis & Factures et Finance répondent HTTP 200 aux deux largeurs. | Conforme pour les lectures | Chromium, `#admin-quotes`, `app/api/platform-operations/finance/route.ts:8` | Recetter les opérations d’encaissement en Stripe test. |
| D · Manifest, icônes et hors ligne | Manifest `standalone`. PNG 192 et 512 px, icône maskable 512 px et icône Apple 180 px. Le service worker met en cache les trois ressources publiques hors ligne. Un appel privé hors ligne ne reçoit aucun dossier en cache. L’accueil se recharge après retour du réseau. | Conforme | Onze vérifications publiques Chromium/WebKit sur la preview, `app/manifest.ts:6`, `public/sw.js:3` | Fonctionnement conservé, cache public versionné. |
| D · Installation iOS et Android | Chromium n’a signalé aucune erreur d’installabilité en profil persistant. WebKit affiche l’accueil mobile. Les simulateurs n’ont pas atteint une installation complète. | Vérification ouverte | Contrôle CDP `Page.getInstallabilityErrors` à 390 et 1440 px. Essai iOS bloqué au démarrage de SpringBoard. | Installer depuis Safari et Chrome sur des téléphones de recette et ouvrir depuis l’icône. |
| D/E · Performance de l’accueil | La première mesure mobile Lighthouse relevait 1 850 ms de blocage et 64/100 en performance. | Majeur, corrigé | Lighthouse 13.6.0 et chargement à la demande dans `components/courant-app.tsx:151` | Les scores de la preview finale figurent ci-dessous. |
| E · Largeurs, clavier, survol et formulaires | Largeurs visibles et défilables de 390 et 1440 px sur les écrans publics et administratifs vérifiés. Ordre de tabulation, lien d’évitement, focus visible de 3 px, survol desktop et navigation de la carte au clavier vérifiés. | Conforme | Chromium, captures, `app/globals.css:55`, `components/app/booking-location.module.css:7` | Aucun correctif de mise en page nécessaire sur les écrans testés. |

## Mesures Lighthouse

| Largeur | Performance | Accessibilité | Bonnes pratiques | SEO | Temps de blocage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 390 px | 95 | 100 | 100 | 63 | 270 ms |
| 1440 px | 100 | 100 | 100 | 63 | — |

La protection de la preview empêche l’indexation. Les mesures d’accessibilité concernent l’accueil testé. Les mesures sont issues d’un navigateur de recette, sans données de terrain.

## Hypothèses et décisions prises

- « Supprimer la validation par SMS » s’applique au Web/PWA. Les contrats SMS propres aux binaires iOS et Android existants et les notifications transactionnelles restent en place. Alternative écartée pour cette livraison, arrêter immédiatement les routes utilisées par les anciens binaires.
- La contrainte téléphone s’applique au formulaire et à l’API d’inscription Web. Le service Auth partagé accepte toujours les inscriptions historiques des applications natives.
- Le client peut préparer une demande avant connexion. Un compte e-mail confirmé est nécessaire pour l’envoyer et la suivre. Alternative écartée, rattacher les dossiers sur la seule égalité d’un téléphone non vérifié.
- Le complément d’accès est libre et facultatif. La saisie manuelle peut être enregistrée sans coordonnées. Un déplacement du repère demande confirmation pour rattacher la position à l’adresse. La position précise et le complément restent privés. L’interface de mission n’affiche pas ces nouveaux champs à l’électricien.
- Les tuiles viennent d’OpenStreetMap. Le géocodage utilise l’IGN, déjà présent dans le projet. Le mode dégradé garde la saisie manuelle. Alternative écartée pour cette livraison, utiliser un second fournisseur qui recevrait les adresses et les coordonnées.
- L’alias stable de branche et la base `depannage-web-pwa` sont dédiés à la recette. Les liens d’authentification acceptent cette preview. Stripe live est désactivé. Les vérifications qui écrivent ont utilisé des comptes synthétiques et une base locale.
- Les créneaux expriment un souhait avant confirmation par l’électricien. « Après intervention » reste un règlement différé sur la plateforme. Le choix du mode de paiement ne constitue pas une preuve d’encaissement.

## Décisions et vérifications restantes

- Fournir l’accès aux identifiants Stripe de test et au compte Connect de test pour vérifier le règlement et l’encaissement, puis la lecture des écritures côté admin.
- Choisir le parcours de récupération des dossiers pour les anciens comptes uniquement créés par téléphone. Leurs dossiers restent associés à leur identifiant d’origine.
- Rejouer le géocodage lorsque l’IGN répond et contrôler la délivrabilité du lien sur la preview avec un destinataire de recette.
- Vérifier l’installation sur un iPhone et un Android. Rejouer les mutations métier administratives sur des dossiers de test avant une mise en production.

## Vérifications restant à rejouer

| Parcours | Étapes | Résultat attendu |
| --- | --- | --- |
| Paiement et administration | Créer un dossier de recette, autoriser la carte Stripe de test, accepter le devis, terminer l’intervention, payer et ouvrir Finance. | Montant confirmé égal au devis accepté. Les écritures, la commission et le transfert Connect de test sont traçables. |
| E-mail hébergé | S’inscrire sur la preview avec une boîte de recette, ouvrir le lien de confirmation et demander un lien de récupération. | Liens reçus, même domaine de preview et accès au bon profil. |
| Géocodage | Chercher une adresse publique en Martinique, confirmer un résultat, déplacer le repère, puis confirmer une seconde fois. | Adresse proposée par l’IGN, coordonnées cohérentes avec le repère et complément conservé. |
| Installation iPhone | Ouvrir la preview dans Safari, ajouter à l’écran d’accueil, ouvrir l’icône, puis passer hors ligne. | Icône DomDépannage, affichage autonome et écran hors ligne public. |
| Installation Android | Ouvrir la preview dans Chrome, installer, ouvrir l’icône, couper puis rétablir le réseau. | Icône DomDépannage, affichage autonome, écran hors ligne public puis retour à l’accueil. |

## Vérifications techniques

- `npm run typecheck` et compilation Vercel réussis. Onze contrôles publics en ligne, dix scénarios de rôles sur la base isolée et six scénarios carte ont réussi.
- Suite complète avec `node_modules/.bin/tsx --test --test-concurrency=3 'tests/**/*.test.ts'`. Sur 2 276 tests, 2 273 sont passés, 1 assertion a échoué et 2 tests de capture privée ont été ignorés faute de fichier local. Aucune annulation.
- L’unique échec attendait l’ancien montage du panneau d’équipes dans le profil client. L’assertion a été alignée sur Paramètres dans `223303d1`. Les 4 tests de `tests/ui/provider-teams-browser.test.ts` passent après cette correction de test. La suite complète a été exécutée avant cette dernière modification de test.
- La branche GitHub comprend, après le commit déployé, des changements de tests et de documentation. Le code applicatif en preview correspond à celui de la branche livrée.
