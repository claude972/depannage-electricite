# Recheck REMOTE Business — 9f32421

SHA exact `9f3242195ba5555ee8774777cfc6f986ecfa013a`, checkout propre avant/après. Diff contre e6fbcbd relu, dont deuxcapturesdate uniques dans b2b.

**Verdict borné : BUSINESS-REMOTE-001 fermé ; aucun nouveau P1/P2 identifié, intégrable. Exécution distante Business réservée à root après fin/nettoyage Tracking actif.**

remotePreflight prend désormais une fonctionclock, appelée pour load puis de nouveau APRES awaitfetch pourverify. Default délègue réellement à Date.now à chaque appel ; une ancienne optionnowMsfigée est explicitement refusée. La validationhelperA7 peut donc constater une expiration durant le fetch. Construction des8expected indépendante, chargementreçu→fetchpublicsanscookies/redirectsuivi→verify avantbrowser/fixtures restent inchangés. Refus en main donneBLOCKED, code2, nonattribuable, sansmanifest ni requêteSupabase. LOCAL ne reçoit pas cecontrôleREMOTE et conserve sa vérification.

Petitecorrectionb2b : la date saisie dans chaque étape maintenance/visite est capturée unefois puis réutilisée dans lesassertions ; elle ne change pas les attentes métier et évite une incohérence à minuit.

Exécuté : `QA_BUSINESS_4C_HTML=/tmp/depannage-public-4c-home-private.html tsx --test tests/qa-business.test.ts` : **51PASS,0échec,0SKIP** ; syntaxe remote.mjs : PASS. HEAD resté9f324, propre. Lesnouveaux tests utilisent le vraihelper, un fetch suspendu puis horloge+20s, nominalrapide accepté, et maincomplet avec seulGETpublic simulé puis refusverifyEXPIRED et aucunobjetfixture. HTML4c déjà capturé localement lu sansnouveaufetch.

Repro indépendante originale e6 retargetée vers snapshotexact9f : `/tmp/depannage-business-9f324-clock-repro.mjs` : callerAccepted=false àâge910000ms/max900000, helperfresh refuseEXPIRED. Snapshot : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-9f324-review-8_jhk1td`.

Aucun cloud, cookie, credentialréel, API, source, installation ou fixture distante touché. Ce recheck valide le gate de provenance, pas lesparcours métier d’une recette future.
