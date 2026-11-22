# Historique de garantie sur la preview e100a63

La preview [e100a63](https://depannage-electricite-fostd65wu-brafas-projects.vercel.app) sert le commit `e100a63a771dc5bcb16021b0c4eba9d410059ca1` de `integration/web-pwa`. Vercel confirme le déploiement `dpl_79HBvQKScWrq75q1XxpJb5Tj5NDH` et le HTML public confirme le build `CQJdc-jvGrlbSkUYce_uL`. L'accès public a été appliqué à cette preview.

## Vérifications

- Le parcours `72c0e16b3d57` a utilisé deux comptes temporaires et 103 dossiers synthétiques. Un client a ouvert un ancien dossier payé absent des 100 interventions récentes et retrouvé sa demande en cours.
- Avec 103 demandes synthétiques, la liste globale a retourné 100 puis 3 résultats. Un dossier a retourné 100 puis 2 résultats, avec sa demande active en dernière position et un indicateur actif dès la première page. L'ordre a conservé les égalités et les microsecondes. Un dossier sans demande a retourné une liste vide et l'absence confirmée de demande active.
- Le serveur a refusé les accès anonyme et tiers et les curseurs d'une autre identité ou d'un autre dossier. Le tiers ne voyait aucune demande dans sa liste.
- Dans Chromium à 390 et 1 280 px, une erreur 503 interceptée a donné un état d'erreur, puis « Réessayer » a récupéré le dossier réel. Le chargement de la deuxième page a rendu la demande active visible. Le changement de dossier a retiré les résultats précédents. Aucun débordement, erreur JavaScript, dépôt de demande ou paiement observé.
- Le nettoyage a terminé avec 24 étapes réussies. Le 7 novembre 2026 à 22 h 08 en Martinique, 81 lectures indépendantes ont vérifié l'absence des deux comptes et des lignes des dossiers temporaires, dont les demandes de garantie. Le premier essai `ba53574a5416` s'était arrêté sur une incohérence des champs du lot de données de test. Son nettoyage et ses 81 lectures indépendantes ont abouti avant le second essai.
- Les 34 tests ciblés et TypeScript strict passent. Le test PostgreSQL isolé confirme 10 assertions sur la pagination et l'isolation de 106 demandes. Le premier lancement complet local a échoué sur l'absence de `web-push` dans les dépendances partagées. Les 9 tests des fichiers concernés passent avec la version 4.0.0 épinglée et chargée depuis un dossier temporaire. La suite locale relancée avec cette dépendance a donné 2 115 tests réussis, 2 ignorés et aucun échec. Les deux jobs GitHub ont réussi. [CI du commit e100a63](https://github.com/claude972/depannage-electricite/actions/runs/42436871715)

Le dépôt réel reste désactivé sur la preview. La résolution et le rattachement correctif par Super Admin restent couverts par les tests isolés, dans l'attente de la recette avec le compte de l'exploitant. Les états payés ont été préparés en base pour tester la lecture, sans paiement.
