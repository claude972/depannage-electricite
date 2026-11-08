# Correctifs phase 2 · Lot A · Codex

Branche `fix/phase2-lot-A-codex` · Base `93e5a5dcf76caa528c121248a1c22f52433fb84e`
Lot B séparé sur `fix/phase2-lot-B-claude-code`. Registre original de recette hors du checkout, copie de référence conservée sans ses pièces privées.
Plan court : reproductions isolées E01, E28, E73 et E74 dans cet ordre, suite et point de synchronisation, puis mécanismes P1–P7 et défauts isolés, avec contrats de frontière et commits ciblés.

## Commandes de vérification détectées

- TypeScript : `npm run typecheck`.
- Unitaire et tests montés inclus : `npm test`. Sous-ensemble UI : `npm run test:ui`, avec Playwright et Chromium locaux installés et sélectionnables via `QA_PLAYWRIGHT_PATH` et `QA_CHROMIUM_PATH`. Aucun script navigateur global distinct.
- Contrôle CI : `npm run check` (typecheck, tests, builds Next par défaut et Webpack). Aucun script de lint.
- SQL isolé CI : `node --test tests/sql-isolated-migrations.test.mjs`, puis `PGLITE_MODULE=<module PGlite 0.5.13> node tests/sql-*-review.mjs` fichier par fichier et `node tests/sql-review.mjs`. Les stubs Auth, Storage et pg_cron sont explicites.
- PostgreSQL natif : `supabase migration up --local` pour une stack locale démarrée, ou `supabase migration up --remote=<URL locale>` avec le binaire natif déjà utilisé dans la recette et vérification de l’hôte de boucle locale. Aucune migration déployée par ce lot.

## Synthèse

| État | Nombre |
| --- | ---: |
| CORRIGÉ | 0 |
| CORRIGÉ PARTIEL | 0 |
| NON REPRODUIT | 0 |
| DÉCISION REQUISE | 0 |
| REVERTÉ | 0 |
| HORS MISSION | 0 |

## Items

| ID | Gravité | État | Mécanisme | Commit | Test ajouté | Fichiers modifiés | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Bloquant | Vérifié ciblé | Isolé | `2feb706` | `sql-phase2-lot-a-blockers-review.mjs` | Migration additive `support_ticket_audit_target` | HTTP 422 ×2, SQL 23514 avant. HTTP 200 ×2 et audits exacts après. Suite globale à comparer. |
| E28 | Bloquant | Vérifié ciblé | Isolé | `fb3e269` | `sql-phase2-lot-a-blockers-review.mjs` | `lib/features/warranty-policy/contract.ts` | HTTP 503 puis 422 avant, 200 puis 200 après, version 1 relue en SQL. |
| E73 | Bloquant | À traiter | Isolé | — | — | — | Motif PostgreSQL du secret de dispatch. |
| E74 | Bloquant | À traiter | Isolé | — | — | — | Corps des déclencheurs HTTP internes. |

## Attendu de l’autre lot

| ID | Fichier et ligne | Contrat attendu |
| --- | --- | --- |

## Fiches de décision

À renseigner avec les éléments applicables.

## Prérequis externes

- E70 : changement de configuration Connect hors périmètre. La réponse d’erreur applicative est à traiter sur fixture synthétique.
- H01 : checklist avant recette hébergée. Identifier la preview par SHA et son ref, renseigner les variables Supabase pour ce ref sur un projet de recette isolé, vérifier l’historique des migrations et la disponibilité du barème public puis d’une lecture et d’une écriture authentifiées. Relever le résultat sans reprendre les preuves d’une autre preview.
- Les six sous-cas ouverts du registre restent hors mission.

## Échecs préexistants constatés sur HEAD

`npm run check` lancé sur le checkout exact avec Node 24.15.0. Le typecheck est passé. La suite a donné 2 127 succès, 12 échecs et 2 skips (2 141 tests). Échecs en signature de document, export des données client, fiche site responsive/archivée et montage abonnements. La chaîne ne lance donc pas les builds automatiquement. La recette SQL de référence signale aussi un échec préexistant dans `sql-operational-reminders-review.mjs`.
