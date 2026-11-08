# ENT-12 — lectures exactes des approbations simples

GET `/api/enterprise/approvals?organization_id=UUID&site_id=UUID&status=all|pending|approved|rejected&cursor=opaque` : site/cursor facultatifs, status facultatif (all). Taille fixe50, ordre created_at DESC puis UUID DESC, microsecondes conservées. Retour `{items,page:{limit:50,has_more,next_cursor}}`.

GET `/api/enterprise/approvals/[id]?organization_id=UUID&site_id=UUID` : site facultatif. Retour `{approval:row,rule:{enabled,required_role,threshold_cents}|null}` ; null seulement si lecture réussie sans règle pour le site exact.

Chaque row : `{id,quote_id,site_id,status,note,decided_by,created_at,decided_at,site:{id,name,organization_id},quote:{id,intervention_id,total_cents,status},intervention:{id,category,status}}`. Montant du devis de base, aucun avenant/paiement inféré. Décideur UUID uniquement.

JWT courant, profil manager, organisation membre et site sous RLS (lecteur autorisé). Curseur lié acteur/org/site/statut. 401 session,403 rôle,404 organisation/site/détail absent ou étranger,422 paramètres/curseur,503 lecture invérifiable + Retry-After2. Toujours private no-store. Aucune mutation ni nouvelle permission. Le détail ne confère aucun droit de décision ; garde avancée existante inchangée.

Plan Astra : app/api/enterprise/approvals/**, lib/features/enterprise-approvals/**, tests ciblés HTTP/SQL et ce contrat. Jointures explicites sous RLS, contrôle périmètre avant/après ; vérifier >200, ancien dossier, scopes sélectionnés/retrait et projection exacte. Pas UI/migration/cloud.

Preuves locales : 4 tests des vrais handlers (projection, keyset microsecondes, curseurs liés, erreurs/règles et retrait) ; 19 assertions SQL sous RLS après toutes migrations, 221 approbations sur site sélectionné et 222 dans organisation, trois statuts, ancien dossier, lecteur/étranger et révocation ; TypeScript strict passe. Aucune migration ajoutée. Les extensions scheduler du harnais SQL sont stubées ; aucun appel cloud, validation PostgREST hébergée à effectuer sur la preview assemblée.
