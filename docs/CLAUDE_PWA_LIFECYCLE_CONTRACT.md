# QA-PWA-LIFECYCLE-002 — contrat : deux builds réels, deux onglets, origine locale unique

Mission `missions/web-pwa` `0674939` (« QA-PWA-LIFECYCLE-002 »). Branche `claude/web-pwa-qa`, worktree QA existant. **Contrat publié avant le code.** Fichiers possédés par cette mission : ce document, `scripts/qa-pwa-lifecycle.mjs`, `scripts/qa-pwa-lifecycle/**` (helpers purs), `tests/qa-pwa-lifecycle*.test.mjs`. Jamais modifiés : `public/sw.js`, `public/offline.html`, `app/manifest.ts`, `components/pwa-registration.tsx` (`PwaInstallControl`), `next.config.ts`, `scripts/qa-advanced/**`, `package*.json`, coques, `scripts/qa/**` (réutilisés en **lecture seule** : `lib/browser.mjs` pour charger Playwright, lancer Chromium et mesurer le débordement ; `lib/redact.mjs` ; `lib/lifecycle.mjs` pour la porte d'arrêt, les signaux et la finalisation unique ; `lib/config.mjs` pour refuser une sortie dans le dépôt). Tout défaut applicatif constaté est **signalé** (FAIL avec preuve), jamais corrigé ici. L'ancien harnais `/tmp/depannage-web-pwa-qa/pwa-two-deploy.mjs` a été lu sans modification : il visait deux déploiements Vercel successifs ; ce contrat reprend sa séquence (deux onglets, saisie non enregistrée, attente, consentement explicite, purge du cache) sur deux builds **locaux**.

## 1. Ce qui est testé, ce qui ne l'est pas

Testé : deux builds Next réels, préparés par le pilote dans deux checkouts isolés (ancien `1be8f00`, worker `courant-pwa-public-v2` ; nouveau `a2faa02`, worker `courant-pwa-public-v3`), servis **successivement** par `next start` sur la **même origine** `http://localhost:<port>` (défaut 3020), avec deux vrais onglets Chromium (Playwright injecté) dont les contrôleurs de service worker sont conservés pendant le basculement.

Non testé, et jamais présenté comme prouvé : deux previews Vercel déployées (explicitement différé) ; installation au niveau OS (Chrome « Installer », iOS « Sur l'écran d'accueil », Android) ; notifications push, synchronisation en arrière-plan, file hors ligne (absentes par conception du worker) ; parcours de paiement ; comptes utilisateurs réels (aucun compte, aucune cohorte Auth, aucun admin synthétique, rien sous 014) ; cloud (aucune clé service, `.env.local` public seulement, aucune requête vers un fournisseur n'est nécessaire au scénario).

## 2. Interface en ligne de commande

```
node scripts/qa-pwa-lifecycle.mjs \
  --old-dir <checkout+build ancien> --old-sha <40 hex> \
  --new-dir <checkout+build nouveau> --new-sha <40 hex> \
  --playwright-path <module playwright installé> [--chromium-path <exécutable>] \
  --out <dossier hors dépôt> [--port 3020] [--timeout-ms 90000] \
  [--stage-evidence <json du pilote>] [--headless | --no-headless] [--dry-run] [--json]
```

| Option | Rôle |
| --- | --- |
| `--old-dir` / `--new-dir` | Checkouts isolés **déjà construits** par le pilote (`.next/BUILD_ID` présent). Le runner ne lance jamais `next build`, `next dev`, `npm install`. |
| `--old-sha` / `--new-sha` | SHA complets attendus ; `git -C <dir> rev-parse HEAD` doit correspondre, sinon refus. |
| `--port` | Port dédié (défaut 3020). Refus si un processus **non possédé** par le runner écoute déjà dessus ; jamais de réutilisation d'un serveur étranger (notamment pas le checkout QA mutable sur 3017). |
| `--playwright-path` / `QA_PLAYWRIGHT_PATH`, `--chromium-path` / `QA_CHROMIUM_PATH` | Module `playwright` déjà installé, Chromium optionnel. |
| `--out` | Dossier de preuves, **hors dépôt Git** (refus sinon), créé en `0700`, fichiers `0600`. |
| `--stage-evidence` | JSON du pilote (`old_source`, `new_source`, `new_build_id`, `old_sw_sha256`, `new_sw_sha256`) ; toute divergence avec ce qui est observé sur disque est un refus de préflight. |
| `--dry-run` | Préflight complet (disques, SHA, hash des workers, port, Playwright, sortie) puis plan imprimé ; **aucun serveur lancé, aucun navigateur**. |

Codes de sortie : `0` tous les critères PASS et serveurs enfants arrêtés ; `1` au moins un FAIL ou un FATAL (plantage, signal) ; `2` refus de préflight ; `3` un serveur enfant n'a pas pu être arrêté (PID encore vivant ou port encore lié après l'arrêt) — jamais de « propre » si un orphelin subsiste.

## 3. Préflight (rien n'est lancé avant que tout passe)

1. Deux dossiers distincts, chacun avec `.next/BUILD_ID`, `public/sw.js`, `public/offline.html`, `node_modules/next` résolu (lien symbolique accepté). SHA de `HEAD` = `--old-sha` / `--new-sha`.
2. `public/sw.js` : SHA-256 calculé pour chaque build, **différents** ; version de cache extraite (`PUBLIC_CACHE_PREFIX` + `vN`), différentes, l'ancienne strictement inférieure à la nouvelle ; `BUILD_ID` lus et consignés.
3. `.env.local` (s'il existe) : seuls les **noms** de variables sont lus ; refus si un nom contient `SERVICE_ROLE`, `SECRET`, `PRIVATE` ou `TOKEN` (aucune valeur n'est lue, imprimée ni copiée). Le serveur enfant reçoit un environnement minimal (`PATH`, `HOME`, `TMPDIR`, `LANG`, `NODE_ENV=production`, `PORT`, `HOSTNAME`) : aucune variable du shell du pilote n'est transmise.
4. Port libre (aucun processus en écoute). Playwright importable depuis le chemin fourni. `--out` hors dépôt.
5. Si `--stage-evidence` est fourni : égalité des SHA sources, du `new_build_id` et des deux SHA-256 de worker ; `private_service_key_copied` doit être `false`.

## 4. Scénario (ordre d'exécution, chaque étape = PASS ou FAIL avec preuve)

Pilotage des serveurs : `node <dir>/node_modules/next/dist/bin/next start -p <port> -H 127.0.0.1` avec `cwd=<dir>`, PID consigné, sortie console copiée (redactée) dans `<out>/server-old.log` / `server-new.log`, attente de `GET /` 200 **et** `GET /sw.js` 200 ; arrêt par `SIGTERM` puis attente de la sortie du processus (escalade `SIGKILL` après le délai), puis vérification que le port n'est plus lié. Seuls les PID lancés par le runner sont arrêtés.

Navigateur : contexte Playwright avec `serviceWorkers: "allow"` (le contexte des suites de recette bloque le worker ; ici il est l'objet du test), `localhost` = contexte sécurisé. Deux onglets A et B. Vue : `/#demo/client-new` (démonstration explicite, aucun compte) ; le témoin « formulaire modifié » est la zone « Décrivez le problème » remplie d'un texte QA jamais soumis, plus un marqueur `window.__qaDocumentMarker` posé sur le document initial (toute disparition = rechargement).

| # | Étape | Attendu (sinon FAIL) |
| --- | --- | --- |
| 1 | serveur ANCIEN prêt | `/` 200 ; `/sw.js` 200, `Content-Type` JavaScript, `Cache-Control` sans mise en cache, corps contenant la version v2 et SHA-256 = fichier sur disque ; `/offline.html` 200 avec `X-Courant-Public-Offline: 1` ; `/manifest.webmanifest` 200 JSON (`display: standalone`, `scope: /`). |
| 2 | installation/activation réelle du worker v2 dans A et B | `navigator.serviceWorker.ready`, contrôleur non nul dans les deux onglets sans rechargement (`clients.claim`), script du contrôleur = `/sw.js` ; `caches.keys()` contient `courant-pwa-public-v2` ; entrées de ce cache = exactement `/offline.html`. |
| 3 | saisies non enregistrées | Textes distincts dans A et B, marqueurs posés, captures `tab-a-v2.png`, `tab-b-v2.png`. |
| 4 | aucune donnée privée en cache (v2) | Depuis A : `fetch('/api/workspace')` (anonyme → 4xx) et `fetch('/auth/callback')` ; puis énumération de **tous** les caches : aucune entrée dont le chemin commence par `/api`, `/auth`, `/_next/data`, aucune entrée autre que `/offline.html` dans les caches `courant-pwa-public-*`. |
| 5 | basculement à origine inchangée | Arrêt de l'ancien serveur (PID sorti, port libre), démarrage du nouveau sur le **même** port ; `/sw.js` contient v3 et SHA-256 = fichier nouveau ; `BUILD_ID` servi ≠ ancien (lecture du dossier `.next` du nouveau build). Les onglets restent ouverts, leurs contrôleurs inchangés. |
| 6 | nouvelle version **en attente** tant qu'aucun consentement | `registration.update()` depuis A ; dans A **et** B : `registration.waiting.state === "installed"`, contrôleur identique au précédent (`controller === ancien`), marqueur présent, texte saisi intact, bouton « Recharger maintenant » visible avec le texte « Une nouvelle version est disponible. Enregistrez vos saisies avant de recharger. » ; **aucun** rechargement automatique (attente ≥ 3 s puis revérification). Captures `tab-a-waiting.png`, `tab-b-waiting.png`. |
| 7 | consentement explicite dans A seulement | Clic « Recharger maintenant » dans A → navigation de A (marqueur absent, nouveau contrôleur, `fetch('/sw.js')` v3) ; dans B : **pas** de navigation (marqueur présent, texte intact), contrôleur devenu le nouveau (`clients.claim`), bouton de mise à jour toujours proposé. Capture `tab-b-after-a-update.png`. |
| 8 | caches v2 → v3 observés | `caches.keys()` contient `courant-pwa-public-v3` et **plus** `courant-pwa-public-v2` ; un cache tiers posé par le test (`qa-other-cache-preserve`) est conservé puis supprimé par le test ; entrées du cache v3 = `/offline.html` seulement. |
| 9 | consentement explicite dans B (onglet périmé) | Clic sur le bouton de B → rechargement effectif de B (marqueur absent), bouton « Actualisation… » non bloqué (absent après rechargement), B contrôlé par v3. Capture `tab-b-after-explicit-reload.png`. |
| 10 | page hors ligne réelle (v3) et reprise | `context.setOffline(true)` ; navigation de A vers `/#demo/client-new` → réponse servie par le worker : titre « La connexion est indisponible », texte « Aucun dossier personnel n'est enregistré… », lien « Réessayer » ; capture `offline-v3.png` ; `setOffline(false)` ; navigation → application de nouveau rendue (titre de la vue démo), capture `online-again-v3.png`. |
| 11 | aucune donnée privée en cache (v3) | Même énumération qu'en 4 après les sondes `/api/workspace` et `/auth/callback` : seulement `/offline.html`. |
| 12 | console et débordement | Aucune `pageerror` ni message console `error` dans A/B pendant les phases **en ligne** (les échecs réseau attendus pendant la phase hors ligne sont consignés à part, étiquetés `offline-expected`) ; `scrollWidth ≤ viewport + 1` à 360 et 1280 px sur la vue démo (helper existant). |
| 13 | arrêt du nouveau serveur | PID sorti, port libre : sinon code `3`. |

Comparaison v2/v3 : les clés de cache, les entrées, les SHA-256 des workers servis et les `BUILD_ID` sont **observés** et écrits dans `result.json` (`versions.old`, `versions.new`), pas déduits des libellés du harnais.

## 5. Preuves, redaction, cycle de vie

`<out>/` (`0700`) : `result.json` (étapes, statuts, détails, versions observées, PID et horodatages des serveurs, erreurs console classées), `summary.md`, `server-old.log`, `server-new.log`, captures PNG, `console-a.ndjson`, `console-b.ndjson`. Tout texte passe par le redactor (`lib/redact.mjs`) : aucune valeur d'`.env`, aucun cookie, aucun jeton (il n'y en a pas : aucun compte). `result.json` et `summary.md` sont réécrits après chaque étape. Les gestionnaires `SIGINT`/`SIGTERM`/`unhandledRejection`/`uncaughtException` passent par la finalisation idempotente de `lib/lifecycle.mjs` : fermeture du navigateur, **arrêt des serveurs enfants**, écriture des résultats, code `1` (ou `3` si un serveur ne s'arrête pas) ; jamais d'orphelin silencieux, jamais de résultat réécrit en PASS.

## 6. Honnêteté du rapport

Le rapport d'exécution (section 7, ajoutée après coup) distingue ce qui a été **exécuté** par Claude (tests unitaires, `node --check`, `--dry-run`, et, si autorisé, une exécution locale réelle contre les deux builds du pilote avec les preuves listées) de ce qui est seulement **scripté**. Deux builds locaux servis successivement ne sont pas deux previews déployées ; aucune preuve d'installation OS/iOS/Android ni de paiement n'en découle. Un critère en échec est un FAIL rapporté avec sa preuve, jamais une ANOMALY transformée en PASS.
