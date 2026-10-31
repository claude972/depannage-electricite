# Auth404 tracking — relecture ciblée

SHA exact : 8d3c21ba6c20888abeae20de76d4b4465c955d51. Contrat A8 §5e du checkpoint lu ; export figé /private/tmp/depannage-tracking-review-8d3c21b-9oZ7up, sans lecture de WIP.

Verdict : correctif ciblé accepté, aucun P1/P2 trouvé.

isLegacyUserNotFound exige objet non-null/non-tableau exactement trois clés, code strictement404 numérique, error_code strictement user_not_found, msg string nonvide. readUser n'appelle cette reconnaissance que pour statutHTTP404 ; JSON invalide/HTML/vide ou corps arbitraire/clé supplémentaire/manquante/type erroné reste UNKNOWN. Même corps sousHTTP200/500 ne prouve pas absence. Les tests couvrent ces négatifs via les vrais Response et readUser.

40 tests Tracking PASS, zéro échec/skip, exécutés sur export exact avec vrai HTML privé4c. Dont provenance, lookup canonique, réponse perdue/absence exhaustive gardant intent ouvert, manifeste durable avant delete, véritables scénarios locaux headless STOP/drain. Le dépôt temporaire du test CLI sert uniquement à ses vérifications HEAD synthétiques ; aucune modification des fichiers exportés ou du worktree auteur.

Diff source limité à la reconnaissance404 dans auth-admin ; ni searchByEmail, ni cohorte, ni intentions, ni STOP/drain modifiés. La recherche négative exhaustive ne ferme toujours pas l'intention de création inconnue.

Hors verdict : diagnostic UI A8, T8 et ordre logout futurs, absents du diff. Aucun compte, cloud, credential ou fixture distante utilisés pendant cette relecture.
