# Maintenance du 101e site sur bee50a0

La preview sert `bee50a008cd7c26ee1848a5ef4139802a454f867` de `integration/web-pwa`. Vercel confirme `dpl_3hK54dgXMnY6Nqh2Zc4fev2RVoGS` et le HTML public confirme le build `mP_uEkiowBI7azGzndGeb`. Les 48 tests ciblés et TypeScript strict passent. Les tests montés couvrent aussi le site archivé, l’organisation différente et la reprise après indisponibilité. [Preview](https://depannage-electricite-if3ebe74c-brafas-projects.vercel.app) · [CI](https://github.com/claude972/depannage-electricite/actions/runs/42444067728)

La recette Chromium `fad65b001b08` a utilisé 101 sites de test. Le site cible était absent des 100 sites chargés au démarrage pour le gestionnaire et le lecteur. Tous deux ont parcouru les trois pages du portefeuille (50, 50, 1) et ouvert sa fiche directe depuis le bouton du site.

L’API utilisateur a enregistré un étage, une zone rattachée, un plan hebdomadaire et une première visite. Sur la fiche à 390 px, le gestionnaire a relu la zone et l’historique puis saisi une deuxième visite. Une seule commande a été envoyée et l’API a confirmé les deux visites et la prochaine échéance au 10 novembre pour ces données synthétiques. Le plan est resté consultable après rechargement. Le deuxième site a présenté son propre état vide.

Le lecteur a consulté la maintenance sans action d’écriture et le serveur a refusé sa commande par HTTP 403. Le tiers a reçu un refus sur les opérations et les zones. Les 36 étapes de nettoyage, 90 lectures indépendantes et 10 lectures supplémentaires sur les zones et leurs événements ont réussi.
