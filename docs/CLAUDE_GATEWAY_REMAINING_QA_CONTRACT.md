# QA-GW-EXPIRED-REVOKE-003 — critères restants du gateway : JWT expiré, révocation, concurrence

Branche `claude/web-pwa-backend` (worktree `depannage-claude-backend`), base `ac72c38` (harnais cloud 9/9 PASS sur Edge v1 `verify_jwt: true`, nettoyage 40, relectures 0, intégré en `0b1d9f9`). **Contrat publié avant tout code ; revue root/pilote avant implémentation, puis avant exécution.** Propriété : `scripts/qa-gateway/**`, `tests/qa-gateway*.test.ts`, ce document. Jamais `scripts/qa-advanced/**`, jamais l’app, l’Edge, les migrations, l’Auth globale ou la production. Aucune exécution cloud par cet agent ; aucune nouvelle automation ; les 9 scénarios nominaux ne sont pas rejoués (suite additive, sélectionnable).

## 0. Invariants conservés (GW-HARNESS-003 / ac72c38)

`fetch` seulement (aucun SDK), jetons réels par password grant, urgence `scheduled`, sorties 0700/0600 caviardées (clés, JWT, Bearer, mots de passe), refus (code 2) si `--project` ≠ hôte des identifiants/URL de fonction, manifeste durable réécrit après chaque création, découverte de cohorte avant toute suppression, lecture inconnue ⇒ aucune suppression et verdict `fail`, réconciliation tardive après fin anormale, codes de sortie : `0` = `pass`, `prepared` (§1.3) ou `observed` (§1.4 : rien n’a échoué, rien ne reste, mais la preuve n’est pas encore liée strictement), `1` = `fail`/non-preuve, `2` = usage/refus préalable (rien écrit, rien supprimé). Enveloppe 401 de la plateforme acceptée strictement (codes `UNAUTHORIZED_NO_AUTH_HEADER` / `UNAUTHORIZED_INVALID_JWT_FORMAT` liés à leurs scénarios).

## 1. Expiration réelle en deux modes, sans attente bloquante

### 1.1 Principe
Un jeton **réel** d’un **seul** compte client technique est obtenu par password grant, prouvé valide **avant** échéance par une commande **sans mutation**, stocké 0600 hors Git, puis — après que le temps réel a passé — présenté **tel quel** (jamais rafraîchi, jamais re-signé, jamais forgé) à la **vraie** fonction Edge (`verify_jwt: true`) qui doit répondre 401 sans fuite. Aucune lecture du secret JWT, aucune modification du TTL/JWT du projet, aucun `sleep` long : la relance après échéance est faite par l’automation existante du pilote (même commande, mode `verify`).

### 1.2 Interface (additive)
```
node scripts/qa-gateway/run.mjs --suite expiry-prepare --function-url <…/native-document-upload> --project <ref> --credentials <creds.json> --out <dossier privé 0700>
node scripts/qa-gateway/run.mjs --suite expiry-verify  --lease <dossier privé>/lease.json --function-url <…> --project <ref> --credentials <creds.json> --out <dossier privé 2>
```
Sans `--suite`, comportement actuel inchangé (9 scénarios). `--suite` et `--cleanup-manifest` restent compatibles : `--cleanup-manifest` nettoie aussi une cohorte d’expiration (le manifeste porte `suite: "expiry"`). `--dry-run` avec `--suite expiry-prepare` : contrôles d’arguments/projet/santé Auth uniquement.

### 1.3 Mode `prepare`
1. Cohorte **minimale** : **un** compte Auth `qa-gw-exp-<run>@qa.invalid`, `email_confirm: true`, métadonnées `role: client`, créé par l’API admin ; aucun admin, aucune finance, aucun document, aucun dossier, aucun e-mail envoyé. L’**identifiant durable est écrit dans le manifeste avant toute authentification** (manifeste 0600, `suite: "expiry"`, `userIds: [uid]`, `leaseEndsAt`). Le mot de passe (32 octets aléatoires) n’existe **qu’en mémoire** du processus `prepare` : jamais écrit (ni manifeste, ni bail, ni journal).
2. Password grant → `access_token`, `expires_in`, `expires_at`, `refresh_token` (**jamais utilisé, jamais stocké**). Cohérence exigée avant toute écriture du bail : charge utile du JWT décodée en base64url (lecture des claims, **pas** de vérification de signature, **pas** de secret) ; `iss` = `https://<ref>.supabase.co/auth/v1`, `sub` = uid créé, `exp` (claim) = `expires_at` (réponse) à ±5 s et ≈ `now + expires_in`, `aud` = `authenticated`, `role` = `authenticated`. Toute incohérence ⇒ `fail`, compte nettoyé, aucun bail.
3. Preuve « valide avant échéance » **sans mutation** : `POST <function-url>` avec `Authorization: Bearer <token>`, `apikey` publishable, **sans corps multipart**. Attendu : **422** avec l’enveloppe de la fonction `{"error":"…"}` (« contenu envoyé invalide » / « choisissez un fichier »), qui prouve que la plateforme (`verify_jwt`) **et** `getUser` de la fonction ont accepté le jeton ; un 401 ⇒ `fail` (jeton non accepté) ; 2xx ⇒ `fail` (mutation inattendue) ; vérification de fuite sur le corps. Aucune écriture : aucun `documents`, aucun objet Storage (relecture à zéro sous le préfixe `<uid>/`).
4. Bail `lease.json` (0600, dans `--out`, hors Git) : `{version:1, suite:"expiry", runId, project, userId, email, token, issuer, tokenExpiresAt (epoch s), claimExp, grantExpiresIn, preparedAt, verifyNotBefore = exp + 60 s, leaseEndsAt = min(exp + 2 h, preparedAt + 2 h), manifestPath}`. Le **jeton** est le seul secret du bail ; le fichier est caviardé nulle part ailleurs (jamais dans `summary.md`, `result.json`, `run.log` : caviardage existant + ajout du jeton à la liste des secrets).
4 bis. **Bail inexécutable ⇒ refus et nettoyage** : si `verifyNotBefore ≥ leaseEndsAt` (TTL du projet plus long que le bail de 2 h, ou horloge incohérente), `prepare` **n’écrit aucun bail**, supprime immédiatement le compte (relecture 404), verdict `fail` « bail inexécutable : TTL %s s > fenêtre de bail » — jamais de compte laissé sans verify possible.
4 ter. **Données de cohérence dans le manifeste** (réécrit avant le bail) : `expiry: { userId, email, issuer, claimExp, tokenSha256 }` (empreinte SHA-256 hexadécimale du jeton, jamais le jeton). Le manifeste reste sans secret.
5. Verdict **`prepared`** (code de sortie 0) : `summary.md` annonce « PREPARED — expiration non encore prouvée ; relancer `--suite expiry-verify --lease <chemin>` après `verifyNotBefore` (ISO) et avant `leaseEndsAt` ». **Jamais PASS**. Le compte est laissé **intentionnellement** jusqu’au `verify` (au plus `leaseEndsAt`, ≤ 2 h). Le manifeste et le bail sont les artefacts actionnables si le `verify` n’a pas lieu.
6. Erreur/interruption pendant `prepare` (après création du compte) : nettoyage sûr immédiat (découverte + suppression UID + relecture 404) ; si le nettoyage échoue, manifeste conservé et `fail` avec message de relance. Aucun compte permanent.

### 1.4 Mode `verify`
1. Lit `lease.json` ; refus (code 2, rien écrit, rien supprimé, compte conservé) si `now < verifyNotBefore` (« trop tôt : relancer après <ISO> ») ou si projet/URL incohérents avec le bail. Si `now > leaseEndsAt` : **non-preuve** — nettoyage de l’UID, verdict `fail` « bail expiré, expiration non prouvée » (jamais PASS).
1 bis. **Cohérence bail ↔ manifeste avant tout appel** : `verify` relit le manifeste désigné par le bail (`manifestPath`, même projet, `suite: "expiry"`), recalcule `sha256(token du bail)` et exige l’égalité avec `expiry.tokenSha256`, puis relit les claims du jeton (base64url, sans secret) et exige `iss` = `expiry.issuer` = `https://<ref>.supabase.co/auth/v1`, `sub` = `expiry.userId` = `lease.userId`, `exp` = `expiry.claimExp` = `lease.claimExp`, `aud`/`role` = `authenticated`. Toute divergence ⇒ `fail` (bail altéré ou étranger), nettoyage de l’UID du **manifeste**, aucun appel Edge.
2. **Compte actif, ni banni ni effacé, avant l’appel** : `GET /auth/v1/admin/users/<uid>` (clé serveur) doit répondre **200** avec `id` = uid, `email` = e-mail du bail, `deleted_at` absent/`null`, `banned_until` absent/`null`/passé ; 404, bannissement actif ou e-mail différent ⇒ **non-preuve** (`fail`), nettoyage, aucun appel (un 401 sur un compte banni/effacé ne prouverait pas l’expiration).
3. Appel **réel** de la fonction déployée avec le **même** jeton (lu du bail, inchangé) : `POST <function-url>` sans corps, `Authorization: Bearer <token expiré>`, `apikey` publishable. Exigé : **401** et aucune fuite (JWT, chemin, code SQL, clé). Verdicts selon le corps :
   - enveloppe de la fonction `{"error":…}` (refus par `getUser` de la fonction) ⇒ `pass` ;
   - enveloppe plateforme `{"code":"<chaîne>","message":"<non vide>"}` dont le `code` est **dans la liste liée** `EXPIRED_PLATFORM_CODES` ⇒ `pass` ; cette liste est **vide tant que le code réel d’un JWT expiré n’a pas été observé** ;
   - enveloppe plateforme avec un `code` chaîne `UNAUTHORIZED_*` **inconnu** ⇒ verdict **`observed`** (code 0) : le code est enregistré dans le rapport (`observedCode`), le nettoyage doit être propre, **ce n’est pas un PASS** ; le pilote lie ensuite ce code strictement dans un commit de suivi (même méthode que ac72c38), après quoi seul ce code donne `pass` ;
   - **exclus explicitement** (⇒ `fail`, car ils prouveraient un défaut de transport ou d’en-tête, pas l’expiration) : `UNAUTHORIZED_NO_AUTH_HEADER`, `UNAUTHORIZED_INVALID_JWT_FORMAT`, tout corps sans `code` chaîne (`{"message":…}` seul, `code` numérique), corps vide/générique/tableau, `code` ne commençant pas par `UNAUTHORIZED_` ;
   - 422 (jeton encore accepté), 2xx, 5xx, autre 4xx ⇒ `fail`.
4. Contrôle de cohérence temporelle : `now ≥ claimExp + 60 s` au moment de l’appel (horloge locale) **et** le 401 n’est pas celui d’un en-tête absent (`UNAUTHORIZED_NO_AUTH_HEADER` ⇒ `fail`, car il prouverait un défaut de transport, pas l’expiration).
5. Nettoyage : suppression Auth admin de l’UID, relecture **404** ; découverte de cohorte (lignes `documents`/objets sous `<uid>/` : attendus à zéro) ; verdict `pass` seulement si 401 sans fuite avec un corps **lié** (fonction ou code lié) **et** cohérence bail/manifeste **et** 200 actif avant **et** 404 après **et** aucune lecture inconnue ; `observed` si tout est identique sauf le code encore non lié ; `fail` sinon. Le bail est réécrit avec `consumedAt` (jeton conservé tel quel, 0600) ; le pilote supprime le dossier privé.
6. Erreur/interruption ⇒ nettoyage sûr ou manifeste actionnable (`--cleanup-manifest`), jamais d’abandon muet.

### 1.5 Ce que cela prouve / ne prouve pas
Prouve : sur la vraie fonction déployée, un jeton réel accepté avant `exp` est refusé 401 après `exp` sans fuite, le compte existant toujours. Ne prouve pas : la révocation de session (voir §2), le comportement de rafraîchissement, le TTL exact (lu, non modifié), ni l’horloge du serveur (seule la relation `now ≥ exp + 60 s` locale est contrôlée).

### 1.6 Tests unitaires (faux horloge/réponses)
`tests/qa-gateway-expiry.test.ts` (node:test, sans réseau) : cohérence des claims (iss/sub/exp/aud, ±5 s), refus d’incohérence ; preuve pré-échéance (422 enveloppe fonction = pass ; 401/2xx = fail) ; bail 0600 et contenu exact (jeton présent, mot de passe absent) ; `verify` trop tôt (code 2, aucune suppression), bail expiré (fail + nettoyage), compte absent avant appel (fail), 401 plateforme `UNAUTHORIZED_*` (pass), 401 `UNAUTHORIZED_NO_AUTH_HEADER` (fail), 422 (fail), fuite (fail), 404 après suppression (pass) / 200 après (fail) ; caviardage du jeton dans summary/result/log ; `--suite` sélectif (aucun des 9 scénarios exécuté) ; manifeste `suite:"expiry"` accepté par `--cleanup-manifest` ; bail inexécutable (`verifyNotBefore ≥ leaseEndsAt`) ⇒ aucun bail, nettoyage, fail ; cohérence bail/manifeste (empreinte SHA-256, iss/sub/exp) : divergence ⇒ fail sans appel ; compte banni (`banned_until` futur) ou `deleted_at` ⇒ fail sans appel ; 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` ⇒ fail ; 401 code inconnu `UNAUTHORIZED_*` ⇒ `observed` (code 0) ; 401 code lié ⇒ pass ; deux phases enchaînées avec horloge factice (prepare → verify trop tôt → verify après exp + 60 s).

## 2. Révocation pendant un VRAI upload — protocole de concurrence (revue avant tout code)

### 2.1 Objectif
Prouver, sur la fonction déployée, qu’une révocation **validée après le pré-contrôle et avant la finalisation** d’un upload réel aboutit à un **403 avec compensation de l’objet** (GW-REV-001/002), puis relectures `documents`/objet absentes — et non seulement le refus d’un jeton déjà révoqué. Un ordre non prouvé, une issue incertaine (503) ou une fenêtre non exercée ⇒ **FAIL / non-preuve**, jamais PASS théorique.

### 2.2 Contraintes d’exécution (révision pilote de 0a7aaa8)
- Il n’y a **ni psql ni libpq** : le pilote exécute du SQL par `supabase db query --file`, qui envoie un **lot** (batch) ; un `begin` ne peut pas s’étendre sur deux appels CLI. Le verrou, la pause, la révocation et le `commit` doivent donc tenir **dans un seul lot**.
- Un signal fichier écrit **après** le retour de la CLI peut arriver **après** la réponse Edge : il ne prouve rien. L’horloge de la preuve est **celle de la base**, renvoyée **dans le résultat du lot** (`clock_timestamp()` avant verrou, avant révocation, après révocation, après `commit`), jamais un horodatage de fichier post-CLI.
- La fonction finalise par `finalize_document_upload` (013), qui prend d’abord `lock_intervention_organization(p_intervention_id)` = `select … for update of o` sur **l’organisation** du dossier (puis `for share` sur le dossier). Le pré-contrôle (`can_access_intervention`) et l’upload Storage **ne sont pas bloqués** ; la finalisation l’est tant que le lot tient le verrou.
- PostgREST applique `statement_timeout` au rôle `authenticated` (8 s par défaut sur le projet) : si le lot tient le verrou plus longtemps, la RPC échoue (`57014`) ⇒ transport incertain ⇒ **503, objet conservé** (GW-REV-001) ⇒ **non-preuve**. Pause du lot **≤ 4 s**, `statement_timeout` du lot 8 s, `lock_timeout` 2 s.

### 2.3 Acteurs et données (cohorte dédiée, jamais une ligne réelle) — variante site, sans admin
Cohorte du harnais : client QA, artisan QA (attribué), **propriétaire QA** de l’organisation (crée l’organisation et le site de la cohorte par `create_site`), **gestionnaire QA révoqué** = membre `manager` de l’organisation QA à portée `selected` avec grant `can_write` sur le site QA (posé par le propriétaire via `set_organization_member_site_access`). Dossier de **site** QA créé par le propriétaire. **Acteur de l’upload = le gestionnaire QA révoqué** (JWT réel valide, password grant) : il n’est ni le propriétaire, ni le client direct, ni l’artisan attribué. Révocation = **vrai RPC** `set_organization_member_site_access(<org QA>, <gestionnaire QA>, 'selected', '[]'::jsonb)` exécuté **sous l’identité du propriétaire QA** (rôle `authenticated` + claims `sub` = propriétaire QA), dans le lot. Aucun admin, aucune mise à jour directe de table.

### 2.4 Le lot SQL racine (unique, revu, borné)
```
begin;
set local statement_timeout = '8s'; set local lock_timeout = '2s';
select clock_timestamp() as t_begin, pg_backend_pid() as batch_pid;
-- garde : tous les identifiants appartiennent à la cohorte <run> (e-mails qa-gw-<run>-%, organisation/site/dossier liés), sinon raise exception
do $$ … $$;
-- verrou d'ordonnancement, identique à celui de finalize
select clock_timestamp() as t_lock from public.organizations o where o.id = '<org QA>' for update of o;
-- pause courte et bornée : fenêtre pendant laquelle le harnais uploade et observe l'objet
select pg_sleep(4);
-- révocation par le vrai RPC sous l'identité du propriétaire QA
set local role authenticated;
select set_config('request.jwt.claim.sub', '<propriétaire QA>', true), set_config('request.jwt.claims', '{"sub":"<propriétaire QA>","role":"authenticated","aud":"authenticated"}', true);
select clock_timestamp() as t_before_revoke;
select public.set_organization_member_site_access('<org QA>', '<gestionnaire QA>', 'selected', '[]'::jsonb);
select clock_timestamp() as t_revoked;
reset role;
commit;
select clock_timestamp() as t_after_commit;
```
Tous les UUID sont validés par la garde (format + appartenance à la cohorte) ; une seule exécution par run ; le lot est relu par le pilote avant exécution. Si `lock_timeout` ou la garde lève, rien n’est validé.

### 2.5 L’observateur (lecture seule, second appel CLI pendant la pause)
```
select a.pid, a.state, a.wait_event_type, a.wait_event, pg_blocking_pids(a.pid) as blocked_by, clock_timestamp() as t_observed, left(a.query, 80) as query
from pg_stat_activity a where a.query ilike '%finalize_document_upload%' and a.pid <> pg_backend_pid();
```
Attendu pendant la pause : **une** ligne, `wait_event_type = 'Lock'`, `blocked_by` contenant `batch_pid`, horodatage `t_observed` entre `t_lock` et `t_revoked`. C’est la preuve que la finalisation de l’upload réel **attendait le lot** (et non qu’elle n’avait pas encore commencé) au moment où l’objet était visible.

### 2.6 Interleaving et preuve d’ordre
| Étape | Qui | Observation |
|---|---|---|
| 1 | pilote : lance le lot (CLI 1, bloque ~4 s) | résultat final : `t_begin`, `batch_pid`, `t_lock`, `t_before_revoke`, `t_revoked`, `t_after_commit` (horloge DB) |
| 2 | pilote, aussitôt : lance `--suite revoke-live` | le harnais fait **un** upload réel (JPEG 2 Ko, JWT du gestionnaire QA) **sans attendre la réponse**, et liste `<gestionnaire QA>/` toutes les 250 ms (≤ 3 s) jusqu’à voir **un** objet nouveau : `object-observed` (horloge locale du pilote) |
| 3 | pilote, pendant la pause : observateur (CLI 2) | ligne `Lock`, `blocked_by ∋ batch_pid`, `t_observed` |
| 4 | lot : révocation puis `commit` | `t_revoked < t_after_commit` |
| 5 | harnais : réponse reçue | **403** enveloppe fonction, sans fuite ; relectures : objet absent, aucune ligne `documents` du dossier pour cet objet |

**Preuve d’ordre exigée pour PASS** : (a) l’observateur montre la finalisation **bloquée par `batch_pid`** à `t_observed` avec `t_lock ≤ t_observed ≤ t_revoked` (horloge DB) ; (b) le harnais a enregistré `object-observed` **avant** de recevoir la réponse, et l’objet était visible pendant la pause (l’observateur (a) le date côté base) ; (c) la réponse est **403** avec objet absent et aucune ligne `documents` ; (d) `t_revoked < t_after_commit` et la RPC de révocation a retourné sans erreur ; (e) aucune lecture inconnue au nettoyage. La comparaison « objet observé avant la révocation » s’appuie sur (a) (la finalisation attendait encore quand l’observateur a lu) et non sur l’horloge locale du pilote.

**Non-preuve / FAIL** : observateur sans ligne bloquée (la finalisation n’a pas été exercée pendant le verrou) ; objet jamais observé pendant la fenêtre ; 201 (la révocation a perdu la course : fait documenté, pas un PASS) ; 503/`57014`/absence de réponse (issue incertaine ⇒ objet conservé ⇒ découverte + nettoyage) ; lot échoué (garde, `lock_timeout`) ; `t_observed` hors `[t_lock, t_revoked]` ; horloges locale/DB incomparables ne sont **pas** utilisées comme preuve. Aucune garantie codée « par timeout ».

### 2.7 Refus si un autre rédacteur est actif
Le lot commence par `select count(*) from auth.users where email like 'qa-gw-%' and email not like 'qa-gw-<run>-%'` et lève si > 0 ; le harnais exige `--no-other-writer` (coché par le pilote après vérification qu’aucun manifeste non consommé n’existe) et refuse sinon (code 2). Le nettoyage du run précédent doit être **terminé** (0 reliquat).

### 2.8 Hors périmètre / interdits
Aucun trigger, hook ou point d’injection ajouté à l’Edge ; aucune modification de l’Auth globale, de la production ou d’une table utilisateur hors cohorte ; pas de garantie « par timeout » codée comme preuve : seule la séquence observée §2.5 vaut preuve.

### 2.9 Tests unitaires (faux client, faux résultats de lot/observateur, faux horloge) — après GO pilote
`tests/qa-gateway-revoke.test.ts` : le harnais reçoit (par fichier privé fourni par le pilote) le résultat du lot et de l’observateur ; séquence nominale (ligne bloquée par `batch_pid` dans `[t_lock, t_revoked]`, objet observé avant la réponse, 403, relectures absentes ⇒ pass) ; observateur sans ligne bloquée ⇒ fail « finalisation non exercée » ; objet jamais observé ⇒ fail « fenêtre non exercée » ; 201 ⇒ fail documenté ; 503 ⇒ fail incertain + découverte/compensation ; `t_observed` hors fenêtre ⇒ fail ; refus sans `--no-other-writer` ; aucune suppression hors manifeste.

## 3. Révocation « simple » (jeton déjà révoqué) — complément, même suite
Après §2 (ou indépendamment, `--suite revoke-simple`) : (1) **déconnexion globale** : `POST /auth/v1/logout?scope=global` avec le JWT de l’artisan QA, puis upload avec le **même** JWT → attendu 401 **si** la fonction/`getUser` invalide la session (`session_id`) ; sinon 201 **documenté comme fait observé** (le JWT reste statutairement valide jusqu’à `exp` : c’est un résultat, pas un PASS/FAIL théorique — le contrat gateway ne promet pas l’invalidation de session) ; (2) **retrait de droit avant upload** : réaffectation/retrait de membership **avant** l’upload → 403 attendu, aucun objet, aucune ligne (déjà couvert par le pré-contrôle, mais relu ici sur la vraie fonction).

## 4. Livraison et commande pilote
1. Ce contrat (revue). 2. Implémentation §1 + tests (`npx tsx --test tests/qa-gateway*.test.ts`, `tsc`, `node --check`), SHA rapporté. 3. Après décision §2.7, implémentation §2/§3 + tests, SHA rapporté. Commandes pilote : `--suite expiry-prepare` puis, après `verifyNotBefore`, `--suite expiry-verify --lease …` ; `--suite revoke-live --no-other-writer --batch-result <fichier privé>` avec le lot et l’observateur revus (§2.4–2.5) ; `--suite revoke-simple`. Chaque run : nettoyage 0 reliquat exigé avant tout nouveau rédacteur.

## 4 bis. Livraison §1 (implémentation après le contrat v2)

`scripts/qa-gateway/lib.ts` : `decodeJwtClaims` (lecture base64url, aucune signature), `checkTokenConsistency`, `buildLease`/`parseLease`/`leaseDecision`, `assertPreExpiryProbe` (422 enveloppe fonction), `assertExpiredRefusal` (`pass` = enveloppe fonction ou code lié ; `observed` = `UNAUTHORIZED_*` inconnu ; `fail` = `NO_AUTH_HEADER`, `INVALID_JWT_FORMAT`, sans code, code numérique, 422/2xx/5xx, fuite), `EXPIRED_PLATFORM_CODES = []` (vide jusqu’à la première observation), `sha256Hex` (WebCrypto), `expiryPrepare`/`expiryVerify` (orchestration pure sur dépendances injectées : horloge, HTTP, manifeste, bail), manifeste avec `suite`, `leaseEndsAt`, `expiry { userId, email, issuer, claimExp, tokenSha256 }`, verdicts `prepared`/`observed`. `scripts/qa-gateway/run.mjs` : `--suite expiry-prepare|expiry-verify`, `--lease`, dépendances `fetch`, bail `lease.json` 0600 écrit brut dans `--out`, jeton/refresh/mot de passe ajoutés aux secrets de caviardage, nettoyage sauté **seulement** après `prepared` (compte laissé à dessein) ou `too-early` ; codes de sortie 0 (`pass`/`prepared`/`observed`), 1, 2. `tests/qa-gateway-expiry.test.ts` : 12 tests (arguments, claims, bail, sondes, enveloppes, manifeste, verdicts, deux phases enchaînées à horloge factice, non-preuves, câblage).

Commandes pilote (après revue root du contrat v2, jamais exécutées par cet agent) :
```
node scripts/qa-gateway/run.mjs --suite expiry-prepare --function-url https://<ref>.supabase.co/functions/v1/native-document-upload --project <ref> --credentials /chemin/privé/creds.json --out /chemin/privé/exp-1
# verdict attendu : prepared (code 0) ; summary.md donne verifyNotBefore/leaseEndsAt et la commande verify ; lease.json 0600 dans /chemin/privé/exp-1
node scripts/qa-gateway/run.mjs --suite expiry-verify --lease /chemin/privé/exp-1/lease.json --function-url https://<ref>.supabase.co/functions/v1/native-document-upload --project <ref> --credentials /chemin/privé/creds.json --out /chemin/privé/exp-2
# avant verifyNotBefore : code 2, rien touché ; après : observed (code 0) tant que le code plateforme n'est pas lié, pass si enveloppe fonction/code lié, fail sinon ; compte supprimé, relecture 404
node scripts/qa-gateway/run.mjs --cleanup-manifest /chemin/privé/exp-1/manifest.json --project <ref> --credentials /chemin/privé/creds.json --out /chemin/privé/exp-3
# secours si le verify n'a pas lieu avant leaseEndsAt
```
Après la première observation du code plateforme (summary `OBSERVED — code …`), commit de suivi : ajout du code dans `EXPIRED_PLATFORM_CODES` + test fixture verbatim (même méthode que ac72c38).

## 5. Limites honnêtes
Aucune exécution par cet agent ; le code plateforme d’un JWT expiré, la durée réelle de `statement_timeout` PostgREST du projet, le comportement de `getUser` après déconnexion globale et la fenêtre réelle entre pré-contrôle et finalisation sont **à observer** lors de la recette pilote et deviennent des faits du rapport, jamais des PASS supposés.
