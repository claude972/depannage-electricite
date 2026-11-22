# DOC-HISTORY-001

Route additive indépendante des uploads et de leur route actuelle. Base `6b9e344`. Aucun changement de schéma, Storage, permissions ou UI.

`GET /api/documents/history?limit=25&cursor=OPAQUE&intervention_id=UUID` ; les trois paramètres sont facultatifs. `limit` accepte 1–100, défaut 25. Paramètres inconnus, répétés ou invalides refusés.

Réponse : `{documents:[{id,intervention_id,owner_id,name,mime_type,created_at}],page:{limit,has_more,next_cursor}}`. Ordre `created_at DESC,id DESC`. `intervention_id` peut être null pour un document autonome. Aucun chemin Storage, URL signée, jeton ou clé. Les liens de téléchargement continuent à utiliser l’API existante et ses contrôles.

Le curseur opaque conserve la précision PostgreSQL à la microseconde et associe version, utilisateur Auth vérifié et périmètre global/dossier. Le transmettre tel quel, avec le même filtre ; changer de compte ou de filtre impose de repartir sans curseur. Un curseur n’accorde aucun droit. Suppression de sa ligne frontière permise ; les nouveaux documents arrivent sur la première page, sans instantané figé.

Lecture exclusivement via `authenticatedClient().db` sous JWT utilisateur et RLS existante. Le mode global ne filtre pas artificiellement sur owner : les documents partagés autorisés et les documents autonomes restent visibles selon la RLS. Le filtre dossier commence par prouver sa visibilité sous la même session ; aucun sondage des documents si le parent n’est pas visible.

- 200 vide : `documents:[]`, `has_more:false`, `next_cursor:null`.
- 401 : session requise, avant validation des filtres.
- 404 : même réponse pour un dossier filtré absent ou inaccessible.
- 422 : filtre ou curseur invalide, autre utilisateur ou autre périmètre.
- 503 : erreur réseau/SQL ou réponse incohérente ; `Retry-After: 2`.

Toutes les réponses sont `Cache-Control: private, no-store`. Aucun résultat partiel sur erreur.

Validation locale : tests dédiés sur 237 lignes, ex aequo/microsecondes, document autonome/partagé, filtres, changements de périmètre/utilisateur, suppression frontière, insertions récentes, vide, refus et pannes ; typecheck strict. Client Supabase réel sur transport simulé : la preuve RLS hébergée et la recette UI/preview restent à ROOT après intégration. Aucun objet Storage créé pour ces tests.
