# Reprise exacte d'une demande d'assistance sur la preview 5a98914

La preview [5a98914](https://depannage-electricite-9f6fpkpmz-brafas-projects.vercel.app) sert le commit `5a98914f11f935106994c79d59a05331d702a64c` de `integration/web-pwa`. Vercel confirme le déploiement `dpl_5ZrqwGBQCsVRZkmfgzQ3b3vVYamy` et le HTML public confirme le build `WT2YAk5ojpoLJOobipww6`.

- Le parcours Chromium `d79d4a44e888` a envoyé une demande avec un vrai client temporaire. L'API a confirmé le ticket et la base a confirmé le premier message. Le test a interrompu uniquement la remise de la réponse au navigateur.
- Le client est revenu au formulaire puis a rechargé la page avec la même identité. Il a modifié le sujet et le message de son brouillon. « Renvoyer la demande précédente » a transmis exactement le même identifiant, sujet, message et dossier que le premier POST.
- L'API a confirmé le rejeu du même ticket. Les lectures en base ont trouvé un ticket, son message initial et son événement de création. Le brouillon distinct était encore présent à la réouverture du formulaire.
- Les 13 étapes de nettoyage et les 13 lectures indépendantes ont réussi. Le processus était terminé et le compte et ses lignes de test étaient absents.
- Les 26 tests ciblés, TypeScript strict et les deux jobs GitHub passent. Les tests navigateur à réponses injectées couvrent aussi les reçus incomplets, le stockage refusé ou non vérifiable, le remontage de l'ancien format, le changement de compte et la conservation du texte saisi pendant un POST. La suite locale lancée en parallèle a signalé un retard de rendu dans la recette photo. Le test attend désormais l'état rendu et ses 8 cas passent. [CI du commit 5a98914](https://github.com/claude972/depannage-electricite/actions/runs/42439055804)

Ce test porte sur la création et le rejeu côté demandeur. Le traitement positif par un opérateur hébergé reste une recette séparée.
