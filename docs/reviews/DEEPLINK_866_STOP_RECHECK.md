# Recheck FIX004 — STOP pendant le changement d'identité

SHA exact : 86651bca1d7c924ee63c3d607c208df64e280e10. Diff4b09..866 : scénarios et tests uniquement. Export figé /private/tmp/depannage-deeplink-review-86651bc-UUsQuu. Aucun cloud/credential réel, aucun changement auteur, app/pin ou runROOT.

Reproduction indépendante complète : vraie SCENARIO_RUNNERS.D4 du SHA, Chromium local et mini-app/helper existants. Même injection en mémoire que lors de la découverte4b09 : promesse de logout différée, gate.stop pendant son await, compteur d'appel login. Aucun fichierapp/test modifié.

Résultat : login0, loginAfterStop0. StopRequestedError remonte sous la même sémantique « run is stopping » (rapport scénario ANOMALY), sans conversion BLOCKED. Le cas correspondant sur4b09 donnait login1/loginAfterStop1. P2DL-QA-806-004 fermé sur cette reproduction.

Source : l'étape step encapsule act(ctx.gate,fn), donc vérifie avantémission/aprèsawait. Les erreursStop sont explicitement relancées avant le catch BLOCKED de précondition. Navigation versrequests, lecture des marqueurs, logout, login, rebind et preuve identité sont gardés ; aucune seconde connexion après erreur.

FIX002 reste préservé : clientC distinct, même page/document, marqueur inchangé, auth horsfenêtre, revokeUserA/rebindC, même UUIDabsent,1GET dansfenêtre sans événementauth ; D4dernier parordre canonique duparseur. Le nominal mini-app ne prouve pas le produit public en runtime.

Le runROOT97375a8039b5 annoncé4/4PASS a couvert D1/D2/D3 seulement : D4reste exclu de cette preuve, aucune réussite n'est héritée.

Suite complète exécutée : 19 tests qa-deeplink PASS, zéro échec/skip. NominalD1–D4, mémoire sansidentité FAIL, reloadBLOCKED, loginrefusé1tentativeBLOCKED, STOPpendantlogout0login/0nouvelleworkspace, négatifsD1/D2, latchtransitoireD3 et protocolefinallifecycle verts. Tests uniquement serveurs/Chromium locaux et mini-app ; aucune preuve du produit distant extrapolée.

Verdict final : FEU borné pour recette ROOT D4 sur ce SHA ; aucun P1/P2 restant trouvé dans la correction FIX004 et sa compatibilité identité examinée. Revue indépendante des autres pans du harnais conservée, aucune acceptation générale de l'application.
