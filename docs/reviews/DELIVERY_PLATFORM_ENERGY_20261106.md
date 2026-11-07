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
