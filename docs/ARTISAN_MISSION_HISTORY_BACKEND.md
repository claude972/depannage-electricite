# Historique paginé des missions attribuées — SYS-07 / ART

Endpoint privé `GET /api/artisan/mission-history?filter=active|done&cursor=…`, filtre par défaut `active`.

Réponse : `{items, filter, order:"newest_first", captured_at, page:{limit:50,has_more,next_cursor}}`.
Chaque item contient uniquement `id,category,address,city,urgency,status,created_at,completed_at,paid_at`. Le dossier s'ouvre avec son identifiant par le point de lecture existant. Aucun nouvel accès au dossier n'est accordé.

- `active` : assigned, quoted, accepted, in_progress.
- `done` : completed, paid, conformément au regroupement actuel de l'écran artisan. « Terminée » ne signifie donc pas « payée ».
- Tri décroissant créé le / UUID ; 51 lignes SQL, 50 visibles. Le curseur opaque conserve les microsecondes et est lié au compte et au filtre. Il n'accorde aucun droit.
- Rôle exact artisan et attribution courante obligatoires. RPC SECURITY INVOKER soumis aux RLS existantes ; une portée organisation/site n'élargit pas cette liste.
- Lecture des états courants à chaque page, sans instantané transactionnel multi-pages ni total prétendu. Une transition, une réattribution ou un changement de rôle est pris en compte immédiatement ; rafraîchir depuis la première page pour une nouvelle vue complète.
- Réponses 401 session absente, 403 rôle/accès refusé, 422 paramètres/curseur invalides, 503 lecture invérifiable. Cache privé désactivé.

Vérification locale : tous les schémas migrés dans PGlite isolé ; 123 actives et 112 terminées, égalité de dates et pagination complète, comptes étrangers et portée site, changement réel via `intervention_action(...,'complete',...)`, réattribution et retrait du rôle. Tests de la route HTTP réelle avec accès DB injecté. Le scheduler est explicitement simulé par le harnais SQL existant ; ce lot ne modifie aucun job. Aucune migration distante ni recette hébergée effectuée.
