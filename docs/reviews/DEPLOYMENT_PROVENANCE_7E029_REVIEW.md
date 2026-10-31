# Revue provenance REMOTE — 7e029ec

Source exacte `7e029ec0f635d4f38a756776923cc189533d8083`, contrat1e5f808 antérieur au code et propriétéA7 indiquée. Seulement trois nouveaux fichiers revus. Snapshot gitarchive figé : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deployment-7e029-review-ctlsgj0k`. Aucun code modifié ni appel cloud/fetch/API/cookie.

**Verdict : deux P2 à corriger avant feu intégration/callers.14tests existants PASS ne couvrent pas les deux reproductions suivantes.**

## P2 DEPLOYMENT-PROOF-001 — garde horsGit dépend du ceiling hérité

`scripts/qa/lib/deployment-proof.mjs:66–77` exécute gitrev-parse en conservant tout process.env. Une variableGIT_CEILING_DIRECTORIES pointant vers le répertoire canonique du dépôt empêche Git de remonter depuis repo/sub vers sa racine. Le code128 «notagitrepository» est alors pris comme preuve horsGit, alors que le reçu0600 est bien dans ce dépôt.

Reproduction indépendante sur snapshot exact, dépôt temporaire propre créé pour le test seulement : sansvariable, mêmefichier refuséIN_GIT ; avecGIT_CEILING_DIRECTORIES=realpath(repo), mêmefichier **accepté**. Script `/tmp/depannage-deployment-7e029-ceiling-repro.mjs`. L’environnement est restauré et seul le dépôt temporaire du test est supprimé. Ce n’est pas une attaque de modification du reçu par un autreUID : un réglage de découverte Git hérité suffit à rendre le verdict erroné.

Attendu : découverte Git indépendante des variables qui changent ses limites/racines (au minimum ce ceiling), refus conservateur si indéterminable. Ajouter le test dansGitavecceiling, plus aliasparent canonique.

## P2 DEPLOYMENT-PROOF-002 — Flight malformé accepté

`deployment-proof.mjs:110–114` vérifie uniquement le compteurinvalid du parseurBusiness puis son identité. Ce parseur saute un marqueurpush dont l’argument ne commence pas par[ et ne valide pas la parenthèse après le tableau. Deux cas exécutés avec reçu/attendus valides :

- HTMLFlight valide suivi de `<script>self.__next_f.push(null)</script>` : **accepté** malgré le segmentnonarray ;
- seul `<script>self.__next_f.push([1,"…racineBuildTest…"]</script>` (parenthèsefermante absente) : **accepté**, bien que ce script ne soit pas exécutable.

Même script de reproduction ci-dessus. Le contrat et doc livrée annoncent explicitement le refus des appelsFlight malformés, y compris lorsqu’un autre appel serait valide. Ce contrôle reste incomplet. Attendu : garde stricte de l’enveloppe des appels avant acceptation, en gardant le vrai parseurBusiness pour extraction du contenu/buildID, tests négatifs des deuxformes. Aucun changement aux modesLOCAL ou aux autresrunners pour contourner le problème.

## Contrôles conformes dans le périmètre

- Objet receipt exact et gitSource exact ; huit expected obligatoires indépendants, égalitéstrictesanscoercition, tous champs typés/formatés ; NULL refusé sauf target explicitement autorisénull. READY, refintegration/web-pwa, github, SHA40, repoentier sûrpositif, IDspréfixés, origineHTTPScanonique sansport/path/query/credentials. La relation URLunique/deploymentID reste une attestationroot explicite, pas une déduction cryptographique duDNS.
- capturedAtISOcanonique fini, horlogesafeinteger, ancienneté15min/futur30s, nouvellevalidation à verify. Pas de BUILD_IDlocal utilisé pour vérifierREMOTE.
- Loader parentrealpath puis O_NOFOLLOW final/O_NONBLOCK, fichier régulier, UID courant, modeexact0600/nlink1, taillepositive≤16KiB, lecturebornée et fstatavant/après dev/ino/uid/mode/nlink/size/mtimeNs/ctimeNs. UTF8strict/JSONinvalidrefusés sanscontenu dansmessages. Le problèmehorsGit ci-dessus reste distinct de ces contrôlesfd. Limite contre acteurmalveillantmêmeUID explicitement documentée.
- ParseurBusiness importé sans modification et sansappelautomatique ; identitéFlightunique égale reçuETexpected, ambiguïté/staticfallback/refus de build différent correctement traités sur lesformes déjà couvertes. Pasderunner, fixture, package ou appmodifié ; lescallers restent à raccorder séparément avantfixture, avec expected réellement indépendants.

## Vérifications exécutées

`node --test scripts/qa/tests/deployment-proof.test.mjs` : **14PASS,0échec,0SKIP**, également sur snapshot figé. Inclut lecture du HTMLpublic4c déjà capturé parroot dans son fichier privé local : aucun nouveaufetch ni copieHTML dansGit. Syntaxe module : PASS. Deux reproductions supplémentaires ci-dessus montrent les acceptations nonattendues ; elles ne sont pas comptées comme testsPASS.

Aucune installation, cloud, credential, cookie, receipt utilisateur ou fichiersource modifié. Aucun verdict métier/Supabase/permissions/GPS/scheduler dérivé de ces tests.
