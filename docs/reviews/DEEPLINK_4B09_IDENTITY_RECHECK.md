# FIX002 identité D4 — relecture 4b09e95

SHA exact : 4b09e957fac7c275f5da98735bbf1d11057d3858. Contrat A4 lu. Export figé /private/tmp/depannage-deeplink-review-4b09e95-Coa1xs. Aucun cloud/credential réel, source auteur, app28b, pin771 ou runROOT97375a8039b5 touché.

## Verdict

FIX002 fermé dans sa preuve d'identité. Nouveau P2 DL-QA-806-004 confirmé : login peut démarrer après STOP pendant logout. Pas feu D4 avant garde corrigée. La recette partielle ROOT D1/D2/D3 n'inclut pas D4 et n'est pas requalifiée.

18 tests fournis PASS, zéro échec/skip (vrais Chromium locaux compris). Le nominal D4 passe ; mini-app à mémoire sans identité FAIL ; reload pendantlogout BLOCKED ; login refusé BLOCKED après une seule tentative. Les contrôles Realtime, D1/D2, fuite transitoire D3 et finalisation présents restent verts. Aucun succès mini-app assimilé à l'app déployée.

## FIX002 vérifié

clientC est distinct, créé pour D4(g). Le contexte/page existants sont conservés ; après la fenêtre(f), sortie versrequests, marqueur mémorisé, logout puis login sameDocument une seule fois horsfenêtres, preuve identitéC et marqueur inchangé. revokeUser(clientA) invalide les autres handles ; rebind met dl-d4 sousclientC. La fenêtre(g) reprend exactement le UUID jamaisseedé de(e)/(f), attend1GET et introuvable, et assertWindow refuse les événementsauth/reload/focus pendant mesure. D4 est dernier car parseArgs filtre les scénarios selon SCENARIOS[D1,D2,D3,D4], même si --only est fourni dans un ordre différent.

## P2 DL-QA-806-004 — contrôle stop manquant autour du changement d'identité

scripts/qa-deeplink/scenarios.mjs:346–359 : après await switcher.logout(h), le code appelle revokeUser puis switcher.login sans vérifier ctx.gate. Ces nouvelles étapes ne passent pas par act/gate.check. Un SIGINT reçu pendant l'await logout n'empêche donc pas le login suivant. Les appels Supabase/auth sont hors de la barrière navigateur des mutations same-origin/api ; la seule inscription runOne au drain attend le scénario, elle ne bloque pas ces émissions.

Reproduction demandée, exécutée localement : vraie fonction SCENARIO_RUNNERS.D4 importée du SHA exact ; vrai Chromium et mini-app/helper de test existants. Le helper a été chargé/transpilé seulement en mémoire avec une injection minimale : logout retourne une promesse différée, gate.stop('SIGINT during deferred logout') pendant son await ; compteur dans login. Aucun fichier de test/app n'a été créé/modifié. Sortie réelle :

    calls.login = 1
    calls.loginAfterStop = 1
    D4.status = ANOMALY
    D4.error = fixture creation refused: the run is stopping (SIGINT during deferred logout)

L'erreur stop finit par être détectée lors de la prochaine fenêtre, APRÈS l'émission login : attendu login0, obtenu1. Une première probe du bloc exact extrait a confirmé la même séquence, puis cette reproduction complète D4 l'a confirmée avec le navigateur.

Correction ciblée : check stop avantchaque étape et aprèschaque await, immédiatement avant logout/login ; wrapper act existant possible. Si StopRequestedError survient, le laisser remonter avec sa sémantiqueSTOP (ne pas le transformer en BLOCKED précondition dans les catch génériques). Test régression réel D4 : logout différé +stop => login0 ; stop déjàlevé => logout0/login0 ; logininflight puisstop => aucune émission ni fenêtre suivante, seule finalisation existante.

Pas de demande de nouveaucontrat ou d'élargissement fonctionnel : préservation de la garde déjà exigée par le harnais.
