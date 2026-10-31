# Recheck final A7 — 4a1d148

SHA exact `4a1d1484877c9cd269c98b4d161197a08c783c6a`, worktree codex/qa-deployment-proof propre avant/après ; merge parserOWNER38702cf via80f667f, correctifENV17b2 conservé. Contrat1e5f808 et revue7e029 restent historiques.

**Verdict borné : deux P2 précédents fermés, aucun nouveau P1/P2 identifié ; intégrable pour raccordement explicite des callers par leurs owners. Cela ne valide aucun scénario métier distant.**

- DEPLOYMENT-PROOF-001 fermé : loader retire toutes variablesGIT_* héritées avant rev-parse, désactive configglobal/système, force découverte interfilesystem et localeC. GIT_CEILING_DIRECTORIES ne peut plus masquer le dépôt. Les refus autres qu’un128 explicitement notagitrepository restent failclosed. Ouverture et contrôlesfd0600/UID/nlink1/taille/avantaprès inchangés.
- DEPLOYMENT-PROOF-002 fermé : le vrai parseurBusinessOWNER compte les argumentsnonarray commeinvalid, valide que le tableau est suivi seulement d’espaces puis parenthèsefermante ; JSONparse/échappements/chunks restent utilisés. servedBuildIdentity refuse toutinvalid au lieu d’unfallback valide ; moduleA7 vérifie de nouveauinvalid avant extraction. Pas de parseur miroir dansA7.
- Validation receipt/expected intacte : huitattendus exacts indépendants, pasdecoercition/NULL sauf target autorisénull, refintegration/SHA/READYpreview/IDs/originecanonique ; capturedAt et horloge strictes/bornées/revalidées. Aucun BUILD_IDlocal ou API/fetch ajouté. Aucune modification desrunners parA7 ; le parser partagé durcit seulement les pagesFlight malformées, les contrôlesnormauxLOCAL demeurent leurcomparaisonlocal/servi.

Exécuté : `node --test scripts/qa/tests/deployment-proof.test.mjs` **17PASS,0échec,0SKIP**, dont lecture de la captureHTMLpublique4c déjà privée surdisque, sansnouveaufetch. `node --check` module et parser : PASS.

Reproductions indépendantes reprises sur snapshot gitarchive exact `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deployment-4a1d-review-4vl_b8ya` via `/tmp/depannage-deployment-4a1d-repro.mjs` : nonarraypush→FLIGHT_INVALID ; parenthèseabsente→FLIGHT_INVALID ; reçu dansGit→IN_GIT sansceiling et avecceiling canonique. Le test crée/nettoie seulement son propre dépôt temporaire et restaure l’environnement.

Aucun cloud, cookie, credentials, fixture distante, installation ou source éditée. L’attestationroot reste une entrée de confiance opérateur à durée bornée, pas une signature cryptographique. Lescallers doivent fournir expected depuis leur configuration indépendante, appelerverify avantfixtures, préserverLOCAL et publier leur revue distincte.
