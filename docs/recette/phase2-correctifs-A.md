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

## Bloquants livrés

Les quatre corrections ont un test reproductible rouge → vert. Les deux nouvelles migrations passent chacune deux fois sur PostgreSQL 17.11 natif vierge après les 101 existantes, avec stubs Auth/Storage, Vault et pg_net natifs et envoi sortant neutralisé. E01, E28 et E74 passent sur de vraies routes Next.js avec PostgreSQL PGlite isolé et des réponses de fournisseurs synthétiques. La suite de comparaison a été relancée et le typecheck a passé. Les deux builds passent (Webpack dans le checkout, Turbopack dans une copie du checkpoint avec dépendances physiques). La suite applicative conserve ses résultats de référence : 2 127 succès, 12 échecs, 2 skips. Le script SQL préexistant en échec demeure le même ; les autres scripts du passage de comparaison réussissent.

## Synthèse

| État | Nombre |
| --- | ---: |
| CORRIGÉ (avec suite verte) | 0 |
| VÉRIFIÉ CIBLÉ (suite initiale rouge) | 6 |
| CORRIGÉ PARTIEL | 9 |
| NON REPRODUIT | 0 |
| DÉCISION REQUISE | 4 |
| REVERTÉ | 0 |
| HORS MISSION | 7 |

## Items

| ID | Gravité | État | Mécanisme | Commit | Test ajouté | Fichiers modifiés | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Bloquant | Vérifié ciblé | Isolé | `2feb706` | `sql-phase2-lot-a-blockers-review.mjs` | Migration additive `support_ticket_audit_target` | HTTP 422 ×2, SQL 23514 avant. HTTP 200 ×2 et audits exacts après. Suite globale à comparer. |
| E28 | Bloquant | Vérifié ciblé | Isolé | `fb3e269` | `sql-phase2-lot-a-blockers-review.mjs` | `lib/features/warranty-policy/contract.ts` | HTTP 503 puis 422 avant, 200 puis 200 après, version 1 relue en SQL. |
| E73 | Bloquant | Vérifié ciblé | Isolé | `1cf47f4` | `supabase/tests/phase2-notification-dispatch.sql` | Migration additive `notification_dispatch_secret_length` | PostgreSQL 17.11 natif : 2201B avant, deux requêtes pg_net après pour quatre entrées (un appel par canal). Rollback, zéro ligne restante. |
| E74 | Bloquant | Vérifié ciblé | Isolé | `14ea285` | `sql-phase2-lot-a-blockers-review.mjs` | `lib/features/notifications/external-delivery/` | Les deux formes donnent HTTP 422 sans tentative avant, HTTP 200 et une tentative acceptée par canal après. Fournisseurs interceptés, 403 et corps avec données toujours refusés. |

| E07 | Majeur | À REPRODUIRE | Isolé | — | — | — | Verrou d’archivage site pour équipement et visite. |
| E15 | Majeur | CORRIGÉ PARTIEL | P2 | `258f44e` | `sql-phase2-lot-a-p2-review.mjs` | Route operations, migration additive | Deux identités via vrai HTTP : ancien formulaire 200 et v3 avant, 409 et v2 conservée après. RPC historique refusé, pas d’audit supplémentaire. Attend le câblage du lot B. |
| E18 | Mineur | CORRIGÉ PARTIEL | P3 | `7de6d11` | `sql-phase2-lot-a-p3-review.mjs` | Route operations, migration additive | Deux audits et instantanés avant. Après, un de chaque, réponse identique, autre contenu sous même clé refusé. Attend la conservation de la clé dans B. |
| E19 | Mineur | À REPRODUIRE | Isolé | — | — | — | Rapport : nom déclaré vide rejeté côté serveur. |
| E21 | Majeur | CORRIGÉ PARTIEL | P4 | `cbc4fcc` | `sql-phase2-lot-a-temporal-review.mjs` | Migrations additives et contrats `site-operations` | Trois écritures HTTP futures 200 avant puis 422. Refus 22023 SQL direct. Faits anciens futurs non mesurables. Attend le message immédiat B. |
| E23 | Mineur | À REPRODUIRE | Isolé | — | — | — | Règle unique du statut SLA. |
| E24 | Majeur | CORRIGÉ PARTIEL | P4 | `cbc4fcc` | `sql-phase2-lot-a-temporal-review.mjs` | Migrations additives et contrats `site-operations` | Levées antérieure et future 200 avant puis 422, dossier conservé en v1. Refus SQL direct, levée valide 200. Attend le message immédiat B. |
| E25 | Majeur | VÉRIFIÉ CIBLÉ | P4 | `418035d` | `sql-phase2-lot-a-contract-dates-review.mjs` | Migration additive | La publication future vidait les deux lectures. Après, v2 reste disponible avant la date ; v3 devient seule applicable à la date. L’autorisation de l’artisan reste liée à sa révision. |
| E29 | Majeur | CORRIGÉ PARTIEL | P2 | `2b3b44e` | `sql-phase2-lot-a-p2-review.mjs` | Route warranty, migration additive | Ancienne résolution écrasée avec HTTP 200 avant, 409 et résolution conservée après. RPC historique interdit, audit unique. Attend le lot B. |
| E33 | Mineur | À REPRODUIRE | Isolé | — | — | — | Normalisation des noms dans la recherche. |
| E34 | Majeur | CORRIGÉ PARTIEL | P2 | `e17c0e5` | `sql-phase2-lot-a-p2-review.mjs` | Route admin artisans, migration additive | Une approbation ancienne réactivait le dossier via HTTP 200. Elle reçoit maintenant 409 et la suspension demeure. Une réactivation explicite avec version courante passe. Attend le lot B. |
| E36 | Mineur | CORRIGÉ PARTIEL | P3 | `523878c` | `sql-phase2-lot-a-p3-review.mjs` | Route admin artisans, migration additive | Après le verrou P2, le rejeu était refusé 409. Avec la clé, 200 identique et un seul audit. Modification de la même intention refusée. Attend le lot B. |
| E37 | Majeur | À REPRODUIRE | Isolé | — | — | — | Indisponibilité planifiée et éligibilité des offres. |
| E41 | Mineur | CORRIGÉ PARTIEL | P3 | `0127c6d` | `sql-phase2-lot-a-p3-review.mjs` | Route messages, migration additive | Vrai HTTP : deux messages et notifications avant. Après, les deux réponses 201 sont identiques et il n’y a qu’un message et une notification. Attend le lot B. |
| E53 | Mineur | CORRIGÉ PARTIEL | P3 | `b414386` | `sql-phase2-lot-a-documents-review.mjs` | Route documents site, helper Storage, migration additive | Deux objets/documents avant, 1/1 et reçu exact après. Remplacement et reprise de l’objet exact après interruption Storage vérifiés. Un objet privé sans métadonnée reste récupérable avec la clé initiale. Attend le lot B. |
| E59 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Photos avant/après. |
| E60 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Accusé de remise par le client. |
| E61 | Majeur | À REPRODUIRE | Isolé | — | — | — | Pagination et CSV du rapport consolidé. |
| E67 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Justificatif de levée ERP. |
| E68 | Mineur | À REPRODUIRE | Isolé | — | — | — | Purge du brouillon expiré, y compris les champs restaurés par Firefox. |
| E69 | Mineur | VÉRIFIÉ CIBLÉ | P7 | `7ccaeda` | `sql-phase2-lot-a-auth-session-review.mjs` | Route profile sessions | Vrai SDK et Next : `session_not_found` 503 avant, 401 après. `bad_jwt` reste 401, panne reste 503, nominal ferme seulement les autres sessions. |
| E70 | Majeur | À REPRODUIRE | Isolé | — | — | — | Traduire l’erreur Stripe Connect localement. |
| E72 | Majeur | À REPRODUIRE | P7 | — | — | — | Qualification du lien commission vers une écriture Stripe py_. |
| E75 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Réglage nullable à livrer ; valeur commerciale à décider. |
| E76 | Majeur | À REPRODUIRE | Isolé | — | — | — | Quota public par origine/IP et numéro. |
| E77 | Mineur | À REPRODUIRE | Isolé | — | — | — | Retry-After cohérent avec la fenêtre active. |
| E78 | Majeur | À REPRODUIRE | Isolé | — | — | — | Sortie du remboursement préparé après révocation. |
| E80 | Majeur | À REPRODUIRE | Isolé | — | — | — | Projection autorisée du litige dans l’espace artisan. |
| H01 | Bloquant externe | HORS MISSION | Hébergement | — | — | — | Checklist ci-dessous. |
| PUB-10.1 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |
| CLI-05.2 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |
| CLI-08.1 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |
| ADM-01.1 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |
| FIN-06.1 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |
| SYS-08.2 | Externe | HORS MISSION | Recette | — | — | — | Condition ouverte conservée au registre. |

## Attendu de l’autre lot

| ID | Fichier et ligne | Contrat attendu |
| --- | --- | --- |
| E15 | `components/role/client-space.tsx:1714`, écriture artisan correspondante | Envoyer la version lue du créneau, 0 pour la création. Contrat vérifié : `expected_version` reçoit `reminder_version` (entier). Sur 409, relire le créneau avant nouvel envoi. |
| E29 | `components/app/forms.tsx:3338` | Envoyer la version de la demande de garantie avec la décision et conserver le brouillon en cas de conflit. Contrat vérifié : `expected_version` = chaîne `case.updated_at` exacte issue du GET, sans conversion en Date qui perd les microsecondes. |
| E34/E36 | `components/app/forms.tsx:2232` | Distinguer approbation, demande de correction, suspension et réactivation. Envoyer la version lue et garder la même clé d’intention sur les réessais. E34 vérifié : POST action `approve, request_changes, suspend, reinstate`, `expected_version` entier égal à `application_version` du GET. E36 vérifié : `command_id` UUID obligatoire pour toutes les décisions, stable pour le même envoi et son rejeu. |
| E18/E41/E53 | Rapport, conversation texte, dépôt de site | Une clé stable par intention, y compris après la perte de la réponse. Définir le format exact avec chaque test de contrat backend. |
| E08/E10/E12/E62 | Éditeurs budget, zones, adresses et énergie | Les routes concernées ont déjà un contrat de version. Vérifier côté B le rechargement du formulaire et la transition après rejeu avant de modifier le serveur. |
| E21/E24 | `components/features/site-operations/sla-panel.tsx`, `erp-panel.tsx` | Afficher les bornes et les refus immédiatement avec le même ordre de dates que l’API. |
| E80 | `components/role/artisan-space.tsx:2302` | Afficher l’état du litige du règlement attribué à l’artisan. Le journal finance reste privé. |

## Fiches de décision

### E59 — Photos de compte rendu

Options : ajout facultatif par phase, ou photos requises selon des conditions définies par l’exploitant. Une obligation affecte la fin d’intervention, le stockage et les personnes photographiées. Préférence technique : pièces privées liées à la version du rapport, avec phase avant/après, facultatives avant décision. Aucun champ livré à ce checkpoint.

### E60 — Accusé de remise client

Options : accusé authentifié horodaté, ou dispositif de signature distinct. Un accusé rattache une action du destinataire à une version et ne qualifie pas à lui seul la valeur de signature. Préférence technique : preuve de remise séparée du nom déclaré par l’artisan. Niveau de preuve et caractère obligatoire à arbitrer. Aucun flux livré à ce checkpoint.

### E67 — Justificatif ERP

Options : lien facultatif à une pièce privée, ou preuve requise pour les types de réserve définis. Un lien facultatif permet une levée déclarative et une lecture différenciée. Préférence technique : rattacher la pièce à la version de la réserve dans le même site. Aucun champ livré à ce checkpoint.

### E75 — Capacité artisan

Options : capacité non renseignée ou plafond paramétrable. Déterminer l’unité (interventions simultanées, créneaux, autre) et les dossiers qui consomment la capacité avant d’imposer un plafond. Valeur technique prévue : null signifie illimité. Aucun seuil choisi et aucun réglage livré à ce checkpoint.

## Prérequis externes

- E70 : changement de configuration Connect hors périmètre. La réponse d’erreur applicative est à traiter sur fixture synthétique.
- H01 : checklist avant recette hébergée. Identifier la preview par SHA et son ref, renseigner les variables Supabase pour ce ref sur un projet de recette isolé, vérifier l’historique des migrations et la disponibilité du barème public puis d’une lecture et d’une écriture authentifiées. Relever le résultat sans reprendre les preuves d’une autre preview.
- Les six sous-cas ouverts du registre restent hors mission.

## Échecs préexistants constatés sur HEAD

`npm run check` lancé sur le checkout exact avec Node 24.15.0. Le typecheck est passé. La suite a donné 2 127 succès, 12 échecs et 2 skips (2 141 tests). Échecs en signature de document, export des données client, fiche site responsive/archivée et montage abonnements. La chaîne ne lance donc pas les builds automatiquement. La recette SQL de référence signale aussi un échec préexistant dans `sql-operational-reminders-review.mjs`.
