# Revue indépendante QA tracking

SHA exact : **8a8441dbeb2e2d173d922e52a6ccf428aa79077f**. Worktree auteur `/Users/claudebrafa/.codex/worktrees/depannage-claude-planning` non modifié ; sources committées exportées dans `/private/tmp/depannage-tracking-review-8a8441d-iMNGzP`. Aucune lecture de credentials, aucun appel cloud, mutation applicative ou nouveau script de test écrit.

**Verdict : pas prêt pour recette cloud à ce SHA ; quatre P2 ci-dessous.** Les correctifs 5xx/drain demandés sont bien présents et leurs reproductions existantes passent ; cela ne ferme pas les défauts de preuve/néttoyage restants.

## Vérification effectuée

22 tests existants PASS :14 unités tracking +5 tests de barrière, avec VRAI Chromium headless et serveur HTTP local pour les quatre premiers, +3 tests fournisseur par injection (aucun appel IGN). Aucun test sauté. Notamment : 503 différé conserve l’intent inconnu ; commit puis réponse perdue est réconcilié par effet positif ; SIGINT attend API et mutation navigateur en vol ; délai de drain avec producteurs en attente refuse toute suppression et lecture Auth ; arrêt pendant ouverture de session empêche login/écriture après await. Fournisseur429 injecté et refus hôte externe passent.

Les modules réellement utilisés sont `guard.mjs`, `intents.mjs`, `finalize.mjs`, `reconcile.mjs` et `TrackingFixtures/createSessionPool` ; pas seulement des regex de source. Trois probes supplémentaires EN MÉMOIRE, sans nouveau fichier test ni réseau, ont exécuté les exports exacts pour les constats suivants. Les tests existants restent verts malgré ces défauts.

## P2 — Lecture Auth invalide assimilée à un compte absent

`scripts/qa-tracking/lib/auth-admin.mjs:15–16` fait `response.json().catch(() => null)` puis renvoie null si email absent. Or `ownership.mjs:31–34` traite ce null comme un compte absent et conserve l’ID dans les cibles prouvées de nettoyage.

Repro exécutée : createAuthAdmin avec fetch injecté HTTP200/body `not json`, puis proveOwnership avec UUID synthétique. Résultat réel : `emailOf:null`, UUID présent dans proven.auth_users, `unproven:[]`. Une erreur de lecture ne constitue donc pas le refus attendu avant suppression. Même défaut dans findByEmail:24–28 : réponse200 JSON invalide ou envelope sans users devient liste vide/absence.

Correction : null seulement pour Auth404 reconnu ; HTTP200 doit avoir JSON/identité/email valides (et ID attendu lorsqu’il est fourni). Échec de parsing/envelope/pagination => throw/INCOMPLETE, jamais absence. Ajouter tests des deux endpoints qui démontrent zéro suppression après lecture invalide.

## P2 — Absence instantanée ferme une création Auth dont l’issue reste inconnue

`scenarios.mjs:42–48`, surtout ligne45 : le réconciliateur createUser retourne `proven:true, account absent` après un lookup sans résultat. `cleanupWithProof` run.mjs:68 appelle ces réconciliateurs et peut ensuite considérer le journal entièrement résolu.

Probe exécutée : Fixtures.createUser rejette une réponse inconnue503 ; findByEmail renvoie actuellement null ; reconcileOpen ferme l’intent comme `reconciled`, open=0. Faire ensuite apparaître l’utilisateur dans le backend simulé ne réouvre rien. La requête distante dont la réponse a été perdue/503 n’est pas prouvée annulée par son absence lors d’une seule lecture ; cette preuve est non monotone. Les réconciliateurs organization/site déclarent aussi une absence immédiatement prouvée (lignes55/65) et méritent le même contrôle.

Correction minimale : après issue inconnue d’une création, un résultat de recherche absent doit laisser l’intent ouvert/INCOMPLETE tant qu’aucun protocole de terminaison serveur n’est prouvé. Une présence exacte identifiée peut être recensée durablement puis nettoyée ; conserver la distinction présence prouvée/absence actuelle/issue inconnue. Ajouter un test de création différée au-delà du premier readback, pas uniquement commitDrop déjà visible.

## P2 — Manifeste initial absent lors du lookup de récupération du premier compte

`run.mjs:167` construit Fixtures sans sauvegarde initiale avant setup ; `scripts/qa/lib/fixtures.mjs:31–39` ne sauvegarde pas au constructeur et createUser n’écrit le manifeste qu’après retour d’un ID (lignes70–73). collectIndirect retourne immédiatement si aucun profil suivi (217–219).

Probe avec les classes EXACTES : premier createAuthUser perd sa réponse avant ID ; intents.json existe, mais `manifestExistedAtEmailLookup:false`, `manifestExistsAfterReconcile:false`, openIntents=0 après le défaut précédent. En cas de crash ici, la commande de reprise publiée pointe sur un manifest.json inexistant. En outre la récupération de fallback dans run.mjs:75 ajoute les UUID seulement en mémoire avant suppression, sans sauvegarde du manifeste enrichi.

Correction locale au harnais tracking : sauvegarde initiale du manifeste avant toute première mutation/lookup ; persister les IDs récupérés avant de commencer les suppressions. Pas besoin de modifier le module Fixtures partagé : le runner peut invoquer la sauvegarde et fournir un hook durable de récupération. Vérifier le scénario premier-compte inconnu et la reprise d’un cleanup qui échoue après découverte de l’UID.

## P2 — Fournisseur indisponible503 remonte comme PASS de preuve fournisseur

`scenarios.mjs:702–719` (route) et `725–733` (geocode) ne refusent que verdict fail ; unavailable retourne normalement. runOne/createReport marque alors le scénario PASS, contrairement au contrat et au commentaire de provider-proof.mjs.

Probe exécutée via PROVIDER_RUNNERS['provider-geocode'] + runOne + createReport réels : première réponse503 `{reason:'provider_unavailable'}`, lecture snapshot200 et refus viewer403. Sortie : `status:'PASS'`, résumé `{total:1,pass:1,fail:0,anomaly:0,blocked:0}`, note contenant seulement le verdict unavailable. Ce n’est pas une preuve de géocodage disponible.

Correction : état explicite BLOCKED/UNAVAILABLE dans scénario et synthèse lorsque le fournisseur est indisponible ; conserver la raison, les autres contrôles réussis et le nettoyage. Ne pas transformer ce cas en défaut applicatif, mais ne pas comptabiliser la preuve positive fournisseur. Test au niveau PROVIDER_RUNNERS+runOne, pas seulement classifyRoute/classifyGeocode.

## Bornes et points effectivement fermés

- Classification des POST5xx en unknown, tracking/drain des mutations API et navigateur : corrigés et reproduits.
- Drain expiré : createGuardedCleanup mesure les pending AVANT fermeture des producteurs puis refuse proveAndClean si non zéro ; reproduction réelle zéro suppression/lecture Auth PASS.
- Canonical email validé AVANT le scan Auth, mais la qualité de sa réponse est insuffisante (P2 ci-dessus).
- Ouverture de session recontrôle le gate après newPage et après installation de la barrière ; repro5 PASS. Aucun chemin tokens→userRpc n’existe dans le scenarios exact8a : la simulation de réaffectation utilise les écritures service gardées ; ne pas revendiquer un test RPC supprimé.
- Propriété distante normale : email hors cohorte exclu, organisation/site rattachés aux parents prouvés, budget fournisseur jamais écrit. La réponse invalide Auth reste cependant une ouverture fail-closed réelle.
- Pas de revue exhaustive de l’application557, de SQL001–020 ni de recette cloud ; source/harness uniquement. Ne pas extrapoler ces tests en preuve GPS physique ou en disponibilité du fournisseur.
