# État courant — 7 novembre 2026, Martinique

Objectif : application entière, seuls raccordements Stripe et SMS différés. PaletteB cobalt/orange, clair/sombre, Jakarta, aucun nom de marque retenu. Aucun cron de suivi, aucune production/main/store/transaction réelle.

## Référence en ligne

La preview `81742d3` distingue les canaux de notification indisponibles des préférences et de l’inscription de ce navigateur. La recette a vérifié les trois canaux indisponibles, l’absence d’inscription du navigateur et zéro écriture après une modification sans enregistrement. [Preview actuelle](https://depannage-electricite-ngl9mjr03-brafas-projects.vercel.app) · [Recette](reviews/DELIVERY_817_CHANNEL_LABELS.md)

La preview précédente `e4ab640` contient les cinq lots ci-dessous. Le code est poussé sur `integration/web-pwa`. Les preuves fonctionnelles correspondent aux commits indiqués. [Preview e4ab640](https://depannage-electricite-csz4c0bv8-brafas-projects.vercel.app)

- Le compte rendu artisan verrouille l’éditeur pendant le POST. Le rapport confirmé s’affiche et un 503 simulé conserve le brouillon. Le nettoyage est vérifié. [Recette e4ab640](reviews/DELIVERY_E4A_ARTISAN_REPORT_LOCK.md)
- Le filtre « Non lues » garde son curseur lorsqu’une page « Toutes » arrive en retard. La 26e notification est chargée sans réafficher de notification lue. [Recette c028d74](reviews/DELIVERY_C028_NOTIFICATION_FILTER.md)
- L’assistance rejoue exactement une demande après une réponse perdue et retrouve un seul ticket. Le brouillon distinct est conservé. [Recette 5a98914](reviews/DELIVERY_5A9_SUPPORT_REPLAY.md)
- L’équipe prestataire peut affecter la 51e intervention. Le technicien la prend en compte et perd son accès après retrait. Le panneau de garantie propose également la version de conditions enregistrée avec une demande. [Recette 58b6b92](reviews/DELIVERY_58B_PROVIDER_TEAMS.md)
- Les anciens dossiers et demandes de garantie sont accessibles au-delà de la première page, avec reprise après erreur et refus pour le tiers. [Recette e100a63](reviews/DELIVERY_E100_WARRANTY_HISTORY.md)

### Version précédente `eff0061`

La preview `eff0061` permet au gestionnaire d’approuver puis d’accepter le devis exact d’un dossier ancien. Le lecteur est en lecture seule et la décision en attente bloque l’acceptation. Sur la même version, les douze étapes du parcours client–artisan passent jusqu’à l’intervention terminée, PDF privé vérifié et règlement encore attendu. Le brouillon PWA passe dans Chromium et WebKit. Les seize cas publics WebKit et l’affichage Safari sur simulateur iPhone sont vérifiés selon les conditions du rapport. Les nettoyages passent. [Preview](https://depannage-electricite-k098dsnpw-brafas-projects.vercel.app) · [Preuves](reviews/DELIVERY_EFF_ENTERPRISE_DECISION.md)

### Version précédente `9e6d24f`

La preview `9e6d24f` retrouve les anciens devis et contrats depuis les écrans. Le client accepte le devis courant hors des listes initiales. L’entreprise ouvre l’ancienne version exacte, archive un contrat de la troisième page et voit le statut relu. Le changement d’organisation purge le brouillon. Le brouillon PWA reste récupérable hors connexion et les nettoyages passent. [Preview](https://depannage-electricite-huai4bhrp-brafas-projects.vercel.app) · [Preuves](reviews/DELIVERY_9E6_QUOTES_CONTRACTS.md)

### Version précédente `635e41d`

La preview `635e41d` retrouve et décide une approbation ancienne avec l’identité du gestionnaire. La recette passe à 360, 390 et 1 280 px, avec refus de décision pour le lecteur et refus hors organisation. Le nettoyage est vérifié. La réaffectation et le fil administrateur ont des tests ciblés et attendent la recette positive avec le compte propriétaire. [Preview](https://depannage-electricite-l5vibd0zx-brafas-projects.vercel.app) · [Preuves](reviews/DELIVERY_635_APPROVALS.md)

### Version précédente `9526e05`

La preview `9526e05` corrige les libellés accessibles des coordonnées et passe le parcours client–artisan depuis les écrans jusqu’à la clôture. Le règlement reste attendu sur la plateforme. Les seize contrôles publics, le brouillon PWA et le nettoyage du parcours passent sur cette version. [Preview](https://depannage-electricite-25cxpsuy9-brafas-projects.vercel.app) · [Preuves](reviews/DELIVERY_952_CONTACT_CORE.md)

### Version précédente `71f1eb0`

La preview `71f1eb0` a passé quatre scénarios hébergés sur les rapports, la fiche site, les statistiques et le devis exact. Le parcours central crée, attribue et termine un dossier, avec un devis accepté et un règlement attendu sur la plateforme. Les fiches publiques et le brouillon PWA hors ligne ont été rejoués. La CI du commit passe. [Preview](https://depannage-electricite-nrvv4d24m-brafas-projects.vercel.app) · [Recette et nettoyage](reviews/DELIVERY_71F_SCOPED_RECORDS.md)

### Version précédente `256ec5c`

La version de recette `256ec5c` corrige le débordement de la fiche entreprise à 360 px. Les sept scénarios entreprise et les seize contrôles des fiches publiques passent sur ce déploiement. La réservation connectée avec rejeu, le brouillon PWA et les devis privés ont été vérifiés sur `a18f507`. [Preview corrigée](https://depannage-electricite-g75a26xmo-brafas-projects.vercel.app) · [Recette et limites](reviews/DELIVERY_A18_HOSTED.md)

### Version précédente `610b13f`

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
