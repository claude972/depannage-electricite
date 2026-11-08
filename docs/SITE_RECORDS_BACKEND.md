# Fiche site : lectures paginées (SYS-07 / ENT-04 / ENT-10)

GET `/api/sites/[id]/records?kind=open|past|upcoming|completed|audits&cursor=opaque`.
`kind` obligatoire, curseur facultatif lié au compte/site/kind ; taille fixe 50 (lecture51).
Réponse `{items,page:{limit:50,has_more,next_cursor}}` ; aucune autre clé métier.

- open : requested, assigned, quoted, accepted, in_progress. past : completed, paid, cancelled. Tri created_at DESC puis UUID DESC ; items `{id,site_id,category,status,created_at}`.
- upcoming : pending/scheduled, y compris échéances dépassées. completed : completed. audits : audit/safety, tous statuts. Ces trois listes trient due_on ASC puis UUID ASC ; items `{id,site_id,title,kind,due_on,status,notes}`.

Rôle manager courant exigé, site relu sous RLS ; membre lecteur autorisé à lire son site, aucune extension des droits. 401 session absente, 403 rôle, 404 site absent/étranger, 422 paramètres/curseur, 503 invérifiable (Retry-After2). Toutes réponses privées no-store. Point-read et mutations existants inchangés ; aucune migration.

Plan/propriété Astra : route records, lib/features/site-records, tests ciblés HTTP/SQL et ce contrat. Vérifier dossier101/échéance301, pagination sans répétition, filtres exacts, scopes sélectionnés et retrait. Pas UI/shared/cloud.
