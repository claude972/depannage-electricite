# B2 scénarios D1–D4 — contre-revue 806cfeb

SHA harnais exact : 806cfeb3c7963a3a117b184ec4d472c93a9af21a. App oracle exacte : 28b9b797f678646b3b7b6511273349511b6f3962 (pas28b2f6e coordination). Contrat docs/CLAUDE_DEEPLINK_QA_CONTRACT.md jusqu'àA3b et claimB2 lus. Export figé : /private/tmp/depannage-deeplink-review-806cfeb-82g46C. Aucun cloud, credentials réel, mutation source ni switch auteur.

## P2 — D4(g) ne vérifie pas le changement d'identité annoncé

scripts/qa-deeplink/scenarios.mjs:325–331 ouvre freshSession('dl-d4g', user), user étant encore clientA. Le nouveau contexte navigateur charge un nouveau document avec une mémoire JavaScript initialement vide. Une lecture pour le UUID absent y est attendue même si l'application ne clé sa mémoire par aucune identité/contexte : ce contrôle ne prouve donc pas la remise à zéro de la mémoire d'absence lors d'un changement d'identité. A2(g) demande explicitement another identity ; la note finale annonce absence memory per context au-delà de ce qui est testé.

Preuve de couverture concrète : la mini-app fournie utilise st.memory[id] sans aucune clé d'identité/contexte et pourtant son D4 PASS, constaté dans le test exécuté. Ce n'est pas un défaut produit démontré ; c'est un trou du contrôle d'acceptation d'isolation.

Correction à contracter : contrôle sous une autre identité de cohorte (et, si la preuve visée est le reset du cache dans le même app, changement d'identité dans le même document hors fenêtre, document/identité vérifiés avant une nouvelle fenêtre). Toute relogin doit rester explicite hors mesure, respecter le logout global/pool et ne jamais être ajoutée au point d'échec. Sinon réduire explicitement le contrat/rapport à nouvelle session indépendante, sans annoncer le reset identité vérifié. Les essais de protocole/auth doivent être définis avant code.

## Contrôles positifs

16 tests existants PASS, zéro échec/skip : trois contrôles WS natifs/route, deux tests Chromium des vrais scénarios sur mini-app (D1–D4 normaux + variantes cassées eager-notfound/doublefetch/clear-on-failure), unités observer/gate/arguments/journal/nettoyage. Les scénarios mini-app prouvent le harnais contre cette reproduction locale ; ils ne valident PAS les vues28b9 en navigateur réel.

Oracles comparés à l'app28b9 :
- Client détail affiche la description exacte àclient-space1115 ; Loader Recherche du dossier…, titre Dossier momentanément indisponible, data-blocker deeplink:error et Réessayer correspondent aux vrais composants.
- Artisan mission utilise Dossier introuvable ; entreprise Dossier introuvable sur ce périmètre. Hashes detail/mission corrects. Badge non connectée · Actualiser exact conforme.
- D1 crée après login avec lecture seedcount1, Realtime intercepté avant login, une fenêtrehash même document, absence d'introuvable observée et description visible avant10s. Pas reload/login/réparation au point d'échec.
- D2 crée son témoin avant session, preuve bootstrap réel id présent avant stub ; après503 et200profil-seul, navigation témoin depuiscache sansGET puis retour erreur sansGET. Le stub limite les deux réponses prévues, le second reste différé pour vérifier un seul vol/bouton indisponible ; libérationfinally. Troisième retry réel,5xx/transport=>BLOCKED, pas PASS.
- D4(a–f) vérifie présence chargée, revisite0, actionActualiser1, silence0, UUID jamaisseedé1 puis revisite0 sansloader. La fin du200 et le document/auth/focus sont contrôlés dans les fenêtres.

## Limites de preuve D3 (à conserver au rapport)

Les vérifications canary/id du DOM ont lieu UNIQUEMENT après la deuxième fenêtre, via leakFlags au point final. Elles couvrent texte visible et attributsdata/aria finaux ; elles ne détectent pas une fuite DOM transitoire supprimée avant ce point. La présence de canary dans les réponses workspace est en revanche enregistrée passivement pendant toute la page, booléen uniquement. Les requêtes détaillées du dossier étranger observées doivent être404 ; l'absence de telles requêtes est admise. Le statut étranger n'a pas de piège DOM distinct. Ne pas annoncer une preuve générale d'absence de toute fuite transitoire ou de tout champ privé à partir de ces contrôles finaux.

La clause initiale de détection d'écran public n'a pas de marqueur explicite dans PROBE_SOURCE (loading/notfound/error seulement) ; les requêtes logout/password sont détectées et une identité finale est vérifiée horsfenêtres. Ne pas présenter cela comme une surveillance continue de toute apparition transitoire du formulaire public.

Verdict : D4(g) à corriger/qualifier avant acceptation de la preuve globale d'isolation ; pas de défaut supplémentaire trouvé dans les oracles D1/D2 et le contrôle final D3 dans leurs limites déclarées. Une recette partielle ROOT D1/D2/D3 peut rester distincte si le coordinateur l'autorise après sa revue des autres fichiers. LIVE-WORKSPACE efficacitéRealtime et troncature100 restent OPEN ; pas de verdict global harnais/runtime cloud ici.
