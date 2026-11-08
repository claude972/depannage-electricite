# Décision sur un devis ancien dans l’espace entreprise — 7 novembre 2026

La preview `eff0061c0c6b20b93f955552a61bf0689bec9245`, déploiement `dpl_5oRABr8cwpRLSKWRpebwnvin4sHZ`, renvoie 200 sans connexion Vercel et sert le build `-mUz-c72Z5rwzYol4q0r5`. Le commit est intégré à `integration/web-pwa`. [Preview](https://depannage-electricite-k098dsnpw-brafas-projects.vercel.app)

## Code et contrôles ciblés

Astra a ajouté le contexte de décision exact sous RLS. Claude a raccordé le détail aux commandes existantes et au circuit avancé. La revue a conduit à isoler les preuves et le motif par identité, organisation, site et devis, et à ajouter la reprise sur erreur ainsi que le lien vers l’approbation exacte. Le détail par défaut utilise aussi le site actif pour les lignes déjà chargées. Les 38 tests combinés et TypeScript strict passent. Les tests couvrent notamment le 503, la réponse retardée après changement de périmètre et l’absence de commande pour un devis ancien, expiré ou en attente d’approbation.

## Recette entreprise hébergée

L’essai `556d12de8b6d` s’est terminé sans erreur. Le devis et son dossier sont hors des 200 et 100 lignes de démarrage. L’API retrouve les 201 approbations en cinq pages. Le lecteur peut consulter et reçoit 403 sur la décision. Le périmètre étranger reçoit 404.

Le gestionnaire voit l’acceptation bloquée tant que l’approbation attend sa décision. Le lien ouvre l’approbation exacte. Le gestionnaire approuve depuis cet écran, revient au devis exact et confirme l’acceptation. Les POST portent les identifiants attendus. La relecture confirme les statuts approuvé et accepté, et zéro paiement pour le devis. L’écran d’approbation passe à 360, 390 et 1 280 px. Le navigateur est fermé, les 51 étapes de nettoyage passent, puis les 121 lectures indépendantes confirment l’absence des données de recette sur 1 794 cibles REST.

Le brouillon public hors ligne est vérifié sur la même preview dans Chromium à 390 px. Il survit au rechargement et est repris au retour du réseau. Le cache contient les trois fichiers publics hors ligne et aucune écriture API n’est observée.

## Régression client–artisan sur le même déploiement

L’essai `6308109a5406` passe ses 12 étapes. Depuis les écrans, le client corrige son téléphone, soumet la demande, consulte et accepte le devis. Le rejeu de la demande retourne le même dossier. L’artisan accepte la mission, enregistre et envoie le devis, passe en route puis sur place, commence les travaux, enregistre son compte rendu et clôture l’intervention. La validité et le PDF privé sont aussi vérifiés par HTTP avec les identités correspondantes.

L’état final est « terminée », avec un devis accepté à 100 € et le règlement attendu sur la plateforme. Aucun paiement ou règlement n’est enregistré. Les 24 étapes de nettoyage et 29 lectures indépendantes passent. Aucune cohorte de recette connue active après les contrôles.

Les deux jobs CI du commit déployé passent. [CI](https://github.com/claude972/depannage-electricite/actions/runs/42435058811)
