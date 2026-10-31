# Revue B2 observateurs — 806cfeb

SHA exact : 806cfeb3c7963a3a117b184ec4d472c93a9af21a. Source exportée par git archive dans /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deeplink-806-review-o_hnk0oy ; aucun fichier du checkout auteur courant utilisé. Contrat e357a55. Cible applicative déclarée : 28b9b797f678646b3b7b6511273349511b6f3962, non exécutée ici. Périmètre : observe/window/realtime-block/args/probe, scénarios correspondants et tests. Aucune opération cloud, credential réel, installation ou modification source.

Verdict : un P2 de faux PASS de l’oracle D3, à corriger avant de considérer la recette comme preuve d’absence de fuite. Aucun P1 trouvé dans ce périmètre. Ce rapport ne couvre pas la sûreté globale du cleanup, examinée séparément.

## P2 — une fuite DOM transitoire d’UUID étranger passe D3

Source : scripts/qa-deeplink/scenarios.mjs:266–277, scripts/qa-deeplink/lib/probe.mjs:11–38 et51–60.

D3 attend deux fenêtres complètes puis appelle leakFlags une seule fois (275). Le MutationObserver préinstallé ne mémorise que les libellés loader/notfound/error, pas les canaries ou IDs étrangers. Une donnée étrangère affichée pendant le chargement ou brièvement à côté du notfound, puis retirée avant275, n’est donc pas détectée. Le test final déclare pourtant « no id leak ».

Reproduction réelle locale : /tmp/depannage-deeplink-806-transient-repro.mjs. Elle réutilise les vrais setupDeeplink/SCENARIO_RUNNERS/pool/probe/observer/windows du SHA exporté et la mini-app de la suite auteur ; seule la mini-app affiche l’UUID étranger dans un paragraphe pendant50ms après chaque rendu notfound, puis retire ce paragraphe. Aucun workspace ne contient les dossiers étrangers et aucun réseau cloud n’est utilisé. Les trois variantes D3 ont réellement traversé ce DOM défectueux. Résultat exact enregistré dans /tmp/depannage-deeplink-806-transient-repro.log :

ACTUAL_D3_WITH_50MS_FOREIGN_ID_LEAK {"D3":{"status":"PASS","error":"D3: foreign client/artisan/enterprise ids ⇒ one refresh then the existing wording; no canary, no id leak"}}

Correction attendue : armer avant chaque hash une observation persistante booléenne des aiguilles de cette variante (canary/ID), texte et data-/aria-, y compris ajouts/modifications transitoires ; ne conserver aucune valeur sensible. Asserter après chaque fenêtre que rien n’a jamais été observé, sans remise à zéro pouvant effacer la première exposition. Ajouter un négatif réel qui fait apparaître puis retire une fuite avant le contrôle final, attendu FAIL.

## Vérifications exécutées

Commande : node [tsx existant]/dist/cli.mjs --test tests/qa-deeplink.test.ts tests/qa-deeplink-realtime-route.test.ts tests/qa-deeplink-scenarios.test.ts, avec Playwright et Chromium1248 déjà en cache. Sortie privée /tmp/depannage-deeplink-806-tests.log : 16tests PASS,0FAIL,0SKIP,21.35s. Comprend trois contrôles WS réels locaux, scénarios D1–D4 sur mini-app conforme et variantes défectueuses eager-notfound/double-fetch/clear-on-failure attendues FAIL. Ce résultat est compatible avec le faux PASS supplémentaire ci-dessus ; ce n’est pas une validation Supabase ni du build applicatif cible.

Lecture : gate16s depuis dernier focus/blur/visibility + zéro inflight +1s quiet ; timeout45s BLOCKED. Compteurs request-start et requêtes en cours ; fenêtre propre count≠expected => AppDefect, pollution focus => BLOCKED. WS normalise wss/https et ws/http, filtre origine/path exacts, await close, aucun code PageWebSocket requis, données enregistrées sans query. Le handler différé D2 est désormais libéré dans finally et unroute utilise le même matcher. Aucun défaut concret supplémentaire établi dans ces mécanismes au périmètre relu.

P3 contractuel, sans en faire un blocage supplémentaire : D2 exige witnessSeen réel avant stub (161–164), mais ne vérifie pas encore sa visibilité DOM avant ce stub comme demandé par A3b. Le témoin est cependant explicitement vérifié depuis le cache après chaque échec ; la régression clear-on-failure est bien détectée par les tests exécutés.

Prochaine gate : nouveau SHA avec correctif de l’oracle D3, revue ciblée et négatif transitoire. Ne pas transformer les16PASS de mini-app en preuve de non-fuite produit ni en PASS Realtime réel.
