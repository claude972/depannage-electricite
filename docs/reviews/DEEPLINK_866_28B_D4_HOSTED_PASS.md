# Recette D4 hébergée — 31 octobre 2026

Application exacte `28b9b797f678646b3b7b6511273349511b6f3962` sur https://depannage-electricite-7y7ub5wcg-brafas-projects.vercel.app, Flight `mYTq7jnyFyd_WanJwnbB3`. Harnais PINNÉ `86651bca1d7c924ee63c3d607c208df64e280e10`, app-dir28b détaché ; nouvelle attestation ROOT READY/GitSource/HTML avant fixtures.

Run `9f8cd3b6626d`, `/tmp/depannage-deeplink-866-28b-d4-real`, D4 SEUL : setup PASS13143ms, D4 PASS41437ms,2/2PASS,0FAIL/ANOMALY/BLOCKED,exit0,fin23:24:09.293UTC.

D4 contrôle : une lecture par cause, revisite d’un dossier présent sans lecture supplémentaire, Actualiser une lecture, fenêtre silencieuse sans lecture ; UUID jamais créé une lecture puis absence mémorisée sans lecture à la revisite. Précondition contrôlée de changement d’identité clientA vers clientC par logout/login dans le MÊME document, hors mesure, marqueur conservé, poolclientA marqué révoqué ; même UUID absent sous nouveau contexte exige une lecture, sans auth dans la fenêtre. Realtime volontairement bloqué : pas de preuve d’efficacité des événements, ni de dossiers historiques au-delà100.

Le correctif004 a été relu avant exécution : l’injection locale STOP pendant logout différé émet0login après STOP ;19tests PASS dont variante memoryNoIdentity FAIL, reload BLOCKED, loginrefusé1tentative BLOCKED. Aucun STOP réel nécessaire pour cette recette nominale.

Cleanup29PASS,drain0,intentsouverts0,unproven0. Après FINPTY98962, ROOT a relu le script indépendant vs973 (seuls run/chemins/pins/nombres/sélection), puis exécuté les47lectures :7Auth404legacyexact,33REST0,7préfixesStorage0 à23:24:45.740UTC. Cohorte finale7comptes/1organisation/2sites/4dossiers, entièrement nettoyée. ScriptSHA256084c825d13fb18a4d6ae17a6026030ead49cae8a2dc189279af63e86efd51720 ; sortie JSON validée sauvegardée0600 independent-postflight.json. Ne pas réutiliser cette cohorte.

Avec le run973 D1–D3 (harnais771, même application28b), les4scénarios ciblés ont chacun une preuve hébergée. Les modifications771→866 sont les contrôles D4/STOP et le compteQAclientC ; aucune application déployée n’a changé entre les recettes. Ce checkpoint ferme WEB-DEEPLINK-QA-B2-001, pas la totalité de la tranche Web/PWA : LIVE-WORKSPACE-001, limite100, vérifications opérateur/admin positives et Stripe restent distincts. Intégrationharnais58b76414f6233220f938dbc42681c089abe58316 poussée,745tests+tscstrictPASS etCI41252298721SUCCESS ; aucun déploiementEdge/migration/production.
