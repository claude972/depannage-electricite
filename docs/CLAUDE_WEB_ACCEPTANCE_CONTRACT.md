# WEB-ACCEPTANCE-TESTS-001 — contrat des tests de recette navigateur

Mission MISSIONS.md « WEB-ACCEPTANCE-TESTS-001 ». Branche `claude/web-pwa-qa`, base `309ed9f`. Ce contrat est publié **avant** le code de `scripts/qa/**`. Il décrit ce que les scripts font, ce qu'ils exigent, ce qu'ils prouvent et ce qu'ils ne prouvent pas. Les scripts sont écrits par Claude ; Codex les exécute avec les paramètres et secrets fournis seulement à l'exécution, sans modifier le code de test.

Fichiers possédés par cette mission : `scripts/qa/**`, ce contrat, `docs/CLAUDE_WEB_ACCEPTANCE_REPORT.md`. Aucun fichier applicatif, `package.json`, migration ou secret n'est touché. Aucune dépendance n'est installée dans le dépôt : Playwright est injecté depuis un module déjà installé ailleurs.

## 1. Interface en ligne de commande

```
node scripts/qa/run.mjs \
  --base-url <url> \
  --sha <sha git attendu> \
  --project <ref du projet Supabase attendu> \
  --credentials <chemin json privé> \
  [--suite <nom>]... [--headless | --no-headless] [--out <dossier>] \
  [--playwright-path <dossier du module playwright>] [--chromium-path <exécutable>] \
  [--app-dir <checkout qui sert base-url>] [--allow-base-url <origine>]... \
  [--keep-fixtures] [--dry-run] [--json]
```

| Option | Rôle |
| --- | --- |
| `--base-url` | Origine de l'application testée. Refus si elle n'est ni locale (`http://localhost`, `http://127.0.0.1`, tout port) ni explicitement autorisée par `--allow-base-url` ou `allowed_base_urls` du fichier de credentials. Les origines non locales sont étiquetées `remote-allowed` dans toutes les preuves ; elles ne deviennent jamais une « preview réputée réussie ». |
| `--sha` | SHA git complet (40 hex) de la révision que le pilote déclare servie. Il nomme le dossier de sortie et figure dans chaque preuve. Avec `--app-dir`, le runner exécute `git -C <app-dir> rev-parse HEAD` et **refuse** de continuer si le résultat diffère. Sans `--app-dir`, le SHA est enregistré comme « déclaré par le pilote, non vérifié ». |
| `--project` | Ref du projet Supabase dédié attendu (ex. 20 caractères). Refus si ce ref ne correspond pas au `supabase.project_ref` du fichier de credentials **et** au sous-domaine de `supabase.url`. Pendant l'exécution, chaque connexion navigateur vérifie que le cookie `sb-<ref>-auth-token` apparaît : l'application servie utilise bien ce projet, sinon le scénario échoue avant toute écriture. |
| `--credentials` | Chemin d'un fichier JSON privé (voir §2). Jamais copié, jamais journalisé. Obligatoire sauf si la seule suite demandée est `captures` (démonstration locale sans compte). |
| `--suite` | Répétable. Par défaut toutes les suites de §5 dans l'ordre listé. |
| `--headless` / `--no-headless` | Chromium headless par défaut. |
| `--out` | Dossier des preuves. Défaut : `<tmpdir>/depannage-qa/<sha12>-<runId>/`. Jamais dans le dépôt : aucune donnée QA ne doit rejoindre le bundle ou un commit. |
| `--playwright-path` / `QA_PLAYWRIGHT_PATH` | Dossier d'un module `playwright` déjà installé (contenant `package.json` et `index.mjs`). Le runner l'importe par URL de fichier ; il n'exécute jamais `npm install`. |
| `--chromium-path` / `QA_CHROMIUM_PATH` | Exécutable Chromium optionnel si le cache Playwright de la machine ne contient pas la révision attendue. Aucun chemin personnel n'est figé dans le code. |
| `--keep-fixtures` | Ne pas nettoyer (diagnostic). Le manifeste reste disponible pour un nettoyage ultérieur via `node scripts/qa/run.mjs --cleanup-manifest <manifest.json> --credentials ... --project ...`. |
| `--dry-run` | Valide les arguments, le fichier de credentials (forme seulement), l'importabilité de Playwright, puis imprime le plan (suites, fixtures prévues, ordre de nettoyage, dossier de sortie) et s'arrête **sans aucun appel réseau**. |
| `--json` | Résumé final en JSON sur stdout en plus de `result.json`. |

Codes de sortie : `0` aucun FAIL (des ANOMALY peuvent exister, le résumé les liste) ; `1` au moins un scénario FAIL ; `2` refus de préflight (arguments, projet, URL, SHA, Playwright) ; `3` nettoyage incomplet (données de cohorte restantes ou readback impossible) même si les scénarios ont réussi.

## 2. Fichier de credentials

JSON lu une fois, en mémoire seulement. Recommandé en mode `0600`, hors du dépôt. Forme :

```json
{
  "supabase": {
    "url": "https://<ref>.supabase.co",
    "project_ref": "<ref>",
    "service_role_key": "<clé service_role>"
  },
  "allowed_base_urls": ["http://localhost:3017"]
}
```

Règles :

- La clé `service_role` sert **uniquement** au semis des fixtures, aux lectures de contrôle (readback) et au nettoyage, via l'API REST/Auth admin/Storage de Supabase. Elle n'est jamais passée au navigateur, jamais écrite dans `--out`, jamais imprimée.
- Les mots de passe des comptes de test sont **générés par le runner** (aléatoires, 32 octets) pour des comptes créés par lui ; ils ne servent qu'à la connexion par formulaire dans le navigateur et ne sont jamais écrits sur disque. Aucun mot de passe d'utilisateur réel n'est attendu ni accepté.
- Les emails des comptes de test utilisent le domaine réservé `qa.invalid` : aucun email ne peut partir.
- Toute chaîne journalisée (console, `result.json`, `summary.md`, messages d'erreur Playwright) passe par la redaction : clé service, cookies `sb-*`, paramètres `access_token`, `refresh_token`, `token_hash`, `code`, en-têtes `Authorization`, mots de passe générés. Aucun HAR n'est enregistré ; les requêtes réseau sont résumées en `{méthode, chemin, statut}` sans en-têtes ni corps.
- Le runner refuse un fichier de credentials dont `project_ref` ou l'URL ne correspond pas à `--project`.

## 3. Cohorte de fixtures, manifeste, nettoyage

**Cohorte.** Chaque exécution tire un `runId` (12 hex). Toute donnée créée porte ce `runId` dans son nom, son email ou sa description : `qa-<runId>-<label>@qa.invalid`, `QA <RUNID> <label>`, descriptions `QA-<RUNID> ...`. Le marqueur permet de reconnaître la cohorte à l'œil ; il **n'est jamais utilisé comme critère de suppression**.

**Manifeste.** `--out/manifest.json` (mode `0600`) est réécrit après **chaque** création : `{run_id, sha, project, base_url, created: {auth_users:[ids], profiles:[ids], organizations:[ids], sites:[ids], interventions:[ids], quotes:[ids], documents:[ids], storage_paths:[paths], support_tickets:[ids], ...}}`. Les identifiants créés indirectement par l'application pendant un scénario (dossier créé par le formulaire, pièce déposée, ticket créé, devis publié, brouillon) sont relus par identifiant de propriétaire/dossier de la cohorte et ajoutés au manifeste avant le nettoyage.

**Nettoyage.** Exécuté en `finally`, même après un échec, par listes d'identifiants exacts du manifeste (filtres `in.(...)`), jamais par motif de nom, jamais par date, jamais « toute la table ». Ordre respectant les clés étrangères :

1. `support_events`, `support_messages`, `support_tickets` (par `ticket_id` / `id`) ;
2. `quote_drafts` (par `intervention_id`) ;
3. objets Storage du bucket `intervention-documents` (chemins exacts des `documents` de la cohorte) puis `documents` ;
4. `messages`, `intervention_operation_events`, `intervention_appointments`, `intervention_reports`, `quotes`, `audit_log` (par `intervention_id`), `interventions` ; puis `audit_log` et `action_limits` par `actor_id` de la cohorte ;
5. `organization_member_site_grants`, `organization_member_site_scopes`, `organization_invitations`, `organization_membership_events`, `professional_audit`, `approvals`, `approval_rules`, `compliance_records`, `contracts`, `organization_members`, `sites`, `organizations` ;
6. `artisan_credentials`, `artisan_profiles`, `profiles` ;
7. utilisateurs Auth (API admin), un par un.

Après chaque étape : **readback** `count=exact` sur les mêmes identifiants, attendu `0` ; pour Auth, `GET admin/users/<id>` attendu 404 ; pour Storage, liste du préfixe utilisateur attendue vide. Toute suppression ou readback en échec est consigné dans `cleanup.json` avec la table, les identifiants restants et l'erreur ; le runner termine alors en code `3` et le résumé indique « nettoyage incomplet : intervention manuelle requise ». Aucune autre cohorte, aucun compte existant n'est jamais lu pour suppression.

## 4. Préflight et refus

Le runner refuse de démarrer (code `2`, rien créé) si : `--sha` n'est pas un SHA complet ; `--app-dir` donné et `HEAD` différent ; `--project` ne correspond pas aux credentials ; `--base-url` ni locale ni autorisée ; le module Playwright n'est pas importable depuis le chemin injecté ; Chromium ne se lance pas ; `--out` est à l'intérieur du dépôt git. Après démarrage, la première connexion navigateur vérifie le cookie `sb-<ref>-auth-token` et l'identité `/api/workspace.profile.id` du compte créé ; en cas d'écart, la suite est marquée FAIL « application reliée à un autre projet » et le nettoyage s'exécute.

## 5. Scénarios, comportement attendu, classification

Chaque scénario produit `PASS`, `FAIL` ou `ANOMALY` avec `evidence: [chemins]` (captures PNG, extraits JSON de readback, résumé réseau). Règle de classification :

- **FAIL (défaut applicatif présumé)** : une assertion sur l'état attendu échoue — élément d'écriture présent pour un rôle sans droit, requête `POST` émise alors qu'elle ne doit pas l'être, doublon en base, navigation/notice pour la mauvaise identité, version/409 non respectés, contenu absent après pagination, débordement horizontal. Un contrôle que l'application **doit** afficher et qui n'apparaît pas dans le délai est aussi un FAIL (`expectVisible` avec attente longue), car l'absence est le comportement testé.
- **ANOMALY (sélecteur / headless / environnement)** : échec Playwright hors assertion — délai dépassé sur un clic ou un remplissage, violation de mode strict (plusieurs éléments), cible fermée, lancement navigateur, exception réseau du harnais. Le scénario s'arrête, la preuve est conservée, le readback serveur est tout de même consigné, et le résumé demande une vérification manuelle : une anomalie **peut** cacher un défaut applicatif mais n'en est pas la preuve.
- Les readbacks serveur (REST service_role) sont étiquetés `server` dans la preuve, distincts des observations `browser`.

Suites, dans l'ordre d'exécution par défaut :

**`viewer-site-grants`.** Fixtures : organisation avec sites A et B, owner (profil manager, membre owner), manager à portée `selected` (écriture sur A seulement), viewer (portée `all`), un dossier par site créé au nom de l'owner. Attendu : (a) viewer connecté — `#members` affiche « Votre rôle : Lecture », `#site/<A>` n'offre ni « Nouvelle demande » ni éditeur de budget, aucun bouton « Accès aux sites », « Retirer », « Transférer la propriété » ; pendant toute la navigation **aucune requête `POST /api/*` n'est émise** (le 403 serveur n'est jamais sollicité par l'interface) ; sonde `server` : `POST /api/professional set_site_budget` depuis la page du viewer → 403 et budget inchangé. (b) manager `selected` — `#sites` ne montre que A, « Nouvelle demande » présent sur A, `#detail/<dossier B>` n'affiche pas le dossier ; `GET /api/workspace` ne contient que A et son dossier ; aucune `POST` pendant la navigation. (c) owner — `#members` montre « Accès aux sites » et « Retirer » pour les membres non owner, `#site/<B>` montre l'éditeur de budget.

**`support-stale-a-b`.** Fixtures : clients A et B. Déroulé dans un seul onglet : A ouvre `#support/new`, saisit sujet et message, envoie. La requête `POST /api/support` est exécutée immédiatement vers le serveur (commit au nom de A) mais sa **réponse est retenue** par le harnais ; pendant ce temps A se déconnecte (bouton réel) et B se connecte par le formulaire ; la réponse retenue est alors délivrée. Attendu : aucune navigation vers `#support/<id>`, aucune notice « Demande d'assistance enregistrée », aucune erreur affichée pour B ; `#support` de B liste 0 ticket ; `sessionStorage` ne contient plus de clé `courant-support-pending-*` de A ; `server` : exactement un ticket de A avec cet objet, un message, un événement.

**`support-lost-response`.** Fixture : client C. Déroulé : C envoie une demande ; la requête est exécutée (commit) puis la réponse est **perdue** (abort réseau). Attendu : message d'erreur « connexion interrompue… rechargez », texte conservé ; après navigation `#support` → `#support/new` (remount) le formulaire est pré-rempli ; après **rechargement complet** de la page et retour sur `#support/new`, pré-rempli à nouveau ; renvoi → réponse `replayed:true`, notice « déjà été enregistrée ; aucun doublon créé », navigation vers le ticket ; `server` : un seul ticket pour C, un message, un événement, même `client_request_id` que la première tentative (capturée côté harnais dans le corps sortant, sans en-têtes).

**`quote-draft`.** Fixtures : artisan approuvé (profil + dossier `approved`), client, dossier `assigned` à l'artisan. Attendu : `#mission/<id>` montre « Établir le devis » ; saisie d'une ligne, TVA 20 %, « Enregistrer le brouillon » → statut « Brouillon enregistré le … » ; rechargement complet → lignes restituées depuis le serveur ; une sauvegarde concurrente (fetch depuis la page avec la version courante, simulant un autre onglet) puis « Enregistrer le brouillon » depuis l'interface avec une saisie différente → alerte « Brouillon modifié depuis votre dernière lecture », saisie conservée, « Recharger le brouillon » → comparaison « Votre saisie » / « Version enregistrée », « Conserver ma saisie » → enregistré sous la nouvelle version ; « Envoyer le devis au client » → `server` : un devis `sent` créé, `quote_drafts.state='sent'` et `published_quote_id` égal à ce devis, aucun doublon ; `browser` : la référence `DEV-xxxxxx` de ce devis exact est sélectionnée (`aria-pressed`) dans « Versions du devis ».

**`photos-recovery`.** Fixture : client D. Déroulé 1 : demande avec deux photos, la deuxième refusée (422 fabriqué avant d'atteindre le serveur) → un seul dossier créé, une pièce ; « Réessayer les 1 photo refusée » renvoie **seulement** la photo refusée → deux pièces, toujours un dossier. Déroulé 2 : nouvelle demande avec une photo dont la requête atteint le serveur mais la réponse est perdue → état `uncertain`, aucun renvoi automatique ; « Vérifier le dossier » liste la pièce de même nom comme candidate avec « C'est bien cette photo » ; confirmation explicite → état `done`, **aucune** requête supplémentaire ; `server` : deux dossiers au total pour D, trois pièces, aucun doublon de dossier ni de pièce. Le bouton « Renvoyer les photos incertaines » est constaté présent mais non actionné (il créerait volontairement un doublon possible).

**`admin-old-dossiers`.** Fixtures : admin synthétique de cohorte (profil `role=admin` posé par service_role, supprimé au nettoyage), client F, 120 dossiers de F à `created_at` décroissants distincts, le plus ancien portant un marqueur. Attendu : `#admin-interventions`, « Dossiers par page » = 100, le total affiché est ≥ 120, « Suivant » jusqu'à la ligne `INT-<6 hex>` du plus ancien (borne : 50 pages), « Ouvrir » → détail lu via `/api/admin/interventions?id=` affichant la description marquée. Si la ligne n'est pas atteinte, FAIL.

**`captures`.** Sans compte ni credentials : démonstration locale `#demo/artisan` (vue d'ensemble artisan, M35), `#demo/admin` (tableau de bord, M43), `#demo/manager-requests` (table entreprise, M66), en 360 et 1280 px. Attendu : aucun débordement horizontal (`scrollWidth ≤ viewport+1`), titres attendus visibles ; captures pleine page nommées `<vue>-<largeur>.png` pour comparaison visuelle **humaine** avec les maquettes. La fidélité aux maquettes n'est pas jugée par le script.

## 6. Preuves et rapport

`--out/` contient : `result.json` (scénarios, étapes, statut, durée, preuves, réseau résumé, `target: local|remote-allowed`, `sha`, `sha_verified`, `project`), `manifest.json`, `cleanup.json`, `summary.md`, captures PNG. Chaque preuve est rattachée au SHA et à la cible testée. Le rapport humain `docs/CLAUDE_WEB_ACCEPTANCE_REPORT.md` décrit ce qui a été exécuté par Claude (sans secrets : vérifications syntaxiques, `--dry-run`, tests unitaires) et ce que Codex doit lancer avec les vrais paramètres. Aucun résultat des outils temporaires d'avant minuit n'est réutilisé comme preuve.

## 7. Ce que ces scripts ne prouvent pas

- **Vercel Preview / protection de déploiement** : aucune URL de preview n'est supposée, aucun jeton de contournement n'est accepté ; une origine distante autorisée est testée comme telle, sans en déduire un déploiement réussi.
- **Stripe** : aucun paiement, Checkout, webhook ou Connect n'est exercé ; les dossiers restent avant règlement.
- **PWA au niveau OS** : installation réelle, service worker sur appareil, notifications, deux déploiements successifs ne sont pas couverts (le navigateur headless bloque le service worker pour éviter les caches entre scénarios).
- **Email** : aucun email n'est envoyé ni vérifié (domaine `qa.invalid`, comptes confirmés par API admin).
- **Concurrence Postgres réelle entre deux sessions humaines** : le 409 est provoqué par une commande concurrente émise depuis la même session navigateur ; les tests SQL/RPC de concurrence restent ceux des vérifications backend.
- **Fidélité visuelle aux maquettes** : les captures servent à la comparaison humaine, le script ne mesure que le débordement et la présence des titres.
- **Rôles non couverts** : artisan suspendu, réaffectation pendant l'édition, invitations par code et transfert de propriété ne sont pas dans ces suites.
