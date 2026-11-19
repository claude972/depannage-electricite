# État de préparation — 19 novembre 2026 UTC

Ce relevé distingue les preuves de recette des conditions d'ouverture réelle. Les anciens journaux de livraison conservent leurs dates et ne constituent pas un feu vert de production.

## Ce qui est démontré

- Web/PWA : parcours de recette avec comptes synthétiques, administration 35/35 et PWA 22/22 sur le candidat 1483d4b8.
- Paiement Stripe TEST INT-5B12D9 de 130,20 € confirmé par webhook et état serveur, avec écran client réglé.
- Preuves de charge et commission 22,13 € qualifiées par lectures Stripe ; règlements de test inscrits sans doublon.
- Android et iOS simulateur : connexion, lecture des espaces client/artisan/entreprise, restauration de session et déconnexion. Android : erreur réseau et reprise vérifiées.
- Source publiée dans la PR #9, sans merge ni publication aux stores.

## Ce qui empêche d'annoncer « prête pour les clients réels »

1. Le défaut d'association automatique Checkout/commission est corrigé dans le code et testé ; sa livraison et sa vérification en ligne sont en cours. La revue manuelle précédente ne constituait pas cette correction. Voir CORRECTIF_CHECKOUT_2026-11-19.md.
2. Les preuves Stripe concernent un sandbox et des comptes synthétiques ; elles ne valident pas la configuration et l'exploitation des encaissements réels. Aucun mode live n'a été activé par cette intervention.
3. L'écran Finance de recette indique « Émetteur plateforme non configuré » et « Taux de commission non configuré ». Le Checkout de test a sa commission figée propre ; elle ne vaut pas validation des paramètres commerciaux de production. Aucun taux ni renseignement d'émetteur ne doit être inventé.
4. Les binaires natifs ont été testés en émulation/simulation pour les actions énumérées. Les écritures et le paiement de bout en bout en natif, les appareils physiques, les builds de distribution et les stores ne sont pas couverts par ces preuves.

La correction financière peut rendre la candidate apte à une recette supplémentaire. Elle ne transforme pas ces éléments non vérifiés en contrôles réussis et n'autorise pas à annoncer une application entièrement prête pour une ouverture commerciale.

Références : RECETTE_NATIVE_2026-11-18.md, RAPPROCHEMENT_STRIPE_TEST_2026-11-18.md, capture finance-ui/rapprochement-apres.png dans la livraison privée de recette. Les constats de configuration ci-dessus sont ceux de la recette, pas une lecture d'une configuration de production.
