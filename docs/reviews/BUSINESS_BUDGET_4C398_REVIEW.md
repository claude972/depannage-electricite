# Revue Business + Budget — 4c398e8

SHA exact `4c398e8393026598c5b629d3912cf80285acc2f5`, brancheclaude/web-qa-business, worktree propre avant/après. Contrat21f0249 antérieur au code ; correctionsa5f5801/e27dd8b/88bc4f6 incluses. Rapport historique missionsb904 `docs/reviews/BUSINESS_4BD_557_REAL.md` lu : run78a5f871aaba sur557 reste8PASS/6FAIL/1ANOMALY, cleanup root indépendant cité, aucune réinterprétation en succès.

**Verdict borné : aucun P1/P2 identifié dans ces corrections ; accord pour fusion/reconstruction root puis nouvelle recette. Aucun résultat navigateur réel déduit des tests locaux.**

## Corrections vérifiées

- **Validité canonique** : `scripts/qa-business/lib/prerequisites.mjs:snapshotValidUntil` et suite docs lisent bien `snapshot.quote.terms.valid_until`, conformément à015 et snapshot.ts. Une propriété absente reste undefined et l’assertion contre la date attendue échoue ; aucun repli sur l’ancien champ ne masque une erreur.
- **Dépendances** : trois scénarios utilisant documentId passent par scenarioWhen, avec UUID strict ; lectureclient exige aussi ETag et taille du téléchargementartisan. Missing entraîne BLOCKED explicite sans construire requêteundefined. Le FAIL amont est conservé. Reproduction indépendante avec vrai rapport/helper : FAIL amont + BLOCKED dépendant, zéro requête, sortie1. BLOCKED seul n’est jamais PASS ; son code0 isolé suit le contrat existant, root doit lire les compteurs.
- **Générationclient** :015 autorise explicitement generate_quote_document à owns_intervention (clientdemandeur/gestionnaire habilité), après can_access_intervention ; l’aperçu can_generate l’expose. La nouvelle attente de bouton + droitsAPI true/false/false est cohérente, sans modification de produit/RLS/issuer. Validité et proposition d’avenant restent absentes pour le client. La suite ne clique pas la générationclient : elle prouve l’offreUI/capacité, pas une exécution de cette commande par le client.
- **Devisexpiré** : POST409 attendu et relecture DB quote.sent/job.quoted conservés. Alerte réelle `.alert.error[role=alert]` correspond à Alerts ; noteQuoteView `p.form-note` et carte `article[aria-labelledby=quote-ID]`/tag correspondent au markup actuel. Une phrase informative «devis accepté» ailleurs ne sert plus de statut. Re-navigation par vrai bouton et carteEnattentededécision après relecture, sans succès accepté.
- **Budgetproduit** : `BudgetPanel` dérive selected via effectiveFiscalYearId à chaque rendu ; year, yearLines, consumption et select utilisent tous cet ID. La commande de ligne utilise year.id issu de cette même sélection. Le passage rapport0année→premièreannée rend donc immédiatement le tableau et sesSaisir, même si chosen était restévide ; aucun effet dépendant d’un remontage. Le choix utilisateur existant est conservé pendant rafraîchissement. La création explicite d’une année couvrant aujourd’hui choisit cette nouvelleannée, comme l’amendement livré ; création noncourante ne vole pas le choix. Le harnais cible maintenant la ligneMaintenance et sonbouton exact, sansfirstarbitraire.
- **503adaptateur** : les deux frontières attendues existent réellement : parent FeatureUnavailable `siteOperations:unavailable` avectitre/réessayer, et feuille `site-operations-load` avectitre/messageexact. Absence de liste et noméquipement périmés exigée. Après désinterception, le test cliqueRéessayer, attend une vraieGET200, puis données etcontrôleécriture ; marqueurwindow conservé interditunreload et workspace.profile.id imposeowneridentique. Aucune exception convertie enPASS ni rechargement ajouté pour contourner le défaut.

## Vérifications exécutées

Source figée par gitarchive : `/var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-business-4c398-review-da3h6ew0`. Dépendancescache existantes, aucune installation.

- `tsx --test tests/qa-business.test.ts tests/site-operations/view-model.test.ts` : **48PASS,0échec**. Comprend forme canonique du snapshot réel via parser, BLOCKED sansundefined, statuts ciblés, sélectionvide→création→reportrafraîchi et choixvalidepréservé ; gardescleanup/stop précédentes toujoursvertes.
- `tsc --noEmit --incremental false` : PASS.
- Syntaxe deux suitesJS : PASS.
- Repro indépendante FAIL/BLOCKED/exit1 ci-dessus : PASS.

Tests budget = fonctions réellement appelées par le composant et revue de toutes leurs utilisations rendu/commandes ; pas montageDOM ni clic navigateur dans cette revue. Le test503 est une source de recette Playwright relue, pas une recette exécutée ici. Aucun build, cloud, credentials, compte, GPS ou migration touché. PWA ajouté par merge4c398 n’est pas revalidé dans ce périmètre. Nouvelle recette root sur SHA servi vérifié reste requise après reconstruction ; résultats557 historiques conservés.
