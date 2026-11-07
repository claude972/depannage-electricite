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
