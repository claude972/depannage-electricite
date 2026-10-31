# Contre-revue app — 47423b7

SHA exact : 47423b77871aa844fe92080df01fdf88b3e262e8 (inclut5266450). ContratA5 etA6 lus. Export isolé /private/tmp/depannage-deeplink-review-47423b7-gxe9v9. Aucun code auteur/cloud/merge/runtime applicatif modifié.

Verdict : P2 reader invalid-body et P3 Actualiser fermés dans les bornes du contrat. Aucun P1/P2 restant trouvé dans ce correctif. Feu intégration contrôlée après les opérations ROOT déjà en cours, sans substituer ce verdict à une recette navigateur.

80 tests UI ciblés PASS, zéro échec/skip : workspace-reader, workspace-refresh, detail-resolution, guard, identity, session, revalidate, features.

Le shell invoque réellement createWorkspaceReader dans readWorkspace : les tests importent ce même module, injectent api, observent apply/signOut/setError, et passent aussi par le vrai parseApiBody pour les statuts/JSON. Un test assemble le vrai reader et le coordinateur jusqu'à la décision erreur de détail ; ce n'est plus un ReadResult préfabriqué.

Validation effectuée avant application : profil id/string et rôle connu, dix collections canoniques obligatoires sous forme de tableaux, artisan_profile objet/null, essentiels des interventions/devis/sites/organisations/messages et statut intervention dans le jeu DB. Les offres artisan volontairement redacted restent acceptées sans exiger client/adresse/description. Cette validation reste minimale selonA5, pas un validateur intégral de tous les champs métiers.

200{} ou profil seul : failed status200 reason invalid_response, aucune application ni signOut ; mauvais profil/collections/essentiels : même refus. JSON malformé est502 par parseApiBody puis failed sans reset. Vrai401 et identité étrangère au schéma valide : signOut ;403/503/transport : failed, données/session conservées. Le contrôle seq a lieu avant toute validation/application après l'await : réponse périmée ne modifie pas les données/session/bannière après retour.

Le LRU promeut désormais les lectures get et son test vérifie qu'une entrée chaude n'est pas évincée avant les froides. Connecté · Actualiser est effectivement le texte du bouton SUBSCRIBED, Actualiser reste aussi visible ailleurs.

Coordinateur/barrières par défaut et hooks des trois rôles inchangés depuis la revue ; tests de concurrence/deferred/trailing/contextes/superseded et absence de boucle restent verts. Le diff n'ajoute ni API, SQL, tracking-leaf ni dépendance/prototype.

Restent explicitement OPEN : troncature100 dossiers (A6/docs/CLAUDE_DEEPLINK_TRUNCATION.md) — loaded prouve un snapshot valide, pas l'absence globale d'un ancien dossier ; efficacité Realtime/LIVE-WORKSPACE-001 non démontrée par ce reader. Aucun succès GPS physique ou navigateur distant extrapolé.
