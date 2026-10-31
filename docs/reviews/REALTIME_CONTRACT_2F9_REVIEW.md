# Revue contrat Realtime — 2f9d7a5

Source exacte : 2f9d7a570d2d079ae68a98fcc25270561d4e0750, docs/REALTIME_DIAGNOSTIC_CONTRACT.md (31 lignes), lu via git show. Lecture seule, aucun code, credential ou cloud. Contrat non prêt pour GO code en l’état : trois P2 d’oracle/protocole à amender ; aucun défaut applicatif causal établi par cette revue.

## P2-1 — INSERT unique incompatible avec quatre canaux séquentiels

Ligne19 prévoit un seul dossier/INSERT après ouverture de session ;20 prévoit successivement quatre canaux, un par mesure, chacun fermé ensuite ;26 veut constater le même INSERT par canal. Un canal abonné après le premier INSERT ne rejoue pas cet événement. Les témoins ultérieurs peuvent donc manquer l’événement même avec un fournisseur fonctionnel. Cela invalide les comparaisons H1/H3 de28.

Amendement minimal : même compte QA, mais un dossier/INSERT propre par mesure, créé APRÈS join de ce canal et après établissement de son état d’authentification ; ID exact, intent durable avant émission, readback count1/ownership puis attente10s. Corréler en mémoire l’événement INSERT à cet ID exact, en ne persistant qu’un booléen. Canal fermé/drainé en finally avant mesure suivante. Timeout join/insert outcome inconnu => NON CONCLUANT, jamais preuve de perte d’événement. Quatre IDs doivent figurer dans manifeste/cleanup.

## P2-2 — claim local ne prouve pas le rôle du jeton effectif du canal

Ligne25 promet une preuve du rôle socket en décodant un claim local, sans nommer le jeton ni le point de capture. Le jeton de la session Auth peut être authentifié tandis que le join porte un jeton absent/ancien/anon (H2 est précisément cette hypothèse). Le SDK local2.118 RealtimeChannel.js148–155 construit le join à partir de socket.accessTokenValue ;164–166 peut aussi appeler setAuth après la réponse. Inspecter seulement la session ne distingue donc pas H2.

Amendement minimal : définir avant code le point de projection volatile du jeton réellement envoyé dans le join et dans ses updates access_token, lié au canal et à la période de mesure. Ne persister que des booléens role/sub concordants et temps relatifs ; jamais trame, jeton, claims, hashes durables, logs de socket ou de payload. Comparaison à une identité QA indépendamment vérifiée et réévaluation avant INSERT après tout changement de token. Si la capture du jeton effectif ou sa liaison à cette mesure n’est pas démontrée => rôle INCONNU, pas « false » transformé en H2. Le claim transmis n’est pas, à lui seul, une observation de l’identité utilisée par l’évaluateur RLS serveur.

## P2-3 — absence d’événement ne prouve pas une erreur RLS

Ligne28 classe H3 dès que rôle/bindings semblent corrects, sans systemerror et sans événement sur interventions seul. Cette combinaison est également compatible avec retard/perte de livraison fournisseur ou échec non observé. Même avec les deux corrections précédentes, elle n’établit pas que can_access_intervention a été évaluée en erreur. Elle ne remplit pas l’exigence16 de distinguer les causes.

Amendement minimal : cette combinaison devient NON CONCLUANT/H3 possible ; H3 confirmée exige une preuve positive dédiée et bornée d’échec RLS pour la mesure/identité, sur protocole distinct si nécessaire. Ne pas autoriser des lectures globales de logs contenant des données utilisateur pour obtenir cette preuve. Garder H1/H2 comme observations limitées plutôt qu’une causalité système générale.

## Éléments relus et conditions à expliciter dans l’amendement

- Les quatre bindings app au baseline58b76414 (courant-app.tsx515–529) correspondent à la description. package-lock du SHA contrat épingle supabase-js/realtime-js2.118.0. Le SDK installé confirme joinok sans postgres_changes => SUBSCRIBED et comparaison positionnelle/mismatch => CHANNEL_ERROR. L’absence payments de publication est un constat ROOT historique, non revérifié ici et non démontré causal.
- Scopes positifs du contrat : compte client QA unique, aucun admin, aucune modification app/API/SQL/publication/policies ; autorisation code puis exécution ROOT seules ; aucune conclusion Realtime depuis un simple badge SUBSCRIBED. Ces bornes sont appropriées.
- Avant émission Auth (pas seulement avant login), inscrire le canonical email/run dans un intent durable ; réutiliser TrackingFixtures/B1 exact accepté et la reprise froide de son journal. Lost Auth response => discovery exact email, Auth+profiles récupérés persistés avant DELETE ; absence/erreur reste inconnue et exit3. Le simple « identifiant avant authentification » de19 ne spécifie pas cet ordre de création, le nommer explicitement pour éviter une régression déjà connue.
- Désigner les fichiers QA nouveaux et l’owner avant code ; imports QA partagés lecture seule, aucun remplacement du jeton ou service_role dans la page, aucune instrumentation produit ou capture brute. Sonde SDK volatile à documenter/tester avec tokens fictifs horscloud avant tentative ROOT.
- Préflight ROOT : aucune cohorte active connue, build/app/SDK exacts, identité QA vérifiée, publication/grants relus sous scope autorisé ; refus en cas de transport/service indisponible. Cleanup/finally/drain et manifeste privé0600 restent obligatoires quel que soit résultat du diagnostic.

Rapport sans exécution de tests ni tentative fournisseur. Les amendements suffisent à rendre les observations possibles ; ils ne préjugent ni la cause de LIVE-WORKSPACE-001 ni son correctif.
