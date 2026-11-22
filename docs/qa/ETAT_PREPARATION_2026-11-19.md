# État de préparation — 19 novembre 2026 UTC

Ce relevé distingue les preuves de recette des conditions d'ouverture réelle. Les anciens journaux de livraison conservent leurs dates et ne constituent pas un feu vert de production.

## Ce qui est démontré

- Web/PWA : parcours de recette avec comptes synthétiques, administration 35/35 et PWA 22/22 sur le candidat 1483d4b8.
- Paiement Stripe TEST INT-5B12D9 de 130,20 € confirmé par webhook et état serveur, avec écran client réglé.
- Correctif Checkout livré sur la recette `5zggqivyj` : les deux événements fournisseur sont associés au paiement ; commission 22,13 € inscrite une seule fois, rejeu sans doublon et règlements antérieurs inchangés. Voir CORRECTIF_CHECKOUT_2026-11-19.md.
- Android et iOS simulateur : connexion, lecture des espaces client/artisan/entreprise, restauration de session et déconnexion. Android : erreur réseau et reprise vérifiées.
- Source publiée dans la PR #9, sans merge ni publication aux stores.

## Ce qui empêche d'annoncer « prête pour les clients réels »

1. Les preuves Stripe concernent un sandbox et des comptes synthétiques ; elles ne valident pas la configuration et l'exploitation des encaissements réels. Aucun mode live n'a été activé par cette intervention.
2. L'écran Finance de recette indique « Émetteur plateforme non configuré » et « Taux de commission non configuré ». Le Checkout de test a sa commission figée propre ; elle ne vaut pas validation des paramètres commerciaux de production. Aucun taux ni renseignement d'émetteur ne doit être inventé.
3. Les binaires natifs ont été testés en émulation/simulation pour les actions énumérées. Les écritures et le paiement de bout en bout en natif, les appareils physiques, les builds de distribution et les stores ne sont pas couverts par ces preuves.

La correction financière est vérifiée sur la candidate de recette. Elle ne transforme pas ces éléments non vérifiés en contrôles réussis et n'autorise pas à annoncer une application entièrement prête pour une ouverture commerciale.

Références : RECETTE_NATIVE_2026-11-18.md, RAPPROCHEMENT_STRIPE_TEST_2026-11-18.md, capture finance-ui/rapprochement-apres.png dans la livraison privée de recette. Les constats de configuration ci-dessus sont ceux de la recette, pas une lecture d'une configuration de production.

## Reprise du 19 novembre, heure de Martinique

Les [brouillons commerciaux](../lancement/README.md) ont été créés à la demande du propriétaire. La [préparation technique complémentaire](PREPARATION_COMMERCIALE_2026-11-19.md) suit Next16.4.6, les correctifs CI, les tests sur disque externe et la demande Android relue sur iOS. Le [plan de vérification complète](PLAN_VERIFICATION_COMPLETE_2026-11-19.md) et sa matrice des 76 capacités ajoutent explicitement tous les parcours aux tâches en cours. Ces ajouts ne constituent pas un feu vert de lancement.
