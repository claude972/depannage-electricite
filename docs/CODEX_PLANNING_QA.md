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

Si un résultat de mutation est inconnu (transport, réponse5xx sans preuve SQL structurée de rollback, succès malformé) ou une intention ne s'est pas terminée, **aucune suppression n'est lancée** et exit3 conserve les identifiants/intention pour réconciliation du pilote. L'unique exception actuellement admise est HTTP500 provenant de l'endpoint PostgREST vérifié `/rest/v1/<table>` ou `/rest/v1/rpc/<fonction>`, avec objet `code:"P0002"` et message chaîne non vide : SQL `NO_DATA_FOUND`, transaction refusée de manière déterminée, sans renommer le statut500 en404. Auth/admin/token, Storage, routes Next et contextes inconnus ne bénéficient jamais de cette exception, même si leur corps contient P0002. Ce mode ne prétend pas lever automatiquement une incertitude distante par un délai ; ne pas effacer les marqueurs d'incertitude sans contrôle opérateur. Un arrêt normal avec erreurs/scénarios refusés de manière certaine conserve une reprise idempotente du cleanup.

**Statut : prêt pour revue et exécution pilote, pas accepté cloud/navigateur.** Aucun déploiement, publication, email réel ni opération financière effectué par cet agent.

## Correctif QA-ADV-001 — f766ab657c691fffd40e3a2729a40bcb5b9c68da

Le pilote a signalé un arrêt conservateur du harnais initial pendant la sonde d'un artisan tiers : `delete_availability_rule` lève SQL `P0002` lorsque la ligne appartient à autrui. PostgREST peut exposer ce rollback comme HTTP500, tandis que la route Next transforme cette erreur en404. Le harnais classait tous les5xx avant de parser le JSON et conservait donc la cohorte comme transport-incertaine. La recette interrompue reste historique et n'est pas annoncée réussie.

Correction limitée aux fichiers de cette mission : corps JSON parsé avant classification ; seul `500 + objet non-tableau + code P0002 + message chaîne non vide` est reconnu comme rollback déterminé. La preuve conserve `status:500` et `rollback_code:P0002`. Les assertions de refus propriétaire acceptent ce cas exact ainsi que403/404 ; aucun500 arbitraire, tableau, objet incomplet, autreSQLstate ou message texte contenant P0002 ne passe. Les502/503/504, transports interrompus et réponses nonJSON restent incertains. Aucune modification application/SQL et aucun effacement automatique des anciennes marques d'incertitude.

Vérifications après correction : **14/14 tests Node PASS**, trois scripts `node --check` PASS, typecheck cibléESNext/Bundler PASS, `git diff --check` PASS. Les nouveaux tests couvrent le refusP0002 avec conservation du statut500, les formes malformées et les autres5xx. Aucun cloud par cet agent ; le pilote réconcilie séparément la cohorte précédente avant cleanup et nouvelle exécution.

Restriction complémentaire demandée par le pilote : la classification reçoit désormais le contexte d'endpoint. L'exception ne s'applique qu'au namespace PostgREST relatif reconnu ; des tests négatifs supplémentaires couvrent Auth users/token, Next, Storage, URL externe et chemin contenant `..`. Les assertions de refus propriétaire vérifient elles aussi ce contexte.14/14 tests PASS après cette restriction ; aucune modification des anciens manifestes ou de données cloud.

## Correctif de projection préférences après recette pilote b91d5e5

Le pilote rapporte trois cas planning réussis (dont paire HTTP concurrente créneaux avec un seul commit et suspension en lecture seule), puis un refus de lecture avant la première race de préférences. Cause du harnais : la projection par défaut `id` était utilisée sur `notification_preferences`, dont la clé est `user_id`. La sonde de ligne absente sélectionne désormais `user_id` explicitement ; la lecture du résultat de race sélectionnait déjà `version,muted_kinds` correctement. Tous les autres appels `db.select` ont été relus : règles/entrées/notifications/dossiers/organisations/sites/tickets ont bien leur colonne `id` ou une projection explicite adaptée. Le cleanup compte avec `select=*`/HEAD et n'avait pas cette erreur.

Les erreurs HTTP non2xx de `select` exposent maintenant uniquement table, statut et code SQL/PostgREST validé (alphabet majuscules/chiffres borné), avant d'exiger `Content-Range`. Aucun message brut, détail ou en-tête n'est journalisé. Pas de changement applicatif/SQL. Le run pilote reste partiel ; race préférences et support/révocation encore à exécuter. Le pilote rapporte cleanup14PASS et suppression des six comptes de cette cohorte ; aucune opération cloud effectuée par cet agent.

## Correction du statut RPC void après recette pilote d5ae664

Le pilote rapporte les cinq scénarios logiques précédents réussis, dont les deux vraies paires HTTP concurrentes (créneaux et premières préférences : un commit/un conflit, préférencesversion1 relue), avant un arrêt sur le statut attendu du retrait de portée. `set_organization_member_site_access` (009) retourne `void` : son HTTP204 observé constitue une confirmation explicite, pas une issue distante inconnue. L'appel exige désormais exactement204. Le helper de statut conserve une erreur explicite « observed204 expected200 » pour toute divergence, sans fabriquer un marqueur transport-incertain après une réponse connue. Les réponses illisibles de mutation et les créations sans identifiant conservent leur traitement incertain.

Toutes les autres signatures RPC utilisées ont été relues : `save_availability_rule`, `delete_availability_rule`, `save_planning_entry`, `delete_planning_entry`, `artisan_planning`, `intervention_free_slots`, `notification_summary`, `save_notification_preferences`, `mark_notifications` et `create_support_ticket` retournent JSON ; `create_intervention` retourne une ligne. Leurs succès restent explicitement attendus200, les refus P0002 gardent leur500 PostgREST documenté. Aucun élargissement global à tous les2xx. Le pilote rapporte un cleanup propre incluant organisation/site/dossier/deux tickets/six utilisateurs pour ce run interrompu ; cette recette reste partielle et non réexécutée par cet agent.
