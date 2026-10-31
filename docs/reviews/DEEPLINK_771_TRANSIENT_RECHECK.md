# Recheck DL-QA-806-001 — 7713c99

SHA exact : 7713c99d47c0640e341c8084001de7eda21098ba, export git archive isolé /var/folders/z7/f6y31dzs5yn2k2rh4fb68z_40000gn/T/depannage-deeplink-771-review-_30bb6kw. Aucun checkout auteur lu pendant les tests. Revue bornée au correctif de fuite D3 ; ni D4 identity002 ni cleanup003 ne sont validés par ce rapport.

Verdict sur001 : P2 fermé. Le même contre-exemple réel qui donnait PASS sur806 donne maintenant FAIL avant la deuxième fenêtre. Aucun nouveau P1/P2 établi dans cette correction.

Preuve source : scenarios.mjs269 arme le latch avant measure/hash ;271 lit les booléens après chaque fenêtre ;273–274 convertissent les apparitions de canary/UUID en AppDefect. La fenêtre suivante ne réarme qu’après cette assertion. probe.mjs68–99 scanne les données déjà présentes, les textes/ajouts et mutations data-/aria-, garde des flags croissants, attend une tâche avant lecture ; les aiguilles restent en mémoire de la page et aucune valeur de fuite n’est persistée dans le résultat.

Reproduction indépendante : /tmp/depannage-deeplink-771-transient-repro.mjs est la reproduction806 inchangée, hormis les chemins des imports vers le nouvel export et le libellé de sortie. Même mini-app affichant un UUID étranger50ms avant retrait, vrais Chromium/pool/scénarios/observers. Résultat dans /tmp/depannage-deeplink-771-transient-repro.log :

RECHECK_771_D3_WITH_SAME_50MS_LEAK {"D3":{"status":"FAIL","error":"D3 dl-d3a foreign id: foreign dossier id appeared in the DOM (text/data/aria), even transiently"}}

Suites exactes exécutées : tests/qa-deeplink.test.ts, tests/qa-deeplink-realtime-route.test.ts et tests/qa-deeplink-scenarios.test.ts avec tsx/Playwright/Chromium1248 préexistants. Résultat : 17tests PASS,0FAIL,0SKIP,25.25s. Les négatifs Chromium flashText/flashData/flashAria sont réellement exécutés et attendent FAIL du scénario. Cas nominal D1–D4 et contrôles WS réels PASS. Journal /tmp/depannage-deeplink-771-tests.log. Les tests de003 compris dans cette commande ne remplacent pas une revue indépendante de son code hors périmètre.

Aucun credential réel, cloud, installation, mutation Git ou modification source. Le contrôle local porte sur l’oracle de recette, sans établir une absence de fuite sur l’application Supabase cible. D4 identity002 reste OPEN selon le pilote.
