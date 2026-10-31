# WEB-ACCEPTANCE-TESTS-001 — rapport de livraison (Claude)

Branche `claude/web-pwa-qa`, base `309ed9f`. Contrat : `docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md` (publié avant le code, commit `704996c`). Ce rapport décrit **exactement** ce qui a été exécuté par Claude, sans secret ni accès cloud, et ce que Codex doit lancer avec les vrais paramètres. Aucun résultat des outils temporaires d'avant minuit n'est repris ici comme preuve.

## 1. Livrables

| Chemin | Rôle |
| --- | --- |
| `docs/CLAUDE_WEB_ACCEPTANCE_CONTRACT.md` | Contrat CLI, credentials, cohorte/manifeste/nettoyage, refus, scénarios, non-preuves. |
| `scripts/qa/run.mjs` | Runner : préflight, dry-run, exécution des suites, nettoyage, `result.json` / `summary.md` / `cleanup.json`, codes de sortie 0/1/2/3 ; mode `--cleanup-manifest`. |
| `scripts/qa/lib/args.mjs` | Analyse/validation des arguments, liste blanche d'origines (pur). |
| `scripts/qa/lib/config.mjs` | Lecture du fichier de credentials (forme), correspondance `--project`, SHA via `--app-dir`, dossier de sortie hors dépôt. |
| `scripts/qa/lib/redact.mjs` | Redaction des secrets (valeurs connues + motifs : jetons, cookies `sb-*`, JWT, clés `sb_*`). |
| `scripts/qa/lib/cohort.mjs` | `runId`, noms/emails `qa-<runId>-…@qa.invalid`, mots de passe générés. |
| `scripts/qa/lib/cleanup.mjs` | Ordre FK, plan par identifiants exacts, exécution + readback, rapport d'échec. |
| `scripts/qa/lib/supabase.mjs` | Client service minimal sur `fetch` (PostgREST, Auth admin, Storage) ; aucune dépendance. |
| `scripts/qa/lib/fixtures.mjs` | Création des fixtures, manifeste réécrit après chaque création, collecte des créations indirectes. |
| `scripts/qa/lib/browser.mjs` | Playwright injecté, contexte avec résumé réseau (méthode/chemin/statut seulement), connexion par formulaire avec contrôle du cookie `sb-<ref>-auth-token`, `expectVisible` (absence d'un contrôle requis = FAIL). |
| `scripts/qa/lib/report.mjs` | Scénarios, étapes, classification PASS / FAIL / ANOMALY, codes de sortie, `summary.md`. |
| `scripts/qa/suites/*.mjs` | `viewer-site-grants`, `support-stale-a-b`, `support-lost-response`, `quote-draft`, `photos-recovery`, `admin-old-dossiers`, `captures`. |
| `scripts/qa/tests/*.test.mjs` | Tests `node:test` des helpers purs (arguments, redaction, cohorte, ordre de nettoyage, classification). |
| `scripts/qa/credentials.example.json` | Forme du fichier de credentials, sans valeur réelle. |

Aucun fichier applicatif, `package.json`, migration ou secret modifié. Aucune installation npm dans le dépôt ; Playwright est importé depuis `--playwright-path` / `QA_PLAYWRIGHT_PATH`.

## 2. Exécuté par Claude (sans secret, sans cloud)

Environnement : Node v24.15.0, macOS, worktree interne de la branche `claude/web-pwa-qa`.

### 2.1 Vérification syntaxique

```
for f in scripts/qa/run.mjs scripts/qa/lib/*.mjs scripts/qa/suites/*.mjs scripts/qa/tests/*.mjs; do node --check "$f"; done
```
Résultat : aucune erreur (25 fichiers après la révision QA-001..004 ; 26 après QA-REV-005, `tests/fixtures.test.mjs` ajouté).

### 2.2 Tests unitaires

```
node --test scripts/qa/tests/*.test.mjs
```
Résultat initial (`bfb2d4d`) : 32 tests, 32 réussis. Résultat après la révision QA-001..004 : **42 tests, 42 réussis** (fichiers `args`, `redact`, `cohort`, `cleanup`, `report`, `lifecycle`). Couverture : arguments requis/invalides/dupliqués et `--timeout-ms`, liste blanche d'origines, redaction (valeurs connues, `access_token=`, cookies `sb-*`, texte d'en-tête `cookie:`, JWT, clés `sb_*`, erreurs lancées message + pile, clés d'objet `headers`/`cookie`/`authorization`/`apikey`/`x-api-key`, résumé réseau sans en-têtes), nommage de cohorte et domaine `qa.invalid`, ordre FK enfants→parents (dont `approvals` avant `quotes`) + Auth en dernier, plan par identifiants exacts (refus d'un identifiant non UUID), readback restant = échec, tables optionnelles absentes = `skipped`, classification FAIL/ANOMALY, erreur de gestionnaire de route → ANOMALY, événements par étape, codes de sortie avec FATAL, résumé ; cycle de vie : nettoyage exactement une fois, nettoyage qui échoue = incomplet sans interrompre l'écriture des résultats, `--keep-fixtures`, rejet non géré → FATAL → nettoyage → sortie 1/3 (le second plantage est ignoré).

Résultat après QA-REV-005 : **53 tests, 53 réussis, code de sortie 0** (fichier `fixtures` ajouté, `lifecycle` étendu). Nouveaux tests : porte d'arrêt (`check()` lève `StopRequestedError` après `stop()`, `stop()` idempotent, `register`/`drain` comptent les créations en vol, drain qui expire = `pending` rapporté) ; `finalize` lève le signal de façon synchrone, draine **puis** nettoie (ordre vérifié : création réglée → cleanup → résultats) ; création jamais réglée → nettoyage `INCOMPLETE` nommant le drain, code 3 ; gestionnaire de plantage avec une boucle Node de 50 insertions : la boucle s'arrête à l'insertion suivante par `StopRequestedError`, aucune insertion après le cleanup, chaque insertion effectuée figure dans le manifeste avant le cleanup ; `ensureApproval` réutilise la ligne du trigger sans `insert` (pas de 23505), insère seulement si absente, remet à `pending` une ligne décidée, refuse une ligne mise en file sur un autre site, enregistre l'identifiant dans le manifeste ; `guardWrites` refuse toute écriture après le signal (lectures autorisées) ; helper refusé avant toute insertion une fois le signal levé ; création en vol au moment du signal : son identifiant atteint le manifeste avant la fin du drain, une création suivante est refusée.

### 2.3 Dry-run et refus de préflight

Fichier de credentials **factice** (clé non réelle, projet `abcdefghijklmnopqrst`) créé dans un dossier temporaire puis supprimé ; Playwright 1.64.1 injecté depuis un cache interne hors dépôt (révision QA-REV-005 : module 1.62.1 d'un autre cache local, même procédure). Aucun appel réseau n'est effectué en dry-run.

| Cas | Commande (résumé) | Résultat observé |
| --- | --- | --- |
| Aide | `run.mjs --help` | usage imprimé, exit 0 |
| Plan valide | `--base-url http://localhost:3017 --sha <HEAD> --project abcdefghijklmnopqrst --credentials <factice> --app-dir . --dry-run --suite captures --suite quote-draft` | JSON du plan : `sha_verified: true`, `target: local`, `playwright: 1.64.1`, `credentials: "shape validated, project matched"`, fixtures par suite, ordre de nettoyage (32 étapes ; 33 après QA-REV-005 : `approvals by id` puis `approvals by site_id`), codes de sortie ; exit 0 |
| Projet différent | `--project zzzzzzzzzzzzzzzzzzzz` | `refused: --project … does not match the configured Supabase project` ; exit 2 |
| Origine non locale non autorisée | `--base-url https://preview.example` | `refused: base URL https://preview.example is neither local nor in the allow-list` ; exit 2 |
| Origine distante autorisée par le fichier | `--base-url https://allowed.example` (listée dans `allowed_base_urls`) | plan avec `target: "remote-allowed"` |
| SHA ≠ HEAD de `--app-dir` | `--sha bbbb…` | `refused: --sha … differs from HEAD …` ; exit 2 |
| Playwright absent | sans `QA_PLAYWRIGHT_PATH` | `refused: Playwright path missing …` ; exit 2 |
| `--out` dans le dépôt | `--out ./qa-out` | `refused: --out … is inside the git work tree …` ; exit 2 |
| Arguments invalides | `--base-url localhost --sha abc` | quatre erreurs listées + usage ; exit 2 |
| Import sans effet | `import('./scripts/qa/run.mjs')` | aucun appel, liste des 7 suites exportée |

### 2.4 Non exécuté par Claude

Aucune suite navigateur n'a été lancée : pas de credentials réels, pas de serveur Next local lancé par cette mission, pas d'accès au projet Supabase dédié. Les sélecteurs ont été écrits à partir du code de `origin/claude/web-pwa-ui` (libellés `Adresse email`, `Mot de passe`, `Se connecter`, `Sujet`, `Message`, `Envoyer la demande`, `Établir le devis`, `Prestation 1`, `Quantité`, `Prix unitaire HT (€)`, `Taux de TVA (%)`, `Enregistrer le brouillon`, `Recharger le brouillon`, `Conserver ma saisie`, `Envoyer le devis au client`, `Dossiers par page`, `Suivant`, `Ouvrir`, `Vérifier le dossier`, `C’est bien cette photo`, `Votre rôle : …`, `Accès aux sites`, `Retirer`, `Nouvelle demande`, `Périmètre actif`, `Versions du devis`) et des contrats backend. Tout écart entre ces libellés et le SHA réellement servi apparaîtra comme **ANOMALY** (sélecteur), pas comme défaut applicatif.

## 3. À exécuter par Codex (paramètres réels)

Prérequis : serveur Next de la révision intégrée servie en local (par ex. `http://localhost:3017`) et reliée au projet Supabase dédié ; fichier de credentials privé hors dépôt (forme `scripts/qa/credentials.example.json`, mode 0600) ; module `playwright` 1.64.x déjà installé hors dépôt avec sa révision Chromium en cache (sinon `--chromium-path`).

```
# 1. plan sans réseau (vérifie arguments, projet, SHA, Playwright)
QA_PLAYWRIGHT_PATH=<dossier du module playwright> \
node scripts/qa/run.mjs --base-url http://localhost:3017 --sha <SHA servi> --project <ref dédié> \
  --credentials <fichier privé> --app-dir <checkout servi> --dry-run

# 2. exécution complète (toutes les suites, headless), preuves hors dépôt ; --timeout-ms si le backend est lent
QA_PLAYWRIGHT_PATH=<dossier du module playwright> \
node scripts/qa/run.mjs --base-url http://localhost:3017 --sha <SHA servi> --project <ref dédié> \
  --credentials <fichier privé> --app-dir <checkout servi> --timeout-ms 120000 --json

# 3. une suite isolée, navigateur visible pour diagnostic
node scripts/qa/run.mjs … --suite quote-draft --no-headless

# 4. si une exécution a été interrompue avec --keep-fixtures ou un nettoyage incomplet
node scripts/qa/run.mjs --cleanup-manifest <out>/manifest.json --credentials <fichier privé> --project <ref dédié>
```

Lecture des résultats : `summary.md` (tableau par scénario, FATAL éventuel, non-preuves), `result.json` (étapes, preuves, réseau résumé, `routeErrors`, `fatal`, `sha_verified`, `target`), `events.ndjson` (diagnostic pas à pas), `run.log` (console redactée), `cleanup.json` (readback par table ; tout `fail` exige une intervention manuelle, code 3). Codes : 0 aucun FAIL ; 1 défaut applicatif présumé ou FATAL du harnais ; 2 refus de préflight ; 3 nettoyage incomplet. Les ANOMALY n'échouent pas le code de sortie mais doivent être relues : sélecteur/headless, à distinguer d'un défaut.

Les preuves sont rattachées au SHA passé en `--sha` (vérifié seulement avec `--app-dir`) et à la cible `local` ou `remote-allowed` ; elles ne valent jamais pour une preview Vercel, Stripe ou l'installation PWA au niveau OS.

## 3 bis. Révisions après la première exécution réelle du pilote (QA-001 à QA-004)

Le pilote a exécuté `bfb2d4d` contre l'intégration `62b1f7f` et le Supabase dédié ; le harnais a planté hors du `finally` (rejet non géré d'un `route.fetch` dépassant 30 s dans `support-lost-response`), le texte du plantage n'était pas redacté et le nettoyage a dû être lancé à la main. **Aucun défaut applicatif n'est déduit de ces anomalies.** Corrections livrées dans cette révision (toujours sans accès cloud de Claude) :

- **QA-003 — robustesse.** `lib/browser.mjs` : `safeRoute` enveloppe chaque gestionnaire `page.route` (try/catch → `s.routeError` → scénario `ANOMALY`, requête abandonnée), `routeFetch` applique le délai configuré, `newPage().close()`/`stopBrowser()` retirent toutes les routes et ferment les contextes **avant** le nettoyage. `lib/lifecycle.mjs` (nouveau) : finalisation idempotente (nettoyage une seule fois, sauf `--keep-fixtures`), gestionnaires `unhandledRejection`/`uncaughtException` → redaction → FATAL → nettoyage (même si le rapport de plantage échoue, `try/finally`) → sortie `1`/`3`. `lib/redact.mjs` : `redactError` (message **et** pile), texte d'en-tête `cookie:`/`set-cookie:`, clés d'objet `headers`/`x-api-key`, `summarizeNetwork` (méthode/chemin/statut). `run.mjs` : `--timeout-ms` (défaut 90000, appliqué à Playwright, aux `fetch` de page et aux appels Supabase via `AbortSignal.timeout`), `result.json`/`summary.md` réécrits après chaque scénario, `events.ndjson`, `run.log` 0600 dans un dossier 0700, stdout/stderr redactés et recopiés, tout chemin de plantage passé par `redactError`.
- **QA-001 — version publiée sélectionnée.** Constat source : `components/role/artisan-space.tsx` ne rend `role="group" aria-label="Versions du devis"` que si `versions.length > 1`. La suite `quote-draft` sème donc un devis `sent` antérieur (dossier `quoted`) ; après publication, l'assertion sur le groupe (deux boutons, un seul `aria-pressed`, référence du devis publié en tête, bascule vers l'autre version puis retour) est **obligatoire** ; son absence est un FAIL avec capture.
- **QA-002 — manager lecture.** Nouvelle fixture `manager-site-a-read` (portée `selected`, A `can_write=false`) + règle d'approbation, devis et approbation `pending` sur A. Assertions UI (éditeur de budget, « Configurer la règle », « Nouvelle demande », décision d'approbation masqués avec la raison « Vos droits d'écriture sont limités à certains sites. ») et sondes `server` : `set_site_budget`, `set_approval_rule`, `decide_approval` via `/api/professional` et création sur A via `/api/interventions` → 403, readback inchangé ; RPC PostgREST direct avec le jeton de session de l'utilisateur quand `supabase.publishable_key` est fourni (sinon `skipped` explicite). Les mêmes sondes sont appliquées au viewer. Nettoyage : `approvals` supprimées par `site_id` avant `quotes` (l'ancienne étape par `intervention_id` visait une colonne inexistante).
- **QA-004 — sélecteurs.** `getByLabel('Dossiers par page')` remplacé par `getByRole('combobox', { name, exact: true })` ; audit des autres `getByLabel` : champs texte → `textbox`, nombres → `spinbutton`, sélecteurs → `combobox` ; `getByLabel` conservé uniquement pour le mot de passe et le champ fichier (aucun rôle ARIA), avec commentaire.

Vérifications locales de cette révision : `node --check` sur tous les fichiers, `node --test scripts/qa/tests/*.test.mjs` (décompte en §2.2), `--dry-run` complet (plan avec `timeout_ms`, `direct_rpc_probes`, sorties attendues). Aucun scénario navigateur exécuté par Claude.

## 3 ter. Révision après la revue indépendante QA-REV-005 (base `07d7332`)

Constat du réviseur : (1) le setup de `viewer-site-grants` activait la règle d'approbation puis insérait le devis — le trigger `quote_approval_queue` (`queue_quote_approval`, migration `202610310002_professional.sql`, `insert into public.approvals(quote_id, site_id)` quand une règle activée a un seuil inférieur au total) créait déjà l'approbation — puis `createApproval` réinsérait la même `quote_id` : violation UNIQUE `23505` avant tout scénario ; (2) QA-003 restait partiel : la finalisation après FATAL ne bloquait pas la boucle Node de création de fixtures, qui pouvait insérer pendant ou après le nettoyage. Corrections (sans accès cloud de Claude) :

- **Approbation du trigger réutilisée.** `lib/fixtures.mjs` : `createApproval` remplacé par `ensureApproval({quote, site})` — `select approvals where quote_id=eq.<devis>` ; si la ligne du trigger existe, elle est réutilisée (vérification `site_id`, remise à `pending` si elle était décidée) ; sinon seulement, insertion d'une ligne `pending`. Dans les deux cas l'identifiant est enregistré sous `manifest.created.approvals` (nouvelle clé). `lib/cleanup.mjs` : étape `approvals by id` ajoutée avant `approvals by site_id` (toujours avant `quotes`) ; `collectIndirect` relit aussi les approbations des devis de la cohorte. La suite assert `approval.status === 'pending'` après `ensureApproval`. Aucune autre suite n'appelait `createApproval` (grep).
- **Signal d'arrêt + drain avant suppression.** `lib/lifecycle.mjs` : `createStopGate()` (`AbortController`, `check()`, `stop(reason)`, `register(promise)`, `drain(timeoutMs)`) et `StopRequestedError`. `finalize()` lève le signal **de façon synchrone**, draine les créations en vol (borne `--timeout-ms`, la durée maximale d'un appel Supabase), **puis** appelle le nettoyage, puis écrit les résultats (`drain` ajouté à `result.json` ; ligne d'alerte dans `summary.md` si `pending > 0`). Le gestionnaire de plantage lève le signal avant même le rapport du FATAL. Une création non réglée dans le délai force `cleanup.ok=false` (code 3) avec `drain.pending` : le nettoyage n'est jamais annoncé complet quand un identifiant peut manquer au manifeste. `lib/fixtures.mjs` : `guardWrites(db, gate)` vérifie le signal **avant chaque** `insert`/`upsert`/`update`/`delete`/`rpc`/`createAuthUser` (lectures libres) ; chaque helper de création passe par `creating()` (refus immédiat si arrêt, enregistrement en vol jusqu'au règlement) ; `track()` n'est jamais bloqué. `run.mjs` : une seule porte partagée par le cycle de vie et les fixtures ; la boucle des suites s'arrête (`break`) quand `lifecycle.stopping` est vrai, avant comme après une suite interrompue.

**Ce qui reste non prouvé par Claude.** Les deux corrections sont couvertes par des tests unitaires avec faux client et faux processus (§2.2) ; **aucune exécution cloud, aucun scénario navigateur, aucun plantage réel n'a été exécuté par Claude**. La robustesse au plantage (crash-safety) n'est donc pas démontrée par une recette réelle : seuls l'ordre signal → drain → suppression et le refus des écritures après signal sont démontrés hors navigateur. Le comportement réel du trigger (ligne effectivement présente après `createQuote`, colonnes et `status` par défaut `pending`) est déduit de la migration, non observé.

**À vérifier par Codex sur le projet dédié.** (a) `--suite viewer-site-grants` : le setup passe sans `23505`, `manifest.json` contient `created.approvals` avec un identifiant, `result.json` ne montre aucun scénario « suite setup » ; (b) `cleanup.json` : étapes `approvals` (`id` et `site_id`) `pass`, readback 0, puis `quotes` `pass` ; (c) exécution complète : `result.json.drain` présent avec `pending: 0`, `timedOut: false` ; (d) si un FATAL survient : `run.log` montre `suite … skipped: run stopping (fatal:…)` ou `StopRequestedError`, aucune insertion après la ligne `cleanup`, code 1 ou 3 cohérent avec `cleanup.json`.

## 4. Questions ouvertes pour le pilote

1. Chemin du fichier de credentials privé et ref exact du projet dédié à passer en `--project` (le runner refuse tout écart).
2. Origine locale réellement servie (`localhost:3017` d'après NIGHT_DELIVERY_8H ; autre port possible) et, si une origine distante doit être testée, sa valeur explicite pour `--allow-base-url` (elle sera étiquetée `remote-allowed`, jamais réputée preview réussie).
3. Dossier du module `playwright` à injecter (`QA_PLAYWRIGHT_PATH`) et, si le cache Chromium de la machine ne contient pas la révision attendue, `--chromium-path`.
4. Le checkout qui sert l'application, pour `--app-dir` : sans lui, le SHA n'est que déclaré.
5. L'admin de cohorte est créé par `profiles.role='admin'` via service_role puis supprimé ; confirmer que cette pratique reste acceptée sur la base dédiée (elle l'était dans les recettes antérieures).
6. Pour les sondes RPC directes (QA-002), ajouter `supabase.publishable_key` au fichier de credentials ; sinon elles restent `skipped` et seules les sondes par routes applicatives prouvent le 403.
7. QA-REV-005 : confirmer sur la base dédiée que la migration `202610310002_professional.sql` (trigger `quote_approval_queue`) est bien appliquée ; sans elle, `ensureApproval` insère lui-même l'approbation (cas « absente »), ce qui reste valide mais ne teste pas le chemin du trigger. Un `drain.pending > 0` observé en recette doit être remonté avec `manifest.json` et `cleanup.json` : il signale une création Supabase qui a dépassé `--timeout-ms`.
