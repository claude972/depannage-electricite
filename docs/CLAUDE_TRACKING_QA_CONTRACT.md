# WEB-TRACKING-QA-006 — contrat de recette GPS/ETA (avant code)

- Agent : Claude (worktree `depannage-claude-planning`), pilote/exécution cloud : ROOT.
- Branche `claude/web-qa-tracking`, base **origin/integration/web-pwa `6c67644`**.
- Contrats d'entrée : API Codex **`origin/codex/gps-eta` 804a807** (`docs/TRACKING_CONTRACT.md`, base 0f57d96, amendement ROOT
  isolation cache / clear / géocodage inclus) ; contrat UI (design) **à recevoir** — tous les sélecteurs UI ci-dessous sont
  « à relier depuis le contrat UI ».
- Statut : **contrat publié avant code**. Aucun script, aucun test, aucune exécution cloud avant le GO de ROOT. Claude n'exécute
  jamais la recette contre le projet cloud : seulement syntaxe, `--dry-run` et tests unitaires locaux.

## 1. Périmètre et fichiers

Fichiers exclusifs (tous nouveaux) : `scripts/qa-tracking/**`, `tests/qa-tracking*.test.ts`, ce document. Lecture seule :
`scripts/qa/lib/*` (config, args, cohort, fixtures, cleanup, lifecycle, redact, report, supabase, browser, admin-preflight),
importés tels quels ; aucune modification des portes existantes (documents/B2B, PWA OS, expiration/révocation, assistance,
`scripts/qa/run.mjs`, `scripts/qa-advanced*`, `scripts/qa-gateway`, `scripts/qa-pwa-lifecycle*`). Aucun package, aucune
migration, aucun fichier applicatif.

Entrée : `node scripts/qa-tracking/run.mjs --base-url <url> --sha <sha> --project <ref> --credentials <json> --out <dir>
[--suites a,b] [--dry-run] [--keep-fixtures] [--cleanup-manifest <path>] [--provider-proof] [--timeout-ms n]`.

## 2. Préflight (refus = exit 2, aucune écriture)

1. `verifySha` : le SHA demandé est celui du dépôt et la cible sert le même `BUILD_ID` (lu sur la page servie) ; un écart refuse.
2. `assertBaseUrl` : origine sur la liste autorisée (locale ou preview autorisée), jamais production.
3. `assertProject` : référence projet attendue = celle des identifiants ; clé service lue en mémoire seulement.
4. `assertOutOutsideRepo` : sortie hors dépôt, dossier `0700`, fichiers `0600`.
5. Capacités présentes : `GET /api/interventions/<uuid inconnu>/tracking` sous un compte de cohorte doit répondre **404** (route
   active) et non 405/HTML ; sinon `ANOMALY: route absente` et arrêt avant fixtures. Présence de la table
   `intervention_tracking` lue par la clé service (`select … limit 0`) ; absence = arrêt (migration 019 non appliquée).
6. `adminPreflight` non requis : la recette ne crée **aucun** compte admin, aucune grant plateforme, aucune écriture finance.

## 3. Position du navigateur : simulée et étiquetée

- Position fournie par `context.setGeolocation()` + `grantPermissions(['geolocation'])` de Playwright sur des **coordonnées
  publiques fixes** (Fort-de-France, place de la Savane `14.6035, -61.068` ; zone aéroport `14.5911, -61.0032`), précision
  fixée (20 m nominal, 300 m pour le refus d'admission).
- Chaque preuve porte `position_source: "simulated_browser_geolocation"` dans `result.json` / `summary.md`. Aucune formulation
  « GPS », « appareil » ou « mesure » n'est employée pour ces résultats.
- **Non revendiqué** : GPS matériel, permission OS, veille/arrière-plan PWA, précision réelle. Ligne explicite « preuve GPS
  physique : non exercée » dans le résumé.

## 4. Preuve fournisseur, distincte des mocks

Suite optionnelle `provider-proof` (drapeau `--provider-proof`, désactivée par défaut) : un dossier de cohorte, destination
confirmée manuellement sur la zone aéroport, session démarrée sur la Savane, puis **un seul** `POST …/tracking/route`. Attendu :
`state:'available'`, `source:'IGN Géoplateforme / BD TOPO'`, `resource:'bdtopo-valhalla'`, `traffic:'not_available'`,
distance/durée finies (≤ 1 000 000 m, ≤ 86 400 s), `geometry.type === 'LineString'` 2–10 000 points, `calculated_at` présent,
versions (`session_id`, `control_version`, `point_seq`, `destination_version`) égales au snapshot. `503` avec raison structurée
(`provider_quota`, `provider_timeout`, `provider_unavailable`, `route_unavailable`, `server_configuration`) = **indisponibilité
consignée**, pas un succès ni un échec applicatif ; aucun chiffre d'ETA attendu dans ce cas. Aucun mock de réseau sur ces
appels. Les suites navigateur n'appellent jamais `route`/`geocode` sauf mention ; les preuves fournisseur et navigateur sont
dans deux sections séparées du rapport. Pas de retry automatique (respect du quota partagé, une route/30 s/intervention).

## 5. Cohorte et fixtures

`createCohort` (domaine `qa.invalid`) : `client` (particulier propriétaire), `artisanA` (attribué, approuvé), `artisanB`
(approuvé, cible de réaffectation), `artisanC` (non approuvé), `owner` + `manager` (organisation B2B, site S1), `viewer`
(site S1 lecture seule), `outsider` (sans lien), `otherOrgManager` (autre organisation, site S2). Écritures par la clé
service limitées aux préparatifs déjà admis par `scripts/qa/lib/fixtures.mjs` (comptes, profils, approbation artisan par
colonnes, organisations/sites/membres/grants, interventions et passage `accepted`) ; **jamais** d'écriture directe dans
`intervention_tracking` ni dans les tables privées de quota/lease : toutes les mutations GPS passent par l'API HTTP sous JWT
utilisateur. Aucune fixture admin, finance, paiement ou grant plateforme. `guardWrites` + porte d'arrêt partagée inchangés.

## 6. Scénarios (navigateur + API, deux comptes au moins)

Les éléments d'interface (consentement, Démarrer, Arrêter, Arrivé, états périmé/refusé/hors ligne, destination) sont
**« à relier depuis le contrat UI »** ; tant qu'il manque, les scénarios correspondants sont écrits en API seule et marqués
`ui: pending`.

| # | Scénario | Attendu |
| --- | --- | --- |
| T1 | Refus de permission (pas de `grantPermissions`) | Aucun `POST …/tracking` avec action `point` ; snapshot `shared:false`, `position_state:'no_position'` ; message de refus visible. |
| T2 | Démarrage sans consentement / `consent:false` | 422 ; ligne absente ou `control_version` inchangée. |
| T3 | Consentement + start (artisanA) | 200 ; `shared:true`, `travel_stage:'en_route'`, `last_seq:0`, `control_version` +1. Rejeu identique du même start : même état, pas de second démarrage. |
| T4 | Points ordonnés | seq 1,2,3 acceptés (espacés ≥ 5 s) ; doublon tuple identique accepté ; seq inférieur, même seq différent, `sampled_at` reculant → 409 ; >1 point/5 s → 429 avec `Retry-After` borné. |
| T5 | Bornes | `sampled_at` < now−60 s ou > now+5 s, accuracy 0 / 300, latitude 91, longitude NaN → 422 ; le dernier point valide est inchangé. |
| T6 | Fraîcheur | Après 60 s sans point, snapshot `position_state:'stale'` puis `position:null` ; la valeur n'est jamais rendue comme actuelle ; `route` → 503 `position_unavailable`. |
| T7 | Réseau coupé / reprise | `context.setOffline(true)` pendant le partage : l'UI annonce l'état hors ligne, aucun succès affiché ; reprise : nouveaux points avec seq croissant, pas de redémarrage caché ni de nouvelle session. |
| T8 | Rechargement | Après reload, aucun point n'est émis sans nouvelle action explicite ; ancien callback abandonné (aucun POST après reload sans clic). |
| T9 | Lecteurs autorisés | client, owner, manager, viewer (site courant) lisent le snapshot frais ; `can_share:false`, `can_confirm_destination` vrai seulement pour client/owner/manager. |
| T10 | Tiers | outsider, otherOrgManager, artisanB (non attribué), artisanC → GET 404 sans détail, POST 403/404 ; aucune coordonnée dans les corps de refus. |
| T11 | Révocation de grant | viewer passe en portée `selected` sans S1 → GET 404 immédiatement ; rétablissement → lecture rendue. |
| T12 | Réaffectation | Réaffectation (`reassign_intervention` via le compte prévu par le contrat, sinon suite marquée `skipped: needs-root-actor`) : ancien artisanA → 404 / 409, aucune position ; ligne purgée (`shared:false`, point NULL) ; artisanB doit consentir de nouveau. |
| T13 | Suspension | Désapprobation d'artisanA (colonnes profil par la clé service, comme les fixtures existantes) → session invalidée, commandes tardives 403/409, point effacé. |
| T14 | Stop / arrivé | stop → `shared:false`, point NULL, `control_version` +1, répétition sans effet ; arrived → `travel_stage:'on_site'` et même purge ; commandes tardives après stop → 409. |
| T15 | Fin d'intervention | Passage `completed` → snapshot sans point, POST point refusé. |
| T16 | Destination | client/owner/manager confirment `manual` ; viewer et artisan → 403 ; `{clear:true}` efface cible + point + consentement ; mélange `clear` + coordonnées → 422 ; `destination_version` et `control_version` incrémentées. |
| T17 | Géocodage (optionnel, `--provider-proof`) | requête publique « Place de la Savane 97200 » : ≤ 5 candidats, aucune cible enregistrée sans POST destination ; viewer → 403. |
| T18 | Isolation cache (amendement ROOT) | deux dossiers, même artisan, même UUID de session, mêmes compteurs : snapshots et routes distincts, aucun croisement. API seule. |
| T19 | Changement d'identité | client connecté puis déconnexion et connexion de outsider dans le même onglet : aucune position de A visible ; capture 360/1280 de l'état. |

Captures 360/1280 (après hydratation complète) pour T1, T3, T6, T7, T14 côté artisan et T9 côté client, avec carte/attribution
quand le contrat UI l'expose. Aucune capture ne contient de coordonnée lisible hors des coordonnées publiques fixes.

## 7. Nettoyage (ordre FK, intentions, inconnus ⇒ échec fermé)

- Manifeste réécrit après chaque création (`0600`), avec **intention** enregistrée avant chaque écriture (`intents: [{op, table,
  key, at}]`) et réglée après ; une intention non réglée au nettoyage ⇒ `cleanup: INCOMPLETE`, **exit 3**.
- Étapes ajoutées **avant** les étapes partagées sur `interventions` : `intervention_tracking` par `intervention_id` (ids
  `interventions` de la cohorte), puis les tables partagées dans l'ordre de `CLEANUP_STEPS` (lecture seule ; la liste est
  composée localement, pas modifiée dans `scripts/qa/lib/cleanup.mjs`).
- **Jamais touchés** : le singleton de quota fournisseur et les leases d'autres interventions. Les leases éventuels de la
  cohorte sont seulement relus (comptage par `intervention_id`) ; s'ils ne sont pas supprimés en cascade par la FK prévue
  par 019, le rapport les liste comme restes connus, sans suppression manuelle hors contrat.
- Relecture après suppression : zéro ligne `intervention_tracking` / `interventions` / `profiles` pour les identifiants du
  manifeste ; toute ligne restante ou erreur inconnue ⇒ exit 3. `--cleanup-manifest` reprend un manifeste existant.
- Codes : 0 succès, 1 défaut applicatif, 2 préflight, 3 nettoyage incomplet ou issue inconnue, 130 interruption.

## 8. Journaux et confidentialité

- Redacteur partagé + règle spécifique : toute paire latitude/longitude, `geometry`, `snapped_*`, `destination`, `position`,
  libellé de géocodage est remplacée par `[position]` avant écriture dans `run.log`, `events.ndjson`, `result.json`,
  `summary.md`. Les preuves gardent seulement `{present, state, age_s arrondi, accuracy_bucket, seq, versions}`.
- Réseau résumé `{méthode, chemin, statut}` ; corps POST jamais journalisés ; aucun en-tête.
- Aucune coordonnée dans les URL : vérification automatique que les requêtes `…/tracking*` n'ont pas de query string.
- Captures : seulement les coordonnées publiques fixes ; le rapport rappelle qu'elles sont simulées.

## 9. Tests locaux (exécutés par Claude)

`tests/qa-tracking*.test.ts` (node:test via tsx) : parsing des arguments et refus de préflight ; ordre de nettoyage
(`intervention_tracking` avant `interventions`, aucune étape quota/lease) ; intentions non réglées ⇒ 3 ; redaction des
coordonnées (nombres décimaux, tableaux `[lon,lat]`, GeoJSON) ; classification fournisseur (200 valide, 503 raisons,
réponse invalide) ; étiquetage `simulated_browser_geolocation` ; absence de query string sur les URL de tracking ;
`--dry-run` sans aucun appel réseau. Contrôles : `npx tsc --noEmit`, `npx tsx --test tests/qa-tracking*.test.ts`, puis
`npx tsx --test tests/*.test.ts` pour la non-régression.

## 10. Questions ouvertes (non bloquantes pour ce contrat)

1. Acteur de réaffectation (T12) : `reassign_intervention` exige un administrateur ; la recette ne crée pas d'admin. Proposition :
   ROOT fournit un compte opérateur de recette existant, sinon T12 passe par l'arrêt d'attribution le plus proche admis par 019
   ou reste `skipped: needs-root-actor`.
2. Les leases fournisseur de la cohorte sont-ils supprimés par cascade FK sur `interventions` (019) ? Sinon, nom et clé de la
   table pour une étape de nettoyage explicite approuvée par ROOT.
3. Sélecteurs et noms accessibles : à relier dès réception du SHA du contrat UI.
