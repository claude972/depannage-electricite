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
- **Lecture de verdict** (chaque ligne exige un join confirmé et l’INSERT propre à la mesure) :

| Constat | Conclusion |
|---|---|
| Canal à 4 : `CHANNEL_ERROR` « mismatch… » ; canal (i) : `SUBSCRIBED` + événement reçu | **H1a** |
| Canal à 4 : `SUBSCRIBED`, aucun événement, message `system` d’erreur en liste blanche (« Unable to subscribe… ») ; canal (i) ou (ii) : événement reçu | **H1b** |
| `join_token_present = false` ou `join_token_role_is_authenticated = false` au join | **H2** (jeton non transmis / rôle anon au join) |
| Jeton du join prouvé (`present`, `authenticated`, `sub` attendu), bindings conformes, **et** preuve **positive** d’un rejet RLS (message `system`/erreur en liste blanche contenant « RLS » ou équivalent) | **H3** |
| Jeton du join prouvé, bindings conformes, aucun message d’erreur, **aucun événement** même sur (ii) | **INCONNU** (revue root P2-3 : l’absence d’événement seule ne prouve pas H3) |
| Join non confirmé, rôle non prouvé, ou toute autre combinaison | **non concluant**, aucune cause affirmée |

## 4. Limites et interdits
Aucun affaiblissement RLS, aucune policy modifiée, aucune migration (ajout de `payments` à la publication = décision séparée du propriétaire des migrations, après diagnostic), aucun changement de l’app pendant le diagnostic. Le correctif éventuel (bindings publiés seulement ou un canal par table, écoute `system`, `wait`, badge honnête) relève des propriétaires de la coque et des migrations, sur contrat séparé.
