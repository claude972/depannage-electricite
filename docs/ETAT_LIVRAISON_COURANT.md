# État courant — 7 novembre 2026, Martinique

Objectif : application entière, seuls raccordements Stripe et SMS différés. PaletteB cobalt/orange, clair/sombre, Jakarta, aucun nom de marque retenu. Aucun cron de suivi, aucune production/main/store/transaction réelle.

## Référence en ligne

https://depannage-electricite-2jcup0522-brafas-projects.vercel.app

Version `610b13f1a4c03b861d57915ef5c324501a274b52` intégrée et poussée, 1 509 tests réussis, 2 tests facultatifs ignorés, TypeScript strict et compilation webpack réussis. Preview READY `dpl_FzQDRm7B3KRL1dT9dZwizHD9FTyM`, build `sMd0H5MCAOCFLc3pUAiks`. Les deux jobs de [la CI](https://github.com/claude972/depannage-electricite/actions/runs/42383082429) passent sur ce SHA.

Recette navigateur connectée à 390 px sur la preview. Connexion du client de test, demande générale, adresse, refus sans choix du règlement, choix après intervention, envoi HTTP 201, affichage du dossier et rejeu avec le même identifiant. La base confirme un seul dossier et une seule réservation, aucun paiement ni document. Le nettoyage de ce compte temporaire a été suivi de 11 lectures indépendantes à zéro. Les deux routes de publication répondent 200 avec `published: null` et `no-store`. Éditeur privé et suivi anonyme refusés avec HTTP 401. [Rapport de recette](reviews/DELIVERY_610B_HOSTED.md)

### Version précédente `a8d0d9d`

https://depannage-electricite-ealsdykya-brafas-projects.vercel.app

Source `a8d0d9d110f756df0f88573a16824b68f40247df`, preview `dpl_2cL6SfpANbBsHy5arHQrZRBMGGnB` READY et [CI verte sur les deux jobs](https://github.com/claude972/depannage-electricite/actions/runs/42380092393). Le formulaire connecté passe par la confirmation et le choix du règlement avec une clé stable. L’interface d’exécution du remboursement est raccordée. Le navigateur à 390 px a rejoué deux scénarios de démonstration sur cette preview, dont le parcours demande → choix du règlement → offre artisan → devis → fin d’intervention. Aucune requête métier ni erreur JavaScript pendant ces scénarios. Accueil public HTTP 200 et suivi anonyme HTTP 401 avec `private, no-store`.

Recette publique sans soumission sur cette preview. Les huit fiches affichent leur estimation et photo et ouvrent le formulaire jusqu’aux coordonnées à 360 px en clair et 1440 px en sombre, 16 contrôles réussis. Le parcours « Plusieurs prises sans courant » à 390 px arrive jusqu’au récapitulatif après le choix du règlement sur la plateforme après travaux. Empreinte et SMS signalés indisponibles, aucune écriture ni erreur JavaScript.

### Recette authentifiée précédente, version `46708c7`

https://depannage-electricite-7u0f47efr-brafas-projects.vercel.app

Source46708c7e860ee0ba633419834dd62f4c77868ba7, preview GitSource READY, CI42331625645 SUCCESS. Assemblage c8cf :1363 tests0skip+tsc strictPASS ; correction démo ensuite22 tests ciblés+tscPASS.12 contrôles publics PASS. Recette authentifiée eeaf6e94b1 :18 actions listées PASS, dont demande réelle, offre anonymisée puis acceptation artisan, devis TVA8,5%, acceptation client, mises à jour Realtime devis/acceptation sans rechargement, PDF privé réel, début/compte rendu/fin, QR et copropriété manager/viewer. Verdict borné PASS_FOR_LISTED_ACTIONS_WITH_OPEN_FINDINGS : choix paiement absent du nouveau formulaire client connecté, en correction. Le premier essai conserve son FAIL de sélecteur de harnais. Nettoyage terminé et22 lectures indépendantes toutes0. Aucune preuve de paiement fournisseur ni GPS physique.

À cette recette, 41 migrations étaient appliquées. Contacts, énergie, adresses préférées, SLA, factures privées, admin réponse/fiche client, lien paiement, zones, copropriété, reporting, TVA explicite et offres artisan paginées intégrés. Les anciennes preuves8ca/3402 restent bornées à leurs SHA, sans réécriture de leurs résultats.

## Travail actif et limites

Remboursement plateforme intégré avec la migration `20261107031755`. Le scénario SQL avancé vérifie le refus de solder sans preuve qualifiée, les montants et le rejeu. Les contrôles hébergés du parcours financier réel attendent le raccordement Stripe.

L’assemblage intégré en `610b13f` comprend le remplacement d’empreinte, l’historique des justificatifs, les paramètres et l’archivage des sites, les liens entre dossiers et équipements/zones, la chronologie B2B et l’éditeur des informations publiques. L’énergie consolidée déclarative et les conditions de garantie disposent d’API versionnées. La recette navigateur authentifiée du commit couvre la demande client. Les opérations des autres rôles ont des preuves ciblées, avec des essais en ligne à compléter. [Assemblage groupé](https://github.com/claude972/depannage-electricite/pull/2)

Les huit migrations de l’assemblage ont été appliquées à la base dédiée, soit 49 au total. Supabase leur a attribué les versions `20261107144124` à `20261107144139`. La demande générale connectée rejetait les identifiants `demande-*` côté base. La migration `20261107144139_signed_booking_categories.sql` accepte les cinq paires identifiant/catégorie. Une transaction PostgreSQL hébergée a confirmé les cinq créations et leurs rejeux, ainsi que le refus d’une paire incohérente. Après annulation de la transaction, les six lectures Auth, profil, réservation, dossier, clé et audit ne trouvent aucune ligne de la recette. L’éditeur attend une recette positive avec le compte propriétaire.

Voir le [plan des 76 capacités](PLAN_LIVRAISON_INTEGRALE.md) et l’[inventaire des écarts](RESTE_A_LIVRER_ACTUEL.md). L’activation du compte propriétaire Super Admin reste différée. Aucun compte QA connu actif. Stripe, Vonage et la recette native restent à faire.
