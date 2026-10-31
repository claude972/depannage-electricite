# Contre-revue B1 cleanup — 478a2da

SHA exact : 478a2da7f4f22c27763ca263b1e65455909bf9ca ; baseaf48d3c. Contratf4021ac/A3 optionB lu. Diff complet : trois fichiers uniquement (run.mjs, nouveau lib/cleanup-proof.mjs, nouveau test adaptateur). Lecture/test exclusivement sur export git archive figé /private/tmp/depannage-cleanup-review-478a2da-dXQ1C8 ; le checkout auteur ayant ensuite changé de branche n'est pas utilisé comme source. Aucun cloud, credential réel, commit ou switch auteur.

Verdict : feu borné B1 ; aucun P1/P2 actionnable trouvé dans l'extraction. Prêt pour intégration contrôlée et import B2 en lecture seule selon contrat, sans présumer le futur harnais deep-link livré.

66 tests Tracking existants PASS, zéro échec/skip : 57 tests antérieurs inchangés dans leurs assertions +9 testsB1. Modes normal ET cleanupOnly exercés avec vrais IntentLog/createAuthAdmin/ownership/manifestes et fausses API/DB ; les vrais tests Chromium locaux, STOP/drain, provenance/HTML4c et A8–A10 restent verts.

Ordre conservé dans le module extrait : réconcilier → persist → découverte exacte e-mail canonique → persist UID → lectures/propriété → cleanup_attempt persisté avant DELETE → runCleanupFn → hook → verdict et résultat persisté. runCleanupFn obligatoire, persist obligatoire, hook défaut no-op. Validation des paramètres avant toute réconciliation/lecture. Le binding exporté de run.mjs impose runTrackingCleanup et settleTrackingSideEffects sans changer les appels normal/cleanupOnly.

Le hook tracking reprend le contrôle de lease existant : ne réconcilie les intents provider que si étape lease pass (ou absente, sémantique déjà existante). Échec lease laisse provider ouvert. Le no-op générique laisse provider ouvert ; exception du hook rend okfalse, side_effects_error et exit3, jamais PASS. Exception du nettoyage continue de remonter au finaliseur existant ; hook non appelé après cette exception.

Probes indépendantes supplémentaires sur le vrai module :
- échec persist injecté immédiatement après récupération UID : runCleanupFn appelé0fois, fichier manifeste précédent intact, intent création toujours ouvert ;
- runCleanupFn qui jette : rejet propagé, hook appelé0fois, cleanup_attempt.completed_at reste null. Aucun succès de nettoyage fabriqué.

La récupération perdue est persistée avant la première suppression dans les deux modes, prouvée depuis le faux DELETE qui lit le fichier disque. Recherche Auth inconnue/malformée ou absence exhaustive ne clôt jamais l'intention et retourne INCOMPLETE/exit3. Les tests antérieurs interruption après persist/reprise cleanupOnly et Auth404 exact restent verts.

Limites : ne prouve aucune suppression distante, aucun fournisseur, aucune recette deep-link B2. La nouvelle capture d'exception hook est fail-closed ; elle ajoute seulement un champ d'erreur si ce cas survient. Aucune modification des autres shared/Business/Tracking guard/scenarios dans le diffB1.
