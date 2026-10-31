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
- Ticket d'un manager de cohorte lié à un dossier de site ; réponse et statut opérateur via vrais RPC ; notifications du seul créateur. Retrait de portée de site via commande propriétaire : ticket, notifications/listes/comptes/marquage refusés/masqués selon contrat. Ticket personnel sans dossier contraste : lisible/notifiable après ce retrait. Historique support conservé jusqu'au cleanup, pas de suppression pour simuler la révocation.
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
