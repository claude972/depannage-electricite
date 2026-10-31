# Revue caller REMOTE Business — e6fbcbd

SHA exact `e6fbcbd51463b7578748e3cbd83fb70c2ad1c800`, worktree propre avant/après ; contrat§19eae3752 antérieur au code. Revue limitée aux cinqfichiers livrés et intégration du helperA7 déjà revu.

**Verdict : un P2 à corriger avant feu.49testsPASS ne couvrent pas l’expiration pendant le fetch.**

## P2 BUSINESS-REMOTE-001 — horloge figée avant les attentes

`scripts/qa-business/lib/remote.mjs:38–56` évalue `nowMs=Date.now()` une seule fois à l’entrée puis transmet le même instant à loadDeploymentProof ET verifyRemoteDeployment après awaitload et awaitfetch. Un reçu encore âgé de14min50s au début peut dépasser15min pendant le fetch autorisé30s et rester accepté comme preuve valide. La nouvelle validation du helper est neutralisée par l’horloge périmée injectée par le caller.

Reproduction indépendante exécutée sur snapshot exact : reçuâge890000ms ; fetch contrôlé avance l’horloge de20000ms ; remotePreflight renvoieok:true àâge910000ms, alors que le même helper A7 à l’instant réel de verify refuseEXPIRED. Script `/tmp/depannage-business-e6fbc-clock-repro.mjs`. Aucune attente20s ni requête réelle : horloge et fetch injectés, reçu synthétique privé, nettoyé aprèstest.

Attendu : relire l’horloge à chaque validation (injection de fonctionclock pour les tests, valeur actuelle auverify en production) ; testbarrière où le reçu expire entreload etverify doit donner refused/verify/EXPIRED, puis mainBLOCKED/code2/zérofixture. Les tests à heure constante doivent garder leurdéterminisme sans figer le temps de production.

## Contrôles conformes

- Huitexpected construits uniquement depuis lesCLIroot : origin/vercelproject/team/deployment/repoId/refintegration/sha/expectedbuildID. Ni reçuniHTMLne fournit cesattendus. SHA vient de --shaapplicatif ; --app-dir s’il est fourni vérifieHEAD de cecheckoutsource, pas celui du harnais. Pour viser app4c avec harnaise6, root doit donc pointer --app-dir vers source4c ou s’appuyer sur provenanceREMOTE conforme ; aucun BUILD_IDlocal utilisé enREMOTE.
- Ordre source main : validationargs/credentials/projet/allowlistURL/SHA/outsideGit puis remotePreflight load→GETpublic→verify ; aucunbrowser, clientservice/fixture/intent/manifest/runlog avant succès. Refus produitBLOCKED/codeseul/exit2, seulementresult.json etsummary.md privés, attributablefalse. Le testmain bloque globalfetch et confirmezérorequête pour reçu absent.
- GETpublic versorigine validée, path/, pasquery ; redirectmanual etstatus200 obligatoire, aucuneheadercookie/servicecredential transmise par le code. Nodefetch démarre sanscookiejarbrowser. Les erreurs reçupage ne sont pas réimprimées ; seulsstage/code ou preuve courte apparaissent.
- BrancheLOCAL garde la lecture de .next/BUILD_ID et comparaison auFlightstrict ; drapeauxREMOTEinterdits enLOCAL. Pas de fauxBUILD_ID créé. ContrôleREMOTE ne compare pas le BUILD_IDlocal avec celui deVercel. Lesfixtures/cleanup/scénarios métier ne sont pas modifiés dans cecheckpoint.

## Vérifications réellement exécutées

Snapshot gitarchive : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-e6fbc-review-im1hxhft`.

`QA_BUSINESS_4C_HTML=/tmp/depannage-public-4c-home-private.html tsx --test tests/qa-business.test.ts` : **49PASS,0échec,0SKIP**, dont vraiHTML4c déjà capturé parroot et lu localement (pasfetch). Syntaxe remote.mjs etrun.mjs : PASS. Anciennesgardescleanup/stop et parserstrict restent dans la suite. Reproduction temporelle supplémentaire ci-dessus : acceptation indue confirmée, non comptée commePASS.

Aucun cloud, credential réel, cookie, API, navigateur, build, source ou fichierutilisateur modifié. Le reçu temporaire de reproduction est synthétique et appartenait au test ; sourceA7 n’est pas modifiée. Aucun verdict métier distant annoncé.
