# Approbations entreprise et administration — 7 novembre 2026, Martinique

## Version et portée

L’intégration `635e41d33d3f150e39c9eafb80f4796e55b5217a` est déployée en preview sur `dpl_6cYMMg77RzjKbjtt8AKYEnDz9VzW`. Vercel atteste le commit et la branche `integration/web-pwa`. Le chargement public sans cookie a renvoyé 200 et la page a servi le build `Z-8-msrV7yUvqKgUHrdLl`. [Preview](https://depannage-electricite-l5vibd0zx-brafas-projects.vercel.app)

## Vérification hébergée

La recette `7e0e0f823115` s’est terminée sans erreur. Le gestionnaire a lu 201 approbations sur cinq pages et ouvert l’approbation en attente au-delà des 200 lignes de démarrage. Le dossier associé était au-delà des 100 interventions chargées. La lecture ponctuelle a confirmé le devis à 100 €, le site et la règle de décision. Le lecteur a consulté le dossier et reçu 403 sur la décision. La lecture hors organisation a reçu 404.

Le gestionnaire a approuvé depuis l’interface. Le POST portait l’identifiant exact, a répondu 200 et la relecture ponctuelle et l’écran ont affiché la décision enregistrée. Le document et les deux sélecteurs sont restés dans le viewport à 360, 390 et 1 280 px dans Chromium. Les lectures indépendantes après fermeture et nettoyage ont confirmé l’absence des données de recette. 51 étapes de nettoyage, 121 lectures indépendantes et 1 794 cibles REST vérifiées. Aucun compte administrateur de test créé.

## Revue du parcours administrateur

Le lot `9324810` raccorde la réaffectation à l’annuaire paginé des artisans approuvés et le fil à la lecture serveur des messages. Le fil relit la première page quand l’espace actualisé signale un nouveau message. Il garde les pages vérifiées avec recouvrement et repart d’un nouveau curseur quand une rafale a dépassé la première page. Les tests ciblés couvrent le changement de dossier, les refus, les erreurs et la reprise. TypeScript strict et les deux jobs CI de ce commit passent. La preview `9324810` a renvoyé 401 pour les lectures anonymes de l’annuaire et des messages. La vérification positive en ligne avec le compte propriétaire reste différée. [CI](https://github.com/claude972/depannage-electricite/actions/runs/42432384224)

## Échecs conservés

- `02df5796a1d9` s’est arrêté pendant la préparation. La règle d’approbation active avait déjà créé les lignes lors de l’insertion des devis. Après nettoyage, 129 lectures indépendantes passent. Le script suivant a installé la règle après la création explicite des données historiques.
- `b0db3e4463b4` a confirmé les cinq pages et les refus. La décision a été enregistrée, mais le viewport 390 px débordait. Les 121 lectures indépendantes de nettoyage passent.
- `d24f6d0994d3` a reproduit le débordement de 1 px avec un seul dossier. Le sélecteur d’organisation imposait la largeur de l’option. La correction a passé un essai Chromium avec un nom long avant la recette hébergée. Les 53 lectures indépendantes de nettoyage passent.
