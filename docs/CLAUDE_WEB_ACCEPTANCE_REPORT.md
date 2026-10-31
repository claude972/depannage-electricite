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
Résultat : aucune erreur sur les 20 fichiers.

### 2.2 Tests unitaires

```
node --test scripts/qa/tests/*.test.mjs
```
Résultat : 32 tests, 32 réussis (après une correction : le vérificateur d'ordre a signalé une double suppression d'`audit_log` de part et d'autre d'`interventions` ; les suppressions par `actor_id` ont été avancées avant `interventions`, et le contrat §3 aligné). Couverture : arguments requis/invalides/dupliqués, liste blanche d'origines, redaction (valeurs connues, `access_token=`, cookies `sb-*`, JWT, clés `sb_*`, clés d'objet sensibles), nommage de cohorte et domaine `qa.invalid`, ordre FK enfants→parents + Auth en dernier, plan par identifiants exacts (refus d'un identifiant non UUID), readback restant = échec, tables optionnelles absentes = `skipped`, classification FAIL/ANOMALY, codes de sortie, résumé.

### 2.3 Dry-run et refus de préflight

Fichier de credentials **factice** (clé non réelle, projet `abcdefghijklmnopqrst`) créé dans un dossier temporaire puis supprimé ; Playwright 1.64.1 injecté depuis un cache interne hors dépôt. Aucun appel réseau n'est effectué en dry-run.

| Cas | Commande (résumé) | Résultat observé |
| --- | --- | --- |
| Aide | `run.mjs --help` | usage imprimé, exit 0 |
| Plan valide | `--base-url http://localhost:3017 --sha <HEAD> --project abcdefghijklmnopqrst --credentials <factice> --app-dir . --dry-run --suite captures --suite quote-draft` | JSON du plan : `sha_verified: true`, `target: local`, `playwright: 1.64.1`, `credentials: "shape validated, project matched"`, fixtures par suite, ordre de nettoyage (32 étapes), codes de sortie ; exit 0 |
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

# 2. exécution complète (toutes les suites, headless), preuves hors dépôt
QA_PLAYWRIGHT_PATH=<dossier du module playwright> \
node scripts/qa/run.mjs --base-url http://localhost:3017 --sha <SHA servi> --project <ref dédié> \
  --credentials <fichier privé> --app-dir <checkout servi> --json

# 3. une suite isolée, navigateur visible pour diagnostic
node scripts/qa/run.mjs … --suite quote-draft --no-headless

# 4. si une exécution a été interrompue avec --keep-fixtures ou un nettoyage incomplet
node scripts/qa/run.mjs --cleanup-manifest <out>/manifest.json --credentials <fichier privé> --project <ref dédié>
```

Lecture des résultats : `summary.md` (tableau par scénario, non-preuves), `result.json` (étapes, preuves, réseau résumé, `sha_verified`, `target`), `cleanup.json` (readback par table ; tout `fail` exige une intervention manuelle, code 3). Codes : 0 aucun FAIL ; 1 défaut applicatif présumé ; 2 refus de préflight ; 3 nettoyage incomplet. Les ANOMALY n'échouent pas le code de sortie mais doivent être relues : sélecteur/headless, à distinguer d'un défaut.

Les preuves sont rattachées au SHA passé en `--sha` (vérifié seulement avec `--app-dir`) et à la cible `local` ou `remote-allowed` ; elles ne valent jamais pour une preview Vercel, Stripe ou l'installation PWA au niveau OS.

## 4. Questions ouvertes pour le pilote

1. Chemin du fichier de credentials privé et ref exact du projet dédié à passer en `--project` (le runner refuse tout écart).
2. Origine locale réellement servie (`localhost:3017` d'après NIGHT_DELIVERY_8H ; autre port possible) et, si une origine distante doit être testée, sa valeur explicite pour `--allow-base-url` (elle sera étiquetée `remote-allowed`, jamais réputée preview réussie).
3. Dossier du module `playwright` à injecter (`QA_PLAYWRIGHT_PATH`) et, si le cache Chromium de la machine ne contient pas la révision attendue, `--chromium-path`.
4. Le checkout qui sert l'application, pour `--app-dir` : sans lui, le SHA n'est que déclaré.
5. L'admin de cohorte est créé par `profiles.role='admin'` via service_role puis supprimé ; confirmer que cette pratique reste acceptée sur la base dédiée (elle l'était dans les recettes antérieures).
