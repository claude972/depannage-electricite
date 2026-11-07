# État courant — 7 novembre 2026, Martinique

Objectif : application entière, seuls raccordements Stripe et SMS différés. PaletteB cobalt/orange, clair/sombre, Jakarta, aucun nom de marque retenu. Aucun cron de suivi, aucune production/main/store/transaction réelle.

## Référence en ligne

https://depannage-electricite-ealsdykya-brafas-projects.vercel.app

Source `a8d0d9d110f756df0f88573a16824b68f40247df`, preview `dpl_2cL6SfpANbBsHy5arHQrZRBMGGnB` READY et [CI verte sur les deux jobs](https://github.com/claude972/depannage-electricite/actions/runs/42380092393). Le formulaire connecté passe par la confirmation et le choix du règlement avec une clé stable. L’interface d’exécution du remboursement est raccordée. Le navigateur à 390 px a rejoué deux scénarios de démonstration sur cette preview, dont le parcours demande → choix du règlement → offre artisan → devis → fin d’intervention. Aucune requête métier ni erreur JavaScript pendant ces scénarios. Accueil public HTTP 200 et suivi anonyme HTTP 401 avec `private, no-store`.

### Recette authentifiée précédente, version `46708c7`

https://depannage-electricite-7u0f47efr-brafas-projects.vercel.app

Source46708c7e860ee0ba633419834dd62f4c77868ba7, preview GitSource READY, CI42331625645 SUCCESS. Assemblage c8cf :1363 tests0skip+tsc strictPASS ; correction démo ensuite22 tests ciblés+tscPASS.12 contrôles publics PASS. Recette authentifiée eeaf6e94b1 :18 actions listées PASS, dont demande réelle, offre anonymisée puis acceptation artisan, devis TVA8,5%, acceptation client, mises à jour Realtime devis/acceptation sans rechargement, PDF privé réel, début/compte rendu/fin, QR et copropriété manager/viewer. Verdict borné PASS_FOR_LISTED_ACTIONS_WITH_OPEN_FINDINGS : choix paiement absent du nouveau formulaire client connecté, en correction. Le premier essai conserve son FAIL de sélecteur de harnais. Nettoyage terminé et22 lectures indépendantes toutes0. Aucune preuve de paiement fournisseur ni GPS physique.

41 migrations appliquées. Contacts, énergie, adresses préférées, SLA, factures privées, admin réponse/fiche client, lien paiement, zones, copropriété, reporting, TVA explicite et offres artisan paginées intégrés. Les anciennes preuves8ca/3402 restent bornées à leurs SHA, sans réécriture de leurs résultats.

## Travail actif et limites

Remboursement plateforme intégré avec la migration `20261107031755`. Le scénario SQL avancé vérifie le refus de solder sans preuve qualifiée, les montants et le rejeu. Les contrôles hébergés du parcours financier réel attendent le raccordement Stripe.

La branche `codex/full-delivery-assembly` réunit le remplacement d’empreinte, l’historique de revue des justificatifs, le cycle de vie des sites, les liens entre dossiers et équipements/zones, la chronologie B2B et la configuration des informations publiques. Les migrations et interfaces de ce lot sont à recetter ensemble avant la mise en ligne. Les vérifications locales et la preview `a8d0d9d` couvrent des versions distinctes.

Voir le [plan des 76 capacités](PLAN_LIVRAISON_INTEGRALE.md) et l’[inventaire des écarts](RESTE_A_LIVRER_ACTUEL.md). L’activation du compte propriétaire Super Admin reste différée. Aucun compte QA connu actif. Stripe, Vonage et la recette native restent à faire.
