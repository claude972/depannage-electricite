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

## Amendement A4 — T8 lié à la décision du lead sur « Reprendre le partage »

Décision lead (transmise à l'agent UI) : « Reprendre le partage » = `stop` avec le `session_id` du snapshot courant (seulement si
`shared=true` et `can_share`), puis écran de consentement à nouveau, puis `start` avec un **nouveau** `session_id` après confirmation ;
jamais un `start` seul suivi d'un 409, jamais de nouvel essai automatique ; si le `stop` échoue (409/403/404), l'UI relit le
snapshot et affiche l'état serveur. L'incohérence signalée en A2 est donc close côté contrat.

**T8 — attendu exact (navigateur, réseau observé sans coordonnées) :**
1. Partage actif (session S1, au moins un point), puis rechargement de la page.
2. Après hydratation : message « Partage interrompu par le rechargement » ; **zéro** `POST …/tracking` tant qu'aucun clic n'a eu lieu
   (observation ≥ 10 s) ; aucun `watchPosition` déclenché (aucun POST `point`).
3. Clic sur « Reprendre le partage » (nom accessible à confirmer à la livraison UI ; changement ⇒ `ANOMALY: selector`) ⇒ exactement un
   `POST` action `stop` avec `payload.session_id = S1` (lu dans le snapshot), réponse 200, `shared=false`.
4. L'écran de consentement réapparaît (« Autoriser et démarrer » / « Annuler ») ; aucun `start` avant le clic.
   Variante 4b : « Annuler » ⇒ aucun `start`, état « Partage arrêté » conservé.
5. « Autoriser et démarrer » ⇒ exactement un `POST` action `start` avec `session_id = S2 ≠ S1`, `consent:true`,
   `consent_policy:'tracking-v1'`, réponse 200 ; ensuite seulement des `point` avec `seq` repartant de 1 sur S2.
6. Ordre strict des requêtes : `stop(S1)` → `start(S2)` → `point…` ; aucun `start` reçu en 409 ; aucune requête répétée
   automatiquement.

**T8-fail — échec du stop :** l'artisan perd l'attribution entre le reload et le clic (via `T12-sim`, mêmes gardes que A3) ⇒ le
`stop(S1)` reçoit 403 ; attendus : un seul `POST stop`, aucun `start`, relecture du snapshot (`GET …/tracking`, ici 404) et affichage
de l'état serveur (plus de contrôle de partage) ; aucun nouvel essai.

Rapport : un `start` seul suivi de 409, un `start` réutilisant S1, un `stop` envoyé sans clic ou une requête répétée automatiquement
⇒ `ANOMALY: restart-after-reload`. Toujours aucun code avant le GO de ROOT.

## Amendement A5 — revue ROOT (GO code sous ces conditions)

1. **Préflight sans compte de cohorte** (remplace §2.5) : avant toute fixture, `GET /api/interventions/<uuid aléatoire>/tracking`
   **anonyme** ⇒ **401** JSON avec `Cache-Control: private, no-store` ; puis `HEAD` service sur `intervention_tracking`
   (`select … head:true`) ⇒ table présente (migration 019). Ensuite seulement, le premier compte technique est **manifesté**
   (intention durable écrite sur disque) **avant** sa création et son authentification ; puis, authentifié, `GET` sur un UUID inconnu
   ⇒ **404** (preuve RLS). Échec de l'un de ces points ⇒ exit 2 (préflight), après nettoyage de ce qui a été manifesté.
2. **Reprise après rechargement** : A4 inchangé ; libellé confirmé par l'UI `origin/claude/web-tracking-ui` 22dd419 :
   `button` « Reprendre le partage » ; message « Partage interrompu par le rechargement de la page. ». Séquence exigée : `stop(S1)`
   → relecture du snapshot → consentement → `start(S2 ≠ S1)` ; jamais un `start` seul en 409.
3. **T1 permission refusée** : attendu = **zéro** `POST point`, `position:null`, `shared:false` et le message UI « Localisation
   refusée par le navigateur : autorisez-la dans les réglages du site pour partager votre position. ». Après un `start` puis `stop`,
   **pas** d'exigence `no_position` (le backend peut répondre `stopped`) : seulement `shared:false` et `position:null`.
4. **SIGINT/SIGTERM** : la porte d'arrêt bloque **les scénarios suivants et tous les mutateurs DB et API** (fixtures service, appels
   `POST` de l'API tracking émis par le harnais, clics navigateur pilotés) ; fermeture du navigateur ; puis drain et nettoyage ; aucune
   continuation de scénario après le signal. Toute intention non réglée ⇒ `INCOMPLETE`, **exit 3**. Avant le nettoyage, **validation
   distante de la propriété** de chaque identifiant (relecture service : e-mail canonique `qa-<run>-<slug>@qa.invalid` validé par
   expression avant toute recherche, dossiers dont le client/artisan appartient à la cohorte) ; un identifiant non prouvé n'est jamais
   supprimé et rend le nettoyage `INCOMPLETE`.
5. **Pas d'ANOMALY de contournement** : tout écart de l'UI au contrat (y compris sélecteur manquant ou renommé) ⇒ **FAIL** (exit 1),
   sauf élément marqué explicitement « informatif » dans ce contrat (aucun à ce jour). `ANOMALY` est réservé aux constats hors
   assertion (ex. erreur de route Playwright consignée) et ne rend jamais un scénario vert. Les mentions `ANOMALY: selector` et
   `ANOMALY: restart-after-reload` de A1/A4 deviennent **FAIL**.

Libellés UI 22dd419 liés (en plus de A1) : « Partager ma position », « Autoriser et démarrer », « Annuler », « Je suis arrivé »,
« Arrêter le partage », « Reprendre le partage », « Recalculer », « Retirer la destination », « Rechercher une adresse »,
« Confirmer cette destination » ; carte `role="img"`, boutons « Zoomer », « Dézoomer », « Recentrer la carte » ; attribution
« © OpenStreetMap contributors » ; « Position déclarée par le navigateur (non certifiée) » ; « Suivi actif » ; « Aucune position
récente : l'arrivée ne peut pas être estimée. » ; « Position trop imprécise (± N m) : non envoyée. ».

Validé tel quel par ROOT : `T12-sim`, preuve 429 sans rafale. Merge de travail de `codex/gps-eta` autorisé pour les types ; aucune
modification des fichiers backend, 019 ou 020. Nettoyage : lignes tracking avant interventions/profils ; leases relus = 0 après
cascade ; budget jamais modifié. Exécution cloud par ROOT uniquement ; aucune géolocalisation présentée comme GPS physique.

## Livraison du harnais (après GO ROOT sur A5)

- Merge de travail `codex/gps-eta` 8366c05 (commit ad53cc7) : types, adaptateur et migration 019 importés **sans aucune modification**
  des fichiers backend ; aucune acceptation de 8366c05 n'en découle.
- `scripts/qa-tracking/run.mjs` (CLI, préflight A5.1, cycle de vie, signaux, preuve de propriété, nettoyage, codes 0/1/2/3/130),
  `scenarios.mjs` (cohorte, T1–T8, T8-fail, T9–T11, T12-sim, T13–T16, T18, T19, preuves fournisseur optionnelles),
  `lib/` (constants, args, intents, position-redact, requests, provider-proof, preflight, ownership, auth-admin, cleanup, guard),
  `sql-backoff-review.mjs` (PGlite **local** : backoff partagé prouvé sans 429 IGN réel).
- Tests hors ligne : `tests/qa-tracking.test.ts` (12 tests : arguments, intentions durables, redaction des positions, résumé des
  requêtes et séquence de reprise, classification fournisseur, préflight, preuve de propriété, ordre de nettoyage, récupération
  d'intention ⇒ INCOMPLETE, porte d'arrêt, BLOCKED/FAIL, analyse de source) ; `tests/qa-tracking-provider.test.ts` (3 tests : 429
  injecté dans l'adaptateur, défauts et hôte fixe). Le premier fichier est en `@ts-nocheck` car le harnais est du JavaScript ESM non
  typé (même convention que `scripts/qa`) ; il est exécuté par `tsx`.
- Écart signalé : T17 (géocodage) est couvert par la preuve fournisseur optionnelle `provider-geocode`, pas par un scénario T17 séparé.
- Aucune exécution cloud, aucun fichier d'identifiants lu par Claude ; l'exécution réelle est réservée à ROOT.

## Corrections de la revue ROOT de 8aa5a78 (P2-a, P2-b, addendum a/b)

- **P2-a — classification des mutations** (`lib/guard.mjs` `classifyMutation`) : 2xx entièrement lu ⇒ `done` ; 400/401/403/404/409/
  422/429 entièrement lus ⇒ `refused` ; erreur de transport, délai, 5xx, tout autre statut ou réponse non entièrement lue ⇒
  **inconnu** : l'intention reste ouverte avec une relecture (`lib/reconcile.mjs`, preuves monotones uniquement : session observée
  active, seq observée appliquée, session close, `destination_version` avancée, statut d'intervention atteint ; les appels fournisseur
  ne sont prouvés que par la relecture des leases = 0 après cascade). Relecture tentée immédiatement puis après le drain ; sans preuve
  ⇒ INCOMPLETE (exit 3). Les écritures service (cohorte, réaffectation simulée, suspension, grants) ont aussi leur relecture.
- **P2-b — drain** : chaque POST du harnais (`createTrackingApi.post`) et chaque mutation déclenchée par le navigateur
  (`trackBrowserMutations`, interception de route sur `/api/**` de même origine) est enregistrée dans la porte d'arrêt ; une fois la
  porte levée, une mutation navigateur est bloquée **avant émission** (jamais annoncée, jamais envoyée). Chaque scénario en cours et
  chaque ouverture de session sont aussi enregistrés (motif `mutation`/`mutatingClick` repris du harnais métier 4bd9e76, copié, pas
  importé).
- **Addendum (a) — garde de nettoyage propre au lot** (`lib/finalize.mjs`) : si un producteur reste non drainé au début du nettoyage,
  **aucune suppression ni lecture Auth**, manifest et intentions intacts sur disque, exit 3 avec la commande de reprise
  `--cleanup-manifest`. Le cycle de vie partagé `scripts/qa` n'est pas modifié.
- **Addendum (b) — attente puis émission** : `gate.check()` est refait immédiatement avant chaque émission qui suit une attente
  (ouverture de session : après la création de page, avant la pose de la barrière et avant la connexion ; écritures service : avant
  l'annonce, puis dans `mutation()`). Audit : `createTrackingApi.post` n'a aucune attente avant l'émission ; les écritures service
  passent par `guardWrites` (contrôle à chaque appel) ; les clics passent par `act()` et, surtout, par la barrière de route.
- **Constat réel** : Chromium relance **une fois** un POST si une connexion keep-alive réutilisée tombe avant la réponse (observé :
  2 POST reçus par le serveur). Le serveur doit donc tolérer un doublon (c'est le cas : tuple de point identique accepté) ; côté
  harnais, l'issue reste inconnue jusqu'à la relecture.
- **Sélecteurs** revérifiés contre `origin/claude/web-shared-a5` 8bcee45 : `TrackingAnchor` monté dans `#mission/<id>` (artisan, si
  statut accepted/in_progress), `#detail/<id>` (particulier et entreprise) ; titres « Partage de ma position » / « Suivi de l’artisan »
  et libellés inchangés ; « Recalculer » peut porter un suffixe en attente de position (non utilisé comme sélecteur exact).

| Repro exigée par ROOT | Test |
| --- | --- |
| 503 différé ⇒ inconnu + réconciliation | `tests/qa-tracking-barrier.test.ts` « repro 1 » (serveur local réel + Chromium) |
| Commit puis réponse perdue ⇒ inconnu, relecture prouve | « repro 2 » |
| SIGINT avec un POST harnais et une mutation navigateur en attente : barrière, drain, nettoyage strictement après | « repro 3 » (horodatages ordonnés) |
| Drain expiré avec producteur en attente ⇒ zéro suppression, manifest intact, exit 3 | « repro 4 » + unité « guarded cleanup and exit codes » |
| SIGINT pendant l'attente qui précède l'émission ⇒ jamais émis | « repro 5 » |
| Classification 4xx/5xx/non lu et preuves monotones | `tests/qa-tracking.test.ts` « outcome classification and readback proofs », « intents » |

## Corrections de la revue ROOT de 8a8441d (P2-1/P2-c, P2-2/P2-d, P2-3)

- **P2-1 — lectures Auth admin** (`lib/auth-admin.mjs`) : `readUser(id)` valide un schéma exact (id UUID **égal** à l'id demandé,
  e-mail chaîne) ; un 200 non JSON, partiel ou incohérent ⇒ **inconnu** (jamais « absent », jamais « possédé ») ; seul un vrai 404
  prouve l'absence. La propriété exige l'e-mail canonique `qa-<run>-<slug>@qa.invalid` relu dans un corps valide ; sinon l'id n'est
  pas supprimé et le nettoyage est INCOMPLETE (3).
- **P2-2 / P2-d — création perdue** : le manifest est écrit sur disque **avant** toute création ou recherche, et manifest + intentions
  sont écrits de façon atomique (fichier temporaire, fsync, rename, fsync du dossier, 0600 — `lib/durable.mjs` ; la méthode
  d'écriture du manifest est remplacée sur l'instance du harnais, le fichier partagé `scripts/qa/lib/fixtures.mjs` reste intact).
  Recherche par e-mail canonique (validé avant toute recherche) sur **toutes** les pages, exhaustive seulement si la fin est prouvée
  (page plus courte que `per_page` ou total `x-total-count` présent atteint ; un en-tête absent n'est jamais « 0 ») ; toute erreur ou
  page mal formée ⇒ inconnu ; relectures espacées jusqu'à une échéance déclarée. Une absence — même exhaustive après l'échéance
  (« not-found-exhaustive ») — **ne ferme jamais** l'intention : exit 3. Même règle pour les autres écritures service : seule une
  observation positive (ligne vue) prouve ; une absence ne prouve rien.
- **P2-3 — fournisseur indisponible** : tout 503 (quelle que soit la raison), 429, 502/504/408, délai ou transport inconnu ⇒
  `unavailable` ⇒ scénario **BLOCKED** (jamais PASS) pour `provider-route` et `provider-geocode` ; la session de partage est arrêtée
  avant ; un 503 portant des chiffres d'ETA ou un 500 restent FAIL.
- Défaut partagé signalé (non corrigé ici) : `scripts/qa/lib/fixtures.mjs` écrit le manifest avec un `writeFile` non atomique et
  seulement après la première création.

| Défaut ROOT (reproduit sur 8a8441d) | Test (passe après correction) |
| --- | --- |
| P2-1 : 200 non JSON ⇒ id accepté comme possédé | `tests/qa-tracking-auth.test.ts` « P2-c — a 200 with a malformed body… » (dont `"{not json"`) |
| 200 avec id / e-mail incohérent | « P2-c — a 200 with a mismatched id… » |
| P2-2 : création perdue + une seule absence ⇒ intention fermée ; manifest absent | « P2-2 — manifest and intent are durable on disk BEFORE the creation… » (vraies `Fixtures`, dossier temporaire, crash injecté au point de création) |
| Utilisateur apparu à la 2ᵉ relecture ⇒ trouvé et nettoyé | « P2-d — lost create, the user appears on the 2nd re-read… » |
| Utilisateur en page 3 ⇒ trouvé | « P2-d — lost create, the user is on page 3… » (a révélé le défaut « en-tête total absent lu comme 0 ») |
| Page 2 en erreur / mal formée ⇒ inconnu, exit 3 | « P2-d — page 2 errors or is malformed… » |
| Jamais trouvé après l'échéance ⇒ intention gardée, exit 3 | « P2-d — never found after the deadline… » |
| P2-3 : 503 `provider_unavailable` ⇒ PASS 1 / blocked 0 | « P2-3 — provider 503/429/timeout through the REAL runners, runOne and createReport ⇒ BLOCKED » |

## Correction de la revue ROOT de 4b57800 — durabilité des UID récupérés

- `cleanupWithProof` exige un crochet `persist()` durable (écriture atomique `lib/durable.mjs` ; normal : `fixtures.save()`, mode
  `--cleanup-manifest` : réécriture atomique du fichier manifest). Il est appelé après la réconciliation, **immédiatement après chaque
  UID récupéré par e-mail** (avec une entrée `recovered[]`), puis après la preuve de propriété (`cleanup_attempt` : prouvés / non
  prouvés) **avant la première suppression**, et enfin avec le résultat. Le manifest ne retire jamais un id : il enregistre ce qui a
  été supprimé après preuve.
- Défaut supplémentaire trouvé par le test d'interruption : un échec d'écriture du manifest pendant la récupération était avalé par le
  `try/catch` de la recherche et le nettoyage continuait vers les suppressions. Corrigé : seul l'échec de la recherche est capturé ;
  un échec de `persist()` interrompt le nettoyage avant toute suppression.
- Reproduit sur 4b57800 : à la première suppression `{memory:true, disk:false}` et UID toujours absent du disque après le nettoyage.

| Repro ROOT | Test (`tests/qa-tracking-auth.test.ts`) |
| --- | --- |
| Mode normal : UID récupéré présent sur disque à la première suppression, conservé après | « durability — normal mode… » (vraies `Fixtures` + écriture durable, contrôle disque injecté à la 1ʳᵉ suppression) |
| Mode `--cleanup-manifest` : idem | « durability — --cleanup-manifest mode… » (vrai `cleanupOnly`, clients injectés) |
| Interruption entre récupération et suppression ⇒ UID sur disque, intention ouverte ; reprise `--cleanup-manifest` le retrouve et le supprime ; état disque cohérent | « durability — interruption between recovery and DELETE… » |

## Amendement A6 — provenance du déploiement (BUILD_ID Flight)

Défaut confirmé par ROOT dans d3338e9 : `checkBuildId` (`scripts/qa-tracking/lib/preflight.mjs`) cherche la chaîne par simple `includes` (`/_next/static/<id>/` ou `"<id>"`). Elle refuse la forme Flight échappée (`\"b\":\"W1T6udg45nuoEg3XO7IGT\"`) du BUILD_ID public 4c398e8. Le relevé ROOT `/tmp/depannage-public-4c-build-probe.json` est une preuve en lecture seule : identité `source=flight`, un seul candidat, non ambiguë, et `preflightError` émis par ce check. La recherche par sous-chaîne est abandonnée dans les deux modes. Le reste de d3338e9 ne change pas (P2 clos, 33 PASS ROOT).

**Mode REMOTE.** Le pré-vol, avant toute fixture, IntentLog ou écriture, passe par le helper Codex `scripts/qa/lib/deployment-proof.mjs` (contrat 1e5f808, `codex/qa-deployment-proof`), une fois revu :
1. `loadDeploymentProof({receiptPath, expected, nowMs})` charge le reçu ROOT : fichier 0600 hors Git, métadonnées Vercel projet/équipe/déploiement, GitSource 4c.
2. `GET /` est lu une seule fois, sans cookie ni clé.
3. `verifyRemoteDeployment({proof, html, expected, nowMs})` vérifie le reçu et exige un BUILD_ID Flight unique, égal à celui du reçu et à `expected`.

Les huit valeurs `expected` viennent de la configuration ROOT explicite passée au runner (CLI), jamais de la page ni du seul reçu. Tout refus ⇒ BLOCKED avant fixtures, exit non nul, aucune donnée du reçu ni du HTML dans les journaux. La sortie conserve seulement la preuve compacte retournée (`provenance: "root-receipt+served-flight"`).

**Mode LOCAL.** Il garde un contrôle réel par parseur strict, sans sous-chaîne :
- les pushes `self.__next_f` du document sont analysés ;
- les chunks de type 1 sont concaténés, puis la ligne racine `0:` est analysée en JSON, ce qui gère les formes échappées ;
- `b` est lu dans le jeu de caractères BUILD_ID ;
- il faut exactement un identifiant au total (Flight et manifestes `/_next/static/<id>/` confondus), égal à `--build-id`.

Zéro identifiant ⇒ refus « non vérifié ». Plusieurs ⇒ refus « ambigu ». Différent ⇒ refus « autre build ». Le parseur réutilisé est `servedBuildIdentity`, importé en lecture seule (le même que le helper Codex).

**Hors périmètre / interdits.**
- Les fichiers Codex (`scripts/qa/lib/deployment-proof.mjs`, `scripts/qa/tests/deployment-proof.test.mjs`, `docs/QA_DEPLOYMENT_PROVENANCE_CONTRACT.md`) et `scripts/qa/lib/*` ne sont pas modifiés.
- Aucun `.next/BUILD_ID` fabriqué pour les tests. Ceux-ci utilisent des documents HTML Flight synthétiques : forme échappée réelle, zéro, plusieurs ou mauvais identifiant, push invalide.
- Ni cloud, ni cookie, ni clé, ni lecture de reçu réel de ma part.
- Le câblage du code (`scripts/qa-tracking/**` et `tests/qa-tracking*.test.ts` uniquement) attend la revue du helper et le feu vert du coordinateur.

## Amendement A7 — contrat de câblage REMOTE / LOCAL (helper 4a1d148, fixtures 5fa7f82)

Sources lues : `codex/qa-deployment-proof` 4a1d148 (`scripts/qa/lib/deployment-proof.mjs`), parseur Business `scripts/qa-business/lib/preflight.mjs` (avec la correction propriétaire 38702cf), fixtures `claude/web-pwa-qa` 5fa7f82. Ces trois fichiers sont importés en lecture seule. Ils ne sont ni copiés, ni modifiés, ni bouchonnés dans les tests.

**Appels exacts (REMOTE).**
1. `proof = await loadDeploymentProof({ receiptPath, expected, nowMs: Date.now() })` : reçu ROOT absolu, hors Git, 0600, propriétaire courant, ≤ 16 KiB, schéma exact, âge ≤ 15 min.
2. Le runner fait un seul `GET <origin>/` : `redirect: "manual"`, sans cookie, en-tête d'auth ni clé, avec timeout `--timeout-ms`. Il exige un statut 200 et lit le corps de façon bornée (au-delà de 8 MiB ⇒ refus `HTML`).
3. `served = verifyRemoteDeployment({ proof, html, expected, nowMs: Date.now() })`. Cet appel revalide le reçu et l'horloge, refuse tout push Flight invalide, et exige `source="flight"`, un candidat unique et un id égal à `proof.servedBuildId` et à `expected.servedBuildId`.

Le contexte du run ne garde que la preuve compacte gelée `{mode:"remote", origin, sha, deploymentId, servedBuildId, capturedAt, provenance:"root-receipt+served-flight"}`. Ni le chemin du reçu, ni son contenu, ni le HTML n'y figurent.

**Drapeaux CLI.** `--mode remote|local` est obligatoire pour un vrai run ; il ne l'est pas pour `--dry-run` ni `--cleanup-manifest`.

En REMOTE, les huit valeurs `expected` viennent toutes de la ligne de commande ROOT, jamais de la page ni du reçu :

| Champ `expected` | Source CLI |
| --- | --- |
| `origin` | `--base-url`, déjà réduit à une origine exacte |
| `sha` | `--sha` |
| `servedBuildId` | `--build-id` |
| `projectId` | `--vercel-project-id` |
| `teamId` | `--vercel-team-id` |
| `deploymentId` | `--vercel-deployment-id` |
| `repoId` | `--git-repo-id` (entier décimal positif sûr) |
| `ref` | `--git-ref` |

`--deployment-receipt <chemin absolu>` est également requis. Le parseur d'arguments ne contrôle que la présence et la syntaxe ; les formats fins restent au helper (code `EXPECTED`).

En LOCAL, tout drapeau REMOTE est refusé, l'hôte de `--base-url` doit être loopback (`localhost`, `127.0.0.1`, `[::1]`), et `--build-id` reste requis.

**Placement.** La preuve de build est le premier contrôle réseau du runner. Elle passe après les contrôles locaux en lecture seule déjà présents (arguments, liste blanche, `verifySha`, `--out` hors dépôt) et avant `checkAnonymous`, `checkTrackingTable`, la création de `--out` et du tee, `IntentLog`, `Fixtures` et toute requête service. Un refus n'écrit donc rien et ne crée aucune fixture.

**Correspondance des issues.**
- Refus du helper (`error.code` ∈ `EXPECTED`/`CLOCK`/`SCHEMA`/`STATE`/`IDENTITY`/`MISMATCH`/`DATE`/`EXPIRED`/`PATH`/`IN_GIT`/`GIT_CHECK`/`FILE_TYPE`/`OWNER`/`MODE`/`SIZE`/`CHANGED`/`JSON`/`FILE_READ`/`HTML`/`FLIGHT_INVALID`/`SERVED_BUILD`), statut ≠ 200, corps trop grand, timeout ou erreur de transport : tous donnent `PreflightError`.
- La sortie standard d'erreur reçoit une ligne `refused: BLOCKED deployment provenance <CODE>`. Le code est fixe ; elle ne contient ni valeur reçue, ni extrait HTML, ni chemin. Code de sortie : 2.
- Toute autre exception du helper est réduite à `FILE_READ`/`UNKNOWN`, sans message d'origine.
- En LOCAL, mêmes règles avec les codes `LOCAL_NONE` (aucun id), `LOCAL_AMBIGUOUS` (plusieurs) et `LOCAL_MISMATCH` (≠ `--build-id`), plus `FLIGHT_INVALID` si un push est mal formé.

**LOCAL strict.** Le contrôle s'appuie sur `servedBuildIdentity(html)` et `flightPushes(html).invalid === 0`, importés du parseur Business. Il exige exactement un candidat, toutes sources confondues, égal à `--build-id`. La source `flight` ou `static` est acceptée seulement si elle est unique et non ambiguë. Aucune recherche par sous-chaîne. Aucun `.next/BUILD_ID` n'est écrit, ni par le code ni par les tests. `checkBuildId` d3338e9 est remplacé.

**Fixtures 5fa7f82.** Le constructeur n'écrit plus. `init()` est paresseux, idempotent et passe par la `save` de l'INSTANCE ; `creating()` exécute check → `await init()` → check → mutation. `makeManifestDurable` continue de remplacer `fixtures.save` sur l'instance et d'écrire le manifeste vide immédiatement. Le premier `init()` appelle donc cette version atomique (comportement couvert par le test « REAL tracking makeManifestDurable honoured » de 5fa7f82). `TrackingFixtures` et `cleanupWithProof` ne changent pas. Un test côté tracking reprend ce point avec les vraies `Fixtures` intégrées.

**Acquisition.** Le code arrive par un merge de travail contrôlé de `origin/integration/web-pwa` (≥ 54f877c, helper et fixtures acceptés), sans rebase ni force. Le diff de la branche contre l'intégration doit ensuite se limiter à `scripts/qa-tracking/**`, `tests/qa-tracking*.test.ts` et ce document.

**Plan de tests (hors ligne, sans cloud).**
- Un HTML Flight synthétique avec la forme échappée réelle passe en LOCAL ; avec zéro id, deux ids, un mauvais id, un push invalide ou une ancienne forme sous-chaîne seule, il est refusé.
- REMOTE avec reçu temporaire 0600 hors Git et horloge injectée : nominal ; reçu expiré (> 15 min) ⇒ `EXPIRED` ; chaque champ `expected` divergent ⇒ `MISMATCH` ; HTML d'un autre build ⇒ `SERVED_BUILD` ; statut 3xx/500 ⇒ refus ; aucune écriture dans `--out` ni requête service avant le refus (transports injectés et comptés).
- Le message de refus ne contient ni le contenu du reçu, ni le HTML, ni le chemin.
- Arguments : `--mode` manquant, drapeaux REMOTE en LOCAL, LOCAL hors loopback, `--git-repo-id` non entier.
- Le vrai HTML public 4c est lu via `QA_TRACKING_REAL_HTML` (défaut `/tmp/depannage-public-4c-home-private.html`, lecture seule, jamais commité). Le LOCAL strict doit y trouver exactement `W1T6udg45nuoEg3XO7IGT` et l'ancien contrôle par sous-chaîne doit échouer dessus ; test SKIPPED si le fichier est absent.
- Ensuite : suite complète, `tsc --noEmit`, `node --check`, `--dry-run`.

## Amendement A8 — diagnostics bornés à l'échec, sélecteur T8, pistes T6/T14 (run ROOT 4e8bc1a68a89)

Contexte : run ROOT 4e8bc1a68a89 — T6, T8, T8-fail et T9 en FAIL ; T14 en ANOMALY (timeout du sélecteur de partage après 194 s) ; T15 en PASS. Base lue : la source 4c intégrée sur cette branche (`components/features/tracking/*`, `components/role/tracking-anchor.tsx`). Ce document précède le code ; aucun code avant lecture ROOT.

### 1. Diagnostics bornés au premier échec

**Quand.** Au premier échec de chaque scénario, qu'il s'agisse d'une assertion, d'`AppDefect`, d'un BLOCKED ou d'une ANOMALY. Les scénarios s'arrêtent au premier échec, donc il y a au plus une capture par scénario. La capture se fait dans `runOne`, AVANT le classement et avant toute fermeture de session ou de page. Les pages concernées sont celles que le scénario a ouvertes ou utilisées : le pool trace, par scénario, les libellés obtenus via `session` et `freshSession`.

**Sous la même identité, sans rien changer.** La capture ne fait pas de nouvelle connexion, pas de `reload`, pas de `goto`, ni de clic ou de saisie. Elle n'appelle aucune API. Ce sont des lectures seules du DOM et de l'état déjà présents. Si la porte d'arrêt est levée, la capture est sautée et notée `skipped: stopping` ; elle n'enregistre aucune mutation dans le drain.

**Contenu, par page, dans `--out/diagnostics/<scénario>/`** (dossier 0700, fichiers 0600, passés par le redacteur du run complété du masquage des positions) :
- `<libellé>.png` : capture de la fenêtre, viewport seulement, chmod 0600 après écriture ;
- `<libellé>.json`, qui contient :
  - le chemin et le hash de l'URL, sans query ;
  - toutes les valeurs `[data-blocker]` présentes, avec le texte visible de chaque bloc `.unavailable` (au plus 20 entrées de 200 caractères) ;
  - le texte visible du panneau artisan (section titrée « Partage de ma position ») et de la carte client (« Suivi de l’artisan »), ou `absent` pour chacun, plafonné à 4 000 caractères ;
  - les titres h1 à h3 visibles (au plus 20 de 120 caractères) et le nombre d'éléments `role="status"` et `role="alert"` avec leur texte (même plafond), ce qui sert à décider si l'espace de travail affiche le dossier ;
  - un résumé des requêtes de suivi vues par la page (`/api/interventions/<id>/tracking|route|geocode` et la sonde de capacité) : méthode, chemin avec identifiants, statut, horodatage ISO, `action` pour un POST et origine `ui` ou `harness`. Il ne contient ni en-têtes, ni jetons, ni corps de requête ou de réponse. Seule exception : le champ serveur `reason`, s'il est une chaîne au format `^[a-z_]{1,64}$`, lu sur les réponses de statut ≥ 400. Ce résumé couvre au plus les 50 dernières requêtes.

Ce recueil s'appuie sur un enregistreur par page posé dès la création de la page par le pool. L'enregistreur actuel des scénarios n'est pas modifié.

**Bornes.**
- Au plus 3 pages par scénario.
- 5 s par opération Playwright.
- 20 s au total par scénario, au-delà la capture est tronquée et notée `truncated: time_cap`.
- Aucune nouvelle tentative.

Une erreur de diagnostic est notée `diagnostics_error: <code fixe>` et ne remonte pas. Les diagnostics ne changent jamais le verdict, le code de sortie ni le nettoyage. Le rapport référence seulement les fichiers.

**Propriété.** Le code ira dans `scripts/qa-tracking/lib/diagnostics.mjs`, dans le pool de `scenarios.mjs` et dans `runOne` (`run.mjs`). Rien dans `scripts/qa`. Le même mécanisme pourrait plus tard servir aux autres harnais via `scripts/qa/lib`, mais ce serait une proposition au propriétaire, pas une modification.

### 2. Sélecteur T8 et T8-fail (diagnostic lead, confirmé par la source)

Dans `artisan-tracking-panel.tsx` (branche `stale`, l. 146-149), la phrase « Partage interrompu par le rechargement de la page. » est rendue dans un `<p role="status">` plus long, qui continue par « L’arrêt côté service est tenté ; … après 60 s. ». `getByText(UI.reloadInterrupted, { exact: true })` ne peut donc jamais correspondre. Deux lignes sont touchées dans `scenarios.mjs` : 408 (T8) et 438 (T8-fail).

Remplacement, aussi strict : `panel(page).getByRole("status").filter({ hasText: UI.reloadInterrupted })`. Le locator est limité au panneau artisan et au rôle `status`. Il doit correspondre à exactement un élément, et le mode strict de Playwright refuse plusieurs correspondances. Le bouton `panel(page).getByRole("button", { name: UI.resume, exact: true })` doit aussi être visible. La lecture de l'état serveur (`shared=true`) reste inchangée.

Revue des autres contrôles « texte exact » contre la source 4c :

| Ligne | Texte | Source | Verdict |
| --- | --- | --- | --- |
| 191 | `declaredSource` | `<dd>` seul (panneau) | correct |
| 215 | `permissionRefused` | `<p role="alert">` avec le message seul, `retryable: false` (`model.ts` l. 434) | correct ; il deviendrait faux si `retryable` changeait, la même forme `getByRole("alert").filter({ hasText })` est donc proposée par cohérence |
| 479 | `activeTracking` | `<Tag>` seul | correct |
| 738 | `osmAttribution` | `<a>` seul | correct |

Seules les lignes 408 et 438 sont en défaut. **T14 n'emploie aucun texte exact** : son échec a une autre cause (§4).

### 3. T6 : comment les diagnostics décideront (aucun changement d'assertion ni correctif avant les preuves DOM)

Piste du relecteur UI ROOT, non confirmée : la session client est ouverte pendant `setupCohort` (l. 109), avant la création des dossiers (l. 125). Ensuite, un `goto` qui ne change que le hash ne force pas l'espace de travail React à se rafraîchir, donc la liste du client peut ne pas contenir le nouveau dossier. T9 réutilise la même session client et la même route ; il est concerné par la même décision.

| Observation au point d'échec (page client, même identité) | Conclusion |
| --- | --- |
| Carte « Suivi de l’artisan » `absent` ; aucun `data-blocker` de suivi ; titres et texte sans le dossier (ou état « introuvable ») ; aucune requête `GET …/tracking` de la page pour ce dossier | L'espace de travail ne contient pas le dossier (ordre du harnais ou défaut de rafraîchissement de l'app). L'attribution sera décidée par ROOT et le lead UI au vu des requêtes de liste vues. |
| Carte présente avec `data-blocker="capability:tracking"` et le texte « Disponibilité du service en cours de vérification. » | Capacité restée `unknown` (hypothèse lead : sonde sans effet sur un bundle reconstruit). Le résumé dira si la sonde a été émise et avec quel statut. |
| Bloc `data-blocker="tracking:unavailable"` (`FeatureUnavailable`), avec le statut et la `reason` de la sonde | Capacité `unavailable` |
| Carte présente et disponible, sans « Position périmée … » | Écart d'affichage ou d'état, comparé à la preuve d'instantané déjà notée (`evidence T6`) |

### 4. T14 : piste à confirmer par les mêmes diagnostics (pas de correctif avant)

La source et l'ordre des scénarios donnent une explication cohérente avec la durée observée :
1. T9 démarre un partage sur `main` via la session API et ne l'arrête pas.
2. Le panneau de T14 sur `main` affiche alors la branche `needsExplicitRestart` (partage actif sans contrôleur local), donc « Reprendre le partage » et non « Partager ma position ».
3. Le clic de partage attend jusqu'au timeout (90 s par défaut).
4. Le repli arrête le partage par API puis rappelle `uiStart`. Mais le `goto` vers la même URL à hash ne relit pas l'instantané du panneau, ce qui provoque un second timeout. Deux attentes de 90 s plus le reste donnent environ 194 s.

Les diagnostics (texte du panneau, boutons visibles via les titres et le texte, requêtes `GET`) confirmeront ou infirmeront cette lecture. Le correctif éventuel est un remplacement du repli par un état préalable propre : arrêt API AVANT l'ouverture du panneau, ou session fraîche. Il viendra dans un amendement ultérieur, avec preuve et sans relâcher l'assertion.

### Tests prévus (hors ligne)

- Le diagnostic, testé dans un vrai Chromium avec un serveur local, ne fait ni `goto`, ni `reload`, ni requête réseau.
- Les fichiers sont en 0600 et le dossier en 0700.
- Aucune query dans l'URL notée, aucun en-tête, aucun jeton ni corps hors `reason`.
- Les positions sont masquées.
- Les plafonds de 3 pages, 20 s et des tailles de texte sont respectés.
- Le verdict n'est pas modifié quand le diagnostic échoue.
- Le diagnostic est sauté une fois la porte d'arrêt levée.
- Le sélecteur T8 correspond au markup réel du panneau (rendu statique de la branche `stale`) et refuse l'ancienne forme exacte.

### 5. Compléments A8 après le résultat final ROOT de 4e8bc1a68a89

Résultat final ROOT (exit 1) : 22 scénarios, 14 PASS, 7 FAIL, 1 ANOMALY. Nettoyage : 29 PASS ; drain 0, intentions ouvertes 0, ids non prouvés 0.

| Scénario | Verdict | Cause relevée par ROOT |
| --- | --- | --- |
| T6, T8, T8-fail, T9 | FAIL | voir §2 et §3 |
| T16 | FAIL | bouton « Retirer la destination » absent |
| provider-route, provider-geocode | FAIL | 401 |
| T14 | ANOMALY | clic de partage |
| T19 | PASS | carte client avec session fraîche et changement d'identité |

Le §1 (diagnostics) et l'audit des sélecteurs du §2 sont inchangés : seules les lignes 408 et 438 posent un défaut de texte exact ; T14 n'en a pas (§4).

**c) T6, T9 et T16 : une seule décision.** La piste ROOT est un espace de travail client périmé. T6, T9 et T16 utilisent la session `client` du pool, ouverte au l. 109 avant le seed. T19, qui a une session client fraîche, passe. Les diagnostics du §1 trancheront selon le tableau du §3 :
- carte ou dossier absents de l'espace, sans requête `GET …/tracking` pour le dossier ⇒ espace périmé ;
- `data-blocker="capability:tracking"` avec le texte « en cours de vérification » ⇒ capacité `unknown` ;
- `tracking:unavailable` ⇒ capacité `unavailable`.

Pour T16, il faudra en plus le texte du panneau destination : boutons visibles et `permissions.can_confirm_destination` déjà lisible dans l'instantané.

Deux correctifs du harnais seront évalués APRÈS la preuve DOM seulement, sans modifier aucune assertion :
- ouvrir la session client APRÈS le seed (le 404 de préflight sur UUID inconnu reste exécuté juste après la création du premier compte, avec une session dédiée fermée ensuite) ;
- ou forcer le rafraîchissement de l'espace de travail par le chemin de rafraîchissement propre à l'app, s'il existe et une fois identifié dans la source.

Jamais par une nouvelle connexion, qui masquerait la cause. Si la preuve montre un défaut de rafraîchissement de l'app, le FAIL reste et il est signalé au lead.

**d) Isolation des déconnexions.** Constat source, pour mémoire et sans proposition de changement : la déconnexion de l'app appelle `createClient().auth.signOut()` sans `scope` (`components/courant-app.tsx` l. 576). La portée par défaut de supabase-js est globale, ce qui révoque toutes les sessions de l'utilisateur. T19 déconnecte `users.client` (session `switch`). Les scénarios fournisseur réutilisent ensuite `ctx.session("client")`, ce qui est cohérent avec leur 401. Les deux FAIL fournisseur restent des FAIL pour ce run ; aucune requalification en PASS.

Règles à coder :
- Un scénario qui se déconnecte utilise une identité dédiée, créée pour lui et non partagée, ou passe en dernier, après les scénarios fournisseur.
- Après une déconnexion, toute session du pool appartenant au même utilisateur est marquée révoquée. Une réutilisation ultérieure est refusée : BLOCKED « session révoquée par une déconnexion globale », jamais une reconnexion silencieuse.

Décision ROOT : la déconnexion globale actuelle du produit est conservée pour cette tranche, et l'authentification n'est pas modifiée pour la QA. C'est l'ordre et l'isolation du harnais qui s'adaptent. Ce correctif d'ordre QA ne demande aucune question au propriétaire.

**e) Format des 404 Auth admin (postflight ROOT).** Le harnais actuel (`auth-admin.mjs` l. 85, `readUser`) considère TOUT statut 404 comme `absent`, quel que soit le corps. Ce comportement est trop large et sera corrigé. Seul le corps historique, réellement observé par ROOT, sera accepté comme `absent` sur un `GET /auth/v1/admin/users/<id>` en statut HTTP 404 : objet JSON exact `{code: 404, error_code: "user_not_found", msg: <chaîne non vide>}`, sans aucune autre clé. Aucune autre forme n'est déclarée « actuelle » : elle ne serait ajoutée qu'avec une preuve officielle ou de transport, par un amendement séparé.

Tout autre cas reste `unknown` et n'est jamais `absent` : 404 avec un autre corps ou sans corps, JSON invalide, clés en plus ou en moins, autre `error_code`.

Ces règles ne changent rien d'autre : l'absence ne ferme toujours aucune intention (P2-2/P2-d), et la recherche paginée par e-mail garde sa preuve de fin. Le `UNKNOWN` d'origine du run 4e8bc1a68a89 reste tel quel. Tests prévus : le corps historique exact est `absent`. Sont `unknown` : un 404 nu, un 404 HTML, un 404 avec un champ en plus, un 404 avec un autre `error_code`, un `msg` vide, la forme `{code: "user_not_found", message}`, et un statut 200 ou 500 portant le corps historique.

### 6. Ordre T19 / déconnexion (GO ROOT sur 7502e28, avant le code)

Choix retenu : **T19 passe après toutes les preuves fournisseur**. Le runner exécute dans cet ordre :
1. les scénarios de suivi sélectionnés, sauf T19 ;
2. les preuves fournisseur (`--provider-proof`) ;
3. T19 en dernier, s'il est sélectionné.

Ainsi, aucun scénario ultérieur ne peut réutiliser une session de `users.client` révoquée par la déconnexion globale de T19.

En défense supplémentaire, toute déconnexion faite par un scénario marque comme révoquées toutes les sessions du pool appartenant au même utilisateur. Un `session()` ultérieur pour cet utilisateur échoue en BLOCKED (« session révoquée par une déconnexion globale »), sans reconnexion silencieuse.

Le comportement d'authentification du produit (déconnexion globale) est inchangé. Précision ROOT (§5 e) : seule la forme historique exacte prouve l'absence, et ce resserrement entre dans ce lot de code.

### 7. Run ciblé (diagnostic T6 sous la même identité)

`--only` existe déjà : `--only T6` (ou `--only T6,T9,T16`) exécute le seed complet de `setupCohort`, puis seulement les scénarios demandés, dans l'ordre du §6. La session `client` est donc ouverte avant le seed, exactement comme dans le run 4e8bc1a68a89 : la condition suspectée est reproduite, pas masquée. Les diagnostics du §1 sont toujours actifs, sans option. Le `--dry-run` affiche `order` et `diagnostics`.

Exemple ROOT : `node scripts/qa-tracking/run.mjs --mode remote … --only T6`. Sans `--provider-proof`, aucun appel fournisseur n'est fait.

### 8. Corrections de la revue ROOT de 18039eb (diagnostics, avant code)

**a) `reason` en ensemble fermé.** Une `reason` de forme snake_case n'est plus acceptée telle quelle : seules les raisons connues du suivi sont conservées.
- `ROUTE_REASONS` : `position_unavailable`, `destination_required`, `provider_quota`, `provider_timeout`, `provider_unavailable`, `route_unavailable`, `invalid_provider_response`, `server_configuration`. Ce sont les raisons 503 de `lib/features/tracking/http.ts` et `provider.ts`, reprises par le modèle UI.
- `tracking_changed` (409).
- `application_quota` (429).

Toute autre valeur, y compris une chaîne snake_case valide inconnue (par exemple `private_token_from_upstream`), est enregistrée comme la constante `"other"`. Un corps illisible ou sans `reason` donne `null`. Jamais un texte venant de l'amont. Test de reproduction : une raison snake_case inconnue n'est pas persistée.

**b) Arrêt pendant la capture.** La porte d'arrêt est revérifiée avant chaque opération de capture (capture d'écran, lecture DOM, écriture) et après chaque `await`, avant l'opération suivante. Dès qu'elle est levée, plus aucune opération n'est lancée. La capture en cours est notée `truncated: "stopping"` et les pages restantes ne sont pas visitées. Le fichier JSON de la page en cours est écrit seulement s'il reste dans les bornes, avec ce qui a déjà été lu : c'est une écriture locale, pas une opération de page. Le verdict reste inchangé. Test de reproduction : un arrêt pendant la capture d'écran ⇒ aucun `evaluate` lancé, capture `truncated`, verdict du scénario inchangé.

## Amendement A9 — sessions ouvertes après le seed (attribution T6 confirmée par ROOT)

**Constat ROOT** (rapport `/tmp/depannage-tracking-t6-confirmed-attribution.md`, lu par ROOT, non versionné). Dans T6, l'identité client QA et le hash `#detail/<id>` sont bons, mais le dossier est ABSENT de l'espace de travail React du client. L'état vide « Intervention introuvable » (`client-space.tsx` vers l. 903) s'affiche avant `TrackingAnchor`.

Cause côté harnais : la session `client` est ouverte dans `setupCohort` (l. 110, préflight 404) AVANT le seed (création des dossiers vers l. 129). Le gestionnaire de hash de l'app (vers l. 464) ne recharge pas l'espace de travail. La même session est réutilisée par T6 et par T9/T16 (§5 c).

**Contrat QA (code seulement après GO ROOT).**
1. **Préflight dans un contexte dédié.** Le 404 authentifié sur UUID inconnu s'exécute dans une session de pool dédiée, `preflight-client` : un nouveau contexte navigateur via `newPage`, avec le compte client déjà annoncé par son intention durable. Elle est fermée (`closeSession`) juste après le 404, avant toute autre création. Le libellé `client` n'est plus ouvert pendant `setupCohort`.
2. **Toutes les sessions de scénario s'ouvrent après le seed complet.** C'est la précondition normale : le client a déjà l'intervention quand il ouvre l'app. `setupCohort` n'ouvre aucune session après le préflight. Les `ctx.session(...)` et `ctx.freshSession(...)` des scénarios s'exécutent tous après la fin de `setupCohort`. Un test vérifiera l'ordre : aucune ouverture de session entre le premier `createIntervention` et la fin du setup, et la session du préflight est fermée avant le premier compte suivant.
3. **Assertions inchangées.** Celles de T6 restent telles quelles, comme celles de T9, T14 et T16. Au point d'échec : pas de reconnexion, pas de rechargement, rien qui masque un échec. Les diagnostics du §1/§8 restent actifs. Si T6 échoue encore avec une session ouverte après le seed, c'est un FAIL réel, diagnostiqué tel quel.
4. **Le cas session périmée n'est pas abandonné en silence.** Une session ouverte avant la création d'un dossier ne voit pas ce dossier sans rechargement : c'est un constat PRODUIT distinct, **LIVE-WORKSPACE-001**, qui appartient au lead. Il est consigné ici et dans le rapport du run comme « hors périmètre QA, non clos par ce correctif ». Le correctif QA aligne la précondition du test, il ne déclare pas le comportement produit conforme. Aucun scénario ne le transforme en PASS.

**Hors périmètre.** Aucun changement à `client-space.tsx`, à l'app, à `scripts/qa` ou à l'authentification. L'ordre du §6 (fournisseurs puis T19) et la révocation des sessions sont conservés. `--only T6` reste le run ciblé (§7).
