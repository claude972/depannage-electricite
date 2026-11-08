# Garantie : historique exact

GET `/api/warranty[?intervention_id=UUID][&cursor=opaque]` conserve `cases` et `enabled`, ajoute `next_cursor:string|null` et `has_active:boolean|null`.
100 cas maximum par page, ordre created_at DESC puis UUID DESC, microsecondes conservées. Curseur lié au compte et filtre intervention ; tout autre paramètre ou curseur incohérent :422.
Sans filtre : has_active=null (aucune affirmation globale). Avec filtre : booléen prouvé par lecture indépendante des cas submitted/reviewing de ce dossier, sans dépendre de la page courante. Dossier absent/inaccessible :404, même si aucun cas.
Les champs de cas existants sont conservés : id,intervention_id,client_id,description,status,resolution,created_at,updated_at,terms_version. Lecture JWT/RLS exclusivement, périmètre revérifié après lecture. Pas de changement POST ni activation. Erreurs privées no-store ; indisponibilité503 Retry-After2.

Plan : reader strict + pagination100+1 et existence active indépendante ; tests handler limites/cursor/refus/erreur et SQL RLS >100. Aucun changement UI, migration ou cloud.
