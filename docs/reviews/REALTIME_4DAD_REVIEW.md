# Revue ciblée Realtime — 4dad028

SHA exact : 4dad028b5675f4176d70aabaef0f048587cf5b6c, export git archive relu dans /tmp/depannage-rt-4dad-review. Contrat REALTIME_DIAGNOSTIC_CONTRACT.md présent à ce SHA. Aucune source modifiée, aucune credential lue, aucun cloud. FASTSPLIT lu.

Verdict : un P2 de qualification à corriger avant probe réel ; aucun défaut de suppression hors cohorte identifié dans ce périmètre.

## P2 — un jeton indécodable devient une fausse observation H2

scripts/qa-realtime/lib/project.mjs:24–33 transforme un JWT malformé, JSON invalide ou sans rôle en {present:true, role_authenticated:false}. authVerdict:94–100 qualifie alors observed_false ; verdict.mjs:14 émet H2_observed. Le contrat distingue rôle inconnu et rôle explicitement non authentifié.

Reproduction exécutée en mémoire avec chaîne fictive not-a-jwt : projector.client(phx_join), authVerdict, conclude => observed_false / H2_observed. Aucun claim/rôle n’a pourtant été lu. Le test actuel projectToken verrouille précisément cette confusion pour garbage.

Correction minimale attendue : ajouter une information de décodabilité/rôle connu dans la projection volatile, retourner unknown si le token présent est indécodable ou son rôle inconnu, et couvrir malformed/JSONnull/claims sans role. Conserver observed_false pour absence observée ou rôle anon explicitement décodé et proven pour authenticated/sub exact. Ne jamais persister le jeton/claims.

## Vérifications acquises

18/18 tests existants PASS, 0 SKIP : tsx --test tests/qa-realtime.test.ts tests/qa-realtime-sdk.test.ts. Vrai Chromium + vrai SDK local contre faux serveur Supabase : join, événement propre, mismatch sans INSERT, erreur system, mise à jour access_token, anon, absence événement ; vrai main injecté, préflight sans mutation, reprise Auth perdue trouvée/inconnue et cleanupOnly. Log /tmp/depannage-rt-4dad-review-tests.log. Pas de suite globale répétée.

Source relue : les quatre canaux séquentiels reproduisent l’ordre des bindings et wait ; un INSERT seulement après SUBSCRIBED, intention durable et UUID manifesté avant émission via TrackingFixtures ; compte canonique qa-<run>-rt-client@qa.invalid. Lecture de contrôle puis corrélation d’id en mémoire, fermeture en finally. Rapport ne conserve que projections/booleans/listes publiques et erreurs whitelistées. Aucun app/SQL/Edge modifié.

B1 imports lecture seule : gate/drain avant cleanup, refus si producteurs encore actifs, découverte/ownership distante avant suppression et UID Auth récupéré persisté avant DELETE. Intention inconnue non récupérable garde cleanup INCOMPLETE/exit3 ; préflight exit2 ; fatal après cleanup complet exit1 ; handlers SIGINT/SIGTERM partagés configurés pour130 ou3. Pas de nouveau test SIGINT propre à cette sonde : vérification de raccordement source, sans prétendre injection STOP exécutée ici.

## Limites

Tous les événements reçus peuvent donner INCONCLUSIVE : diagnostic complet, aucune hypothèse causale établie. Ce n’est pas une preuve du refresh/badge de l’application. Le rôle projeté depuis un claim transporté ne démontre pas l’identité évaluée par le serveur RLS. H3 requiert une erreur positive whitelistée ; l’absence d’événement seule reste UNKNOWN_H3_POSSIBLE. Publication/grants/préflight réel à relire par ROOT ; aucune recette Supabase réelle dans cette revue.
