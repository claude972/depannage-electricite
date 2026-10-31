# CODEX-PLANNING-QA-001 — contrat de recette avancée

Base `c92f4de4719fc4cd9ea79a9ec1181400e8130a41`, branche `codex/planning-qa`. Propriété A4 publiée sur `missions/web-pwa`, confirmée par le lead Claude à15:54:08Z (`d6ac5fb`). Ce contrat est poussé avant le code. Codex possède seulement `scripts/qa-advanced/**`, `tests/qa-advanced*.test.ts` et ce document ; les helpers `scripts/qa/**` restent lus/importés sans modification.

## Plan et décision

1. Harnais Node24 sans installation : préflight strict, fonctions pures testables, client HTTP utilisateur/administration séparés, cohorte/manifestes, stop/drain/nettoyage.
2. Recette API réelle planning/notifications (HTTP Next et RPC sous JWT utilisateur), y compris deux requêtes concurrentes réellement envoyées avec `Promise.all` ; jamais remplacer cette preuve par PGlite.
3. Recette navigateur injectée via Playwright déjà installé : connexion formulaire, planning/notifications raccordés, états/rôle/erreurs et captures360/1280. Aucun appel réel exécuté par l'auteur ; le pilote exécutera après revue de016 et du SHA intégré.

Contrats serveur lus : `docs/CLAUDE_ADV_PLANNING_CONTRACT.md` amendementA1 (`8574b78`), API/SQL corrigés `b26bc450df683484569a63da1c042fa14d3da353`. Le harnais n'applique aucune migration, ne déploie rien et n'effectue aucune opération finance/ledger/audit financier immuable.

## Interface CLI prévue

```
node scripts/qa-advanced/run.mjs --base-url http://localhost:3017 \
  --sha <40hex-SHA-servi> --app-dir <checkout-servi> \
  --project kcpyjzndybfdlnhvscbs --credentials <json-privé-0600> \
  --out <dossier-hors-dépôt> [--suite api|browser|all] \
  [--playwright-path <module>] [--chromium-path <exécutable>] \
  [--timeout-ms 120000] [--allow-base-url <origine>] [--dry-run]

node scripts/qa-advanced/run.mjs --cleanup-manifest <manifest.json> \
  --project kcpyjzndybfdlnhvscbs --credentials <json-privé-0600> --out <nouveau-dossier>
```

Défaut `--suite all`. `--dry-run` valide sans réseau et sans cohorte. Aucune dépendance installée par le script. `--app-dir` obligatoire pour une exécution afin de vérifier HEAD contre `--sha` ; une preuve locale est étiquetée locale, jamais preview déployée. Les origines distantes exigent une allowlist explicite. Refus des credentials autres que le projet/Supabase exacts, des fichiers lisibles par groupe/autres, et des sorties dans un checkout Git. Les paramètres sensibles ne sont jamais transmis sur la CLI.

Credentials (même enveloppe que le harnais existant, clé publique obligatoire pour RPC utilisateur) :

```
{"supabase":{"url":"https://<ref>.supabase.co","project_ref":"<ref>","publishable_key":"<public>","service_role_key":"<server>"},"allowed_base_urls":[]}
```

La clé serveur sert exclusivement aux fixtures/lectures de contrôle/nettoyage, jamais au navigateur ni aux commandes utilisateur. Les sessions de cohorte sont obtenues avec des comptes confirmés `qa.invalid`, mots de passe et tokens générés en mémoire et enregistrés auprès du redactor existant avant toute trace. Pas d'email, SMS, push, HAR, secret de bypass ou Stripe. Le navigateur se connecte via le formulaire réel.

## Scénarios API

- ArtisanA/B/tiers/client : règles et entrées privées, écriture client/non propriétaire refusée, disponibilité récurrente + exception + créneau occupé, version périmée409 et idempotence même clé sans doublon. Suspension posée seulement sur le compte technique de cohorte : lecture conservée/écriture refusée ; restauration de ce compte.
- Deux créneaux `busy` qui se chevauchent envoyés simultanément sous deux sessions du même artisan : un succès, un conflit, une ligne. Deux premières sauvegardes de préférences `expected_version:0` sous deux sessions : un succès, un conflit, version1 et contenu du gagnant conservé.
- Tickets d'un manager de cohorte, lié à un dossier de site et personnel sans lien : créations par leurs vrais RPC utilisateur. Notifications **techniques semées** par service_role, avec `support_ticket_id` réel, `actor_id:null` et clé de déduplication QA : cette recette teste RLS/liste/compte/marquage, **pas la génération des triggers opérateur**. Aucun profil admin de cohorte n'est créé (protection du dernier SuperAdmin après014). Retrait de portée de site via commande propriétaire : ticket et notification liés deviennent illisibles/non marquables ; ticket et notification personnels restent accessibles. Historique support conservé jusqu'au cleanup, pas de suppression pour simuler la révocation. La génération reply/status reste la preuve SQL isolée de Claude, pas une preuve live apportée ici.
- Les sondes intercomptes utilisent le JWT propre de l'acteur. Le chemin HTTP doit refuser l'anonyme ; les commandes utilisateur critiques sont exercées sous RLS/RPC et par HTTP via navigateur si disponible.

## Navigateur

Réutiliser en lecture seule les helpers de chargement Playwright/connexion et le redactor. Vérifier le projet dans le cookie Auth. Artisan connecté : route `#planning`, titre et formulaires du contrat disponibles, lecture/chargement réel ; notifications `#notifications`, contenu de cohorte et marquage confirmé ; aucun débordement360/1280. Suspension/tiers et erreurs réseau sont testés contre la vraie page, avec défaut de sélecteur distingué d'un défaut produit. Le contrat absent ou le raccordement non livré n'est jamais un PASS. Captures hors dépôt, pas de données d'un compte réel.

## Sécurité du cycle de vie et nettoyage

Manifestes atomiques0600 dans un dossier0700, réécrits après chaque création connue et **avant** l'appel suivant ; intentions/identifiants propriétaires de cohorte conservés pour les résultats incertains. Suppression par UUID/chemins exacts seulement, jamais recherche textuelle/cohorte/date comme filtre de suppression. Stop commun avant nouvelles écritures ; toutes les mutations déjà en vol sont enregistrées/drainées avant cleanup. SIGINT/SIGTERM et rejets non gérés déclenchent le même finalize idempotent ; si une opération reste inconnue/pending, manifeste conservé et nettoyage déclaré incomplet (pas de faux état propre).

Le cleanup relit les enfants créés pour les seuls utilisateurs/dossiers/sites manifestés, puis supprime dans l'ordre : notifications et préférences ; planning ; support events/messages/tickets ; enfants d'interventions ; interventions ; portées/membres/audits mutables de cohorte ; sites/organisations ; limites et profils artisan ; Auth en dernier. Pas de suppression d'audit/ledger financiers immuables. Chaque table et compte Auth reçoit une relecture d'absence ; indisponibilité≠zéro. Aucun objet Storage n'est nécessaire à ces suites. Le mode `--cleanup-manifest` reprend exactement la cohorte et refuse un projet étranger.

Sorties : `manifest.json`, `result.json`, `summary.md`, `cleanup.json`, traces expurgées et captures. Codes0 succès de tous critères exécutés et cleanup propre ;1 défaut/scénario incomplet ;2 préflight refusé ;3 cleanup incomplet. Un SIGINT interrompt le run même si récupération propre, sans le transformer en succès.

## Vérification prévue et limites

Tests unitaires significatifs sans réseau : refus projet/origine/SHA, manifeste borné/atomique, ordre et reprise cleanup, résultat inconnu non assimilé à absence, stop/drain et finalisation unique/signal, classification concurrence et idempotence. Commande : `node --test tests/qa-advanced*.test.ts` (Node24) ou binaire tsx existant.

Les recettes cloud/navigateur ne sont pas exécutées par cet agent. Aucun résultat PGlite ne vaut preuve de concurrence réseau. Les timers ne prouvent pas la fin d'un travail distant ; une mutation transport-incertaine conserve le manifeste et nécessite réconciliation. Vercel/Stripe et plateformes natives sont hors mission.

## Livraison à relire — code4be763abcf02fac040846164536f6a5255205763

Fichiers livrés : `scripts/qa-advanced/{core,run,scenarios}.mjs`, `tests/qa-advanced.test.ts`. Aucun helper historique, fichier applicatif, migration, package, verrou de dernier admin ou configuration fournisseur modifié.

Exécuté sans réseau :

- `node --test tests/qa-advanced.test.ts` : **13/13 PASS**, dont vraie exécution CLI `--dry-run` avec credentials factices et dépôt Git temporaire ; aucune clé imprimée.
- `node --check` des trois scripts : PASS.
- Vérification TypeScript ciblée des tests avec le compilateur déjà disponible, `--noEmit --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --types node --typeRoots <cache-existant>/@types` : PASS. Premier essai ad hoc NodeNext refusait `import.meta` en CommonJS ; commande corrigée pour correspondre au modeESNext/Bundler du dépôt, aucune dépendance/configuration changée.
- `git diff --check` : PASS. Node24 émet une note `MODULE_TYPELESS_PACKAGE_JSON` sur le fichier de test TS ; elle est non bloquante et ne justifie aucune édition du package hors propriété.

Préconditions d'exécution pilote : migration016 corrigée et revue (`b26bc45` ou descendant), application servie au SHA réellement vérifié, credentials0600 conformes au contrat. Les autres migrations peuvent être présentes : le harnais ne crée aucun admin et ne touche aucune facture/transaction/ledger/audit financier immuable.

### Exécution API/RPC d'abord, sans attendre les coques

```
node scripts/qa-advanced/run.mjs --base-url http://localhost:3017 \
  --sha <SHA-complet-servi> --app-dir <checkout-servi> \
  --project kcpyjzndybfdlnhvscbs --credentials <json0600> \
  --out <dossier-temporaire-hors-git> --suite api --dry-run
```

Après revue, retirer `--dry-run` pour la recette réelle. `--suite api` n'importe/lance pas Playwright et ne prétend pas tester le navigateur. Elle vérifie l'anonyme sur Next, puis les RPC/lectures sous les vrais JWT de la cohorte. Les deux races exigent un succès et un conflit ET un chevauchement mesuré des fenêtres HTTP ; une paire séquentielle échoue comme critère non exercé. Les traces conservent seulement méthode/chemin sans query/rôle technique/date/status, aucun corps/en-tête/session.

### Après assemblage UI seulement

Même commande avec `--suite all --playwright-path <module-playwright-existant>` (et `--chromium-path` si nécessaire). Le préflight vérifie l'import de Playwright avant toute création. `--suite browser` est un sous-ensemble séparé : crée sa cohorte et teste les vues/états/planning, mais la comparaison notifications liées/personnelles et son marquage nécessitent les fixtures de `--suite all`. Aucun sous-ensemble ne vaut exécution des critères omis.

Parcours navigateur écrits, **non exécutés** : login formulaire et vérification projet, GET privés, validation422, création d'une entrée par le vrai formulaire et contrôle serveur, captures360/1280, préférences/canaux indisponibles, suspension403 et lecture seule, panneGET injectée/réessai, refus client de planning privé ; en `all`, notifications après révocation et bouton de marquage de la notification personnelle. Les sélecteurs suivent les composants feuilles de `b26bc45` ; leur compatibilité avec les coques finales doit être constatée, pas déduite des tests purs.

### Résultats et reprise

`result.json` contient SHA application et SHA propre du harnais, suite/cible, étapes, temps/statuts des requêtes et non-preuves ; `summary.md`, `cleanup.json` et manifeste atomique0600 restent hors Git. Toutes les créations sont arrêtées avant le drain, puis les seuls enfants de la cohorte sont découverts avant suppression/readback. Les sources cleanup utilisent les vrais `actor_id`/`user_id` et les comptes exacts (une erreur/compte inconnu n'est jamais zéro).

```
node scripts/qa-advanced/run.mjs --cleanup-manifest <run>/manifest.json \
  --project kcpyjzndybfdlnhvscbs --credentials <json0600> --out <nouveau-dossier>
```

Si un résultat de mutation est inconnu (transport, réponse5xx, succès malformé) ou une intention ne s'est pas terminée, **aucune suppression n'est lancée** et exit3 conserve les identifiants/intention pour réconciliation du pilote. Ce mode ne prétend pas lever automatiquement une incertitude distante par un délai ; ne pas effacer les marqueurs d'incertitude sans contrôle opérateur. Un arrêt normal avec erreurs/scénarios refusés de manière certaine conserve une reprise idempotente du cleanup.

**Statut : prêt pour revue et exécution pilote, pas accepté cloud/navigateur.** Aucun déploiement, publication, email réel ni opération financière effectué par cet agent.
