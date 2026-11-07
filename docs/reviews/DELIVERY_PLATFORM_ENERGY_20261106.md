# Livraison en cours — paiement plateforme et énergie, 6 novembre 2026

Périmètre propriétaire : application entière, seules connexions Stripe/SMS différées. Aucun succès bancaire simulé dans le produit. Pas de production ni activation de compte administrateur substitut.

## Code et contrôles

- Paiement direct retiré : source bf3bf3c, intégré 2da0021 ; contre-revue ROOT et 17 tests HTTP ciblés +45 contrôles SQL isolés passent.
- Checkout plateforme après travaux : source 4f62911, intégré 21cd76d. ROOT relit handlers et migration ; 26 tests ciblés assemblés (paiement + administration), 72 contrôles SQL PGlite passent, TypeScript strict passe. Montant = devis accepté + avenants acceptés ; destinataire/commission/origine figés avant création fournisseur, reprise même clé après réponse perdue, aucun nouvel essai aveugle après expiration de la fenêtre. Lien de suivi relatif et authentifié ; partager ce lien ne signifie pas paiement disponible. Stripe réel non raccordé/non testé.
- Énergie : ROOT 4b78bbc, revue indépendante Claude sans P1/P2, corrections 4fb8288. 10 tests schémas/handlers, 29 contrôles SQL isolés passent. Curseur lié au site et aux filtres, rejeu lié à son auteur, versions et archivage. Saisie humaine documentée, pas de mesure automatique inventée.
- PGlite emploie des stubs explicites Auth/Storage/cron : il ne prouve ni les fournisseurs ni deux sessions concurrentes réelles.

## Base dédiée réelle

Projet kcpyjzndybfdlnhvscbs : migrations 001–027 relues depuis le connecteur avant mutation. Trois nouvelles migrations appliquées par ROOT via le connecteur :

- 20261107013937 platform_only_payments
- 20261107013950 site_energy_periods
- 20261107014010 platform_deferred_checkout

Les noms locaux sont alignés sur les versions attribuées par le connecteur ; contenu SQL inchangé. Vérification réelle des ACL : RLS énergie et ledger actifs, aucune insertion directe énergie pour authenticated, aucune lecture ledger pour authenticated, ancienne RPC de déclaration directe non exécutable, seules commandes étroites prévues autorisées.

Énergie : transaction réelle PostgreSQL avec utilisateurs QA synthétiques, organisation et site, intégralement ROLLBACK. Création exacte, reprise sans doublon d’événement, refus de chevauchement, lecture viewer, écriture viewer refusée, aucune ligne visible hors organisation, archivage versionné : PASS. Lecture indépendante après rollback : Auth/profils/organisations/sites/périodes/événements du préfixe QA tous 0. Aucun compte maintenu. Ce contrôle SQL ne prouve pas encore le parcours navigateur authentifié de l’interface énergie.

## Preview et limites

Thème B source d3f6bd8 intégré ; premier assemblage poussé 7b4eed7, CI42324648349 SUCCESS, preview GitSource READY dpl_5tXYP8FUKix8oBqd5sTj41Tvs1pS. Le contrôle public a trouvé un débordement réel de 7px à 1280px dans les deux thèmes ; correction Claude demandée. Tests sous charge : ancien sommeil fixe du test empreinte insuffisant ; attente bornée d’état UI ajoutée 7b4eed7, scénario Chromium ciblé 10/10 PASS, assertions financières inchangées. La première suite complète reste historisée 1149 PASS/1 FAIL/2 SKIP avant correction ; ne pas la renommer verte.

Ni cette preview, ni les tests unitaires ne signifient application complète. Interface énergie/modération/préférences et autres modules en cours d’intégration ; Stripe/SMS toujours différés.

## Contacts, adresses et administration

Contacts 5e605c3 intégré c93042f : contre-revue ROOT handlers/SQL ; 6 tests HTTP et 52 SQL isolés passent. Migration réelle 20261107014437. Transaction réelle avec rollback : création, rejeu/audit unique, refus d’un second principal, lecture viewer/refus écriture, refus de lecture hors organisation, archivage et retrait du principal : PASS. Lecture indépendante Auth/profils/org/sites/contacts/événements QA : tous 0.

Adresses 48a10e2 intégré bd5bdcc : contre-revue ROOT handlers/SQL ; 6 tests HTTP et 56 SQL isolés passent. Migration réelle 20261107014959. Transaction réelle avec rollback : création prénom/nom/adresse, rejeu/audit unique, préférence unique, géopoint incomplet refusé, refus lecture/écriture entre utilisateurs, archivage : PASS. Lecture indépendante Auth/profils/adresses/événements QA : tous 0. RLS self-only, aucun INSERT REST et aucune RPC anon autorisés. Le câblage des adresses dans le formulaire reste à livrer.

Administration 70a9c5d/f47ba7f : revue indépendante Claude a trouvé une attribution erronée d’auteur dans le fil (P1) et une conversation potentiellement invisible avant attribution (P2). Auteur corrigé dans 028032a ; SQL rétablit dossier non annulé avec artisan attribué et normalise les espaces. 3 tests handlers +19 SQL isolés passent. Migration réelle 20261107014921 ; aucune promotion/création d’administrateur faite. Le parcours opérateur réel reste à vérifier sans compte substitut.

Parcours public 7b4eed7 sur mobile390 : fiche service → urgence → coordonnées → adresse → paiement plateforme après intervention → récapitulatif PASS, validations vides bloquantes, bouton inline et barre basse visibles, aucun POST et aucune erreur JS. SMS absent annoncé honnêtement ; réservation non envoyée, aucun paiement tenté. Preuve locale /tmp/depannage-public-booking-b-proof.json, données QA synthétiques uniquement.

## Assemblage contrôlé suivant

- SLA multi-sites d45d80e intégré 30f6ce2 : ROOT relit projection/RPC/flags de complétude ; 8 nouveaux tests handlers/logique et 24 contrôles SQL isolés passent. Migration réelle 20261107015431. Contrôle SQL réel avec rollback : propriétaire voit ses deux sites, viewer limité ne voit qu’un site et le périmètre est explicitement non global, organisation étrangère refusée. Readback indépendant Auth/profils/organisations/sites QA tous 0. Pas de calendrier SLA ni de respect de délai inventés. Interface consolidée à raccorder.
- Header c1bf0f4 et barrière énergie 1fe3786 intégrés 080ff05. Contre-vérification ROOT : 13 tests, dont vrai montage Chromium header clair/sombre 360–1440 et courses de lecture/écriture différées, PASS sans skip.
- Assemblage ROOT 080ff05 : **1222 tests PASS, 0 FAIL, 0 SKIP**, TypeScript strict non incrémental PASS. Les deux captures HTML optionnelles ont été fournies à partir du vrai déploiement 4c 200/Flight W1, et non d’une fixture inventée. Résultat /tmp/depannage-combined-current-all-tests.log. Aucune preuve fournisseur Stripe/SMS réel.

## Recette publique authentifiée 8ca6eed

Preview GitSource exact 8ca6eede1223120c663c45cd0d16bae53550471c, dpl_EJrdffmQDpQ5QAxJEa652kqbSixR, https://depannage-electricite-xlc5a4rx5-brafas-projects.vercel.app ; READY, exception publique limitée à ce déploiement. CI42326684303 SUCCESS. Flight strict rqyQrO45gNtOiP_7u3uZ7, attestation ROOT et préflight helper PASS avant fixtures. 12 contrôles publics PASS (8 accueil clair/sombre/360/390/1280/1440, 4 rôles en démonstration, API anonyme401/no-store) ; aucun débordement ni erreur JS.

Run authentifié 49ae4c9b12 : **15 contrôles PASS, zéro échec** sur la vraie preview et la vraie base dédiée. Deux comptes email QA synthétiques, aucun administrateur : login via formulaire réel ; énergie vide puis POST réel + reprise version1 sans doublon ; contact POST + liste ; adresse préférée prénom/nom POST + liste exhaustive privée ; SLA scope ; relecture de la consommation dans le vrai panneau entreprise. Second compte réellement authentifié : RLS renvoie zéro ligne pour énergie, contacts et adresses de l’autre compte. Aucun Stripe, SMS, signup réel ni vérification de téléphone revendiqués ; les comptes QA ont été préparés explicitement pour la recette.

Processus terminé, navigateur fermé puis cleanup transactionnel exact. Readback SQL indépendant : **18 périmètres tous à zéro** (Auth users/identities/sessions/refresh tokens, profils, org/sites/membres/scopes/grants, énergie/événements, contacts/événements, adresses/événements, action_limits, Storage). Pas de revendication Auth Admin404 : contrôle d’absence SQL ici. Aucun compte QA connu actif. Preuves /tmp/depannage-authenticated-8ca-{proof,postflight}.json et manifest privé hors Git.

Factures customer e9edb30 intégré 1f52c92 : revue ROOT des audiences, projections et renderer existant ; 6 tests HTTP/PDF et 40 SQL isolés PASS, tsc PASS. Migration 20261107020603 appliquée, registre et routes opérateur inchangés. L’accès client/artisan/org vise uniquement leurs factures déjà émises ; aucune émission ni confirmation bancaire créée pour tester. UI et nouvelle recette à suivre.

Site areas 1e1bb6c intégré fa0c7fe : contre-revue ROOT API/schema/SQL, 6 tests HTTP et58 SQL isolés PASS +tsc. Migration réelle 20261107021512 appliquée : étages/zones/parties communes, profondeur maximale4, anti-cycle et parent même site, quota1000, versions/rejeu/archivage. Aucun remap d’équipements ou intervention ni règle réglementaire inventée. UI et recette navigateur restent à livrer.

## Assemblage B2B suivant — 6 novembre 22h30 AST

Source fe4f24c : **1297 tests PASS, zéro échec/skip**, TypeScript strict non incrémental PASS. Cette suite inclut les nouvelles interfaces adresses/préférences, contacts, SLA, factures et le libellé de paiement qui ne présente plus le devis de base comme la somme à régler après avenants. Elle ne vaut pas recette hébergée de ces ajouts.

Étages/zones/parties communes : feuille17244cc et câblage89e9542 relus ROOT et intégrés ;8 tests ciblés PASS. Tous types de sites, lecture seule et arborescence paginée explicite. Aucun lien équipement/dossier inventé.

Copropriété3893ac8 :6 handlers HTTP et69 assertions SQL PGlite indépendants PASS ; source SQL/API relue. Migration réelle20261107022649 appliquée. Transaction réelle intégralement rollback : AG documentaire, reprise/audit unique, appel lié, refus archivage AG avec dépendance, montant gelé après émission, lecture viewer/refus écriture et cloisonnement extérieur PASS. Readback indépendant six périmètres Auth/profils/org/sites/records/events tous0. Pas de quorum, validation juridique, avis envoyé ni encaissement revendiqués. Interface en cours chez Claude.

## Preview3402 et recette UI réelle — 6 novembre 22h36 AST

https://depannage-electricite-hz1nc1lkc-brafas-projects.vercel.app — GitSource3402f6484b11bdfe8ef11f5a5a2549a6cc9348af READY, dpl_2Zaaxaz5BtWB9jL958WEsf5WMyBW, FlightogWkc4WbPUzyGDQUKUbDD, CI42329385949 SUCCESS. Exception publique limitée à ce déploiement.12 contrôles publics PASS sans débordement/erreur JS, quatre tailles et deux thèmes plus rôles démo ; API anonyme401private/no-store.

Run42072de3ba : trois comptes synthétiques (manager, viewer, client extérieur), attestation fraîche avant seed. L’essai initial conserve9 contrôles PASS puis verdict FAIL de harnais (nom accessible du champ concatène l’aide, sélecteur exact incorrect). Preuves : /tmp/depannage-authenticated-3402-proof.json. Les reprises client restent distinctes : une création réelle par formulaire PASS, puis contrôle arrêté car la présélection est à l’étape2 et non1, puis sélecteur Adresse au lieu d’Adresse d’intervention, puis variable de script non déclarée. Ces erreurs ROOT de recette ne sont ni des succès de bout en bout ni des défauts produit prouvés. Historiques conservés, aucune assertion métier affaiblie.

Faits vérifiés réellement : contacts créés via formulaire ; étage puis zone enfant créés via formulaire ; archivage parent utilisé refusé409 visible ; SLA organisation rendu ; factures organisation explicitement vides et facture inconnue404privée ; viewer lit les deux zones sans contrôle d’écriture et POST réel403 ; adresse client créée avec prénom/nom/préférence ; nouvelle demande présélectionnée à l’étape adresse ; adresse éditéeA→B puis retour nouvelle demande afficheB ; client extérieur refusé404 sur contacts/zones ; zéro erreur JavaScript. Dernière reprise en lecture seule5/5PASS, /tmp/depannage-authenticated-3402-client-final-proof.json. Pas de facture émise ni de paiement/OTP fournisseur fabriqués.

Tous processus terminés/navigateurs fermés puis cleanup SQL exact. Postflight indépendant22 périmètres tous0 (Auth users/identities/sessions/refresh_tokens, profils, org/sites/membres/scopes/grants, énergie/contacts/adresses/zones/copro et événements, action_limits, Storage). Premier postflight avait une erreur de colonne user_id au lieu de actor_id dans action_limits ; requête corrigée d’après DDL réel, sans écriture supplémentaire. /tmp/depannage-authenticated-3402-postflight.json. Aucune cohorte QA connue active.

## Reporting financier et copropriété/QR — 6 novembre

Reporting6435ba1 relu ROOT,6 handlers HTTP/CSV +23 SQL PGlite indépendants PASS. Intégréb782cf5. Agrège devis acceptés avec avenants, paiements Stripe enregistrés avec date, remboursements corroborés et reçus historiques déclarés séparément ; aucune vérification bancaire en direct ni revenu net artisan inventé. Migration réelle20261107024046 appliquée. Transaction réelle rollback : devis12k+avenant3k => accepté/engagé15k, zéro payé sans paiement ; viewer autorisé, organisation étrangère invisible.7 readbacks Auth/profils/org/sites/jobs/devis/avenants tous0.

UI copropriété2276c5c+câblage019e8f3, QR local862af8b et correction texte0e79fd4 intégrés5f53fa8. Contre-vérification ROOT46 tests ciblés0skip et tscPASS : QR SVG réellement décodé en URL exacte, pas de POST, copie/refus explicites ; composant copropriété versions/reprise/readonly/page/contraintes et texte devis-avenants. Pas encore recette hébergée de ces ajouts depuis3402.

Backendoffresad1514 :5 handlers+153 SQL isolés sur135 offres PASS, tscPASS. Pagination50+1 et lecture ponctuelle de l’offre anonyme éligible, catégorie/territoire/disponibilité actuels, refus/suspension et accès privé inchangés. En contre-revue Claude avant application SQL et UI ; ne pas le déclarer livré.

TVA363f0fe +UIc5e2d64 : contre-tests ROOT22handlers/UI ciblés+37SQLPGlitePASS, aucun skip. Migration réelle20261107024641 appliquée après vérification des quatre contraintes existantes. Transaction réelle rollback : envoi sans taux ou taux7 refusé, devis8,5% (10000HT/850TVA/10850TTC), acceptation sous identité propriétaire puis avenant2,1% (2500HT/53TVA/2553TTC) PASS.7 périmètres indépendants tous0 après rollback. Aucune détermination automatique d’éligibilité fiscale, valeurs historiques inchangées ; tscglobal attend encore un callback de démonstration number→TaxRate chez Claude.

## Assemblage source c8cf70b et correction démo

Assemblée complète :1363testsPASS0skip, TypeScript strict non incrémentalPASS. La revueROOT a ensuite reproduit un P2 que cette suite ne couvrait pas : les identifiants demo-* des offres étaient refusés par le parseur UUID live. Fixdc28393 conserve le parseur live strict et ouvre les résumés de démonstration depuis les données locales uniquement. Test vraiCourantAppChromium clicoffre→résumé→acceptationsimulée→dossier, aucunAPI ; contre-tests ciblésROOT et tsc. Ne pas confondre cette preuve démo avec RLS ni recette fournisseur.

APIoffresad1514 revue indépendammentClaude0P1P2 ; P3casseUUIDducurseur normaliséeROOT.6handlers/156SQLPGlitePASS sur135offres et bornes49/50/51. Migrationréelle20261107024741 appliquée. Transactionréelle de135offressynthétiques (dates2030 explicitementQA pour isoler la fenêtre) :51candidats→50affichables, deuxième50, dernière35, sélectionanonymeponctuelleetrefusnonartisanPASS après correction d’une parenthèse CASE dans la recette ROOT ; rollback puis6périmètres indépendants tous0. Pas de distance géographique inventée ni de nouvelle preuve de concurrence de l’acceptation existante.


## Preview467 et parcours client-artisan réel — 6 novembre23h05 AST

https://depannage-electricite-7u0f47efr-brafas-projects.vercel.app — source46708c7e860ee0ba633419834dd62f4c77868ba7, dpl_7KEazdWanMLwEjHE5VsJtGPAMePJ READY, FlightRq7iGcHUYnNTS6LcLYR0x, CI42331625645 SUCCESS.12 contrôles publics PASS, quatre tailles/deux thèmes et rôles démo, cookies0/aucun débordement/erreurJS, tracking anonyme401JSONprivate,no-store.

Run eeaf6e94b1 :18 actions listées PASS. Création client par formulaire réel ; offre ponctuelle anonyme puis acceptation artisan verrouillée ; taux explicite8,5%, devis15000HT/1275TVA/16275TTC ; client reçoit le devis et artisan reçoit l'acceptation sans reload/relogin ; génération snapshot201 et téléchargement privé200 application/pdf avec signature%PDF- ; compte rendu par API réelle, début/fin, QR local ; aucun statut payé fabriqué, Stripe configuration_required/payment_availablefalse ; factures vides honnêtes ; AG copropriété formulaire réel et viewer sans écriture ; client390sans débordement/aucune erreurJS. Ce contrôle Realtime porte seulement sur les deux mises à jour observées.

Verdict exact PASS_FOR_LISTED_ACTIONS_WITH_OPEN_FINDINGS, pas application complète. Finding : client connecté nouvelle demande encore trois étapes sans choix du paiement, et source sans request_id ; correction confiée au lead. Autre constat visuel : carte localisation fournisseur non choisi. Premier essai FAIL de harnais check() sur catégorie bouton au lieu de radio,0 dossier avant reprise ; original conservé sans réécriture. Preuves privées /tmp/depannage-core-467-attempt2-proof.json et premier /tmp/depannage-core-467-proof.json.

Après fin/navigateurs fermés, nettoyage exact puis22 périmètres SQL indépendants tous0 : Auth users/identities/sessions/refresh_tokens, profils/artisan, org/sites/membres, jobs/devis/avenants/messages/notifications/documents/events/copro/audit/action_limits/Storage. /tmp/depannage-core-467-postflight.json, capture2026-11-07T03:05:42.099Z. AuthAdmin404 non revendiqué. Aucun compte QA connu actif, identités consommées à ne pas réutiliser.

## Revue remboursement — 6 novembre23h17 AST

Code45787bc intégré avec116ccce : contre-testsROOT29HTTP/régressions et37SQL isolés PASS ; anciens tests financiers corrigés en créant les faits historiques avant la nouvelle exigence d'exécution, puis migration et preuve d'historique inchangé/nouvelle clôture sans exécution refusée :26SQL reporting et revue plateforme41migrations PASS. Le découpage détecte le suffixe_refund_execution.sql, ne dépend pas de son horodatage. Les anciens échecs de fixtures après durcissement sont conservés dans les logs. Aucun appel Stripe ni remboursement bancaire réel ; politique non configurée, contrôle indisponible honnête. Application cloud et UI suivent séparément.

Migration réelle20261107031755 appliquée après inspectionRLS/signatures existantes. Contrôles réels sans fixture financière : tables privéesRLS, aucunSELECT anon/authenticated, writerhistorique inaccessible mêmeau service_role, unknownactorcapfalse et préparation/lecture refusées42501, settlementservice sansbinding refuséP0001exact. Transactionrollback ; vérificationsSQL aprèsrollback Auth0/executions0/events0 sur identifiants techniques. Pas de compteadmin/synthétique, pas de paiement ni événement bancaire créé. Ce contrôle négatif ne vaut pas recettepositiveStripe.

UI097efca/3064db9 assemblée : vrais testsChromiumROOT quatrePASS, zéroFAIL/zéroskip, unTODO échoue effectivement sur le choix du paiement manquant et reste ouvert. Le parcours interactif démo complet et isolement des documents de démo passent ; ce n'est pas une preuve RLS.
