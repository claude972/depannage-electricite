# Contre-revue contrat Realtime — 348a9b2

SHA exact : 348a9b2b50775d04a937a97b92b2b9e1819d8eea. Lecture git show/diff du seul docs/REALTIME_DIAGNOSTIC_CONTRACT.md, aucune exécution, credential, opération cloud ou édition source. DETAIL n’est pas couvert et n’est pas accepté par ce rapport.

Verdict : amendement utile mais GO code encore conditionné aux précisions ci-dessous. Les anciens P2-1 etP2-3 sont fermés ; P2-2 ferme la confusion session/JOIN mais pas encore la période post-JOIN.

## Fermetures

- P2-1 : INSERT distinct par mesure après le join, UUID généré et manifesté avant émission, canal séquentiel fermé après fenêtre, événement corrélé à l’ID propre. Les canaux témoins peuvent désormais recevoir leur propre événement. Le code futur devra readback l’INSERT et drainer en finally ; ce ne sont pas des tests exécutés ici.
- P2-3 : absence d’événement sans erreur devient INCONNU ; H3 requiert une indication positive RLS. Plus de causalité RLS déduite de la seule absence.
- P2-2 partiellement : jeton réellement porté par le JOIN explicitement intercepté localement et projeté sans persistance brute, canal/époque liés. Cela remplace correctement le simple claim de session locale.

## P2 restant — jeton effectif après le JOIN non suivi

Le contrat ne capture que access_token dans le JOIN. Or le SDK2.118 examiné dans la première revue appelle setAuth après joinok (RealtimeChannel.js164–166) et peut émettre des updates access_token. Un JOIN sans jeton utilisateur, puis un update authentifié avant l’INSERT, serait classé H2 par le tableau alors que l’INSERT est observé sous une autre époque d’authentification. À l’inverse, un token JOIN correct n’établit pas son maintien jusqu’à l’INSERT.

Amendement minimal avant code : même projection volatile pour les messages access_token effectifs du canal, compteur d’époque/auth, contrôle du dernier état avant INSERT et pendant la fenêtre ; tout changement non corrélé ou capture incertaine => non concluant. Distinguer clairement « jeton absent au JOIN observé » d’une cause du défaut d’événement ; H2 cause candidate seulement si état effectif reste absent/anon pour la mesure. Aucune trame/claim/token/log brut conservé. Ne pas confondre échec de décodage/capture et booléen faux prouvé.

## Barrières Auth/ownership encore non explicites

La ligne cohorte reste un identifiant durable avant authentification et une référence générale B1 ; elle ne dit toujours pas qu’un intent canonical email/run est écrit AVANT createAuthUser. Le lost response peut précéder la connaissance de l’UID. Ajouter explicitement TrackingFixtures et B1 au SHA accepté, intent avant émission, découverte exhaustive exacte, Auth+profiles récupérés persistés avant DELETE, hydratation du journal en reprise froide, absence/transport inconnu => INCOMPLETE3. Aucun DELETE depuis UID brut non prouvé. Cette exigence porte sur la création, pas seulement le login.

Les fichiers QA réservés/owner ne figurent toujours pas dans ce contrat. Une mission ROOT de propriété distincte, publiée avant code, peut fournir cette information ; sinon ajouter chemins nouveaux exacts et imports partagés en lecture seule. Aucune permission implicite de modifier app/API/SQL/helpers communs, et exécution cloud ROOT seule.

## Contradiction de verdict à lever

L’introduction du tableau dit « chaque ligne exige un join confirmé et l’INSERT propre ». La première ligne exige pourtant CHANNEL_ERROR/mismatch sur le canal4, et le protocole interdit l’INSERT dès que le join n’est pas confirmé. Cette branche H1a devient donc impossible à satisfaire littéralement. Remplacer par : un événement ne constitue une preuve que pour une mesure au join confirmé et à son INSERT corrélé ; les erreurs de JOIN sont des observations propres, sans INSERT nécessaire sur le canal rejeté. La réception du témoin reste requise avant comparaison H1a.

Ces réserves ne prouvent aucun défaut produit/fournisseur. Aucune preuve Realtime réelle ou nettoyage à distance n’est dérivée d’une lecture de contrat.
