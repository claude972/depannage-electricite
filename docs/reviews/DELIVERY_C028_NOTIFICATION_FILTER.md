# Pagination des notifications sur la preview c028d74

La preview [c028d74](https://depannage-electricite-mh95z3pjy-brafas-projects.vercel.app) sert le commit `c028d74b0438f7c909b9d847a6d4f28c27c8b1d6` de `integration/web-pwa`. Vercel confirme le déploiement `dpl_FgjnAxGCNsdGUiyCEsAqpaR3ttjX` et le HTML public confirme le build `gRSsVfbRDMNvAsrdcRquC`.

Le parcours `84ec43f15d1c` a utilisé un client temporaire et 60 notifications internes, dont 26 non lues. Chromium a affiché les 25 premières entrées, demandé la suite réelle de « Toutes » et retenu sa réponse. Le client a basculé sur « Non lues » et attendu les 25 premières entrées rendues. La suite retardée a été livrée ensuite sans ajouter de notification lue. Le bouton a utilisé le curseur du filtre « Non lues » et affiché la 26e entrée. Quatre lectures et aucun POST applicatif.

Les préférences du compte temporaire étaient absentes avant la création des lignes. Aucun canal externe n'a été activé. Les 10 étapes de nettoyage et 10 lectures indépendantes ont réussi. Une lecture SQL distincte a trouvé zéro ligne d'envoi ou d'échec d'envoi pour les 60 identifiants synthétiques après nettoyage.

Les 10 tests ciblés et TypeScript strict passent. Les tests Chromium à réponses injectées couvrent le rechargement, les réponses incompatibles et tardives, les marquages concurrents et la relecture après confirmation d'un marquage. Le test hébergé porte sur la lecture et la pagination. [CI du commit c028d74](https://github.com/claude972/depannage-electricite/actions/runs/42440204590)
