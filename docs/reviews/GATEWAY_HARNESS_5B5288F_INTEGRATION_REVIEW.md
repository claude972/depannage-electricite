# Revue intégration du harnais Gateway — 5b5288f

Source réelle : claude/web-pwa-backend,5b5288f5352aa4ea6e2d41e69aa5c7ec73e569f8, worktreebackend propre. Aucune branche claude/web-native-gateway n’existe dans l’inventaire local/distants suivi. Cible integration/web-pwa7b05d3f559f57d1890384fe28ffdd024ce9a47e1 ; basecommuneac72c38d9cccd9100c38467f5d4cffe2193c806c.

## Verdict borné

Intégration du lot acceptable : aucun nouveau P1/P2 identifié. Pas de merge effectué. La revue ne redonne pas une autorisation de créer des cohortes, relancer des baux consommés ou exécuter le SQL ; chaque vrai essai reste sous contrôleROOT. Un petit texte de résumé automatisé reste à aligner (P3ci-dessous).

## Diff complet et périmètre

Le diff triplepoint cible...source contient exactement9fichiers,3089ajouts/30suppressions : docs/CLAUDE_GATEWAY_REMAINING_QA_CONTRACT.md ; scripts/qa-gateway/lib.ts etrun.mjs ; deux nouveaux scripts/qa-gateway/sql/revoke-live-{batch,observe}.sql ; tests/qa-gateway-{expiry,revoke,runner}.test.ts ; modificationtests/qa-gateway.test.ts. Aucunapp/composant/libproduit/Edge/supabasefunctions/migration/package/lockfile modifié. Attention les2SQL sont des harnaisQA : le lotbatch révoque réellement ungrantQA etCOMMIT siROOTl’exécute ; ce ne sont pas des migrations ni duSQLpurementread-only. L’observateur est read-only.

Côtéintégration, gitdiff ac72..7b05 sur chacun deschemins du lot estvide : aucune modification concurrente de ces fichiers à résoudre identifiée. La branche implémentation a évidemment un arbreapp plusancien ; intégrer lescommits/merge, ne pas remplacer le treecible par cetarbrehistorique.

## Revues et source contrôlées

Revues précédentes relues : /tmp/depannage-gateway-6466b8a-review.md (expirycohort/UIDdurable/leases), /tmp/depannage-gateway-revoke-13b-review.md (ancienP1cleanup), /tmp/depannage-gateway-revoke-83fd-recheck.md (P1chaînedistantefermé/objetexact/listagefinprouvée), /tmp/depannage-gateway-expiry-aee66b0-review.md (qualificationréelle). Elles sont bornées à leurs SHA ; la présente revue vérifie leurs éléments dans le tip5b, le diff entier du runner/lib, lesdeuxSQL et les tests actuels. Aucuncredential ni preuve contenantJWT relu.

- Arguments additifs/sélectifs : les9scénarioshistoriques restent par défaut ; modesexpiry/revoke explicites avec lease, no-other-writer et fichiersrésultats requis ; dryrun sanscréation et cleanupmanifest séparé. Importer main en tests ne lancepas automatiquementle runner.
- Prepareexpiry : préalablehealth/OPTIONS/anonymefailed bloqueavantseed ; UIDreçuenregistrédurable avantgrant ; sonde préexpiration422sanscorps vérifiequefonctionatteinte etdiscovery0 ; bailborné2h/exp+60/fenêtreexécutable, fichiersprivés etconsommationdufichieroriginal. PREPARED n’estpasPASS.
- Verifyexpiry : cohérenceprojet/run/manifeste/SHA256token/claims/email puisGETAuthUIDexact/emailcohorte AVANTpermissioncleanup ; UIDvalidé écrit avantprobe ; UIDétranger/lectureinconnue/refus n’estpas ajouté auplan. Le codegénériqueUNAUTHORIZED_ASYMMETRIC_JWT reste dans OBSERVED_EXPIRED_PLATFORM_CODES uniquement ; EXPIRED_PLATFORM_CODES803 restevide.401générique=>OBSERVED ;2xx/422/headerabsent/formatinvalide=>FAIL ;transport/5xx=>INCOMPLETE ;cleanupfailed/leftoversgardentprioritéFAIL. Aucun codegénérique arbitrairement lié pour produirePASS.5b corrigeledocP3relevé.
- Revoke : gardeqa-gwautrerédacteur avantseed, listageAuthborné sansprétendreexhaustivité surpagepleineàlimite. Prepare crée seulement2managersQA, organisation/site/dossierQA etgrantselectedunseulcanwrite. NoAdminfake. LiveprouveAuthdes2comptes puischaîneorganisationpropriétaire/membre,siteorganisation/nom,dossierclient/site/description etappartenancecreated avantrecordValidateddechaqueentité ; inconnu=>pasd’entiténonprouvéeauménage, reliquat/exit3, uploadnonémis.
- SQLbatch : rendervaleursvalidées, gardesexactesemail/relations/scopeselected/exclusionadmin/owner/artisan, verrouUNEorgQA, pause3s,statement8s/lock2s. Mesuresroot ; SETLOCALROLEauthenticated etauth.uidOWNER prouvésavantRPCréel ; aucunGRANT/bypass/triggerdésactivé. Unefin structurée uniquementaprèssuccès+COMMIT, readbackselected/0 ethorodatagesDB. Observateur uniqueexigé parparser ; SQLne sortpasquerytext/claims, seulementPID/wait/blocks etobjetQA.
- Preuveconcurrente : PASSrequiertPIDfinalize directementbloquéparbatchPID dansfenêtreDB ETunobjetexactnommé auchemindécouvert/manifesté sousmanagerUID, découvertavantresponse ;403enveloppegateway sansfuite etobjetabsent/zérodocuments.201courseperdue=FAIL ;absenceHTTP/5xx=UNKNOWN puis réconciliationavantcleanup. Uneobservationvide/multiple/horsfenêtre n’estpas sauvéeparuntimer.
- Nettoyage : discoverycohortefirst existant conservé, lecturesUNKNOWN bloquent toute suppression propre ; interruption conserve late-reconcile etmanifestes. La fenêtre30s est une observationbornée, pasune garantie d’arrêtde toute opérationdistante. CréerAuthsansUIDreçu lorsd’untransportinconnu nécessite encorela vérificationmanuelleemaildecohorteROOT avantrelance, limitationdéjàdocumentée6466, pas nouvellepreuve d’idempotenceglobale.

## Contrôles effectivement exécutés au tip

- /tmp/depannage-web-pwa-local-qa/node_modules/.bin/tsx --test tests/qa-gateway*.test.ts :76PASS,0FAIL,0SKIP. Inclut vraishelpers etmain/catch/finally surfauxréseau/horloge, fichiersprivésréels ; aucuncloud.
- tsc ciblé strictlib+4fichiersGateway, ES2022/esnext/bundler/allowImportingTsExtensions/typesnode/cacheexistant :PASS. Aucuninstall/buildfullapp nécessaire pour ces seuls scripts.
- node --check scripts/qa-gateway/run.mjs :PASS.
- Worktreepropre avant/après. Aucunmerge, SQLréel, déploiement, nouvellecohorte, bail, cred ou compte touché.

## P3 non bloquant restant

scripts/qa-gateway/lib.ts855, summaryMarkdown, écrit encore pour toutOBSERVED : «àlierstrictementdansEXPIRED_PLATFORM_CODES(commitsuivi)avanttoutPASS». Pourl’observationréellegénérique, ce conseilautomatique invite encoreunfollowupbinding alorsquecontrat5b§1.4bis précisequ’ilresteranonlié. Remplacerparuntexteneutre indiquantqu’uncodegénériqueneprouvepaslacauseexpirationetresteOBSERVED ; nepas changerla listevide oulesassertionspouralignerletexte. AucunFAUXPASSactuelenrésulte.

Les preuvesréellesdéjàrapportées(ROOTexpiryOBSERVEDnettoyé,Gateway4PASSconcurrenceréelle)restentleurspropresartefacts/SHA ; ces76testslocauxne lesrecréentpasetne prouventpasdenouveauxcomportementscloud.
