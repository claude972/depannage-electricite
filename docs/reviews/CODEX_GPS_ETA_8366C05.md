# Revue croisée — backend GPS/ETA (Codex A6), checkpoint `8366c05d4ab5b667240a5a4ad381b5b59794e3c8`

Revue indépendante par Claude QA, **lecture seule** : worktree détaché au SHA exact (`origin/codex/gps-eta`), `node_modules` lié, supprimé en fin de revue ; aucun cloud, aucun credential, aucun appel fournisseur, **migration 019 non appliquée** (PGlite isolé seulement), aucun fichier Codex modifié. Contrat : `docs/TRACKING_CONTRACT.md` (`d4d57bc` puis amendement ROOT `804a807`).

## 1. Propriété — conforme

`git diff --stat 0f57d96 8366c05` (base d'intégration) : exactement **12 fichiers** (+709) — `supabase/migrations/202610310019_intervention_tracking.sql`, `app/api/interventions/[id]/tracking/{route.ts,route/route.ts,geocode/route.ts}`, `lib/features/tracking/{http,provider,state,types}.ts`, `tests/tracking.test.ts`, `tests/tracking-routes.test.ts`, `tests/sql-tracking-review.mjs`, `docs/TRACKING_CONTRACT.md`. Rien dans 001–018, `components/**`, contrôleur, `package*.json`, `next.config.ts`. 019 ne référence que des objets existants (001 `is_admin`/`consume_action`, 003 `set_travel_stage`/`travel_stage`, 009 `can_access_intervention`/`owns_intervention`/`can_manage_site`/`lock_intervention_organization`, 008/012 `artisan_profiles`) ; rien de 018. La base `0f57d96` ne contient pas 018 : le script SQL lit 018 **en lecture seule** depuis `6062f92` (`git show`), déclaré au contrat l.72-76.

## 2. Migration 019 (fichier:ligne)

| Exigence | Constat | Réf. |
| --- | --- | --- |
| RLS lecture | `grant select` à `authenticated` seulement ; policy `tracking_private_read` → `tracking_row_visible` : `can_access_intervention` **courant** ET (ligne sans point OU point partagé, artisan courant, artisan éligible, `travel_stage='en_route'`, `sampled_at` et `received_at` ≤ 60 s) ; aucune écriture directe (`revoke all`, pas de policy insert/update/delete) ; tables quota/leases sans grant `authenticated` | `019:30-35,42-48` |
| Écrivain GPS | `job.artisan_id = auth.uid()` + `tracking_artisan_eligible` (statut `accepted/in_progress`, `profiles.role='artisan'`, `artisan_approved`, `application_status='approved'`), relu **sous verrous** | `019:37-40,101` |
| Droits destination | `owns_intervention` (client privé sans site, ou `can_manage_site` = owner/manager B2B avec écriture de site) ou `is_admin()` ; dossier non terminal ; jamais viewer, manager lecture seule ni artisan simplement attribué (prouvé : « assignee cannot change client target », « read-only site target denied ») | `019:98-100`, `009 owns_intervention/can_manage_site` |
| Ordre des verrous | commande : organisation (`lock_intervention_organization`) → intervention `FOR UPDATE` → profil artisan → dossier artisan → ligne tracking → leases ; `set_travel_stage` reprend la même ligne d'intervention déjà tenue. Trigger profil/dossier : **aucun verrou d'intervention**, seulement les lignes tracking de l'artisan en `order by intervention_id` puis leases. `approve_artisan` (008) : profil → dossier → update (trigger) — n'acquiert pas d'intervention. Assignation/start (012) : intervention → profil → dossier. `claim_tracking_provider` : intervention `FOR KEY SHARE` d'abord → budget → lease. **Graphe sans cycle identifié** : aucun chemin ne prend une ligne tracking puis une intervention/profil, ni une lease avant l'intervention | `019:90-104,191-195,207-212`, `008:43-60`, `012:26-29,43-48` |
| Triggers de purge | `interventions` (réaffectation, statut hors `accepted/in_progress`, `travel_stage` `planned/on_site`, changement de site/adresse → destination effacée + `destination_version++`) ; `profiles` (rôle ≠ artisan ou `artisan_approved=false`) ; `artisan_profiles` (statut ≠ approved) : point, session, consentement effacés physiquement, `control_version++` borné, leases supprimées | `019:166-200` |
| Point | `seq` entier > 0 et > `last_seq`, `sampled_at` ISO strict, ≤ 60 s passé / ≤ 5 s futur, strictement croissant ; précision 1–250 m ; bornes lat/lon ; rejeu exact idempotent ; **1 point / 5 s** (`53300` → 429) + quota 30/min | `019:139-150` |
| stop / arrived / destination / clear | `stop`/`arrived` exigent session + identité courantes, `arrived` passe par `set_travel_stage('on_site')` puis purge sans ressusciter (`where shared`) ; `destination` union stricte (champs listés, types JSON) ou `{"clear":true}` exact ; `destination_version++` et `control_version++` ; leases supprimées sur toute commande non-point | `019:106-122,151-160` |
| Snapshot | purge physique conditionnelle du point périmé de ce dossier (`UPDATE … where … expiré`), position renvoyée seulement si fraîche/éligible/en route, permissions `can_share`/`can_confirm_destination` calculées serveur | `019:60-81` |
| Quota / leases | singleton `id='ign'`, leases par `(intervention, operation)`, `claim_tracking_provider` et `tracking_provider_backoff` **service_role seul** (300 ms global, 30 s route / 1 s géocodage, bail 8 s, backoff 1–60 s) | `019:20-29,202-227` |
| ACL / search_path | toutes les fonctions `security definer set search_path=''` ; privées (`tracking_artisan_eligible`, triggers, purge) révoquées de public/anon/authenticated ; publiques seulement `tracking_snapshot`, `tracking_command`, `tracking_row_visible` à `authenticated` | `019:41,46-47,57-58,82-83,163-164,181,198,226-227` |

## 3. Routes et bibliothèque

| Exigence | Constat | Réf. |
| --- | --- | --- |
| zod strict / origine / cache | `commandSchema` union discriminée `.strict()` partout ; route/géocodage `z.object({}).strict()` / `{query}` borné 2–200 sans contrôles ; `assertOrigin` sur les trois POST ; `Cache-Control: private, no-store` sur succès et erreurs ; paramètres de requête refusés (422) | `state.ts:15-21`, `route.ts:7-8`, `route/route.ts:7`, `geocode/route.ts:7`, `http.ts:8-12` |
| Codes | 401 (session), 403 (écriture), 404 (`42501` du snapshot → invisible), 409 (`P0001`, contexte changé), 422, 429 (`53300`), 503 structurés (`position_unavailable`, `destination_required`, `provider_*`, `route_unavailable`, `invalid_provider_response`, `server_configuration`) | `http.ts:10-15,17` |
| Clé service | uniquement `adminClient()` pour `claim_tracking_provider` / `tracking_provider_backoff`, **après** un snapshot sous JWT | `http.ts:17-21,29` |
| Fournisseur | URL construite fixe `https://data.geopf.fr/navigation/itineraire` / `/geocodage/search`, revalidée (https, hôte, pas de port/userinfo, chemin exact) ; `redirect:'error'` ; abort 5 s ; `Content-Type` JSON ; corps borné 1 MiB en streaming ; UTF-8 fatal ; schémas stricts ; distance/durée bornées ; snaps ≤ 1 km du point/destination et géométrie cohérente (≤ 100 m) | `provider.ts:5-41` |
| Pas de repli | aucune ligne droite ni vitesse constante (le grand cercle sert **uniquement** à valider les snaps, commenté) ; aucune démo OSRM ; `traffic:'not_available'` | `provider.ts:10-18` |
| Re-snapshot | après chaque attente (y compris cache hit) : nouveau snapshot sous JWT, clé recomparée (session, `control_version`, `last_seq`, `destination_version`, artisan, lecteur, opération) → 409 sans géométrie, puis `requireRoute` → 503 si plus frais ; géocodage : droit de confirmation relu (403) et `destination_version` comparée (409) ; mise en cache seulement après la recomparaison | `http.ts:19-33` |
| Clé de cache | sha256 de `[intervention, lecteur, artisan, session, control_version, last_seq, destination_version, opération, query]` ; cache mémoire 100 entrées / 30 s, SQL reste l'autorité de rythme | `state.ts:22-38` |
| Journalisation | aucun `console.*` dans routes et bibliothèque ; aucune coordonnée ni adresse journalisée | grep |

## 4. Tests exécutés par le réviseur (sans réseau)

- `npx tsx --test tests/tracking*.test.ts` : **13/13 PASS** — schémas stricts (usurpation d'identité, consentement manquant, clear mélangé, position incohérente), isolation du cache entre deux dossiers partageant artisan/session/compteurs et entre lecteurs, fraîcheur échantillon **et** réception, parseur IGN (forme observée, unités, snaps, géométrie lointaine), candidats de géocodage sans choix automatique, réseau (SSRF, 429, non-JSON, flux trop gros, sans redirection), chargeur de route réel sans fuite inter-dossiers et recontrôle des droits sur cache hit, réponse tardive après révocation ou nouveau point rejetée sans mise en cache, géocodage avant démarrage GPS avec recontrôle du droit après l'attente, RPC absente/malformée jamais transformée en succès ; routes : auth, extras de requête, dossier exact, no-store, origine/identité/extras rejetés **avant** la RPC, statuts SQL conservés, routage sans coordonnées client.
- `PGLITE_MODULE=/tmp/depannage-web-pwa-sql/node_modules/@electric-sql/pglite/dist/index.js node tests/sql-tracking-review.mjs` (PGlite 0.5.13) : **PASS — 19 migrations** (018 lue depuis `6062f92`), ~40 contrôles nommés + « failed assertion aborts and rollback leaves every table count unchanged » : anonyme/tiers refusés, client ne démarre pas, consentement explicite, artisan ne change pas la destination, démarrage synchronise `travel_stage`, point frais, même seq autre point refusé, précision/ancienneté refusées, admission 5 s, aucune écriture directe, quota service-only, RLS de la ligne brute (fraîche visible, périmée masquée), purge physique par snapshot, stop/arrivée/clear, triggers réaffectation/suspension/terminal, ancien attributaire refusé, viewer de site lecture seule, révocation de site masquant le snapshot, budget fournisseur partagé et backoff.
- `npx tsc --noEmit` au checkpoint : **propre**.
- **Non prouvé** : cloud, migration appliquée, concurrence à deux connexions (verrous réellement observés, révocation de profil vs point, quota concurrent), appel fournisseur réel avec données utilisateur, appareil GPS / veille / PWA en arrière-plan, UI.

## 5. Constats

Aucun P1.

- **P2-1 — Rétention physique du dernier point sans purge planifiée.** Un point expiré n'est effacé physiquement que par `tracking_snapshot`/`tracking_command` du dossier ou par `purge_expired_tracking_points()` (service_role) ; **rien ne l'appelle** (pas de cron, pas de route). Si l'artisan ferme l'application en partage actif et que personne ne relit le dossier, ses dernières coordonnées restent stockées indéfiniment (masquées par RLS). Le contrat dit « masqué logiquement ; snapshot purge physiquement » (l.57), mais l'objectif « pas d'historique » et la minimisation demandent une purge planifiée (pg_cron ou appel service périodique) ou une purge dans le trigger de lecture. `019:50-58`.
- **P2-2 — Concurrence réelle non prouvée (déclarée).** Graphe de verrous sans cycle par lecture, mais aucune recette à deux connexions (suspension/réaffectation vs point, arrivée vs point, deux `claim` concurrents) ; contrat l.89. À exécuter par root avant de revendiquer la garantie.
- **P3-1 — `SELECT` sur toutes les colonnes de la ligne brute.** Un lecteur autorisé (viewer de site compris) lit aussi `session_id`, `consent_at`, `consent_policy`, `confirmed_by` par REST direct ; non exploitable (les points exigent l'identité de l'artisan) mais une vue/des colonnes restreintes minimiseraient l'exposition. `019:34`.
- **P3-2 — Ligne entière masquée quand un point périmé n'est pas encore purgé.** Par REST direct, la destination devient invisible tant que le snapshot n'a pas purgé ; sans effet via les routes (snapshot purge d'abord). `019:43-44`.
- **P3-3 — Une nouvelle destination arrête la session de l'artisan.** `destination` remet `shared=false`, session/consentement à NULL : l'artisan doit redémarrer (nouveau consentement). Cohérent avec la sûreté (point/destination liés) mais à confirmer au contrat et à signaler à l'UI. `019:118-122`.
- **P3-4 — 409 fréquents possibles sur la route.** La clé inclut `last_seq` : un point admis pendant l'appel fournisseur (≤ 5 s, points toutes les 5 s) rend la réponse obsolète (409). Comportement voulu (pas de géométrie périmée) ; l'UI doit relancer sans boucle.

## 6. À vérifier par le pilote en direct

1. Appliquer 019 sur le projet dédié (après 018) ; RLS/ACL effectives ; `tracking_provider_budget` singleton présent.
2. Recette HTTP sous JWT : artisan attribué approuvé `start`/`point`/`stop`/`arrived` ; client/owner/manager écriture `destination`/`clear` ; viewer et manager lecture → 403 en écriture, lecture du snapshot ; tiers → 404 ; 429 au-delà d'un point / 5 s ; 409 sur version/session.
3. Deux connexions : suspension (`approve_artisan false`) ou réaffectation pendant `point` ; arrivée pendant `point` ; deux routes concurrentes → un seul appel fournisseur admis par fenêtre.
4. Un appel IGN réel contrôlé (consentement, données de recette) : route 200 → géométrie, distance, durée ; 429 fournisseur → backoff partagé.
5. Décider la purge planifiée du P2-1.

## 7. Verdict (borné)

Checkpoint `8366c05` **conforme au contrat (y compris l'amendement ROOT) et à la propriété** : RLS/droits/verrous/triggers/versions/quota corrects par lecture, routes strictes et fail-closed, fournisseur fixe sans repli ni journalisation, 13/13 unités, SQL isolé 19 migrations PASS avec rollback, `tsc` propre, tous reproduits par le réviseur. **Mergeable côté backend** sous réserve de traiter ou déclarer P2-1 (purge planifiée) et de faire exécuter par root la recette deux connexions (P2-2) et l'appel fournisseur réel. Aucune exécution cloud, fournisseur ou appareil par le réviseur.

## 8. Addendum — correctif `c8ca4cc31c0157f246531769cd9f45cd47b464fe` (re-vérification après l'attente du quota)

Même méthode (worktree détaché au SHA exact, lecture seule, supprimé ensuite). Diff `8366c05..c8ca4cc` : 3 fichiers seulement — `lib/features/tracking/http.ts` (+24/−4), `tests/tracking.test.ts` (+25/−2), `docs/TRACKING_CONTRACT.md` (+8). **Aucun SQL modifié**, propriété inchangée.

Constat :
- **Route** (`http.ts` `loadRoute`) : après `claim(...)` (qui peut attendre une autre transaction), un **nouveau snapshot sous JWT** est pris ; la clé complète (intervention, lecteur, artisan, session, `control_version`, `last_seq`, `destination_version`, opération) doit être identique à celle d'avant → sinon 409 ; `requireRoute(ready)` exige encore un point frais et une destination → sinon 503 ; l'URL fournisseur est construite depuis `ready` (mêmes coordonnées, puisque la clé inclut `last_seq`). Le contrôle après fournisseur et le chemin cache-hit (sans émission) sont conservés.
- **Géocodage** (`loadGeocode`) : nouveau `requireGeocodeContext(before, ready)` **avant** `providerJson` — droit `can_confirm_destination` relu (403) et identité de contexte (intervention, artisan, session, `control_version`, `destination_version`) → 409 ; sans exiger de GPS actif (correct : on choisit la destination avant le départ). Même contrôle après le fournisseur.
- **Pas de nouveau chemin de contournement** : les deux seuls appels `external(...)` sont précédés du re-snapshot ; un cache hit n'émet rien et repasse par le contrôle final ; `claim` reste le seul usage de la clé service.
- **Fenêtre résiduelle** (déclarée au contrat) : le délai réseau entre la dernière lecture et l'émission HTTP n'est pas fermable sans transaction distribuée ; il est réduit à l'intervalle sans `await` métier entre le snapshot et `fetch`. Acceptable.
- **Tests** : deux nouveaux cas avec un `claim` suspendu par barrière asynchrone, puis révocation (404) / arrêt (409) / nouveau point (409) pour la route, et révocation (404) / retrait du droit (403) / changement de version (409) pour le géocodage — **`providerCalls === 0`** dans chaque cas. Significatifs : ils échoueraient sur `8366c05` (l'émission précédait la seconde vérification).

Exécuté par le réviseur à `c8ca4cc` : `npx tsx --test tests/tracking*.test.ts` **15/15** ; `tests/sql-tracking-review.mjs` (PGlite 0.5.13) **PASS 19 migrations**, rollback inchangé ; `npx tsc --noEmit` **propre**. Toujours non prouvé : cloud, migration appliquée, deux connexions, fournisseur réel, appareil.

**Le P2 « émission externe avant re-vérification après l'attente du quota » est fermé** (constat de la revue 8366c05 relayé par root). P2-1 et P2-2 de la section 5 restent ouverts.

### P2-1 — options pour une purge planifiée du dernier point expiré (pg_cron non disponible selon le préflight root) — options seulement, aucune décision

Rappel : `public.purge_expired_tracking_points()` (019:50-58) existe, est idempotente, n'efface que les colonnes de point périmé (> 60 s), et n'est exécutable que par `service_role`. Avec une cadence `C`, la rétention physique maximale d'un point devient ≈ 60 s + `C`.

| Option | Ce qu'il faut | Prérequis / risques |
| --- | --- | --- |
| A. Appel périodique **service_role** de la RPC existante par un **ordonnanceur de confiance déjà présent** — p. ex. workflow GitHub Actions planifié (`on: schedule`) faisant `POST /rest/v1/rpc/purge_expired_tracking_points` | un fichier de workflow (propriétaire CI), un secret de dépôt contenant la clé service du projet visé, le ref projet ; aucune migration | gestion d'un secret service dans la CI ; cadence minimale ~5 min et non garantie (retards possibles de l'ordonnanceur) ; décision propriétaire sur le stockage du secret |
| B. Route interne Next appelée par **Vercel Cron** (p. ex. `/api/internal/tracking-purge` protégée par un secret d'en-tête, clé service côté serveur) | une route (propriétaire backend), une entrée `crons` dans `vercel.json`, deux variables d'environnement serveur | dépend d'un déploiement Vercel actif (actuellement différé par le propriétaire) ; cadence selon le plan Vercel ; surface HTTP supplémentaire à protéger |
| C. **Activer pg_cron** sur le projet Supabase puis une migration `cron.schedule('tracking-purge','* * * * *','select public.purge_expired_tracking_points()')` | décision propriétaire + activation de l'extension (tableau de bord / `create extension`), une migration additive (numéro réservé, propriétaire backend), revue SQL | extension aujourd'hui non activée (préflight root) ; tâches exécutées par `postgres` ; à documenter dans les migrations ; les « Scheduled Functions » Supabase reposent elles aussi sur pg_cron (donc même prérequis) |
| D. **Purge opportuniste élargie sans ordonnanceur** : dans `tracking_snapshot` / `tracking_command`, purger aussi **toutes** les lignes expirées (pas seulement le dossier courant), avec un index partiel `where latitude is not null` | modification de 019 (ou migration suivante) par le propriétaire backend, revue SQL des verrous (UPDATE multi-lignes hors ordre org→intervention : à vérifier contre le graphe) | aucune garantie en l'absence de trafic ; coût et verrous sur un chemin de lecture ; complexité de verrouillage accrue |
| E. Accepter et **déclarer** la rétention (masquage RLS seul) | mention au contrat / registre de traitement | la coordonnée la plus récente d'un artisan peut subsister indéfiniment en base ; à confronter à l'objectif « pas d'historique » et au consentement `tracking-v1` |

Le choix appartient au propriétaire et au pilote ; A et B n'exigent aucune modification de 019, C exige une extension et une migration, D modifie le SQL de Codex.

## 9. Addendum — rétention planifiée `282edc1479b476a2a2662bbc0f322b6d5e38dfa2` (contrat `44cfb15` avant code)

Même méthode : worktree détaché au SHA exact, lecture seule, supprimé ensuite ; aucun cloud, aucun credential, aucun pg_cron réel activé (PGlite + ordonnanceur **stub** déclaré), aucun fichier Codex modifié.

### 9.1 Fichiers touchés (`git diff --stat c8ca4cc 282edc1`)

`docs/TRACKING_CONTRACT.md` (+52), `supabase/migrations/202610310020_tracking_retention.sql` (nouveau, +72), `tests/sql-tracking-retention-review.mjs` (nouveau, +62), `tests/sql-tracking-review.mjs` (+3/−2 : applique 020 avec le stub). **Aucune migration antérieure modifiée** (`git diff --name-only c8ca4cc 282edc1 -- supabase/migrations` → 020 seule) ; aucun fichier applicatif, UI, package.

### 9.2 Purge (`020:8-23`)

| Exigence | Constat |
| --- | --- |
| Lot ≤ 1000 | CTE `materialized … limit 1000` (`020:12-16`) ; test : 1001 expirés → 1000, puis 1, puis 0 |
| `FOR UPDATE SKIP LOCKED` | `for update of t skip locked` (`020:16`) ; une ligne tenue par une commande est laissée au passage suivant, jamais attendue |
| Index | `tracking_point_expiry_idx` partiel `((least(sampled_at,received_at)),intervention_id) where latitude is not null` (`020:8`), même expression que le prédicat et l'ordre (`020:14-15`) |
| Prédicat | `latitude is not null and least(sampled_at,received_at) < clock_timestamp()-60 s` : équivalent exact du critère 019 (`sampled_at` OU `received_at` périmé) ; points frais conservés (test : 2 frais survivent) |
| Effet | met à NULL **uniquement** les 5 champs GPS ; ne touche ni session, consentement, `control_version`, destination, ni quota/leases (test : colonnes métier strictement identiques avant/après) |
| Idempotence | 2e et 3e appels → 1 puis 0 ; aucune autre écriture |
| ACL | même signature 019 remplacée (`create or replace`), `security definer set search_path=''`, `revoke … from public,anon,authenticated`, `grant execute … to service_role` ; test : anon/authenticated → 42501 sur la fonction et sur `cron.job` |

### 9.3 pg_cron (`020:25-71`)

- **Un seul job**, nom exact `depannage_tracking_retention_v1`, `* * * * *`, commande constante `select public.purge_expired_tracking_points();` (`020:56-60`).
- **Collision refusée, jamais écrasée** : `lock table cron.job in share row exclusive mode` sérialise les installateurs concurrents ; `row_security=off` **local** pour voir toutes les lignes de ce nom (refus si la session ne peut pas lire sans RLS) ; 0 ligne → `cron.schedule` ; 1 ligne → vérification stricte (planning, commande, base, `username='postgres'`, `active`, `nodename='localhost'`, `nodeport`) sinon exception sans modification ; > 1 → exception. `cron.schedule(name,…)` (upsert natif) n'est **jamais** appelé quand une ligne existe. Test : chaque dérive (commande, planning, propriétaire, base, nœud, inactif, port) → échec P0001, table `cron.job` inchangée, aucun appel `schedule` supplémentaire ; job étranger `foreign_untouched` intact ; réapplication conforme → aucun nouvel appel.
- **pg_cron absent** : la migration native lève `P0001 « pg_cron is unavailable »` et toute la transaction 020 est annulée (index et fonction compris) — pas de succès silencieux ; test : `cron.job` reste absent. Le stub n'est substitué que dans les tests, par remplacement explicite du bloc balisé `BEGIN/END PG_CRON INSTALL`, et il ne lance aucune horloge.
- Accès client : refus si `anon`/`authenticated` ont `USAGE` sur `cron` (test : `grant usage … to authenticated` → 42501, rien modifié) ; aucun droit cron accordé aux rôles applicatifs ; seuls les droits de gestion `postgres` de l'installation officielle Supabase.
- Rien n'active pg_cron dans les exécutions de revue (PGlite n'a pas l'extension ; le stub est un schéma `cron` factice local).

### 9.4 Verrous et borne de rétention

- La purge ne prend **que** les lignes `intervention_tracking` sélectionnées, sans attendre (SKIP LOCKED), sans verrou d'organisation/intervention/profil et sans trigger sur cette table : **aucun cycle** possible avec les commandes 019 (`org → intervention → profil → dossier → tracking`). Une commande `point/stop/start` peut attendre au plus la durée d'un UPDATE de lot sur sa ligne ; après la purge elle relit la ligne verrouillée (points NULL) et poursuit normalement (pas de faux rejet « obsolète » : `sampled_at` NULL). Pas de famine des commandes ; une ligne verrouillée en permanence serait seulement reportée.
- Borne : ≈ 60 s (péremption) + ≤ 60 s (cadence) + durée d'exécution ; le contrat dit explicitement « fonctionnement ordinaire, **pas un TTL physique dur** » (panne cron, backlog > 1000/min, lignes verrouillées) et fournit des requêtes de supervision sans coordonnées. Cohérent avec la section 8.

### 9.5 Exécuté par le réviseur à `282edc1`

| Commande | Résultat |
| --- | --- |
| `PGLITE_MODULE=/tmp/depannage-web-pwa-sql/…/pglite/dist/index.js node tests/sql-tracking-retention-review.mjs` | **3 blocs PASS** (installation native refusée sans pg_cron ; job créé une fois / réapplication inchangée / job étranger intact ; 7 dérives + accès cron applicatif refusés ; purge service-only 1000 → 1 → 0, 2 frais conservés, champs métier inchangés) |
| `PGLITE_MODULE=… node tests/sql-tracking-review.mjs` | **PASS 20 migrations** (018 lue depuis `6062f92`, 020 avec stub), rollback inchangé |
| `npx tsx --test tests/tracking*.test.ts` | **15/15** |
| `npx tsc --noEmit` | **propre** |

**Non prouvé** : cloud ; application de 020 ; pg_cron réel (chargement, `cron.job` réel, RLS de `cron.job` vs `row_security=off` pour le rôle `postgres` Supabase, `nodename/nodeport` réels) ; une exécution par l'ordonnanceur (`cron.job_run_details.status='succeeded'`) ; SKIP LOCKED et concurrence à deux connexions ; volumétrie.

### 9.6 Constats

Aucun P1.

- **P2-1 (section 5) : fermé côté code**, sous réserve de la preuve opérationnelle root (job réel + au moins un `succeeded` effaçant un point QA expiré, point frais contrasté) — tant qu'elle manque, la rétention reste « masquage RLS + purge à la lecture ».
- **P2-2 (concurrence deux connexions)** : toujours ouvert ; s'y ajoute purge `SKIP LOCKED` vs `point` concurrent.
- **P3-1 — L'application de 020 active elle-même pg_cron** (`create extension … with schema pg_catalog`, `020:32`) : c'est une décision propriétaire distincte de « déployer une purge » ; et l'amélioration de la fonction (lot + index) est **couplée** à l'ordonnanceur (pg_cron indisponible ⇒ 020 entière annulée). À confirmer comme voulu (le contrat le décrit) avant l'application.
- **P3-2 — Hypothèses Supabase à vérifier en direct** : `postgres` lit bien `cron.job` avec `row_security=off` (sinon 020 échoue, fail-closed), `nodename='localhost'` et `nodeport=inet_server_port()` correspondent aux valeurs que `cron.schedule` enregistre ; un écart ferait échouer 020 sans dommage.
- **P3-3 — `cron.job_run_details` croît sans nettoyage** (déclaré au contrat) : une ligne par minute ; prévoir sa rétention côté exploitation.
- **P3-4 — Lot fixe 1000/min** : suffisant pour l'usage (un point actif par session) ; au-delà, backlog visible par la requête de supervision fournie.

### 9.7 Verdict (borné)

`282edc1` est **conforme au contrat `44cfb15`** : nouvelle migration seule, purge bornée/non bloquante/limitée aux champs GPS expirés/service-only, job unique à collision refusée, échec explicite sans pg_cron, aucun verrou nouveau sur le graphe 019. **Mergeable côté code**, application conditionnée à la décision propriétaire d'activer pg_cron (P3-1) et à la preuve root (job réel, run `succeeded`, point expiré effacé / frais conservé, deux connexions). Aucune exécution cloud ni pg_cron réel par le réviseur.

## 10. Addendum — correctif 020 `a658087a6232746e08c432f1df20fc0b39a78538` (hébergé : verrou consultatif + API `cron.schedule`)

Verdict formé avant toute lecture de la revue root. Même méthode : worktree détaché au SHA exact, lecture seule, supprimé ensuite ; aucun cloud, aucun credential, aucun pg_cron réel. Contexte root : 019 appliquée, 020 annulée en direct sur 42501 (`LOCK cron.job` / lecture `row_security=off`), aucun job cron.

**(1) Fichiers** (`git diff --name-only 282edc1 a658087`) : `docs/TRACKING_CONTRACT.md`, `supabase/migrations/202610310020_tracking_retention.sql`, `tests/sql-tracking-retention-review.mjs`. Aucune migration antérieure, aucun autre fichier.

**(2) Sémantique de collision — ce qui est garanti / ne l'est pas.** La lecture est désormais `where jobname=name_ and username=current_user` sous RLS active (politique pg_cron `username=current_user`). Dans l'**espace (nom, propriétaire courant)** : absent ⇒ `cron.schedule` crée ; présent et conforme (planning, commande, base, `username=current_user`, actif, `localhost`, port) ⇒ conservé, aucun appel `schedule` ; présent mais dérivé ⇒ refus `P0001` sans modification (testé pour commande, planning, base, nœud, inactif, port). `n>1` est impossible (unicité `(jobname, username)` de pg_cron). **Garanti** : aucun job d'un autre propriétaire n'est lu, modifié ni écrasé — `cron.schedule(name,…)` fait un upsert sur la clé `(jobname, username)` de l'appelant, donc un job homonyme d'un autre rôle n'est jamais touché (test : job `foreign_owner` homonyme caché par RLS et intact). **Non garanti** : l'unicité **globale** du nom — un job homonyme d'un autre propriétaire, invisible, peut coexister avec le nôtre (deux lignes de même `jobname`, propriétaires différents ; le test l'établit). Ce n'est pas un écrasement mais un « doublon inter-propriétaires » non détecté ; la détection exigerait des droits de lecture hors RLS que l'hébergement refuse. La vérification « propriétaire = `postgres` » est remplacée par « = `current_user` » : appliquer 020 **en tant que `postgres`** reste nécessaire pour que le job s'exécute sous le propriétaire de la fonction.

**(3) Verrou consultatif.** `pg_try_advisory_xact_lock(hashtext('depannage.tracking.retention'), hashtext(current_database()||':'||current_user||':'||name_))` : clé fixe et espacée par base/propriétaire/nom, **portée transaction** (relâchée au commit/rollback), **non bloquant** (un second installateur échoue en `55P03` au lieu d'attendre). **Coopératif seulement** : il ne protège pas contre un administrateur, le tableau de bord Supabase ou tout outil qui appelle directement `cron.schedule`/`alter_job`/`unschedule` sans prendre ce verrou (entre le `count` et `schedule`, un tel acteur pourrait créer le même nom pour le même propriétaire et l'upsert l'écraserait, ou l'inverse) ; ni contre une dérive postérieure au commit (détectée seulement à la réapplication) ; collision de hachage 32 bits théoriquement possible mais sans effet hors de ce protocole. Le contrat le déclare (« Administrators bypassing this protocol must not concurrently schedule … », `020:57-58`).

**(4) Purge inchangée** : aucune ligne modifiée dans `020:8-23` (lot 1000, `FOR UPDATE SKIP LOCKED`, index partiel, 5 champs GPS seulement, `security definer`, `search_path=''`, `service_role` seul). Droits réduits : suppression de `grant all privileges on all tables in schema cron to postgres` ; `grant usage on schema cron to postgres` déplacé dans le bloc d'installation native. Préflight explicite des droits du propriétaire (USAGE schéma, SELECT `cron.job`, EXECUTE `cron.schedule`) → `42501` sinon (testé).

**(5) pg_cron absent** ⇒ `P0001 « pg_cron is unavailable »`, toute la transaction 020 annulée (testé, `cron.job` reste absent). Réapplication idempotente (testé : aucun second appel `schedule`, ligne identique). Accès client au schéma cron ⇒ refus `42501` (testé).

**(6) Exécuté** à `a658087` : `tests/sql-tracking-retention-review.mjs` **3 blocs PASS** (installateur non-superuser SELECT seul, propriétaire cron distinct, vraie RLS : l'ancien `LOCK` échoue 42501 comme en direct ; job propre créé une fois ; homonyme étranger caché intact ; dérives et droits manquants refusés ; purge 1000 → 1 → 0, 2 frais conservés) ; `tests/sql-tracking-review.mjs` **PASS 20 migrations**, rollback inchangé ; `npx tsx --test tests/tracking*.test.ts` **15/15** ; `npx tsc --noEmit` **propre**.

**Non prouvé** : pg_cron réel sur Supabase (droits effectifs de `postgres` après `create extension` : USAGE/SELECT/EXECUTE ; `grant usage` éventuellement sans effet si `postgres` n'a pas l'option de délégation — le préflight échouerait alors proprement) ; valeurs réelles `nodename`/`nodeport` enregistrées par `cron.schedule` ; un run `succeeded` ; `SKIP LOCKED` à deux connexions ; cloud.

**Verdict** : aucun P1. **Conforme et applicable par root** (en tant que `postgres`). P2 : preuve opérationnelle root (job réel, `cron.job_run_details` `succeeded`, point QA expiré effacé / frais conservé) et concurrence deux connexions toujours requises. P3-1 : unicité globale du nom non garantie (doublon homonyme inter-propriétaires possible, jamais écrasé) — à accepter ou contrôler par une requête opérateur privilégiée. P3-2 : verrou purement coopératif (déclaré). P3-3 : hypothèses `nodename='localhost'` / `nodeport=inet_server_port()` à constater en direct (échec propre sinon). P3 précédents (activation pg_cron = décision propriétaire, croissance `job_run_details`, lot fixe) inchangés.
