# Tracking caller REMOTE/LOCAL — a67f0e4

SHA exact : a67f0e4ed6827ea376d13e7f521afb9f9c740bd7. Contrat A7 b868aab lu dans sa version committée. Worktree auteur propre au contrôle. Revue source exacte + export isolé /private/tmp/depannage-tracking-review-a67f0e4-j0v3DE. Aucun cloud ni écriture auteur.

Verdict : aucun P1/P2 actionnable trouvé dans le raccordement provenance ; feu pour exécution contrôlée ROOT selon le reçu récent et les paramètres indépendants. Ce verdict ne vaut pas recette distante GPS déjà exécutée.

40 tests Tracking PASS, zéro échec/skip, avec QA_TRACKING_REAL_HTML=/tmp/depannage-public-4c-home-private.html. Le vrai HTML privé 4c passe par le parseur Flight et fournit W1T6udg45nuoEg3XO7IGT ; l'ancien substring échoue bien dessus. Le test de placement lance le vrai CLI avec reçu expiré et confirme exit2 sans créer --out. L'export utilise un dépôt Git temporaire de fixture pour ce test CLI ; ses fichiers proviennent intégralement du SHA revu, et aucun fichier source n'a été modifié. Les tests STOP/drain/réponse perdue et override Fixtures réels restent verts.

Points contrôlés :
- expectedFromOptions prend origin/base-url, SHA, BUILD_ID, projet, équipe, déploiement, repoId et ref dans la CLI, jamais dans le reçu/HTML ; les divergences sont refusées.
- loadDeploymentProof puis un seul GET / sans cookies/auth, credentials omit, redirect manual, statut200 obligatoire, décodage UTF8 strict et borne8MiB ; verifyRemoteDeployment revalide fraîcheur/identité après la lecture et exige Flight unique. Erreurs exposées par codes fixes, sans valeurs de reçu/HTML.
- Ce contrôle précède checkAnonymous, table service, création --out, IntentLog et Fixtures. Construction du client service et lectures locales préalables n'émettent pas de requête service.
- LOCAL exige loopback et parse strict toutes sources, aucun push invalide, exactement un candidat égal au BUILD_ID attendu ; ambigu/mauvais/absent refusés.
- verifySha(options.sha, options.appDir) lit le HEAD du checkout APP explicitement fourni ; il ne lit pas le HEAD du harnais pour cette comparaison. L'application4c et le harnais a67 sont donc distincts. Sans appDir, la vérification locale du SHA reste explicitement false ; ROOT doit conserver son appDir prévu.
- Les fixtures intégrées utilisent leur save remplacé par makeManifestDurable ; init lazy ne déclenche pas le writer de base. Aucun changement à la récupération/drain/cleanup dans ce checkpoint.

Limites : pas de reçu réel lu, pas de requête réseau distante ni de recette fournisseur pendant la revue. Durabilité matérielle et comportement déployé non extrapolés.
