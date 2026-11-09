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

## Vérification combinée de travail

A `33d378f` et B `26464ef` ont été réunis dans un checkout temporaire. Typecheck passé, 19 scénarios Chromium et 2 vérifications unitaires de la règle de refus réussis, ainsi que 15 tests serveur ciblés. Ce passage ne vaut pas validation complète de la suite ni déploiement. Les scénarios existants de messages et garantie qui utilisaient les anciens contrats ont été conservés et adaptés aux nouveaux champs, avec leurs assertions de refus.

Le checkout combiné A `974211b` et B `b3af4c8` a passé le typecheck. La suite applicative a donné 2 168 succès, 12 échecs strictement identiques par nom à la base et deux skips optionnels. Le checkout A `dbeae94` et B `aa3c7ee` a ensuite passé le typecheck, 44 tests ciblés B et quatre cas HTTP serveur ciblés. Les deux validations temporelles des formulaires ont envoyé zéro commande dans Chromium. Les vérifications sont locales et isolées.

Sur A `974211b`, le test d’adaptation des migrations et 83 des 85 scripts SQL passent. `sql-operational-reminders-review.mjs` échouait déjà sur la base. `sql-adv-rollback-review.mjs` échoue parce que son script historique appelle la commande d’approbation révoquée. Une copie de ce script adaptée au contrat versionné passe ses 346 vérifications. Le script versionné relève d’un raccordement hors lots, détaillé ci-dessous.

La contre-recette E51 a monté le shell complet dans Chromium avec le SDK Supabase installé, une authentification de recette et un vrai WebSocket de boucle locale. Sur `93e5a5d`, la reconnexion ne produit aucun GET de rattrapage et la description précédente reste affichée. Sur A `c92b47f` avec B `99516ac`, deux abonnements sont observés autour de la coupure. La reconnexion produit exactement un GET, affiche la nouvelle description dans le même document et ne déclenche aucune mutation. Le typecheck et 56 tests ciblés d’interface passent également sur A `c92b47f` avec B `00e6e02`.

## Rejeu natif de la chaîne complète

Sur le SHA A `974211b`, les 101 migrations initiales et les 20 additives se sont appliquées dans l’ordre sur PostgreSQL 17.11 vierge. Vault, pg_cron et pg_net sont chargés, les départs de tâches et l’émission réseau sont neutralisés. La base de recette est arrêtée après vérification. Aucun changement hébergé.

## Synthèse

| État | Nombre |
| --- | ---: |
| CORRIGÉ (avec suite verte) | 0 |
| VÉRIFIÉ CIBLÉ (suite initiale rouge) | 25 |
| CORRIGÉ PARTIEL | 3 |
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

| E07 | Majeur | VÉRIFIÉ CIBLÉ | Isolé | `f9d9918` | `sql-phase2-lot-a-archived-site-review.mjs` | Migration additive | Manager avec droit conservé : HTTP 200 et deux audits avant, HTTP 409 sur les deux commandes après, aucune écriture ni audit. RPC direct refusé aussi. |
| E15 | Majeur | VÉRIFIÉ CIBLÉ | P2 | `258f44e` | `sql-phase2-lot-a-p2-review.mjs` | Route operations, migration additive | Deux identités via vrai HTTP : ancien formulaire 200 et v3 avant, 409 et v2 conservée après. RPC historique refusé, pas d’audit supplémentaire. Le formulaire versionné est vérifié dans B `c1b5ddf`. |
| E18 | Mineur | VÉRIFIÉ CIBLÉ | P3 | `7de6d11` | `sql-phase2-lot-a-p3-review.mjs` | Route operations, migration additive | Deux audits et instantanés avant. Après, un de chaque, réponse identique, autre contenu sous même clé refusé. La même clé est conservée par B `4049d5d`. |
| E19 | Mineur | VÉRIFIÉ CIBLÉ | Isolé | `f6e280a` | `sql-phase2-lot-a-p3-review.mjs` | Route operations, migration additive | HTTP 200 et chaîne vide avant, 422 explicite et aucune écriture après. RPC direct refuse les espaces/tabulations, saisie nominale conservée. |
| E21 | Majeur | VÉRIFIÉ CIBLÉ | P4 | `cbc4fcc` | `sql-phase2-lot-a-temporal-review.mjs` | Migrations additives et contrats `site-operations` | Trois écritures HTTP futures 200 avant puis 422. Refus 22023 SQL direct. Faits anciens futurs non mesurables. Schéma partagé vérifié dans Chromium sur A `974211b` + B `b3af4c8` : zéro commande et erreur immédiate. |
| E23 | Mineur | VÉRIFIÉ CIBLÉ | Isolé | `1a32034` | `sql-phase2-lot-a-temporal-review.mjs` | Rapports SLA site et organisation | Deux GET Next.js avec données SQL. Avant, le site comptait un dossier respecté et le consolidé un indéterminé. Après, les deux classent le dossier indéterminé. 74 tests unitaires ciblés et les trois cas HTTP temporels passent. |
| E24 | Majeur | VÉRIFIÉ CIBLÉ | P4 | `cbc4fcc` | `sql-phase2-lot-a-temporal-review.mjs` | Migrations additives et contrats `site-operations` | Levées antérieure et future 200 avant puis 422, dossier conservé en v1. Refus SQL direct, levée valide 200. Schéma partagé vérifié dans Chromium sur A `974211b` + B `b3af4c8` : zéro commande et erreur immédiate. |
| E25 | Majeur | VÉRIFIÉ CIBLÉ | P4 | `418035d` | `sql-phase2-lot-a-contract-dates-review.mjs` | Migration additive | La publication future vidait les deux lectures. Après, v2 reste disponible avant la date ; v3 devient seule applicable à la date. L’autorisation de l’artisan reste liée à sa révision. |
| E29 | Majeur | VÉRIFIÉ CIBLÉ | P2 | `2b3b44e` | `sql-phase2-lot-a-p2-review.mjs` | Route warranty, migration additive | Ancienne résolution écrasée avec HTTP 200 avant, 409 et résolution conservée après. RPC historique interdit, audit unique. La relecture et le rebasing du formulaire sont vérifiés dans B `47f3fdc`. |
| E33 | Mineur | VÉRIFIÉ CIBLÉ | Isolé | `cdd74bc` | `phase2-lot-a-directory-browser.mjs` | Route annuaire et migration additive | Chromium monté, vrais PATCH et GET Next.js et RLS isolée : 1 résultat avant et 2 après, pour les deux formes, noms bruts conservés, non-admin refusé. 8 tests annuaire passent. Migration native appliquée deux fois et filtre testé avec PostgREST 16.5 sur une table de recette RLS. |
| E34 | Majeur | VÉRIFIÉ CIBLÉ | P2 | `e17c0e5` | `sql-phase2-lot-a-p2-review.mjs` | Route admin artisans, migration additive | Une approbation ancienne réactivait le dossier via HTTP 200. Elle reçoit maintenant 409 et la suspension demeure. Une réactivation explicite avec version courante passe. Les actions distinctes et la version sont vérifiées dans B `43ee0b9`. Le script de recette historique est à aligner. |
| E36 | Mineur | VÉRIFIÉ CIBLÉ | P3 | `523878c` | `sql-phase2-lot-a-p3-review.mjs` | Route admin artisans, migration additive | Après le verrou P2, le rejeu était refusé 409. Avec la clé, 200 identique et un seul audit. Modification de la même intention refusée. La stabilité de la commande à la reprise est vérifiée dans B `43ee0b9`. |
| E37 | Majeur | VÉRIFIÉ CIBLÉ | Isolé | `6104037` | `sql-phase2-lot-a-planning-eligibility-review.mjs` | Migration additive | Routes Next planning, liste et acceptation. Congé courant : offre urgente visible et attribuée avant, 404/403 et aucune attribution après. Congé futur et demande à planifier préservés, retrait du congé rend l’urgence de nouveau attribuable. Migration appliquée deux fois sur PostgreSQL natif. |
| E41 | Mineur | VÉRIFIÉ CIBLÉ | P3 | `0127c6d` | `sql-phase2-lot-a-p3-review.mjs` | Route messages, migration additive | Vrai HTTP : deux messages et notifications avant. Après, les deux réponses 201 sont identiques et il n’y a qu’un message et une notification. La stabilité de la clé et la nouvelle intention sont vérifiées dans B `03936b5`. |
| E53 | Mineur | VÉRIFIÉ CIBLÉ | P3 | `b414386` | `sql-phase2-lot-a-documents-review.mjs` | Route documents site, helper Storage, migration additive | Deux objets/documents avant, 1/1 et reçu exact après. Remplacement et reprise de l’objet exact après interruption Storage vérifiés. Un objet privé sans métadonnée reste récupérable avec la clé initiale. La stabilité de la clé du dépôt est vérifiée dans B `fc06c26`. |
| E59 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Photos avant/après. |
| E60 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Accusé de remise par le client. |
| E61 | Majeur | CORRIGÉ PARTIEL | Isolé | `fa9d690` | `sql-phase2-lot-a-reports-pagination-review.mjs` | Route rapports | HTTP sur PostgreSQL isolé : 503/422/503 avant, 200/200/200 après. 1 000 + 1 sites, totaux par page, CSV entier en flux, pas de résultat pour le tiers et interruption si la page finale est tronquée. Attend les contrôles de pagination B. |
| E67 | Majeur | DÉCISION REQUISE | Décision | — | — | — | Justificatif de levée ERP. |
| E68 | Mineur | CORRIGÉ PARTIEL | Isolé | `f183d49` | `phase2-lot-a-offline-draft-browser.mjs` | `public/offline-request.js` | Firefox conservait les champs et les deux moteurs gardaient la clé expirée. Après, formulaire vide et clé absente dans Firefox et WebKit, brouillon valide relu, transport coupé et zéro POST. Le passage d’une installation existante de v6 à v7 a été vérifié dans les deux moteurs avec un candidat local. La génération reste à intégrer. |
| E69 | Mineur | VÉRIFIÉ CIBLÉ | P7 | `7ccaeda` | `sql-phase2-lot-a-auth-session-review.mjs` | Route profile sessions | Vrai SDK et Next : `session_not_found` 503 avant, 401 après. `bad_jwt` reste 401, panne reste 503, nominal ferme seulement les autres sessions. |
| E70 | Majeur | CORRIGÉ PARTIEL | Isolé | `3e86b60` | `sql-phase2-lot-a-connect-review.mjs` | `app/api/payments/connect/route.ts` | Next.js et SDK Stripe réels, fournisseur synthétique sur boucle locale. Les deux codes passent de 500 à 503 avec un message d’action. Refus 403 sans appel, autre erreur 500, aucune mutation de profil. La configuration du compte Connect reste externe. |
| E72 | Majeur | VÉRIFIÉ CIBLÉ | P7 | `2bdc979` | Webhook signé local, qualification SQL et test provider injecté | Contrat Stripe, migration additive | HTTP 400 et SQL 22023 avant ; 200 et commission rapprochée sur fixture après. Le préfixe py_ est limité aux commissions, la transaction ch_ plateforme et l’identité Connect restent vérifiées. Le parseur B `976e6e3` accepte les deux formes sans élargir la preuve plateforme. |
| E75 | Majeur | DÉCISION REQUISE | Décision | `e492a1b` | `sql-phase2-lot-a-artisan-capacity-review.mjs` | Route artisan et migration additive | Réglage neutre versionné : `null` initial et réinitialisable, aucune capacité appliquée aux offres. HTTP 422 avant, 200 après. Autre rôle, suspension et version périmée refusés. Migration appliquée deux fois en natif. |
| E76 | Majeur | VÉRIFIÉ CIBLÉ | Quota rappel | `b102a21` | `sql-phase2-lot-a-callback-quota-review.mjs` | Handler rappel, migration additive | Vrai HTTP anonyme : 429/429 avant, 429/200 après pour la source saturée et l’autre appelant. Rejeu accepté à quota et aucun IP brut stocké. L’en-tête Vercel est simulé en recette. Sans adresse fiable, repli conservateur par origine. |
| E77 | Mineur | VÉRIFIÉ CIBLÉ | Quota rappel | `b102a21` | `sql-phase2-lot-a-callback-quota-review.mjs` | Handler rappel, migration additive | La réponse renvoie le temps restant pour les deux plafonds, y compris après changement de source. Un numéro neuf reste accepté. PostgreSQL natif : migration appliquée deux fois ; contrat SQL historique, permissions et Chromium rappel passent. |
| E78 | Majeur | VÉRIFIÉ CIBLÉ | Isolé | `0c4e5c7` | `sql-phase2-lot-a-refund-handoff-review.mjs` | Migration additive | Vrais HTTP et SDK Stripe sur boucle locale. Révocation pendant la lecture : 403 et zéro émission initiale. Reprise exacte par un autre habilité : 202, une seule émission simulée et un audit, jamais de confirmation bancaire. Nouvel ID, acteur encore habilité et émission déjà soumise refusés. Préparation de plus de 23 h ou incertitude fournisseur hors reprise. 37 contrôles SQL historiques et 13 tests existants passent. |
| E80 | Majeur | VÉRIFIÉ CIBLÉ | Isolé | `f58df31` | `sql-phase2-lot-a-artisan-dispute-review.mjs` | Route statut paiement, migration additive | GET 200 avec règlement confirmé avant et après. Nouveau champ seul `under_review` pour l’artisan affecté auteur du devis. Client, tiers, ancien et nouvel artisan après changement d’affectation ne reçoivent pas le litige historique. Registre finance inchangé. Affichage Chromium vérifié avec B `8fa9749`, état relu sur changement de session ou actualisation. |
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
| E72 | `components/features/finance-proofs/model.ts:63` | Le champ `connected_charge_id` accepte ch_ ou py_ ; `charge_id` plateforme reste ch_. |
| E61 | `components/features/enterprise-reports/model.ts` | Accepter `after=<UUID>` et `page` optionnel (`limit`, `has_more`, `next_after`) ; ajouter les contrôles de page et préserver le CSV sans `after`. Les montants des pages partielles ne sont pas des totaux globaux. |
| E80 | `components/role/artisan-space.tsx:2302` | Lire le GET statut paiement du devis accepté. Champ optionnel `artisan_dispute` parmi `none`, `open`, `under_review`, `resolved`, `closed`, indépendant de l’état du règlement. Le journal finance reste privé. |

## Attendu de l’intégration

| ID | Fichier | Action requise |
| --- | --- | --- |
| E34/E36 | `scripts/qa-advanced-platform/rollback.sql:148` | La suite intégrale échoue sur `approve_artisan` (42501), volontairement révoqué. La copie de recette passe avec `decide_artisan_application` (`approve`, version du profil relue, `gen_random_uuid()`) : 346 PASS, 130 tables inchangées après rollback. Le script versionné est hors périmètre des deux lots. |
| E68 | `public/sw.js` | Incrémenter la génération immuable avec le nouveau script dans le même déploiement. Le candidat local a conservé v6 jusqu’à activation explicite, installé v7 puis supprimé v6. Firefox et WebKit ont rechargé hors connexion sans brouillon expiré ni POST. Les 35 tests PWA et brouillons passent avec le candidat. `public/sw.js` est hors périmètre des deux lots. |

## Fiches de décision

### E59 — Photos de compte rendu

Options : ajout facultatif par phase, ou photos requises selon des conditions définies par l’exploitant. Une obligation affecte la fin d’intervention, le stockage et les personnes photographiées. Préférence technique : pièces privées liées à la version du rapport, avec phase avant/après, facultatives avant décision. Aucun champ livré à ce checkpoint.

### E60 — Accusé de remise client

Options : accusé authentifié horodaté, ou dispositif de signature distinct. Un accusé rattache une action du destinataire à une version et ne qualifie pas à lui seul la valeur de signature. Préférence technique : preuve de remise séparée du nom déclaré par l’artisan. Niveau de preuve et caractère obligatoire à arbitrer. Aucun flux livré à ce checkpoint.

### E67 — Justificatif ERP

Options : lien facultatif à une pièce privée, ou preuve requise pour les types de réserve définis. Un lien facultatif permet une levée déclarative et une lecture différenciée. Préférence technique : rattacher la pièce à la version de la réserve dans le même site. Aucun champ livré à ce checkpoint.

### E75 — Capacité artisan

Options : capacité non renseignée ou plafond paramétrable. Déterminer l’unité (interventions simultanées, créneaux, autre) et les dossiers qui consomment la capacité avant d’imposer un plafond. La préférence nullable est disponible via le profil et une action versionnée. Null signifie illimité. Aucune valeur commerciale, aucun comptage de capacité ni contrôle affiché à ce stade.

## Prérequis externes

- E70 : changement de configuration Connect hors périmètre. La réponse d’erreur applicative est à traiter sur fixture synthétique.
- H01 : checklist avant recette hébergée. Identifier la preview par SHA et son ref, renseigner les variables Supabase pour ce ref sur un projet de recette isolé, vérifier l’historique des migrations et la disponibilité du barème public puis d’une lecture et d’une écriture authentifiées. Relever le résultat sans reprendre les preuves d’une autre preview.
- Les six sous-cas ouverts du registre restent hors mission.

## Comparaison du lot A au checkpoint E70

Le typecheck et la suite applicative ont été relancés sur `0031617`. La suite compte 2 128 succès, deux skips optionnels et les mêmes 12 échecs par nom que la base. La qualification combinée et les tests des changements ultérieurs restent séparés.

## Échecs préexistants constatés sur HEAD

`npm run check` lancé sur le checkout exact avec Node 24.15.0. Le typecheck est passé. La suite a donné 2 127 succès, 12 échecs et 2 skips (2 141 tests). Échecs en signature de document, export des données client, fiche site responsive/archivée et montage abonnements. La chaîne ne lance donc pas les builds automatiquement. La recette SQL de référence signale aussi un échec préexistant dans `sql-operational-reminders-review.mjs`.
