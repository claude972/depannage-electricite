# QA-GW-EXPIRED-REVOKE-003 — critères restants du gateway : JWT expiré, révocation, concurrence

Branche `claude/web-pwa-backend` (worktree `depannage-claude-backend`), base `ac72c38` (harnais cloud 9/9 PASS sur Edge v1 `verify_jwt: true`, nettoyage 40, relectures 0, intégré en `0b1d9f9`). **Contrat publié avant tout code ; revue root/pilote avant implémentation, puis avant exécution.** Propriété : `scripts/qa-gateway/**`, `tests/qa-gateway*.test.ts`, ce document. Jamais `scripts/qa-advanced/**`, jamais l’app, l’Edge, les migrations, l’Auth globale ou la production. Aucune exécution cloud par cet agent ; aucune nouvelle automation ; les 9 scénarios nominaux ne sont pas rejoués (suite additive, sélectionnable).

## 0. Invariants conservés (GW-HARNESS-003 / ac72c38)

`fetch` seulement (aucun SDK), jetons réels par password grant, urgence `scheduled`, sorties 0700/0600 caviardées (clés, JWT, Bearer, mots de passe), refus (code 2) si `--project` ≠ hôte des identifiants/URL de fonction, manifeste durable réécrit après chaque création, découverte de cohorte avant toute suppression, lecture inconnue ⇒ aucune suppression et verdict `fail`, réconciliation tardive après fin anormale, codes de sortie : `0` pass (ou `prepared`, voir §1.4), `1` fail/non-preuve, `2` usage/refus préalable (rien écrit, rien supprimé). Enveloppe 401 de la plateforme acceptée strictement (codes `UNAUTHORIZED_NO_AUTH_HEADER` / `UNAUTHORIZED_INVALID_JWT_FORMAT` liés à leurs scénarios).

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
5. Verdict **`prepared`** (code de sortie 0) : `summary.md` annonce « PREPARED — expiration non encore prouvée ; relancer `--suite expiry-verify --lease <chemin>` après `verifyNotBefore` (ISO) et avant `leaseEndsAt` ». **Jamais PASS**. Le compte est laissé **intentionnellement** jusqu’au `verify` (au plus `leaseEndsAt`, ≤ 2 h). Le manifeste et le bail sont les artefacts actionnables si le `verify` n’a pas lieu.
6. Erreur/interruption pendant `prepare` (après création du compte) : nettoyage sûr immédiat (découverte + suppression UID + relecture 404) ; si le nettoyage échoue, manifeste conservé et `fail` avec message de relance. Aucun compte permanent.

### 1.4 Mode `verify`
1. Lit `lease.json` ; refus (code 2, rien écrit, rien supprimé, compte conservé) si `now < verifyNotBefore` (« trop tôt : relancer après <ISO> ») ou si projet/URL incohérents avec le bail. Si `now > leaseEndsAt` : **non-preuve** — nettoyage de l’UID, verdict `fail` « bail expiré, expiration non prouvée » (jamais PASS).
2. **Isolation expiration / compte effacé** : `GET /auth/v1/admin/users/<uid>` (clé serveur) doit répondre **200** (compte encore actif) **avant** l’appel ; sinon `fail` (le 401 ne prouverait rien).
3. Appel **réel** de la fonction déployée avec le **même** jeton (lu du bail, inchangé) : `POST <function-url>` sans corps, `Authorization: Bearer <token expiré>`, `apikey` publishable. Attendu : **401** ; corps = enveloppe de la fonction `{"error":…}` **ou** enveloppe plateforme `{"code":"<chaîne>","message":"…"}` ; vérification de fuite (aucun JWT, chemin, code SQL, clé). Le `code` plateforme réellement renvoyé pour un JWT expiré **n’a pas encore été observé** : le harnais exige un `code` chaîne commençant par `UNAUTHORIZED_` et un `message` non vide, l’enregistre dans le rapport, et le pilote le fixe strictement dans ac72c38-style après la première observation (suivi explicite, pas de PASS théorique sur la forme). Tout autre statut (422 = jeton encore accepté, 2xx, 5xx) ⇒ `fail`.
4. Contrôle de cohérence temporelle : `now ≥ claimExp + 60 s` au moment de l’appel (horloge locale) **et** le 401 n’est pas celui d’un en-tête absent (`UNAUTHORIZED_NO_AUTH_HEADER` ⇒ `fail`, car il prouverait un défaut de transport, pas l’expiration).
5. Nettoyage : suppression Auth admin de l’UID, relecture **404** ; découverte de cohorte (lignes `documents`/objets sous `<uid>/` : attendus à zéro) ; verdict `pass` seulement si 401 sans fuite **et** 200 avant **et** 404 après **et** aucune lecture inconnue. Le bail est réécrit avec `consumedAt` (jeton conservé tel quel, 0600) ; le pilote supprime le dossier privé.
6. Erreur/interruption ⇒ nettoyage sûr ou manifeste actionnable (`--cleanup-manifest`), jamais d’abandon muet.

### 1.5 Ce que cela prouve / ne prouve pas
Prouve : sur la vraie fonction déployée, un jeton réel accepté avant `exp` est refusé 401 après `exp` sans fuite, le compte existant toujours. Ne prouve pas : la révocation de session (voir §2), le comportement de rafraîchissement, le TTL exact (lu, non modifié), ni l’horloge du serveur (seule la relation `now ≥ exp + 60 s` locale est contrôlée).

### 1.6 Tests unitaires (faux horloge/réponses)
`tests/qa-gateway-expiry.test.ts` (node:test, sans réseau) : cohérence des claims (iss/sub/exp/aud, ±5 s), refus d’incohérence ; preuve pré-échéance (422 enveloppe fonction = pass ; 401/2xx = fail) ; bail 0600 et contenu exact (jeton présent, mot de passe absent) ; `verify` trop tôt (code 2, aucune suppression), bail expiré (fail + nettoyage), compte absent avant appel (fail), 401 plateforme `UNAUTHORIZED_*` (pass), 401 `UNAUTHORIZED_NO_AUTH_HEADER` (fail), 422 (fail), fuite (fail), 404 après suppression (pass) / 200 après (fail) ; caviardage du jeton dans summary/result/log ; `--suite` sélectif (aucun des 9 scénarios exécuté) ; manifeste `suite:"expiry"` accepté par `--cleanup-manifest`.

## 2. Révocation pendant un VRAI upload — protocole de concurrence (revue avant tout code)

### 2.1 Objectif
Prouver, sur la fonction déployée, qu’une révocation **validée après le pré-contrôle et avant la finalisation** d’un upload réel aboutit à un **403 avec compensation de l’objet** (GW-REV-001/002), puis relectures `documents`/objet absentes — et non seulement le refus d’un jeton déjà révoqué. Un ordre non prouvé, une issue incertaine (503) ou une fenêtre non exercée ⇒ **FAIL / non-preuve**, jamais PASS théorique.

### 2.2 Mécanisme d’ordonnancement
`finalize_document_upload` (013) commence par `lock_intervention_organization(p_intervention_id)` = `select … for update of o` sur **l’organisation** du dossier, puis `for share` sur le dossier. Le pré-contrôle de la fonction (`can_access_intervention`, lectures simples) **n’est pas bloqué** par ce verrou ; l’upload Storage non plus. Donc une session SQL racine qui **tient le verrou de l’organisation de la cohorte** laisse passer pré-contrôle + upload et **bloque la finalisation** jusqu’à son `commit`. La révocation est exécutée **dans cette même transaction** (par le vrai RPC sous l’identité de l’admin QA : `set local role authenticated` + claims du super admin QA de la cohorte → `reassign_intervention(<dossier QA>, <autre artisan QA>, 'révocation QA')`, variante site : `set_organization_member_site_access`/retrait de membership QA), puis `commit` : la finalisation reprend **après** la révocation, re-vérifie l’accès sous verrou → `42501` → la fonction répond **403** et **supprime le seul objet de la tentative**.

Contrainte dure : PostgREST applique `statement_timeout` au rôle `authenticated` (valeur projet, 8 s par défaut). Si la transaction racine tient le verrou plus longtemps, la RPC échoue `57014` ⇒ transport incertain ⇒ **503, objet conservé** (règle GW-REV-001) ⇒ issue **incertaine ⇒ FAIL/non-preuve** (puis nettoyage par découverte). Le protocole est donc borné à **≤ 5 s** de verrou.

### 2.3 Acteurs et données (cohorte dédiée, jamais une ligne réelle)
Cohorte standard du harnais (client, artisan, autre artisan ; **aucun admin QA n’existe aujourd’hui côté harnais**, voir §2.7) ; dossier client QA avec artisan QA attribué (écriture de seeding service, comme aujourd’hui) ; acteur de l’upload = **artisan QA attribué, JWT valide** (password grant). Variante site : dossier de site QA + membre QA à portée `selected` avec `can_write`, révocation = retrait du grant.

### 2.4 Commande SQL racine (unique, revue, bornée)
Exécutée par le pilote (`supabase db query --file`), **une seule** commande, paramétrée par des UUID **validés** (format UUID + préfixe de cohorte `qa-gw-<run>` vérifié par `select` préalable dans la même transaction, sinon `raise exception`), jamais de trigger/hook/bypass, jamais de table utilisateur hors cohorte :
```
begin;
set local statement_timeout='5s'; set local lock_timeout='2s';
-- 1. garde : le dossier, l'organisation (si site) et les comptes appartiennent à la cohorte <run> (emails qa-gw-<run>-%)
do $$ … raise exception 'hors cohorte' … $$;
-- 2. verrou d'ordonnancement (même verrou que finalize)
select 1 from public.organizations o … where i.id='<dossier QA>' for update of o;   -- variante client sans site : for update sur public.interventions id='<dossier QA>' (finalize fait `for share` ⇒ bloqué)
-- 3. attente bornée du signal « objet observé » (voir 2.5), au plus 3 s : pg_sleep(<n>) décidé par le pilote, PAS une boucle
-- 4. révocation par le vrai RPC sous l'identité de l'admin QA / du propriétaire QA
set local role authenticated; select set_config('request.jwt.claim.sub','<admin QA>',true); select set_config('request.jwt.claims','{"sub":"<admin QA>","role":"authenticated"}',true);
select public.reassign_intervention('<dossier QA>','<autre artisan QA>','révocation QA pendant upload');
reset role;
commit;
```
Note : pour un dossier **sans site**, `lock_intervention_organization` ne verrouille rien (jointure vide) ; la finalisation est alors bloquée par le `for share` sur le dossier face à un `for update` racine sur **la ligne du dossier**. Le choix client/site est fixé à la revue ; les deux sont décrits, un seul est exécuté par run.

### 2.5 Interleaving (séquence prouvée par observations, pas par hypothèse)
| t | Session racine (pilote) | Harnais (`--suite revoke-live`) | Observation exigée |
|---|---|---|---|
| 0 | `begin` ; garde cohorte ; **verrou pris** (retour immédiat) | attend le fichier signal `lock-held` écrit par le pilote dans `--signal-dir` (0700) — attente bornée 120 s, sinon FAIL « fenêtre non exercée » | horodatage `lock-held` |
| 1 | tient le verrou | `POST` upload réel (JPEG 2 Ko, JWT artisan valide) **en arrière-plan** ; pendant que la réponse est en attente, liste Storage `<artisan>/` toutes les 250 ms (≤ 3 s) jusqu’à voir **un** objet nouveau | horodatage `object-observed` + nom d’objet **avant** toute réponse HTTP ; écrit le signal `object-observed` |
| 2 | lit `object-observed` (ou `pg_sleep` borné décidé par le pilote), exécute la **révocation**, `commit` | réponse HTTP toujours pendante | horodatage `revocation-committed` (fichier signal écrit par le pilote **après** le commit) |
| 3 | — | réponse reçue : **403** attendu, enveloppe fonction, sans fuite ; puis relectures : `documents` par dossier = 0 ligne pour cet objet, objet absent du préfixe ; l’horodatage de réception doit être **≥** `revocation-committed` | verdict |

Règles de verdict : **PASS** seulement si `lock-held < object-observed < revocation-committed ≤ réponse` **et** 403 **et** objet absent **et** aucune ligne `documents` **et** aucune lecture inconnue. **FAIL/non-preuve** si : réponse reçue avant `revocation-committed` (ordre non prouvé, même si 403), objet jamais observé pendant la fenêtre (fenêtre non exercée), 201 (révocation perdue la course : documenté, pas un PASS), 503/absence de réponse (issue incertaine ⇒ objet conservé ⇒ découverte + nettoyage), signal manquant/attente dépassée. Les signaux sont des fichiers 0600 dans un dossier 0700 propre à ce run ; aucune nouvelle automation : le pilote écrit `lock-held` et `revocation-committed` à la main (ou par sa commande CLI), le harnais écrit `object-observed`.

### 2.6 Refus si un autre rédacteur est actif
Avant `lock-held`, le harnais et la commande racine vérifient qu’aucun autre run n’est actif sur le projet : `select count(*) from auth.users where email like 'qa-gw-%@example.invalid' and email not like 'qa-gw-<run>-%'` doit être 0 (côté racine) et le harnais exige l’absence de tout autre `manifest.json` « non consommé » déclaré par le pilote (`--no-other-writer` explicite, à cocher par le pilote après vérification). Sinon refus (code 2), rien écrit. Le nettoyage de la cohorte précédente doit être **terminé** (verdict propre) avant ce run.

### 2.7 Point ouvert à trancher à la revue
La révocation par `reassign_intervention` exige un **admin** (`is_admin()`). Le harnais n’a pas d’admin QA aujourd’hui (aucune promotion de profil par le harnais, qui est `fetch`-only). Options : (a) la session racine exécute la révocation directement par `update public.interventions set artisan_id=<autre artisan QA> where id=<dossier QA> and client_id=<client QA>` (commande racine bornée à la cohorte, pas un RPC) ; (b) variante **site** : révocation par le vrai RPC `set_organization_member_site_access` sous l’identité du **propriétaire QA** de l’organisation (pas d’admin requis) — **recommandée** car réelle et sans privilège global ; (c) promotion temporaire d’un admin QA dans la transaction racine (comme QA-ADV-ROLLBACK) puis `reassign_intervention` — plus lourd. Le pilote choisit ; le code n’est écrit qu’après.

### 2.8 Hors périmètre / interdits
Aucun trigger, hook ou point d’injection ajouté à l’Edge ; aucune modification de l’Auth globale, de la production ou d’une table utilisateur hors cohorte ; pas de garantie « par timeout » codée comme preuve : seule la séquence observée §2.5 vaut preuve.

### 2.9 Tests unitaires (faux client, faux signaux, faux horloge)
`tests/qa-gateway-revoke.test.ts` : séquence nominale (signaux dans l’ordre, objet observé, 403, relectures absentes ⇒ pass) ; réponse avant commit ⇒ fail « ordre non prouvé » ; objet jamais observé ⇒ fail « fenêtre non exercée » ; 201 ⇒ fail documenté ; 503 ⇒ fail incertain + découverte/compensation par le nettoyage ; attente de signal dépassée ⇒ fail ; refus si autre rédacteur ; aucune suppression hors manifeste.

## 3. Révocation « simple » (jeton déjà révoqué) — complément, même suite
Après §2 (ou indépendamment, `--suite revoke-simple`) : (1) **déconnexion globale** : `POST /auth/v1/logout?scope=global` avec le JWT de l’artisan QA, puis upload avec le **même** JWT → attendu 401 **si** la fonction/`getUser` invalide la session (`session_id`) ; sinon 201 **documenté comme fait observé** (le JWT reste statutairement valide jusqu’à `exp` : c’est un résultat, pas un PASS/FAIL théorique — le contrat gateway ne promet pas l’invalidation de session) ; (2) **retrait de droit avant upload** : réaffectation/retrait de membership **avant** l’upload → 403 attendu, aucun objet, aucune ligne (déjà couvert par le pré-contrôle, mais relu ici sur la vraie fonction).

## 4. Livraison et commande pilote
1. Ce contrat (revue). 2. Implémentation §1 + tests (`npx tsx --test tests/qa-gateway*.test.ts`, `tsc`, `node --check`), SHA rapporté. 3. Après décision §2.7, implémentation §2/§3 + tests, SHA rapporté. Commandes pilote : `--suite expiry-prepare` puis, après `verifyNotBefore`, `--suite expiry-verify --lease …` ; `--suite revoke-live --signal-dir <dossier 0700> --no-other-writer` avec la commande racine revue ; `--suite revoke-simple`. Chaque run : nettoyage 0 reliquat exigé avant tout nouveau rédacteur.

## 5. Limites honnêtes
Aucune exécution par cet agent ; le code plateforme d’un JWT expiré, la durée réelle de `statement_timeout` PostgREST du projet, le comportement de `getUser` après déconnexion globale et la fenêtre réelle entre pré-contrôle et finalisation sont **à observer** lors de la recette pilote et deviennent des faits du rapport, jamais des PASS supposés.
