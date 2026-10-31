# Recheck expiration — da5758c

Source exacte `da5758c9a2a1c5fd9bfceba6606868163e4bac4c`, worktree backend propre. Aucun cloud/credential/compte réel/SQL réel/install/build ; sources non modifiées.

## Verdict borné : P1 fermé, deux P2 toujours ouverts ; pas de feu global

**EXPIRY-REVIEW-001 P1 fermé dans expiryVerify** : bail/manifeste/claims/run/projet/email doivent concorder, puis Auth GET exact UID doit confirmer l'email QA de ce run. Un mismatch/manifeste illisible/compte absent/bail périmé refuse avec cleanup:false ; le runner n'enregistre donc pas cet UID. Les nouveaux tests de refus sont pertinents sur le helper et passent. Le bail original --lease reçoit désormais consumedAt, puis une copie est écrite dans --out : point original fermé.

**EXPIRY-REVIEW-002 P2 toujours ouvert** : run.mjs253–255 reste `await expiryVerify(...)` puis enregistrement uniquement après retour. Le helper peut obtenir une preuve Auth valide, puis deps.probe ou writeLease jeter/être interrompu. Le runner tombe alors dans son finally avec created vide et ne nettoie pas ce compte connu. L'original peut même être consommé avant l'échec de la copie --out, sans compte dans le manifeste de verify. Enregistrer la cohorte validée durablement via callback immédiatement après preuve et avant probe/writeLease ; l'exception post-preuve doit conduire au cleanup exact ou au reliquat actionnable. Ne jamais enregistrer le bail brut avant preuve.

**EXPIRY-REVIEW-003 P2 toujours ouvert** : aucun changement des lignes de préflight ni de skipCleanup. Health/OPTIONS/POST anonyme peuvent loguer fail puis la création expiryPrepare continuer ; outcome prepared déclenche skipCleanup=true malgré les fail antérieurs. Le résultat final est FAIL avec compte laissé. Arrêter avant création sur préflight invalide, ou interdire skipCleanup quand l'ensemble ne peut conclure PREPARED.

**Bornes/read-permissions non corrigées** : parseLease n'impose toujours pas les relations verifyNotBefore=exp+60 et leaseEndsAt=min(exp+7200,preparedAt+7200) ; aucun contrôle égalité avec leaseEndsAt du manifeste. Aucun lstat/fstat/no-follow ni vérification mode0600 et parent0700 avant lecture --lease/manifeste ; les opérations restent readFile. Ces points étaient demandés pour ce recheck et n'apparaissent pas dans le diff. Les sorties nouvellement écrites restent protégées par mode/chmod/rename, ce qui ne valide pas les fichiers d'entrée.

## Tests exécutés et limites

- `tsx --test tests/qa-gateway*.test.ts` : **49 PASS, 0 échec**.
- Typecheck ciblé lib.ts et deux tests gateway (ES2022/esnext/bundler/typesnode/ignoreConfig) : PASS.
- `node --check scripts/qa-gateway/run.mjs` : PASS.

Le test de câblage runner est encore une comparaison de regex sur le source. Sa nouvelle assertion exige même l'enregistrement après await expiryVerify ; elle ne prouve pas un lifecycle finally sous interruption. Aucun test réel du runner avec faux fetch/erreur après cohorte/preflight invalide n'a été ajouté. Les tests helper ne comportent pas de client DELETE réel et ne remplacent pas cette couverture. Aucun PASS cloud ou preuve d'expiration n'est déduit de cette revue. §2 reste hors autorisation de codage de cette revue.
