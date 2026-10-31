# Contre-revue contrat A3 — f4021ac

Source exacte : f4021acbfeac723dc81d8df64effc71945bc5c09, docs/CLAUDE_DEEPLINK_QA_CONTRACT.md. Revue du contrat uniquement ; aucune modification applicative, credential, installation ou opération cloud. Le contrôle local Playwright déjà réalisé pour 914cfae n’a pas été répété.

Verdict borné : B1 extraction seule cohérente avec la propriété réservée et la mission ROOT 1b3b81d. Ce constat n’est ni une revue du futur code B1 ni un GO B2. Deux amendements restent nécessaires avant B2.

## P2 — code de fermeture encore exigé sur une API qui ne l’expose pas

Ligne 290 : si page.on("websocket") émet, le contrat exige encore que sa fermeture concorde avec code4000. Supprimer cette exigence même dans ce cas. Playwright1.64.1 WebSocket.on("close") fournit l’objet WebSocket, sans code. Le contrôle local précédent établit aussi que la socket non routée émet bien cet événement mais sans code ; une socket routée peut ne pas émettre de PageWebSocket du tout. Le caractère optionnel de l’événement ne rend donc pas son code accessible.

Amendement minimal : PageWebSocket, lorsqu’émis, permet seulement les observations exposées (fermeture/compteurs de frames). Aucune assertion de code depuis cette API. Code4000 réservé au vrai CloseEvent natif du contrôle local. Les preuves obligatoires handler hits/exactmatch/close résolu/no-connect/error de 285–289 suffisent au scénario distant. Référence du contrôle réel antérieur : /tmp/depannage-deeplink-ws-api-review.mjs et /tmp/depannage-deeplink-contract-914-review.md.

## P2 — D2-only : préservation de liste toujours potentiellement vacante

Lignes94 et103–104 : une session D2 indépendante précède jobLate2 ; aucune étape ne garantit un dossier visible avant les deux réponses invalides. Avec --only D2, la liste initiale peut être vide. Une implémentation qui efface les anciennes données passerait alors l’oracle « earlier list stays ».

Amendement minimal : créer un dossier témoin clientA avant l’ouverture de la session D2, prouver sa présence dans le workspace chargé et dans la liste avant interception ; créer seulement jobLate2 après login. Après chacun des échecs, vérifier que ce même dossier témoin reste présent. Le scénario doit se suffire à lui-même sans D1/D4. Précondition absente => BLOCKED, jamais preuve de conservation.

## Corrections acceptables et limites

- Gate focus lignes299–308 : les16s depuis dernier événement (ou création), installation avant login, aucun inflight,1s quiet et timeout45s ferment le cas connu du timer de focus t7→t15. Le prouver dans les tests du futur harness ; aucune preuve produit/cloud ici.
- Éviter un masquage de régression à306 : seuls les événements passifs démontrés rendent une fenêtre non attribuable. Dans une fenêtre propre, deux requêtes provoquées par la même action restent FAIL selon106/141 ; ne pas classer toute requête excédentaire comme « inconnue » puis BLOCKED.
- Origine exacte WS : le code futur devra convertir explicitement https→wss et http→ws avant comparaison, conserver host/port et chemin exact. Une comparaison littérale avec l’origine HTTPS des credentials ne pourrait pas matcher WSS.
- B1 lignes312–325 : fichiers réservés limités, fonction de cleanup obligatoire sans défaut, hook paramétré, wrapper tracking conservé, mêmes champs/manifeste/verdicts et assertions historiques ; extraction distincte à revoir avant B2. Les57tests annoncés sont une exigence contractuelle, pas une exécution de cette revue.
- Revue B1/B2 future : vérifier persistance aussi des profils récupérés, reprise froide des intents sans écrasement, recoveryCommand propre au harness appelant et provider intents non clos par no-op. Ces obligations de compatibilité n’autorisent aucune modification des shared helpers.

Aucun nouveau contrôle cloud, compte, socket Supabase ni fixture. Aucun statut PASS de D1–D4 ou de Realtime réel déduit de cette revue.
