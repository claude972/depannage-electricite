# Recette Web/PWA du 7 novembre 2026

Application `a18f507db16df2adf2343e48742f415b32de3986` sur `integration/web-pwa`. Vercel confirme la source Git, le déploiement `dpl_4DqE9GbatJtLe5nTYd7pJ6wZAvAX` et le build Flight `s12J9IQRmqik11EU0xm4R`. La page répond HTTP 200 sans session Vercel. [Preview de recette](https://depannage-electricite-2gs193aoe-brafas-projects.vercel.app)

- Les 2 014 tests applicatifs locaux passent sur `147d8ae`. Le diff jusqu’à `a18f507` porte sur la migration du planificateur et deux tests SQL. La CI de `a18f507` valide TypeScript, les deux compilations et la suite SQL isolée. [CI du commit servi](https://github.com/claude972/depannage-electricite/actions/runs/42424484982)
- Le premier déploiement du schéma applique neuf migrations puis refuse la modification directe de `cron.job`. Le rôle installateur a le droit d’utiliser `cron.schedule_in_database`. La migration corrigée crée le rappel opérationnel inactif. La reprise applique 33 migrations. La lecture indépendante confirme 91 versions, le barème V1 et les portes de publication tarifaire et de notifications externes fermées.
- Les huit fiches répondent à 360 px en clair et à 1 440 px en sombre. Chaque estimation et photo est lisible. « Confirmer » puis « Continuer » ouvrent l’étape des coordonnées avec le champ « Prénom ». Seize cas, aucune écriture ni erreur navigateur. Le barème public répond 200 et les routes privées de réservation, suivi et administration tarifaire répondent 401 sans session.
- Le client connecté passe par le choix du règlement. La confirmation renvoie 201, le devis reste à établir et le rejeu renvoie le même dossier. La base confirme un dossier, une réservation avec estimation V1, zéro paiement et zéro document. Le premier contrôle de lecture avait cherché les paiements par une colonne absente. Le second essai vérifie le lien par les devis. Douze lectures indépendantes à zéro après chacun des deux nettoyages.
- Chromium retrouve le brouillon après rechargement hors connexion, puis le reprend en ligne sans écrire sur le serveur. Les routes IGN renvoient des suggestions pour Fort-de-France, dont une recherche inverse à coordonnées fournies. Une coordonnée invalide donne 400.
- La recette métier initiale `2bdc1016136b` reste à neuf succès et cinq échecs. Quatre échecs viennent des anciennes assertions sur les avenants et les lectures POST. Le cinquième mesure un débordement entreprise à 360 px. Le nettoyage est complet et 163 lectures indépendantes le confirment.
- La reprise devis `8bc80c1ce9bb` avec le harnais `82a0622` réussit sept scénarios sur sept, dont l’acceptation d’avenant sans paiement, le PDF privé et le refus après réaffectation. Les 68 lectures indépendantes confirment le nettoyage. La recette entreprise après correction du débordement se suit séparément.

Les raccordements Stripe et Vonage restent différés. Les résultats de localisation utilisent des coordonnées fournies. Les preuves de navigation concernent Chromium.

## Correction de la fiche entreprise

La preview `256ec5cb0a2b0352b63987e4c327010729953b7d` sert le correctif `13dae48` de Claude. Déploiement `dpl_EQMm21XaxheXU4MGcrSvn733AAt6`, Flight `VZ1FBbEFd3XJmnK2cnQAe`, HTTP 200 sans session Vercel. Aucun changement de schéma depuis `a18f507`. [Preview corrigée](https://depannage-electricite-g75a26xmo-brafas-projects.vercel.app)

Les 25 tests ciblés passent. La fiche réelle tient à 360, 390 et 1 280 px en test local, au chargement et après un 503 simulé. En ligne, la reprise entreprise `e17d07d96322` passe sept scénarios sur sept. À 360 px, le site s’affiche sans débordement et « Réessayer » rétablit les données après le 503 injecté. Le test confirme aussi la lecture seule, le refus des écritures directes et le cloisonnement des organisations. Les 95 lectures indépendantes confirment le nettoyage.

Les seize vérifications des fiches publiques passent également sur cette preview. Les preuves de réservation connectée, brouillon PWA et devis ci-dessus restent rattachées à `a18f507`.

La CI de `256ec5c` réussit sur ses deux jobs. Le suivi GPS `a0209e1d210a` réussit les treize scénarios sélectionnés, dont la péremption, la reprise, la révocation, le changement d’identité, l’itinéraire et le géocodage IGN. Les positions du navigateur sont émulées sur des coordonnées publiques. Les 194 lectures indépendantes confirment le nettoyage. [CI du correctif](https://github.com/claude972/depannage-electricite/actions/runs/42425995406)
