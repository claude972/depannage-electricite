# Recheck DL-QA-806-003 — sorties du runner, 7713c99d

Source exacte :7713c99d47c0640e341c8084001de7eda21098ba, export gitarchive isolé /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deeplink-771-exit-review-o9fjau1m. Comparaison contre806cfeb3c7963a3a117b184ec4d472c93a9af21a ; aucun switch ni modification du checkout.

Verdict borné : DL-QA-806-003 fermé. Le crash ordinaire après cleanup complet retourne maintenant1 (FATAL) ; PreflightError reste2 ; cleanup inconnu/incomplet reste prioritaire3. Aucun nouveau P1/P2 identifié dans cette correction. Aucun avis sur D4g002 encoreOPEN ou sur la modification D3/oracles revue par l’autre agent.

Attention périmètre du commit : diff806..771 contient5fichiers, pas seulement2 : run.mjs/testsunit pour003, et probe/scenarios/tests-scénarios pour le latching leak observer001. Ici seule la partie003 et l’invariance cleanup ont été revues ; l’autre sous-lot n’est pas implicitement accepté.

Preuves source : le seul changement fonctionnel de sortie est le return2 devenu return1 du catch Error ordinaire ; la branche finalCode===3 reste avant toute classification et la branche PreflightError retourne toujours2. Le code signal conserve exitCodeFor({cleanup,signal:true}) sans changement. Aucune modification de lib/cleanup.mjs, du B1 cleanup-proof, de lib/finalize.mjs ou du lifecycle partagé dans ce diff.

Tests réellement exécutés dans l’export exact, ciblés pour ne pas rejouer les anciens tests backend :

- tsx --test --test-name-pattern='main:|main --cleanup-manifest' tests/qa-deeplink.test.ts :4PASS. Vrai main injecté :9journauxinvalides oumanquants=>3/zéroDBAuth ; manifesteversion/projetinvalide=>2/aucuncredential ; collectIndirectthrow=>cleanupfalse/3 ; browsercrash+cleanupincomplet=>3 ; browsercrash+cleanupcomplet=>1 ; PreflightErrorprovenance=>2 et --out non créé. Réseau et credentials synthétiques uniquement.
- tsx --test --test-name-pattern='cleanup guard|undrained|exit|stop gate' tests/qa-tracking.test.ts :3PASS. Mêmes helpers réellement importés parB2 : récupérationintentinconnu gardeINCOMPLETE, stopgate refuse toute nouvelle mutation, producteur non drainé empêchedelete etconserve3 ; assertion exitCodeFor(cleanupok,signaltrue)===130 etcleanuprefusé+signal===3. Cela ne constitue pas un nouveau signalOS sur un run cloud ; wiring du runner relu inchangé.
- node --check scripts/qa-deeplink/run.mjs :PASS.

Sept testsPASS, zéroéchec. Les tests non sélectionnés ne sont pas présentés comme réexécutés ; aucune suiteSQL/app/backend normale relancée. Aucun navigateur, cloud, compte ou credentialréel, bail, déploiement ni mutation source.
