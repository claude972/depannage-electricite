# Contre-revue A3b — e357a55

SHA exact : e357a5551c89b9a6b4b9d66a0d14a9d2c71dca14. Contrat uniquement : docs/CLAUDE_DEEPLINK_QA_CONTRACT.md, diff f4021ac..e357a55 et tableau des verdicts relus. Aucun cloud, credential, code ou test applicatif exécuté.

Verdict : aucun P1/P2 contractuel restant dans le périmètre demandé ; proposition GO B2 borné à ROOT après B1 accepté. Cette revue ne valide ni le futur code B2 ni des parcours réels.

- P2 WS fermé : assertions de code PageWebSocket retirées des anciennes sections et A3 ; événement facultatif, seuls fermeture et compteurs exposés utilisables. Code4000 réservé au CloseEvent natif du contrôle local ; preuve distante handler exactmatch + close résolu + zéro connectToServer + absence erreur. Normalisation explicite wss/https et ws/http, host/port/path conservés selon A3b.
- P2 D2-only fermé : dossier témoin propre créé avant la session, readback puis vrai bootstrap UI contenant son ID et présence visible avant interception. Témoin conservé après503 puis200 invalide, sinon FAIL ; absence de preuve initiale BLOCKED. --only D2 crée son témoin indépendamment des autres scénarios.
- Gate16s + drain +1s quiet conservé ; timeout45s BLOCKED. Tableau FAIL conserve plus d’une requête par cause et requête dans fenêtre calme. Lecture requise de « unattributed » : pollution passive démontrée seulement, aucune requalification systématique d’un doublon causé par l’application en BLOCKED.
- B1 : acceptance par peer/ROOT reçue du pilote ; non rejouée et non contre-revue dans cette mission limitée. B2 doit utiliser le SHA/API B1 réellement accepté, les imports tracking en lecture seule et ses fichiers réservés ; pas d’autorité supplémentaire sur helpers partagés.

Prochaine gate : revue indépendante du SHA B2, tests du vrai handler et des fenêtres, oracle témoin D2 et reprise/cleanup durable. Pas de cloud autorisé par ce rapport, aucune preuve Realtime effective dérivée du contrôle de blocage.
