# Data erasure requests (SYS-07)

Strict mirror of Astra c0df158 / 0ebab8f (`contract.ts`; the lib file imports server code, so it is
mirrored, not imported). Client: `MyErasureRequests` inside « Mes données » (`erasureRequests` opt-in,
client space only). Operator: `OperatorDataRequests` under the support queue (list, detail + history,
decision only when `can_decide` and not terminal; command fenced under
`courant-private-data-requests:<uid>:<gen>:<id>`). Nothing is erased: execution is always « non commencé ».

## Procédure actuelle

1. La personne se connecte sur le Web ou la PWA. Dans **Votre espace → Profil → Mes données**, elle sélectionne **Demander l’effacement**, puis confirme. Pour un compte client, **Mes demandes d’effacement** affiche la demande et son état. Le reçu donne accès au ticket privé d’assistance. Un renvoi depuis le même onglet après une réponse perdue réutilise la référence de la demande.
2. L’équipe ouvre **Assistance → Demandes d’effacement**. La lecture est réservée à une personne habilitée pour l’assistance. Pour décider, la personne doit disposer des droits de lecture et de gestion des statuts. Elle sélectionne la demande, consulte son historique et enregistre l’état suivant avec un motif. Pour demander un complément, elle utilise le ticket privé lié à la demande.
3. Les états **Approuvée** et **Refusée** terminent l’examen dans ce module. Le ticket et la demande d’effacement ont chacun leur statut. La décision est historisée et l’exécution reste **Effacement non commencé**.

Le module traite la demande et son examen. La procédure d’exécution reste à valider par l’exploitant, y compris le responsable du traitement, le contact pour l’exercice des droits, le périmètre à traiter dans la base, l’authentification, les fichiers, les prestataires et les sauvegardes, ainsi que les règles et durées de conservation à publier.
