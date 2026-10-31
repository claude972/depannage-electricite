# Contre-revue CONTRAT SEULEMENT — 6fb13ad

Document exact : `docs/CLAUDE_DEEPLINK_QA_CONTRACT.md` aucommit6fb13ad. Lecture des primitives annoncées à la base7b05d3f pour vérifier leur applicabilité ; aucun code, cloud, navigateur, credential ou fixture exécuté/modifié. ROOT signale depuis A10 réel terminé/nettoyé : ce préalable est levé côtéexécution, mais les amendements ci-dessous restent à publier avantGOcode.

**Verdict : pas de P1 établi, quatre P2 contractuels/oracles à préciser avant GO. Ils ne constituent pas des bugs produit démontrés.**

## 1. P2 — preuve d’isolation Realtime insuffisante (§D1.1 et tests)

Zéroframe et badge déconnecté peuvent être observés si le handler n’a jamais intercepté la socket (pattern incorrect, absence de tentative, observateur tardif). Cela ne prouve pas que la route installée a bloqué le transport voulu.

Amendement : installation avantlogin et toute socket ; compteurhit du handler sur host/pathRealtimeattendus, fermeture effectivement résolue, compteurclosed correspondant, aucune connexionversserveur par le handler, aucuneframe métier reçue pendantfenêtre ; erreurhandler ou zérohit ⇒ BLOCKED/nonpreuve, jamaisPASS. Ne conserver que paths/compteurs/booleans, ni queryapikey ni framepayload. Tests négatifs : mauvaispattern/zerohit, handlerquiéchoue, socketnonbloquée ; ils ne doivent jamais réussir sur seul0frames. La route deblocage reste active jusqu’à fermeturecontexte.

## 2. P2 — « exactement1parcause » exige des causes réellement isolées (§D1.5–6,D2,D4)

Le minimum15s du scheduler est un cooldown, pas une garantie qu’aucun refresh ne puisse survenir dans10s : sa première signalisationfocus est immédiate (`lastEnd=-Infinity`) ; un timer antérieur peut aussi expirer dans la fenêtre. Headless n’est pas une preuve d’absence de focus/visibility. Par ailleurs waitForWorkspace/login émettent eux-mêmes des GET et ne prouvent pas que le bootstrapUI et ses callbacks sont tous terminés. Deuxlectures peuvent être légitimes si une autre cause intervient pendantA, conformémentA4.

Amendement : observer les **départs** de requêtes et leurs règlements paridentité locale de requête, installeravantlogin, borner la fenêtre après règlement des probesdriver ETbootstrapUI, journaliser focus/visibility commecompteurs/horodatages sans corps. Une fenêtre polluée par une autrecause/timer nonisolé ⇒ NONPREUVE/BLOCKED ou analyse causale séparée, pas FAILproduit automatique. Les probes helper partagés nonmarqués doivent rester horsfenêtre et réglés (ils ne portent pas nécessairement x-qa-harness). Chaque cause mesurée utilise la vraie navigationhash et les vrais boutonsActualiser/Réessayer, pas un appel API du harnais pour produire lecompte attendu.

Le test de doubleclic doit tenir une réponse par barrière contrôlée, constater le bouton désactivé pendantvol puis tenter la seconde action avantlibération. Un dblclick Playwright qui attend l’activation peut cliquer après la réponse et produire un fauxFAIL ; éviter de supposer qu’un stub immédiatement résolu exerce l’état en vol.

## 3. P2 — D4 ne teste pas la mémoire « absence aprèsloaded »

jobLate3 est légitimement absent du cacheinitial, puis devient PRÉSENT après la premièrelecture. Retourner sur ce mêmeID et observer0requête prouve le cachepositif, pas la mémorisation d’unID absent après une lectureloaded. Ce dernier est précisément le risque de boucle de l’anti-introuvable.

Amendement : conserver le caspositif, ajouter UUID négatif jamaisseedé, absence confirmée à la fixture/réponse complète de cecompte : première navigation ⇒1GET200 valide+introuvableaprèslecture ; liste→mêmeID/mêmecontexte ⇒0GET supplémentaire. Un503 ouprofilseul ne doit pas consommer cette preuve. Pas d’appelworkspace auxiliaire dans lafenêtre.

Pour D2 exécutable par --onlyD2, créer un dossier témoin AVANT sa session et confirmer sa présence avantfenêtre ; sinon « lesdossiers déjàvus restentlistés » peut être vérifié sur une listevide siD1 n’a pas été lancé. Cetteprécondition doit être indépendante des autres scénarios sélectionnés.

## 4. P2 — récupération Auth inconnue et cleanup générique à contractualiser (§1,§3,§5)

La sharedFixtures.createUser annonce l’ID dans lemanifest seulement APRES retour de createAuthUser. Cas concret à couvrir : serveurAuthcréé, réponse perdue ⇒ aucunUIDdanscreated. IntentLog seul conserve un inconnu mais ne fait pas de découverte ; à la baseannoncée, la récupération des createAuthUserouverts par email puispersistavantDELETE est dans `scripts/qa-tracking/run.mjs:cleanupWithProof`, et les wrappers se trouvent aussi dans TrackingFixtures/scenarios.mjs. Ces modules ne figurent pas dans les importsread-only annoncés ; finale/intents/auth-admin/ownership ne raccordent pas seuls cettegarantie.

Amendement : nommer l’adaptateur/API générique et sonSHA aprèsA10, avec réservation/refactor à sonowner si nécessaire, avant code du lot. PourchaqueAuth : emailcanonique/run etintentdurable AVANT émission ; discoveryexactemail sur perte de réponse ; schémavalide/ownership ; UIDrécupéré dans auth_users+profiles etmanifestfsync AVANT premierDELETE. Absence mêmeexhaustive ou simple404 ne ferme JAMAIS un intentcreateinconnu. Inconnuouproducerundrained ⇒cleanupINCOMPLETE/3, pas zéroinventé. Reprise froide charge les intents existants sans lesécraser (leconstructeurIntentLog vide appelle save), conserveouverts/reliquats et refuse suppression sur preuveambiguë. Org/sites/dossiers : mêmes contratsreadbackownership et ordreFK, ne pas réutiliser aveuglément des reconcilers tracking-only pour kindother.

Tests contractuels requis : Authcréé/réponseperdue/manifestinitialsansUID ; emailhorscohorterefusé avantlookup ; découvertefound→persistavantDELETE ; absence→intenttoujoursouvert ; crash entre adoptionetdelete puis --cleanup-manifest ; pannepersistance→zéroDELETE ; drainexpiré→zéroDELETE. Aucunadmin/grantimmuable et aucun nettoyageglobal.

## Précisions complémentaires utiles (non nouveaux bugs produit)

- Une canary seulement dansjobForeign rend le contrôlecorrespondant vacu pourjobB etjobS2 : attribuer une canary unique à chaque cibleD3, testerchaquevariante.
- « Jamais rendu » doit avoir un test négatif Chromium où le texteintrouvable est ajouté puis supprimé dans la même tâche ; le MutationObserver doit inspecter lesrecords/anciennesvaleurs, pas seulement lire le DOMfinal. Ne garder quebooleans.
- Distinguer explicitement un logout provoqué par503/profilmalformé (FAIL) d’une révocation externe prouvée (BLOCKED) : la simple apparition du formulaire ne prouve pas un «global logout» externe.
- Les tests Chromium sur serveurimitant lesvues valident le HARNAIS uniquement ; aucun PASSproduit/Realtime n’en découle. La vraie app auSHA servi vérifié reste la recetteROOT distincte.

Une fois ces amendements publiés/revus, le périmètre neuf et les importsread-only sont raisonnables. Pas de modificationproduit/backend/SQL ni nouveauworker nécessaire pour cette contre-revue.
