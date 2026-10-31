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

## Amendement A1 — sélecteurs liés au contrat UI `origin/claude/web-tracking-ui` a7a1fed

Source : `docs/TRACKING_UI_CONTRACT.md` (a7a1fed, base 6c67644), feuilles `ArtisanTrackingPanel`, `TrackingCard`,
`DestinationPicker`, `TrackingMap`, placées par le lead (artisan : dossier de mission près du panneau « Déplacement » ; client /
entreprise : détail d’intervention). Règle inchangée : `getByRole` + nom accessible exact partout où un rôle existe ; textes
d’état lus dans la région `aria-live="polite"` (sélecteur `[aria-live="polite"]` à l’intérieur de la feuille). Les libellés
contenant un nombre (âge, précision, heure, durée) sont vérifiés par expression régulière ancrée, jamais par valeur exacte de
position. Si le raccordement lead change un libellé, le scénario échoue en `ANOMALY: selector`, il n’est pas adapté en silence.

| Élément | Sélecteur lié (rôle, nom) | Scénarios |
| --- | --- | --- |
| Ouvrir le consentement | `button` « Partager ma position » | T1, T2, T3, T7, T8 |
| Valider / renoncer | `button` « Autoriser et démarrer » / `button` « Annuler » | T2 (Annuler ⇒ aucun POST), T3 |
| Texte de consentement | contient `tracking-v1` (version) et « IGN » (envoi origine/destination) | T3 |
| Arrêter / arrivé | `button` « Arrêter le partage » / `button` « Je suis arrivé » | T14 |
| Dernière position envoyée | texte « position déclarée par le navigateur », `/± \d+ m/`, `/il y a \d+ s/` ; jamais « GPS certifié » | T3, T4 |
| Permission refusée | message d’explication de réactivation dans les réglages ; watch arrêté | T1 |
| Indisponible / délai | `button` « Réessayer » | T1 (variante timeout) |
| Hors ligne | message hors ligne dans la région live ; aucun POST pendant la coupure (pas de file différée) | T7 |
| Échantillon refusé localement | « trop imprécise » (accuracy > 250 m) / « trop ancienne » (> 60 s) ; aucun POST | T5 (volet navigateur) |
| Reload | « Partage interrompu par le rechargement » + bouton de redémarrage explicite ; aucun POST sans clic | T8 |
| Mention web | « Sur le web, le partage s’arrête si la page est fermée, mise en arrière-plan ou en veille » (préfixe) | T3 |
| Client — états | « Suivi actif » (seulement `shared` + `fresh`), « Position périmée (dernière il y a N min) », « Partage arrêté par l’artisan », « Aucune position partagée » | T6, T9, T14, T19 |
| Arrivée estimée | `/Arrivée estimée vers \d{2}:\d{2}/` + « hors trafic temps réel » + « IGN Géoplateforme / BD TOPO » ; absente pour `stale` et pour chaque raison 503 | T6, provider-proof |
| Recalculer | `button` « Recalculer » (≤ 1 appel `route` par 30 s observé) | provider-proof |
| Messages 503 | textes exacts du §6 UI (`position_unavailable` … `server_configuration`) | T6, provider-proof |
| Destination | champ de recherche du `DestinationPicker` (2–200 car.), `button` « Confirmer cette destination » par candidat, `button` « Retirer la destination » + confirmation | T16, T17 |
| Lien navigation | `link` « Ouvrir dans mon application de navigation » (cliqué jamais ; vérifié présent seulement avec destination confirmée) | T16 |
| Carte | `role="img"` avec description `/Position de l’artisan à \d+ m de la destination/` ; attributions « © OpenStreetMap contributors » et « Itinéraire : IGN Géoplateforme / BD TOPO » visibles ; « Fond de carte indisponible » hors ligne | T7, T9, provider-proof |

Ajustements de scénarios induits par le contrat UI (le volet API reste celui du §6) :

- **T2** : « Annuler » sur l’écran de consentement ⇒ aucun `POST …/tracking` ; la permission navigateur accordée seule ne déclenche
  aucun envoi.
- **T3** : ordre vérifié : la réponse 200 du `start` précède le premier `POST` d’action `point` (le `watchPosition` ne démarre
  qu’après le start).
- **T4** : volet navigateur : au plus 1 `POST point` par 5 s observé avec positions simulées changeantes ; `seq` croissant lu
  dans le corps (sans journaliser les coordonnées).
- **T5** : volet navigateur : précision simulée 300 m ⇒ « trop imprécise », aucun `POST`. Les bornes serveur restent testées en API.
- **T7** : pendant `setOffline(true)`, aucun POST n’est émis ni mis en file ; à la reprise, l’échantillon suivant part sur la **même**
  session avec `seq` supérieur, sans nouveau `start` ; si le serveur répond 409, l’UI recharge le snapshot (attendu admis).
- **T8** : après reload avec `shared=true` côté serveur : message « Partage interrompu par le rechargement », zéro POST jusqu’au clic,
  puis nouveau `start` avec un `session_id` différent.
- **T12** : reste `skipped: needs-root-actor` tant que ROOT n’a pas désigné l’acteur de réaffectation (question 1, transmise par le lead).
- **Cleanup** : question 2 (cascade des leases fournisseur) transmise à ROOT par le lead ; d’ici sa réponse, les leases de la
  cohorte sont seulement comptés et listés, jamais supprimés.

Captures 360/1280 (après hydratation complète) : artisan — non partagé, consentement, en partage, refus, hors ligne, reload ;
client — `fresh`, `stale`, `stopped`, arrivée estimée ou message 503. Les coordonnées visibles sont uniquement les points publics
simulés. Toujours aucun code ni exécution avant le GO de ROOT.

## Amendement A2 — contrôle contre le backend livré `origin/codex/gps-eta` 8366c05

Lecture seule par `git show` (migration `202610310019_intervention_tracking.sql`, `app/api/interventions/[id]/tracking/**`,
`lib/features/tracking/{http,state,types,provider}.ts`). **Aucun merge** dans `claude/web-qa-tracking` à ce stade : la branche ne
contient que ce contrat ; le merge de travail (import des types) sera fait au début du code, après le GO de ROOT, sans copier ni
modifier un fichier backend. Rien de ce qui suit n'implique une acceptation de 8366c05.

**Question 2 (leases) — résolue par la source.** `tracking_provider_leases.intervention_id … references interventions(id) on delete
cascade` et `intervention_tracking.intervention_id … on delete cascade`. En revanche `intervention_tracking.artisan_id` et
`confirmed_by` référencent `profiles(id)` **sans** cascade. Nettoyage retenu :
1. `intervention_tracking` par `intervention_id` (cohorte) — étape explicite avant `interventions` (inchangé ; obligatoire avant
   `profiles` à cause des deux FK sans cascade) ;
2. aucune étape pour `tracking_provider_leases` : supprimés par la cascade de `interventions` ; relecture après nettoyage = 0 ligne
   pour les interventions du manifeste, sinon exit 3 ;
3. `tracking_provider_budget` (singleton `id='ign'`) : jamais lu en écriture, jamais supprimé ; seule une lecture `next_allowed_at`
   est autorisée dans le rapport fournisseur.

**Routes et codes réels (remplacent les attentes génériques du §6 là où elles diffèrent).**

| Cas | Réponse livrée |
| --- | --- |
| GET snapshot non autorisé (`42501`) | **404** « Ce suivi est introuvable. » |
| POST commande par un compte sans droit (tiers, viewer en `point`/`start`, artisan non attribué, destination par viewer/artisan) | **403** (via `dbError` 42501) |
| Paramètre de requête sur une route tracking | **422** (`checkedId` refuse toute query string) — vérifié en T10 |
| Format / bornes (`22023`) | **422** |
| Version, session ou ordre (`P0001`) | **409** |
| Point plus d'1 / 5 s (`53300`) ou quota d'action (`consume_action` 30/min) | **429**, `Retry-After` présent (5 s par défaut) |
| Route sans point frais / sans destination | **503** `reason: position_unavailable` / `destination_required` |
| Quota applicatif fournisseur | **429** `reason: application_quota`, `retry_after_s` 1–60 + `Retry-After` |
| Contexte changé pendant le calcul | **409** `reason: tracking_changed` |
| Erreurs fournisseur | **503** `reason` ∈ `provider_quota` (+ `retry_after_s`), `provider_timeout`, `provider_unavailable`, `route_unavailable`, `invalid_provider_response`, `server_configuration` |
| Géocodage sans `can_confirm_destination` | **403** (avant ou après l'appel fournisseur) |

**Écarts de sémantique à prendre en compte (attentes corrigées).**
- **T14 — stop répété** : un second `stop` (session déjà invalidée) renvoie **409** « Tracking session changed » et ne modifie
  rien ; c'est l'attendu (pas un succès idempotent).
- **T3 — rejeu de start** : même `session_id` pendant le partage ⇒ 200 avec le même snapshot ; `session_id` différent pendant le
  partage ⇒ **409** « A tracking session is already active ».
- **T6 — fraîcheur** : `position_state` vaut `stale` tant que `shared` et `last_seq > 0` sans point frais, `stopped` dès que
  `shared=false`, `fresh` seulement si `travel_stage='en_route'` et artisan toujours éligible ; un GET purge physiquement le point
  expiré de ce dossier (constat attendu, pas un effet de bord).
- **T16 — destination** : toute confirmation ou `clear` invalide aussi la session (`shared=false`, point effacé, `control_version`
  +1, `destination_version` +1) ; `can_confirm_destination` = `owns_intervention` (client particulier ou owner/manager avec
  `can_manage_site`) ou admin, et faux après `completed/paid/cancelled`.
- **T13 — suspension** : les déclencheurs `tracking_profile_invalidation` (`artisan_approved`, `role`) et
  `tracking_dossier_invalidation` (`application_status`) purgent la ligne et les leases ; la mise à jour de colonnes profil par la
  clé service, déjà admise par les fixtures existantes, exerce bien ces déclencheurs.
- **T12 — réaffectation** : reste `skipped: needs-root-actor` (consigne lead). Information pour ROOT : le déclencheur
  `tracking_intervention_invalidation` réagit à **toute** mise à jour de `interventions.artisan_id` ; une variante « réaffectation
  simulée par la clé service » exercerait la purge sans `reassign_intervention`, mais elle n'est pas activée sans accord ROOT.

**Incohérence inter-contrats signalée (UI a7a1fed ↔ backend 8366c05) — à arbitrer par le lead, pas corrigée ici.** Le contrat UI
prévoit, après rechargement avec `shared=true`, un « nouveau démarrage, nouveau `session_id` ». Le backend refuse un `start` avec un
autre `session_id` tant que `shared=true` (409). Une reprise conforme doit donc envoyer d'abord `stop` avec le `session_id` lu dans
le snapshot, puis `start` avec un nouvel identifiant. **T8** attend cette séquence ; un `start` seul suivi d'un 409 sera rapporté
comme `ANOMALY: restart-after-reload` (défaut de raccordement), pas masqué par un nouvel essai.

**Inchangé** : pas de code ni d'exécution avant le GO de ROOT ; sélecteurs de l'amendement A1 ; position simulée étiquetée ;
preuve fournisseur séparée et optionnelle ; redaction des coordonnées ; codes de sortie.

## Amendement A3 — réponses ROOT (réaffectation simulée, preuve du 429)

**T12 — réaffectation : simulée, sur identifiants de cohorte validés uniquement.** T12 n'est plus `skipped` ; il devient
`T12-sim` avec l'étiquette obligatoire `state_source: "simulated_service_key_reassignment"` dans `result.json` et `summary.md`, et la
mention « état simulé par la clé service — **pas** une preuve du flux de réaffectation administrateur (`reassign_intervention`) ».
Garde avant toute écriture (échec ⇒ scénario `BLOCKED`, aucune écriture, pas d'exit 1) :
1. l'identifiant du dossier figure dans `manifest.created.interventions` du run courant **et** sa relecture par la clé service montre
   `client_id` = le client de la cohorte et `artisan_id` = artisanA de la cohorte ;
2. l'artisan cible (artisanB) figure dans `manifest.created.profiles` du run courant, `role='artisan'`, et appartient au même
   `run_id` (préfixe d'e-mail `qa.invalid` de la cohorte) ;
3. l'intervention est `accepted` ou `in_progress` ;
4. une intention est enregistrée avant l'écriture et réglée après.
Écriture unique : `update interventions set artisan_id = <artisanB> where id = <dossier> and artisan_id = <artisanA>` (clé service,
condition sur l'ancien artisan ; 0 ligne ⇒ `BLOCKED`). Attendus : déclencheur `tracking_intervention_invalidation` → ligne purgée
(`shared=false`, point NULL, `control_version` +1, leases supprimés) ; artisanA : GET 404, POST 403, aucune coordonnée ; artisanB :
`can_share` vrai seulement après son propre consentement + start ; snapshot côté client `stopped`. Aucune autre écriture directe sur
`interventions` dans la recette.

**429 fournisseur : jamais provoqué en conditions réelles.** La recette ne fait **aucune** rafale vers IGN ; aucune boucle, aucun
nouvel essai automatique. Une seule route nominale réelle (et, si `--provider-proof`, un seul géocodage public) suffit. La preuve du
429 et du backoff partagé est faite hors cloud, dans mes fichiers :
- `tests/qa-tracking-provider.test.ts` (unitaire, aucun réseau) : `providerJson(url, fetcher)` exporté par
  `lib/features/tracking/provider.ts` reçoit un faux `fetch` répondant 429 avec `Retry-After: 7` ⇒ `TrackingProviderError`
  `reason:'provider_quota'`, `retryAfter=7` ; sans en-tête ⇒ 30 ; `Retry-After: 999` ⇒ borné à 60. Import en lecture seule, aucun fichier
  backend modifié.
- `scripts/qa-tracking/sql-backoff-review.mjs` (PGlite **local** isolé, migrations 001–019 chargées depuis le merge de travail, stubs
  Auth/Storage comme les revues SQL existantes) : sous `service_role`, `tracking_provider_backoff(7)` ⇒ `backoff_until` ≈ now+7 s dans
  `tracking_provider_budget` ; puis `claim_tracking_provider(<dossier>, 'route', <clé 64 hex>)` ⇒ `{allowed:false, retry_after_s≥1}` ;
  `tracking_provider_backoff(0|61)` ⇒ 22023 ; `authenticated`/`anon` ⇒ refus d'exécution. Le chemin HTTP (429 fournisseur ⇒ appel
  `tracking_provider_backoff` ⇒ réponse 503 `provider_quota` + `retry_after_s`) reste couvert par les tests backend de Codex ; je le
  cite sans le dupliquer.
- **Cloud** : le singleton `tracking_provider_budget` reste en lecture seule (champ `backoff_until` seulement rapporté). Si la route
  réelle répond 503 `provider_quota` ou 429 `application_quota`, c'est consigné comme indisponibilité, sans nouvel essai.

Inchangé : pas de code ni d'exécution avant le GO de ROOT ; incohérence de reprise après rechargement (A2) toujours à arbitrer par
le lead.
