# Revue indépendante expiration gateway

Source exacte `d9f94f913d8312b84da1fd0246283db91a6e4837`, worktree backend propre à l'ouverture. Code lu par diff et sources committées. Aucun appel cloud, credential, compte réel, SQL réel, installation ou édition app/tests.

## Verdict : pas de feu global prepare/verify avant corrections

### EXPIRY-REVIEW-001 — P1 : suppression possible d'un UID de bail non validé

`lib.ts:1079–1089` retourne cleanup:true sur bail hors fenêtre ou manifeste illisible ; la divergence UID/hash/claims le fait également après la validation. `run.mjs:255` ajoute ensuite lease.userId au nettoyage privilégié. Le cleanup ne vérifie pas l'email/cohorte de cet UID avant suppression Auth et discovery de ses documents/objets.

Un UUID syntaxiquement valide dans un bail corrompu/altéré du bon projet peut donc déclencher le nettoyage d'un compte hors cohorte, même lorsque la cohérence échoue explicitement. Le refus doit être sans suppression tant que l'UID exact QA n'a pas été établi indépendamment à partir du manifeste et d'une lecture Auth identitaire/cohorte. Un bail expiré ne dispense pas de cette garde. Ne jamais promouvoir lease.userId brut en autorité de suppression.

Reproduction locale indépendante avec vrai buildLease/expiryVerify, dépendances sans réseau : bail expiré avec UID arbitraire et email hors cohorte ; résultat cleanup:true, **0 lecture de manifeste/compte/cohorte**. Aucune suppression réelle effectuée.

### EXPIRY-REVIEW-002 — P2 : interruption verify avant enregistrement de la cohorte

`run.mjs:253–255` n'enregistre le compte dans created/manifeste de la phase verify qu'après résolution complète de expiryVerify. Un fetch getUser/probe interrompu, une erreur writeLease ou autre exception après validation sort vers finally avec created vide ; cleanup n'a alors aucun UID à traiter. Le manifeste prepare demeure actionnable ailleurs, mais le nettoyage immédiat annoncé n'a pas lieu et le rapport de cette phase ne porte pas nécessairement le compte.

Attendu : une fois et seulement une fois la propriété/cohorte établie sûrement, enregistrer durablement la cohorte validée **avant** les appels réseau/probe de verify ; les exceptions doivent nettoyer cette cohorte ou lister explicitement le reliquat et le chemin de reprise. Aucun enregistrement d'un UID non validé pour résoudre ce point.

### EXPIRY-REVIEW-003 — P2 : échec préalable avec compte pourtant laissé

Les sondes préalables de run.mjs235–242 loguent fail sans interrompre la création. Si expiryPrepare réussit ensuite, skipCleanup devient true (248), alors computeVerdict retourne fail à cause de ces étapes. On obtient FAIL avec compte laissé intentionnellement, alors que le contrat réserve ce cas à PREPARED et promet nettoyage sur erreur.

Attendu : arrêter avant création si un préalable échoue, ou ne laisser le compte que lorsque la préparation entière peut réellement conclure PREPARED sans fail antérieur.

### Bornes supplémentaires à verrouiller

parseLease ne valide que formes/champs finis, pas les relations verifyNotBefore=exp+60/leaseEndsAt=min(exp+7200,preparedAt+7200) ; verify ne confronte pas leaseEndsAt au manifeste. Revalider ces égalités et le bail≤2h avant décision, sans suppression si les données sont incohérentes. consumedAt est actuellement écrit dans le leasePath du **nouvel --out**, pas dans args.lease original : documenter et corriger la consommation de l'original pour éviter un bail apparemment réutilisable. Les lectures de bail/manifeste n'inspectent pas permissions/symlinks : root doit au minimum utiliser ses sorties neuves privées ; le contrat annonçant leur refus n'est pas encore implémenté.

## Points conformes

Mot de passe enregistré au caviardage avant createUser, access/refresh enregistrés après grant, refresh jamais utilisé/persisté ; clés dans la liste de secrets. Iss/sub/aud/role/exp et empreinte contrôlés, compte id/email/banni/deleted lu avant sonde en chemin nominal. Fenêtre TTL inexécutable refuse de produire un bail. 422 sans corps passe après authentification et avant mutations dans le handler réel. Nouveau code plateforme inconnu => observed, jamais pass ; absence d'en-tête et format JWT invalide refusés. Prepare nominal => prepared, pas pass. WritePrivate utilise temporaire0600/chmod/rename et --out0700. Les neuf scénarios nominaux ne sont pas lancés par la suite expiry.

## Vérifications exécutées

- `tsx --test tests/qa-gateway*.test.ts` : **48 PASS, 0 échec**.
- `node --check scripts/qa-gateway/run.mjs` : PASS.
- Typecheck ciblé lib.ts + tests/qa-gateway-expiry.test.ts + tests/qa-gateway.test.ts : PASS avec `tsc --ignoreConfig --noEmit --target ES2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck --types node`.
- Reproduction pure de REVIEW-001 décrite ci-dessus : assertions strictes PASS.

Les unités n'exercent pas le vrai finally du runner avec interruptions et cohortes invalides ; leur succès ne couvre donc pas ces suppressions/abandons. §2 concurrence reste hors code autorisé et aucune preuve réelle d'expiration n'a été produite par cette revue.
