# Revue QAcore fixtures — 5fa7f82

SHA exact : 5fa7f824957e5ccde160fa9f8706d22483320026. Worktree auteur propre au contrôle. Contrat lu : docs/QA_FIXTURES_DURABILITY_CONTRACT.md (2ec7a34, amendement c89758b). Export exact isolé : /private/tmp/depannage-qacore-review-5fa7f82-DEiwvS.

Verdict : aucun P1/P2 actionnable trouvé dans le périmètre fixtures. Correctif apte à l'intégration contrôlée ; aucune validation cloud ou globale du harnais extrapolée.

## Source

scripts/qa/lib/fixtures.mjs : constructeur limité aux champs ; init() paresseux et mémorisé, erreur efface le memo pour reprise. creating() vérifie la porte avant et après initialisation avant d'appeler la mutation. track() attend init puis persiste. init appelle save de l'INSTANCE, donc le manifeste de BusinessFixtures est déjà en place et l'override Tracking est respecté.

save() enchaîne writeNow dans une queue, avec récupération de la queue après erreur mais rejet rendu à l'appelant concerné. writeNow ne rappelle ni init ni save : pas de cycle d'attente. L'instantané est créé au tour de l'écriture, empêchant une ancienne sauvegarde d'écraser les identifiants ultérieurs.

atomicWriteJson : temporaire exclusif même répertoire, 0600, écriture intégrale et fsync avant rename ; chmod et fsync répertoire ensuite. Erreurs fichier/rename propagées, temporaire nettoyé avant rename échoué. Erreurs répertoire EIO/ENOSPC et autres hors liste non-support propagées. Une erreur après rename peut laisser la nouvelle version complète déjà visible tout en rejetant save : comportement honnête, sans prétendre restaurer l'ancien fichier.

Aucun changement lifecycle/run ni fichiers Business/Tracking dans ce commit.

## Vérification exécutée

- node --test scripts/qa/tests/*.test.mjs : 75 PASS, zéro échec/skip. Inclut les 10 nouveaux tests de durabilité, concurrence 50 track avec lecteur, échec initial/refus mutation/reprise, rename échoué/ancien fichier intact, file qui reprend, vrais BusinessFixtures/override Tracking, intentions perdues et drain.
- tsx --test tests/qa-business*.test.ts tests/qa-tracking*.test.ts : 74 PASS, zéro échec/skip. Les vrais scénarios locaux headless STOP/drain/réponse perdue existants restent verts.

Les imports des tests de compatibilité utilisent réellement les modules du commit, pas une sous-classe de substitution.

## Limites et risque connu hors lot

La création Auth à réponse perdue des fixtures génériques core n'a toujours pas d'intention pré-générée ; ce contrat la déclare explicitement hors lot. Le fichier initial maintenant présent ne suffit pas à prouver son nettoyage. Business/Tracking gardent leurs intentions spécifiques et leurs verdicts UNKNOWN/INCOMPLETE. Pas de preuve crash matériel/coupure d'alimentation ou sémantique d'un FS distant. Aucun compte distant, cloud, mutation ou changement dans le worktree auteur pendant cette revue.
