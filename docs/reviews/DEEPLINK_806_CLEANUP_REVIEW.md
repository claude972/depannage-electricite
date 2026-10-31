# Contre-revue B2 cleanup/finalize — 806cfeb3

Source exacte : 806cfeb3c7963a3a117b184ec4d472c93a9af21a, branche claude/web-qa-deeplink. Export git archive figé dans /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deeplink-806-review-qokveg79 ; aucun branchement/switch du checkout, désormais sur B1 478a2da7f4f22c27763ca263b1e65455909bf9ca. La comparaison des chemins scripts/qa-tracking et scripts/qa/lib entre ces deux SHA est vide : mêmes dépendances B1/shared acceptées.

Verdict borné : aucun P1/P2 identifié dans run, cleanup, durabilité, recovery et sorties après nettoyage examinés. Les quatre risques de prélecture WIP ont été corrigés, avec exécution des vrais tests main injecté. Un P3 de classification des crashes reste indiqué ci-dessous. Ceci ne valide pas les oracles D1–D4 en ligne, leurs fenêtres réelles ni l’efficacité Realtime ; les recettes navigateur/route font l’objet d’autres contrôles. Aucun feu cloud ne découle de cette seule revue.

## Fermeture des quatre points WIP

1. scripts/qa-deeplink/lib/cleanup.mjs, validateIntentsJournal et cleanupOnly : journal version2 et tableau requis ; null, champ absent, non-array, ID/op/kind invalides, état inconnu et issue settled inconnue refusés. Le fallback `intents || []` a disparu. Journal manquant ou illisible => cleanup refusé/exit3, aucun client DB/Auth créé et aucune lecture/suppression distante. Les tests invoquent réellement main --cleanup-manifest pour les variantes, avec compteurs DB/Auth à zéro. Un journal vide valide reste permis pour un manifeste vide ; cela n’est pas une preuve cryptographique d’intégrité des entrées privées.

2. run.mjs, finalCode et catch final : l’issue3 calculée après finalize est mémorisée et conservée quand l’erreur de l’essai retraverse le catch. Le vrai test main avec browserThrows + selectThrows aboutit3 et cleanup.json okfalse, contre2 auparavant. L’issue complète est vérifiée séparément ; aucune transformation d’un cleanup incomplet en0 observée.

3. cleanupOnly : manifeste JSON objet, version exactement1, project exactement égal à --project, run_id valide et created objet requis avant lecture des credentials. Les tests version2/missingversion/autreprojet/missingproject/badrun refusent2 avec compteur credentials/DB/Auth tous à zéro. Les formats sont ceux du harnais Tracking/B1, pas du Business version2.

4. run proveAndClean : collectIndirect throw est désormais conservé dans indirectError ; le ménage peut traiter les IDs déjà connus/provés, mais son résultat final est forcé okfalse/INCOMPLETE et exit3, avec erreur explicite. Le vrai test injecte selectThrows et constate cette issue ; sans l’erreur, cleanup est complet. Le journal et manifeste restent disponibles pour reprise.

## Invariants relus

- Provenance distante avant --out, intent, fixture ou appel service ; schéma et BUILD_ID servis réutilisent les primitives acceptées, pas de comparaison fictive avec un build local distant.
- IntentLog sur disque puis makeManifestDurable avant la première mutation ; TrackingFixtures réutilise le gate et inscrit l’intent avant émission, le manifeste avant création/enregistrement et les IDs reçus malgré arrêt. Aucun changement des helpers partagés ou du B1 dans ce lot.
- Finalisation idempotente commune, drain puis garde undrained avant suppression ; arrêt des contextes/browser et refus si producteur encore actif. SIGINT/fatal empruntent le même ménage ; sortie3 prioritaire au signal/fatal si nettoyage inconnu.
- Adaptateur B2 appelle le B1 avec runTrackingCleanup obligatoire et noSideEffects explicite. Les lignes tracking éventuelles précèdent les parents, provider leases sont relus après cascade ; le no-op ne ferme aucun intent provider artificiellement.
- B1 fait reconcile, persist, recovery email canonique, persist, preuve distante Auth/relations, cleanup_attempt persistant avant DELETE, puis ménage et résultat persistant. UID récupéré est durable avant toute suppression. Auth malformé ou recherche inconnue ne prouve pas ownership. Absence exhaustive ne ferme jamais une création inconnue ; intent reste OPEN et exit3.
- RecoveryCommand est réécrit vers qa-deeplink, sans credentials réels dans les arguments. cleanupOnly lit les entrées sur disque et sauvegarde les IDs récupérés via persist avant suppression ; il n’importe pas simplement un verdict de cleanup précédent.
- Futur postflight : attendre fin du process et drain ; formats manifest1/intents2, résultat terminé, cleanup_attempt et événements drain. Épingler les UUID de la cohorte réellement créée (setup 6 comptes/1org/2sites ; dossiers variables selon --only et progression), jamais supposer tous D1–D4 exécutés. Les parents bornent lectures REST et Storage, Auth404 legacy exact ; UNKNOWN n’est jamais0.

## Vérifications exécutées dans l’export exact

`tsx --test tests/qa-deeplink.test.ts tests/qa-tracking-cleanup-proof.test.ts tests/qa-tracking-auth.test.ts` :31 PASS,0FAIL,0SKIP. Faux réseau/horloge et fichiers temporaires réels ; aucun Supabase cloud, vrai credential ou navigateur démarré. Ces suites exercent main/catch/finally, les refus de reprise, l’Auth recovery et l’ordre B1, pas uniquement des regex source.

`node --check scripts/qa-deeplink/run.mjs` : PASS. Typecheck ciblé des trois tests (ES2022/esnext/bundler/typesnode, cache existant) : PASS ; qa-deeplink.test.ts porte ts-nocheck, donc cette commande n’est pas un typage statique complet du JS runner. Pas de nouvelle installation ni build produit.

## P3 : crash ordinaire classé préflight

Le catch final de run.mjs retourne2 pour une Error ordinaire lorsque finalCode n’est pas3. Le test existant « with a complete cleanup the throw gives2 » reproduit effectivement browser crashed =>2. HELP/commentaire annonce pourtant1=FAIL/FATAL et2=préflight. Aligner ce contrat de sortie, idéalement garder2 pour PreflightError et1 pour Error après début d’essai, ou documenter précisément l’exception voulue. Aucun faux PASS ni perte de priorité3 ne résulte de cette divergence ; ce P3 ne bloque pas la revue cleanup bornée.

Aucun code du dépôt modifié, aucune donnée distante lue/supprimée, aucun compte/bail/secret consulté et aucun cloud exécuté.
