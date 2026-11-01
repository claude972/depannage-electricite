# REALTIME-DIAGNOSTIC — contrat de diagnostic borné (proposition, aucun code)

Base `58b76414` ; branche `claude/web-remaining-contracts`. **Docs seulement** : aucune modification d’app/API/SQL, aucun cloud, aucun identifiant lu par l’auteur. Revue root avant tout code ou toute exécution.

## 1. Faits (source et root)
- **Client navigateur** : `lib/supabase/client.ts` → `@supabase/ssr` `createBrowserClient(url, publishableKey)` (singleton) ; supabase-js / realtime-js **2.118.0** (local).
- **Abonnement** : `components/courant-app.tsx` ~515–529 — **un** canal `workspace-<profileId>`, **quatre** bindings `postgres_changes` `{event:"*", schema:"public", table}` pour `interventions`, `quotes`, `messages`, `payments` ; tout événement ⇒ `refresh()` différé 350 ms ; `connection` = chaîne de statut renvoyée par `subscribe`. Aucun gestionnaire `system`, pas de `postgres_changes_options`.
- **realtime-js 2.118 `RealtimeChannel.subscribe`** (`dist/main/RealtimeChannel.js` ~141–209) : à la réponse `ok` du join, si le serveur ne renvoie pas `postgres_changes` ⇒ `SUBSCRIBED` immédiat ; sinon `_updatePostgresBindings` compare **position par position** chaque binding client au binding serveur (`event`, `schema`, `table`, `filter`) ; au premier écart ⇒ `unsubscribe()`, état `errored`, statut **`CHANNEL_ERROR`** avec l’erreur « mismatch between server and client bindings for postgres changes ». Option `postgres_changes_options.wait` : le join attend le résultat serveur.
- **Root (lecture seule, 2026-10-31 21:14 UTC)** : publication `supabase_realtime` = exactement `interventions`, `messages`, `quotes` ; **`payments` absent** ; `has_function_privilege('authenticated', 'public.can_access_intervention(uuid)', 'execute')` = vrai.
- **Lead (`docs/CLAUDE_LIVE_WORKSPACE_001.md`)** : une session ouverte avant une création externe ne reçoit pas le dossier alors que le badge affiche « En direct » (`SUBSCRIBED`).

## 2. Hypothèses à départager (aucune n’est une cause établie)
- **H1 — rejet / non-correspondance des bindings** à cause de `payments` non publié : (a) le serveur renvoie une liste de bindings différente ⇒ le client passe en `CHANNEL_ERROR` (« mismatch… ») — incompatible avec un badge resté `SUBSCRIBED`, donc à constater ; (b) le serveur renvoie un `ok` puis signale l’échec **asynchronement** par un message `system` de statut `error`, ignoré par l’app ⇒ `SUBSCRIBED` trompeur, aucun événement.
- **H2 — rôle du socket** : join évalué en `anon` (jeton utilisateur non attaché) ⇒ `SUBSCRIBED`, toutes les lignes filtrées par RLS.
- **H3 — évaluation RLS côté Realtime** de `can_access_intervention` en erreur pour cet abonné.
- Le diagnostic doit **distinguer** H1a/H1b/H2/H3 ; il ne corrige rien.

## 3. Diagnostic root proposé (borné, une seule session)
- **Cohorte** : **un** compte client QA (`qa-rt-<run>-client@qa.invalid`, confirmé, aucun admin), identifiant durable écrit dans un manifeste 0600 **avant** toute authentification ; nettoyage **B1** existant (découverte de cohorte d’abord, aucune suppression sur lecture inconnue, relecture 404/0). Aucun nouveau run d’expiration.
- **Un INSERT par mesure** (revue root P2-1) : un canal rejoint après un événement ne peut pas le recevoir ; chaque mesure (canal de l’app puis chaque canal témoin, **séquentiellement**) suit donc : join → attente du statut final du join (`SUBSCRIBED` confirmé, ou `CHANNEL_ERROR`/`TIMED_OUT` constaté) → **intention** d’insertion écrite au manifeste (id UUID généré côté harnais, réécriture atomique 0600) → **un** INSERT d’un dossier QA (`id` = cet UUID, `client_id` = le compte QA, insert unique) → fenêtre de réception bornée (10 s) → fermeture du canal. Chaque id inséré est couvert par le nettoyage B1 (dossiers de la cohorte par `client_id` et par id manifesté). Si le join n’est pas confirmé, **aucun** INSERT n’est fait pour cette mesure (résultat « join non confirmé »).
- **Sonde passive dans une page QA** (outil de recette, pas l’app de production) reproduisant **à l’identique** le canal de l’app (même nom, mêmes 4 bindings, même ordre), puis **séparément** des canaux témoins : (i) les 3 tables publiées seules ; (ii) `interventions` seul ; (iii) le canal à 4 bindings avec `postgres_changes_options: { wait: true }`. Un canal par mesure, fermé après mesure.
- **Collecte autorisée — scalaires et booléens uniquement** :
  - statut(s) de `subscribe` dans l’ordre (`SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`) avec horodatage relatif (ms) ;
  - `join_reply_has_postgres_changes` (booléen), `server_bindings_count` (entier), et pour chaque position : `table` et `event` renvoyés par le serveur (identifiants de table publics), `binding_match` (booléen) ;
  - messages `system` : `status` et `message` **filtrés par liste blanche** (« Unable to subscribe to changes with given parameters », « mismatch between server and client bindings for postgres changes », « Subscribed to PostgreSQL », « RLS », « timeout ») — tout autre texte remplacé par `other` ;
  - **jeton effectivement transmis au join** (revue root P2-2) : un claim de session local ne prouve pas que le jeton a été envoyé. Le harnais calcule **en mémoire, au moment du join et pour ce canal/cette époque de join**, une projection **volatile** du jeton réellement utilisé par le socket pour ce join (le `access_token` porté par le message de join du canal, intercepté localement par la sonde) : `join_token_present`, `join_token_role_is_authenticated`, `join_token_sub_matches_expected` (booléens), liés au nom de canal et au numéro d’époque. Le jeton et ses claims ne sont jamais écrits ni journalisés ; seuls ces trois booléens sont persistés. Un jeton absent ou inconnu au join ⇒ mesure « rôle non prouvé ». **Le rôle côté socket est prouvé séparément** de la réception d’événement ;
  - `event_received_within_10s` (booléen) pour **l’INSERT propre à cette mesure** (id manifesté de la mesure ; un événement pour un autre id ne compte pas), par canal — **l’efficacité d’événement est prouvée séparément** du statut de join.
- **Interdits de persistance** : JWT, refresh token, claims bruts, payloads d’événements, trames WebSocket, en-têtes, cookies, clés, contenu des lignes. Seuls les scalaires ci-dessus sont écrits (rapport 0600 caviardé).
- **Lecture de verdict** : chaque mesure dont le join est **confirmé** exige l’INSERT propre à la mesure ; une mesure dont le join est **refusé** (`CHANNEL_ERROR`, y compris « mismatch… », ou `TIMED_OUT`) reçoit le verdict de mesure **« join refusé »** **sans INSERT** (la mutation est sautée), puis les autres témoins sont exécutés normalement :

| Constat | Conclusion |
|---|---|
| Canal à 4 : « join refusé » (`CHANNEL_ERROR` « mismatch… », aucun INSERT) ; canal (i) : join confirmé, INSERT propre, événement reçu | **H1a** |
| Canal à 4 : `SUBSCRIBED`, aucun événement, message `system` d’erreur en liste blanche (« Unable to subscribe… ») ; canal (i) ou (ii) : événement reçu | **H1b** |
| Capture du jeton du join **démontrée** pour cette mesure et `join_token_present = false` ou `join_token_role_is_authenticated = false` | **H2 observé pour cette mesure** (pas une causalité système générale) |
| Jeton du join prouvé (`present`, `authenticated`, `sub` attendu), bindings conformes, **et** preuve **positive dédiée et bornée** d’un rejet RLS pour cette mesure/identité (protocole distinct si nécessaire ; jamais de lecture globale de journaux contenant des données d’utilisateurs) (message `system`/erreur en liste blanche contenant « RLS » ou équivalent) | **H3** |
| Jeton du join prouvé, bindings conformes, aucun message d’erreur, **aucun événement** même sur (ii) | **INCONNU / H3 possible** (revue root P2-3 : l’absence d’événement seule ne prouve pas H3) |
| Join non confirmé, rôle non prouvé, ou toute autre combinaison | **non concluant**, aucune cause affirmée |

### 3 bis. Précisions issues du rapport root `REALTIME_CONTRACT_2F9_REVIEW.md`
- **Création du compte — fichiers existants réutilisés, non recréés** (contre-revue root) : l’e-mail canonique et le run sont inscrits dans une **intention durable avant `createAuthUser`** (pas seulement avant le login) via le journal d’intentions B1 existant `scripts/qa-tracking/lib/intents.mjs` (+ `durable.mjs`, écriture atomique 0600) ; la création passe par `scripts/qa-tracking/lib/auth-admin.mjs` ; le nettoyage passe par `scripts/qa-tracking/lib/cleanup-proof.mjs` `cleanupWithProof` (B1, `478a2da` sur `claude/web-qa-tracking`), avec `ownership.mjs` pour la preuve distante et la reprise à froid du journal. Réponse Auth perdue ⇒ récupération exacte par e-mail (`auth-admin.mjs`), **UID persisté au manifeste avant toute suppression** ; « non trouvé exhaustif » ne prouve pas la non-création (l’intention reste ouverte) ; absence/erreur de lecture reste **inconnue** ⇒ nettoyage incomplet, code de sortie 3. Propriétaire de ces fichiers : le worker Claude QA tracking (lecture/import seulement par la sonde) ; la sonde n’en modifie aucun.
- **Chaque INSERT** : après émission, relecture `count = 1` et propriété (`client_id` = compte QA) avant l’attente de 10 s ; l’événement est corrélé **en mémoire** à l’id exact de la mesure, seul le booléen est persisté ; canal fermé et drainé en `finally` avant la mesure suivante ; délai de join ou issue d’INSERT inconnue ⇒ **non concluant**, jamais une preuve de perte d’événement. Les quatre ids figurent au manifeste et au nettoyage.
- **Jeton du join et époques d’authentification** (contre-revue root P2-2) : le SDK 2.118 construit le join depuis `socket.accessTokenValue` (`RealtimeChannel.js` ~148–155) et rappelle `setAuth` après la réponse `ok` (~164–166). La projection volatile couvre le jeton du **join puis de chaque mise à jour `access_token`** envoyée pour ce canal **jusqu’à la fin de la fenêtre de réception de l’INSERT** (ou fin de l’époque du socket). Elle enregistre une **progression d’époques d’authentification** — `auth_epoch` (entier : 0 = join, +1 à chaque `access_token` émis), temps relatif — et, **par époque**, un booléen `current_role_is_authenticated_sub_matches` ; aucune charge utile n’est persistée. La mesure n’est probante que si **toutes** les époques couvrant `[join, fin de fenêtre]` sont capturées et vraies ; toute époque non capturée, tout changement de jeton non observé ou toute ambiguïté de liaison ⇒ rôle **INCONNU** pour la mesure, jamais une fausse preuve ; elle est réévaluée avant l’INSERT après tout changement de jeton ; comparaison à l’identité QA vérifiée indépendamment. Si la capture du jeton effectif ou sa liaison à la mesure n’est pas démontrée ⇒ rôle **INCONNU** (jamais converti en « false » ⇒ H2). Persisté : booléens rôle/sub concordants et temps relatifs seulement — jamais trame, jeton, claims, empreinte durable, journaux de socket ou payload. Un claim transmis n’est pas, à lui seul, une observation de l’identité utilisée par l’évaluateur RLS serveur.
- **Fichiers et propriétaire, avant code** : seule la sonde est nouvelle (`scripts/qa-realtime/**`, propriétaire Claude backend) ; fixtures, intentions, lectures Auth et nettoyage réutilisent les fichiers B1 nommés ci-dessus ; imports QA partagés en lecture seule ; aucun remplacement du jeton, aucune clé serveur dans la page, aucune instrumentation du produit ni capture brute ; la sonde SDK volatile est documentée et testée **hors cloud avec des jetons fictifs** avant toute tentative root.
- **Préflight root** : aucune cohorte active connue ; build/app/SDK exacts ; identité QA vérifiée ; publication et grants relus dans le périmètre autorisé ; refus si transport ou service indisponible. Nettoyage/`finally`/drain et manifeste privé 0600 obligatoires quel que soit le résultat. H1/H2 restent des observations limitées à la mesure, pas une causalité système générale ; l’absence de `payments` dans la publication est un constat root historique, non démontré causal.

## 4. Limites et interdits
Aucun affaiblissement RLS, aucune policy modifiée, aucune migration (ajout de `payments` à la publication = décision séparée du propriétaire des migrations, après diagnostic), aucun changement de l’app pendant le diagnostic. Le correctif éventuel (bindings publiés seulement ou un canal par table, écoute `system`, `wait`, badge honnête) relève des propriétaires de la coque et des migrations, sur contrat séparé.

## 5. Claim — WEB-REALTIME-PROBE-001 (mission 78a9020, contract 2058c2c)

Owner: Claude, the existing QA worker. Branch `claude/web-qa-realtime` = integration 53d34a9 plus a clean merge of 2058c2c. That merge also brings `docs/DETAIL_READ_CONTRACT.md` from the same branch, unchanged.

**Exclusive files (new):**
- `scripts/qa-realtime/**`;
- `tests/qa-realtime*.test.ts`;
- this claim section.

**Read-only imports:**
- from tracking (B1): `intents.mjs`, `durable.mjs`, `auth-admin.mjs`, `ownership.mjs`, `cleanup-proof.mjs`, `cleanup.mjs` (`runTrackingCleanup` as `runCleanupFn`), `finalize.mjs`, `guard.mjs`;
- `scenarios.mjs` (`TrackingFixtures`: intent before `createAuthUser`, before every INSERT);
- `scripts/qa/lib/*`.

None of these files is modified.

**Implementation choices within the contract:**
- **SDK.** A local QA page, never the production app, loads the app's real client: `@supabase/ssr` `createBrowserClient`, with supabase-js and realtime-js taken from the app's `node_modules`.
  - The bundle is built locally with esbuild (already installed; no new dependency) into the run's temporary folder, outside Git. It is served from a loopback server.
  - The preflight requires realtime-js `2.118.0` (`--expect-sdk`) and identity with the app's `--app-dir`. The report records the version, the source (paths) and the exact channel specification. It makes NO claim of UI proof.
- **Volatile token projection.** A Playwright `routeWebSocket` on the QA context proxies ONLY the Realtime socket (`connectToServer` plus explicit forwarding both ways). It decodes the frames IN MEMORY: `phx_join`, `access_token`, `phx_reply` of the join, `system`.
  - It derives only booleans: per epoch, token present, `role === "authenticated"`, `sub ===` the QA UID read independently through Auth admin.
  - It also derives relative times, the server bindings (public table and event, per-position match) and the whitelisted `system` messages.
  - No frame, JWT, claim, payload, header or cookie is kept.
  - Proxy not invoked, or a token change seen on the SDK side (`onAuthStateChange`) without a captured `access_token` frame ⇒ role **UNKNOWN**.
- **Events.** The page holds IN MEMORY the ids of received INSERT events on `interventions`. The harness asks it only « the exact id of this measurement received? » ⇒ a boolean.
- **Measurements, sequential, one channel each:**
  - `app-4`: `workspace-<uid>`, the app's 4 bindings in the app's order;
  - `pub-3`;
  - `int-1`;
  - `app-4-wait` (`postgres_changes_options: { wait: true }`).

  Each one is closed and drained in a `finally` before the next. `--only` selects a subset.
- **Cohort.** The e-mail is `qa-<run>-rt-client@qa.invalid`: the canonical shared cohort format required by the B1 ownership proof, instead of the literal `qa-rt-<run>-client` of §3. The meaning is the same: one confirmed client, no admin.
- **Root preflight:**
  - credentials, project and publishable key;
  - an explicit `--confirm-no-active-cohort` flag;
  - exact SDK;
  - `GET /auth/v1/health` = 200;
  - QA identity proven after the login (session UID = created UID).

  Any refusal ⇒ exit 2 before any mutation.
- **Exits:** 0 diagnostic completed (whatever the conclusion), 1 FATAL, 2 BLOCKED / preflight, 3 incomplete cleanup / unknown / stop with an open drain (precedence 3 > 2 > 130 > 1).
- **Outputs:** `--out` outside Git, folders 0700, files 0600: `report.json` (scalars and booleans only), `manifest.json`, `intents.json`, `cleanup.json`. `--cleanup-manifest` gives a cold restart (strict manifest, exact journal, generic B1).
