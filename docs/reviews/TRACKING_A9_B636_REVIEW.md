# Tracking A9 — précondition seed / contexte

SHA exact : b636654d91b79338eb12140cce717316fe613357. Contrat82c2d52 appliqué. Revue exacte du diff et export /private/tmp/depannage-tracking-review-b636654-BzHeOl. Aucun cloud/code auteur modifié.

Verdict : aucun P1/P2 trouvé ; feu borné exécution ROOT de la précondition QA corrigée. LIVE-WORKSPACE-001 reste OPEN produit, non résolu par cet ordre de préparation. T6 historique reste FAIL.

setupCohort crée le premier compte client, ouvre freshSession(preflight-client) uniquement pour le404 UUID inconnu, puis ferme ce contexte dans finally. Le finally couvre le refus API et l'exception d'ouverture ; le pool existant ferme lui-même tout handle encore en ouverture si login échoue. Aucune déconnexion globale ajoutée : closeSession ferme le contexte du préflight.

Après fermeture, le seed des autres comptes/orgs/sites/dix dossiers s'exécute sans aucune ouverture session scénario. Ces sessions sont créées ultérieurement par les scénarios une fois setup terminé. Aucun refresh, relogin ou modification de données au point d'échec.

52 tests existants PASS, zéro échec/skip, sur export exact. Les nouveaux tests exécutent la vraie fonction setupCohort sur helpers injectés et observent l'ordre, le succès, le refus404 et l'exception d'ouverture. Ils ne sont pas annoncés comme une nouvelle recette distante. Les tests Chromium réels A8/T8 et STOP/drain existants restent verts. Les corps T6/T9/T14/T16 sont épinglés par hashes inchangés ; inspection du diff confirme qu'ils ne sont pas touchés. Auth404 strict, provenance, raison finie, diagnostic même page sans API/navigation, révocation pool et providers avantT19 demeurent inchangés et testés.

L'observation produit de session déjà ouverte avant création externe est explicitement maintenue dans le commentaire source/test. Une future réussite T6 après ce setup prouvera la carte stale sur un dossier préchargé, pas la réception Realtime d'un nouveau dossier externe. Aucun nouveau gate hors périmètre ajouté.
