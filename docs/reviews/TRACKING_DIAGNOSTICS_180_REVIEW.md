# Revue Tracking A8 diagnostics — 18039eb

SHA exact : 18039ebf72d1e195e2ddf47c23741d9afd938d57. Export isolé /private/tmp/depannage-tracking-review-18039eb-ChT5w5. Aucun cloud ni modification de source auteur. 47 tests existants PASS, zéro skip ; dont vrais Chromium local diagnostic/T8, compat Auth404 et STOP/drain. Le vrai HTML privé4c est également exercé. Dépôt Git temporaire créé uniquement pour le test CLI de l'export.

## P2 : la raison serveur n'est pas une allowlist

scripts/qa-tracking/lib/diagnostics.mjs:31–37 accepte toute chaîne de1–64 caractères répondant à /^[a-z_]{1,64}$/ ; ce filtre syntaxique n'est pas une liste de codes connus. Probe sur le vrai export : boundedReason(JSON.stringify({reason:'private_token_from_upstream'})) renvoie private_token_from_upstream. L'observateur l'enregistre et captureDiagnostics le persiste ; un texte arbitraire respectant ce format traverse donc le filtre, contrairement à l'exigence ROOT reason allowlist. Un secret inconnu du redactor ne serait pas retiré uniquement par sa forme.

Correction : ensemble fini de raisons documentées du protocole tracking/route/geocode, valeur inconnue => null ou other. Régression : code connu conservé, snake_case arbitraire rejeté. Les actions disposent déjà d'une vraie liste finie et ne présentent pas ce défaut.

## P3 : stop reçu pendant capture n'empêche pas l'étape DOM suivante

captureDiagnostics vérifie gate.stopping à l'entrée et au début de chaque page, mais pas après l'await screenshot avant page.evaluate (environ lignes160–173). Probe : screenshot déclenche gate.stop('SIGINT') puis échoue ; evaluate est encore appelé une fois. Il s'agit d'une lecture DOM, pas d'une mutation/API, et l'effet reste borné. Ajouter un check avant la prochaine opération et noter DOM:SKIPPED_STOP. Ce point seul ne nécessite pas de nouveau protocole de nettoyage.

## Contrôles positifs

- Diagnostic sur les handles réellement utilisés dans le scénario, sans login/reload/navigation/API ajoutés ; vrai test navigateur confirme zéro requête/navigation de la capture.
- URL sans query, chemins réseau normalisés sans query ; aucun header/body persisté, source ui/harness seulement. Ring50, max3pages,5s/op20stotal. Fichiers succès0600 et dossiers0700 testés ; erreurs diagnostic ne changent pas FAIL/BLOCKED.
- T8/T8-fail : status de la section artisan contenant toute la phrase, un seul résultat, bouton Reprendre le partage exact obligatoire. Cas négatifs doublon/bouton absent/hors panneau/casse incorrecte refusés en vrai Chromium.
- Ordre tracking horsT19, puis providers, puisT19 correct. revokeUser marque tous les handles existants du même utilisateur ; session() sur handle révoqué est BLOCKED sans relogin ; rebind du handle switch après login outsider explicite correct.
- T6/T9/T14/T16 non modifiés dans le diff ; aucune assertion assouplie. Le diagnostic doit observer leur échec initial.

Verdict : corriger/clarifier le P2 de raison avant feu diagnostic complet ; P3 borné signalé séparément. Aucun verdict de réussite GPS distant ou de cause T6 anticipé.
