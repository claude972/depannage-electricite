# Équipe prestataire et conditions de garantie sur la preview 58b6b92

La preview [58b6b92](https://depannage-electricite-a0yypium7-brafas-projects.vercel.app) sert le commit `58b6b9258c0a680378fb087c407f9cf4d167e212` de `integration/web-pwa`. Vercel confirme le déploiement `dpl_9sGJ7jT38zVFRAG9TWu9Mifkdhpb`. Le HTML public confirme le build `K6EMov51jnahR5YGQDM4u`.

## Recette équipe prestataire

- Le parcours `477826bbcbd3` a utilisé trois comptes temporaires, une équipe de deux membres et 51 interventions synthétiques. L'API a retourné les pages 50 et 1 avec le curseur attendu.
- Le navigateur a conservé les 50 premières lignes après un 503 intercepté. « Réessayer » a chargé la 51e intervention depuis l'API réelle. L'artisan l'a affectée au technicien depuis le panneau.
- Le technicien n'avait pas accès à cette intervention avant l'affectation. Il a ensuite ouvert son suivi et l'a prise en compte. La réponse ne contenait ni prix, ni paiement, ni document. Son rôle global et le statut commercial de l'intervention sont restés identiques.
- Après retrait du technicien, les lectures et une nouvelle commande ont renvoyé 404. Dans le même onglet et avec la même identité, la navigation a relu les appartenances puis retiré l'équipe et ses commandes. Les contrôles de débordement à 390 et 1 280 px ont réussi.
- Les 23 étapes du nettoyage ont réussi. Les six tables privées de l'équipe ont été contrôlées par une lecture SQL indépendante et 51 lectures indépendantes ont vérifié les comptes et lignes de la cohorte. Le premier parcours `db0df0b39172` avait expiré sur une action de suivi devenue invisible. Son échec de vérification et les deux preuves de nettoyage sont conservés.
- Les tests Chromium avec réponses injectées couvrent également les membres et les invitations après la première page, ainsi que la revalidation après un POST 404. Un coordinateur dont l'élément cible a disparu retrouve son équipe si ses droits restent valides. Le test PostgreSQL isolé passe 91 assertions, dont l'affectation de la 51e mission à un technicien de deuxième page. L'essai hébergé utilisait deux membres.

## Version des conditions de garantie

Le panneau charge à la demande la version enregistrée au dépôt. Le test Chromium vérifie le succès sur la version demandée, l'absence de requête pour un dossier ancien sans version, la reprise et la réponse de version indisponible. Sur la preview, la lecture d'une version absente renvoie une publication nulle et une version hors bornes renvoie 422. Aucune condition n'a été publiée ou activée pour cet essai.

TypeScript strict et les 13 tests ciblés combinés passent. La suite locale sur `58b6b92` a produit 2 118 réussites, 2 tests optionnels ignorés et un échec de synchronisation dans le test navigateur des devis. Les 5 tests de ce fichier passent en isolation puis après remplacement des attentes fixes par les décomptes rendus de 50, 100 et 120. La modification de recette ne change aucun code produit. [CI de la preview 58b6b92](https://github.com/claude972/depannage-electricite/actions/runs/42438055495)
