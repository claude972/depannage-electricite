# QA-PREVIEW-ACCESS-001 — contrat : recette hébergée contre une preview Vercel protégée, par le seul cookie de protection

Statut : **contrat seulement, publié avant tout code ; aucune implémentation avant le GO de root.** Branche `claude/web-pwa-qa`. Propriétaire : Claude QA (cœur `scripts/qa/**`). Ce n'est pas du code produit : aucune modification de l'application, de la configuration Vercel ni de Supabase.

## 0. Objectif et principe

Exécuter la recette hébergée réelle (suites métier `scripts/qa/**`, suivi GPS `scripts/qa-advanced/**` ou équivalent, cycle PWA) contre **une** URL de déploiement preview Vercel protégée, en présentant **uniquement** le cookie de protection Vercel `_vercel_jwt` obtenu par ROOT via le partage de déploiement (7 jours). Pas de proxy, pas de monkeypatch global, pas de contournement de l'authentification applicative, pas de jeton de contournement (`x-vercel-protection-bypass`), pas de désactivation de la protection. Les comptes de recette continuent de se connecter par le vrai formulaire de l'application ; le cookie Vercel n'ouvre que la porte du déploiement.

## 1. Entrée : fichier d'état privé

Produit par ROOT depuis un **contexte navigateur neuf, dédié à la plateforme** (aucune session applicative), après ouverture du lien de partage de déploiement ; exporté hors dépôt. Le runner le lit, ne le copie jamais, ne l'écrit jamais.

Contrôles de fichier (refus ⇒ **exit 2**, message sans valeur) :
- chemin absolu **hors de tout dépôt Git** (même règle que `--out`) ; fichier régulier (pas de lien symbolique) ;
- propriétaire = utilisateur courant (`stat.uid === process.getuid()`) ; mode **exactement `0600`** (aucun bit groupe/autres, aucun exécutable) ;
- taille ≤ 16 KiB ; JSON UTF-8 valide.

Schéma **exact** (format `storageState` de Playwright, rien d'autre) :

```json
{
  "cookies": [
    {
      "name": "_vercel_jwt",
      "value": "<JWT>",
      "domain": "<hôte exact du déploiement, ex. depannage-electricite-abc123-team.vercel.app>",
      "path": "/",
      "expires": 1762300000,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
```

Règles de validation (toute violation ⇒ rejet de l'état **entier**, « état étranger », exit 2) :
- clés de premier niveau exactement `cookies` et `origins` ; `origins` **vide** (aucune entrée localStorage/IndexedDB) ;
- `cookies` contient **exactement un** élément, de nom exactement `_vercel_jwt` ; tout autre cookie (Supabase `sb-*`, analytics, autre nom, doublon) ⇒ rejet ;
- clés du cookie exactement `name, value, domain, path, expires, httpOnly, secure, sameSite` (aucun champ supplémentaire, aucun `partitionKey` inattendu) ;
- `domain` = **hôte exact** de `--base-url`, en minuscules, **sans point initial** (pas de domaine parent, pas de joker, pas de `vercel.app` nu) ; `path === "/"` ; `secure === true` ; `httpOnly === true` ; `sameSite` ∈ {`Lax`, `Strict`, `None`} ;
- `value` : JWT compact de trois segments base64url non vides (`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`), longueur 32–4096 ; la charge utile n'est **pas** utilisée pour l'autorisation (aucune vérification de signature côté QA) ; seule l'expiration du cookie fait foi ;
- `expires` : nombre fini en secondes Unix, **ni session (`-1`), ni passé** ; et `expires*1000 ≥ maintenant + --max-run-ms + marge 5 min` ; sinon exit 2 « accès preview expiré ou expirant pendant la recette » ;
- aucune présence, nulle part dans le fichier, de chaîne ressemblant à un secret interdit : `x-vercel-protection-bypass`, `service_role`, `sb_secret_`, `sb-…-auth-token`, `access_token`, `refresh_token` ⇒ rejet.

Interdits absolus : jeton Supabase Auth, clé service, secret de contournement Vercel, ou le cookie lui-même dans le code client, Git, `run.log`, `result.json`, `summary.md`, `events.ndjson`, `manifest.json`, `cleanup.json`, captures (métadonnées), messages d'erreur ou diagnostics.

## 2. Contraintes sur l'URL de base

- `--base-url` : origine nue `https://<hôte>` (pas de chemin, requête, fragment, identifiants, port non standard) ; schéma **https obligatoire** pour une preview ; hôte ∈ `*.vercel.app` **et** strictement égal au `domain` du cookie ; refus explicite de l'alias de production et de `main` (liste fournie par root, ex. domaine personnalisé et alias `depannage-electricite.vercel.app`) ;
- l'origine doit aussi figurer dans l'allowlist existante (`--allow-base-url` / `allowed_base_urls`) et sera étiquetée `remote-allowed` (`target`), jamais « preview réputée réussie » ;
- `--sha` reste vérifiable seulement par `--app-dir` ; à défaut, il est « déclaré ». (Option prévue, non implémentée sans GO : lire l'identifiant de déploiement/commit exposé par le déploiement si root en fournit une source fiable.)

## 3. Injection

**Navigateur** : `applyToContext(context)` appelle `context.addCookies([{ name, value, domain, path:"/", expires, httpOnly, secure:true, sameSite }])` avec l'**hôte exact** — jamais `url` d'un autre site, jamais domaine parent. Appelé une fois par contexte, avant la première navigation ; aucun `storageState` complet n'est chargé (seul l'objet validé est injecté).

**Node** : `sameOriginFetch(path, init)` — seul chemin Node autorisé à porter le cookie :
- `const url = new URL(path, baseOrigin)` ; si `url.origin !== baseOrigin` ⇒ exception (pas de requête) ; chemins absolus vers un autre hôte, `//autre`, schémas différents refusés ;
- ajoute l'en-tête `Cookie: _vercel_jwt=<value>` **uniquement** à cette requête ; refuse un `init.headers` contenant déjà `cookie`/`authorization`/`x-vercel-*` ; `redirect: "manual"` — une redirection vers une autre origine est une erreur (et vers l'origine de base, suivie au plus 3 fois avec la même vérification) ;
- usage réservé au **préflight même origine** (`/`, `/sw.js`, `/offline.html`, `/manifest.webmanifest`, `/api/workspace` anonyme 401, mesures d'en-têtes) ; jamais vers Supabase (`*.supabase.co`), IGN (`data.geopf.fr`), OSM/CDN, ni aucun tiers. Le client service Supabase existant (`lib/supabase.mjs`) n'est **pas** modifié et ne reçoit jamais ce cookie. Aucun `globalThis.fetch` remplacé.

**Garde de route navigateur (défense en profondeur)** : `context.route('**/*', …)` installé par le helper : toute requête sortante dont l'origine ≠ `baseOrigin` et qui porte la valeur du cookie (en-tête `cookie`, `authorization`, URL, corps texte) est **abandonnée** (`route.abort('blockedbyclient')`) et consignée comme **défaut** (`FAIL` de l'étape en cours, événement `preview-cookie-leak` sans la valeur) ; les autres requêtes continuent (`route.continue()` / `fallback`) sans altération. Le garde coexiste avec `safeRoute` existant et ne le remplace pas ; il est retiré par `stopBrowser`.

## 4. Redaction

Dès la lecture validée et **avant** tout journal, sortie, diagnostic ou capture : `redactor.add(value)`, plus chacun des trois segments du JWT et la valeur encodée en URL (`encodeURIComponent`). Les messages d'erreur du helper ne citent jamais la valeur (seulement « cookie `_vercel_jwt` pour <hôte>, expire le <date ISO> »). Le chemin du fichier d'état peut être journalisé ; son contenu jamais. Les captures d'écran ne contiennent pas de cookie (non affiché par l'application) ; leurs métadonnées ne portent que nom de fichier et horodatage.

## 5. API prévue (`scripts/qa/lib/preview-access.mjs`, cœur QA)

```js
/** Valide le fichier d'état et retourne un handle; lève PreflightError (exit 2) sinon. */
loadPreviewAccess(path, { baseOrigin, maxRunMs, redactor, now = Date.now() })
  // -> { host, expiresAt, applyToContext(context), sameOriginFetch(path, init), guard(context, onLeak), describe() }
applyToContext(context)          // addCookies exact-host, une fois
sameOriginFetch(path, init = {}) // fetch même origine + Cookie, redirect manual
guard(context, onLeak)           // garde de route défense en profondeur
describe()                       // { host, expires_at } — jamais la valeur
```

Raccordement : option CLI `--preview-access <fichier>` dans `scripts/qa/run.mjs` (cœur QA) ; elle exige `--base-url` https de preview, l'allowlist (`allowBaseOrigin`) et `--max-run-ms` (défaut = `--timeout-ms × nombre d'étapes`, plafonné) ; sans l'option, le comportement actuel est strictement inchangé. Le runner PWA (`scripts/qa-pwa-lifecycle.mjs`) ne vise que des serveurs locaux : hors périmètre tant que root ne demande pas un mode preview (qui exigerait un contrat séparé : pas de « deux builds » sur une preview).

### Propriété (aucune édition concurrente)

| Élément | Propriétaire | Moment |
| --- | --- | --- |
| `scripts/qa/lib/preview-access.mjs`, `scripts/qa/tests/preview-access.test.mjs`, option `--preview-access` de `scripts/qa/run.mjs`, ce contrat | Claude QA (cœur) | après GO root |
| Appels dans `scripts/qa-advanced/**` (suivi/planning) | worker Codex propriétaire de ces fichiers | après livraison et revue du helper, dans ses seuls fichiers |
| Appels dans d'autres harnais métier (s'il en existe hors `scripts/qa/**`) | leur propriétaire respectif | idem |
| Export du fichier d'état, partage de déploiement, liste des alias interdits | ROOT | avant la recette |

Les workers n'ajoutent que l'import du helper et l'appel (`--preview-access`, `allowBaseOrigin`) ; ils ne modifient pas le helper.

## 6. Tests prévus (hors réseau, `node --test scripts/qa/tests/preview-access.test.mjs`)

1. État valide minimal → handle ; `describe()` sans valeur.
2. **État étranger** : cookie supplémentaire, nom différent, doublon, `domain` parent (`.vercel.app`), autre hôte, joker, `path ≠ /`, `secure:false`, `httpOnly:false`, champ supplémentaire, `origins` non vide / localStorage, clé de premier niveau supplémentaire, chaîne de secret interdite → rejet exit 2.
3. Fichier : mode ≠ 0600, propriétaire différent (simulé), lien symbolique, chemin dans le dépôt, taille excessive, JSON invalide → rejet.
4. Expiration : cookie de session, passé, expirant avant `maintenant + maxRunMs + 5 min` → exit 2 ; juste au-delà → accepté.
5. Base : `http://`, hôte ≠ `domain`, alias de production interdit, chemin/requête/port → rejet.
6. `applyToContext` sur un faux contexte : un seul cookie, hôte exact, `secure`, chemin `/` ; jamais de domaine parent.
7. `sameOriginFetch` : chemin relatif OK (en-tête Cookie présent) ; URL absolue d'une autre origine, `//autre`, `https://xyz.supabase.co`, `https://data.geopf.fr` → exception **sans appel** au faux fetch ; redirection vers une autre origine → erreur ; en-têtes `cookie`/`authorization` fournis → refus.
8. Garde de route (faux `route`) : requête vers une autre origine portant la valeur (en-tête, URL, corps) → `abort` + `onLeak` sans valeur ; même requête sans la valeur → `continue` ; requête même origine → `continue`.
9. **Capture de secret** : exécuter chargement, injection, refus et garde avec un redactor réel et un faux `writeFile`/`stdout` ; vérifier que ni la valeur, ni un segment, ni sa forme encodée n'apparaissent dans les journaux, `result.json`, `summary.md`, `events.ndjson` ni les messages d'erreur.
10. Sans `--preview-access` : chemins existants inchangés (tests actuels verts, dry-run identique).

## 7. Hors périmètre / interdit

Désactiver ou affaiblir la protection du projet ; viser `main` ou la production ; proxy (local ou distant) ; remplacer `globalThis.fetch` ou patcher Playwright ; tout jeton de contournement (`x-vercel-protection-bypass`, `x-vercel-set-bypass-cookie`) ; réutiliser un état contenant une session applicative ; contourner l'authentification Supabase ; envoyer le cookie à un tiers ; stocker le cookie dans le dépôt, la CI ou les sorties. Aucun accès cloud ni lecture de credential par ce contrat ; l'exécution réelle relève de root avec un état fourni par root.

## 8. Ce que ce contrat ne prouve pas

Le partage Vercel, la durée réelle du cookie, le comportement de la protection sur les sous-ressources (`/_next/static`, `/sw.js` sous contrôle du service worker) et l'enregistrement du service worker sur une preview protégée restent à constater en direct par root ; un éventuel échec d'installation du worker derrière la protection sera rapporté comme constat, pas contourné.
