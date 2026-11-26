# Reprise vérifiée — 26 novembre 2026

## Périmètre

Reprise locale des deux commits après la PR 13 : `b68b8282` (rejeu des décisions artisan) et `a1ff19cd` (conflit isolé au rapprochement, preuves publiques du 25 novembre). Les deux étaient présents sur la branche GitHub `claude/terminaison-suite-20261123`. La branche `main` reste à `a9db467b`.

Le rapprochement historique est clos d’après l’instantané de recette du **25 novembre à 20:07 UTC** : 14 paiements réglés, 14 écritures de règlement, 0 manquant et 0 écart de montant. Ce n’est pas une nouvelle lecture de la base le 26. L’écriture automatique à la confirmation n’a pas encore de preuve en ligne dans cet instantané.

## Défaut reproduit et corrigé : R-FIN-16

Avec une limite de 1, un ancien règlement en conflit était sélectionné à chaque relance, avant deux règlements valides plus récents. Le test a échoué avant correction : `[settled_added, remaining_unsettled] = [0, 3]` au lieu de `[1, 2]`.

La migration additive `20261126090000_reconcile_progress_past_conflicts.sql` trie d’abord les règlements sans conflit connu de session, puis les autres, avec le tri chronologique initial dans chaque groupe. Elle conserve la limite de travail, l’autorisation, les verrous et les écritures immuables. Les conflits restent comptés et réessayables ; aucun règlement fictif n’est créé.

Le test vérifie deux lots successifs de taille 1, l’absence de doublon puis la tentative du conflit restant. Le message Finance mentionne le lot de 200 et demande de vérifier les éventuels conflits, sans affirmer que tout solde provient d’un conflit.

## Vérifications locales

Environnement : Mac de Codex, disque externe, Node 26.13.1 (le projet déclare Node 24.x ; ces résultats ne constituent pas une qualification de Node 24). PGlite isolé ; pg_cron simulé explicitement, aucun appel à une base hébergée.

- `sql-settlement-at-confirmation-review.mjs` : rouge avant correction, **42 contrôles verts** après.
- `sql-artisan-decision-reason-review.mjs` : **27 contrôles verts**.
- `sql-reconcile-withheld-review.mjs` : **15 contrôles verts**.
- `sql-function-search-path-review.mjs` : **10 contrôles verts**.
- `sql-platform-operations-review.mjs` : succès, **143 migrations** exécutées en base isolée et garanties historiques conservées.
- Routes de décision artisan et libellés d’audit : **9 tests réussis**.
- `npm run typecheck` : sortie 0.
- `npm test` : **2 225 réussis, 298 ignorés, 0 échec** sur 2 523 tests, confirmé après ajout de la migration SQL (sortie 0, 25,4 secondes).
- `npm run build` : sortie 0 ; compilation Turbopack après le changement de texte (la migration SQL ajoutée ensuite ne participe pas au build).
- Relecture indépendante : le défaut de progression a été relevé ; seconde relecture après correction sans nouveau constat bloquant. Relecture statique, distincte des tests ci-dessus.

## Limites et suite

Aucune migration appliquée à la recette ou à la production ; aucun déploiement, paiement, changement de sécurité ou fusion de `main`. Les refus d’application déjà consignés ne sont pas contournés. La PR de reprise est empilée sur la branche de la PR 13 : elle présente les travaux suivants sans déclencher la production.

La recette connectée, le paiement TEST démontrant l’écriture automatique, les parcours natifs et les autres lignes du registre restent ouverts à leur état exact. Les 24 mesures responsive publiques sont les preuves du 25 novembre, pas de nouveaux essais ni une validation de tous les espaces connectés.
