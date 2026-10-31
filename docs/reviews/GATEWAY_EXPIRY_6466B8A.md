# Recheck expiration — 6466b8a

Source revue : commit `6466b8a`, scripts gateway et tests. Le worktree avait avancé sur `83b9ccc041661b96a464791efaa6f2b9fd194a11`, changement limité au document contrat §2 : `git diff 6466b8a..HEAD --name-only` ne contient que docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md. Les scripts/tests exécutés correspondent donc exactement au checkpoint6466b8a. Worktree propre. Aucun cloud, credential réel, compte réel, SQL réel, installation ou build.

## Verdict borné : feu pour root prepare/verify dans le cadre décrit

Aucun P1/P2 restant identifié dans les corrections examinées. Utiliser le projet dédié vérifié et des sorties privées neuves distinctes, root seul opérateur cloud ; PREPARED est une préparation, jamais un PASS d'expiration. Relancer verify après exp+60s et avant le bail≤2h, ou nettoyer par le manifeste prepare. §2 concurrence reste hors autorisation de code/exécution de cette revue.

- **REVIEW-001 P1 reste fermé** : avant toute permission de nettoyage, cohérence bail/manifeste/claims/run/projet/email puis Auth lookup indépendant de l'UID exact et email QA du même run. Bail/UID arbitraire ou divergence => refus, aucun identifiant enregistré, aucun DELETE.
- **REVIEW-002 P2 fermé** : recordValidated intervient immédiatement après la preuve de cohorte et avant le probe ou les écritures consumedAt. Le runner enregistre alors durablement l'UID validé ; une exception ultérieure retrouve cette cohorte dans finally. Le callback n'est jamais exécuté pour un UID brut avant validation.
- **REVIEW-003 P2 fermé** : échec de health/OPTIONS/sonde anonyme interrompt prepare avant createUser ; skipCleanup exige outcome prepared et absence de toute étape fail.
- Relations du bail revalidées : verifyNotBefore=exp+60, leaseEndsAt=min(exp+7200,preparedAt+7200), durée après préparation≤2h et positive, exp après préparation, cohérence expires_at±5s, fenêtre exécutable, email de cohorte et issuer projet. leaseEndsAt doit également concorder avec le manifeste.
- Consommation du bail original --lease conservée, puis copie dans le nouvel --out.
- Lectures de bail/manifeste vérifient via lstat fichier régulier, absence de symlink et de bits groupe/autres, ainsi que parent immédiat répertoire privé non symlink. Écriture du bail utilise la même politique ; sorties0600 et dossier0700 vérifiés par tests. Cette revue ne prétend pas une protection contre une substitution locale hostile entre lstat/readFile, ni une vérification récursive de tous les ancêtres : utiliser les sorties neuves appartenant à root/pilote.

## Vérifications effectivement exécutées

- `tsx --test tests/qa-gateway*.test.ts` : **57 PASS, 0 échec**.
- `node --check scripts/qa-gateway/run.mjs` : PASS.
- Typecheck ciblé lib.ts et tests gateway/expiry/runner avec ES2022/esnext/bundler/typesnode/ignoreConfig : PASS.

Les nouveaux tests importent main() et exécutent réellement preflight/prepare/verify/catch/finally sur faux fetch et horloge, avec fichiers privés réels. Scénarios constatés : cycle nominal PREPARED→trop tôt(code2,sans mutation)→OBSERVED/nettoyage ; exception réseau après cohorte validée ; erreur d'écriture du bail original ; préflight503 sans seed ; TTL inexécutable avec nettoyage ; bail symlink/groupe lisible/parent non privé refusés sans DELETE ; bail expiré non-preuve et reprise via cleanup-manifest ; UID arbitraire hors cohorte sans lecture/suppression Auth ; permissions des sorties. Les anciens tests purs de claims/hash/redaction/cleanup restent verts.

## Limites opérationnelles

Aucune expiration réelle prouvée ici. Le code plateforme expiré reste non lié : première observation inconnue doit rester OBSERVED, jamais PASS, puis être qualifiée/pinnée. Aucun comportement de concurrence live (§2) n'est déduit. En cas d'issue réseau inconnue au moment de la création Auth elle-même, le pilote doit vérifier l'email de cohorte de ce run avant de relancer : la présente correction porte sur les interruptions après preuve/enregistrement de la cohorte et n'ajoute pas de découverte Auth par email pour une création dont aucun UID n'aurait été reçu.
