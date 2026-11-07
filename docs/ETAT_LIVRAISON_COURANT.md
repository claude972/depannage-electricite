# État courant — 6 novembre 2026, Martinique

Objectif : application complète, tous rôles et modules ; seules connexions Stripe/SMS différées. Aucun cron de suivi, aucune production/main/store/transaction réelle. Palette B cobalt/orange, clair/sombre, Jakarta, aucun nom de marque choisi.

## Livré et vérifié en ligne

App de référence : https://depannage-electricite-xlc5a4rx5-brafas-projects.vercel.app

Source 8ca6eede1223120c663c45cd0d16bae53550471c ; preview Git liée READY, CI42326684303 SUCCESS ; 1222 tests PASS sans skip et tsc strict. 12 contrôles publics PASS ; parcours public prestation→urgence→coordonnées→adresse→paiement→récapitulatif contrôlé sur le précédent assemblage 7b4eed7, avec bouton inline + barre basse et aucun POST de réservation/paiement.

Recette réelle 8ca : login, énergie, reprise sans doublon, contact, adresse préférée, SLA et refus RLS entre deux comptes : 15 contrôles PASS. Nettoyage terminé ; 18 readbacks indépendants tous0. Aucun compte QA connu actif. Voir docs/reviews/DELIVERY_PLATFORM_ENERGY_20261106.md pour la portée exacte ; ne pas extrapoler ces preuves à tous les parcours.

## Intégré depuis cette preview, encore à redéployer/recetter

Réponse opérateur auditée et attribution explicite des auteurs ; fiche client admin ; lien de suivi artisan et paiement client sous son identité ; contacts dans fiche site ; SLA consolidé ; carnet d’adresses avec prénom/nom et préselection. Tests ciblés passants ; contre-revue en cours des petits correctifs et du câblage. Factures privées client/artisan/organisation : backend et RPC revus/appliqués, UI en cours.

35 migrations sont appliquées sur kcpyjzndybfdlnhvscbs, dont huit nouvelles depuis001–027 (déclarations directes fermées, énergie, Checkout différé, contacts, réponse admin, adresses, SLA consolidé, lecteurs factures). Stripe/SMS non raccordés ; aucun faux paiement ou OTP permis.

## Travail restant connu

Terminer et recetter les UI ci-dessus ; étages/zones/parties communes en implémentation backend ; AG/appels de fonds et autres capacités avancées encore à compléter depuis leur modèle fonctionnel. Vérifier les capacités du catalogue une à une depuis le code actuel, pas les anciens statuts CSV. Paramètres d’exploitation/identité légale/commission/barème restent des valeurs à configurer, sans invention. Activation propriétaire SuperAdmin différée : aucun compte substitut créé. Maquettes complètes et preuves mobile physique ne sont pas acquises par héritage. Aucune déclaration d’application entière terminée à ce stade.
