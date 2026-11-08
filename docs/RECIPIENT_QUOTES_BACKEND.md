# CLI-08 — devis exacts destinataires

GET `/api/quotes?status=all|sent|accepted|rejected&cursor=opaque` : client courant uniquement, statut facultatif all, pages50 fixes, tri created_at DESC/UUID DESC (microsecondes). Retour `{items,page:{limit:50,has_more,next_cursor}}`. Item `{id,intervention_id,total_cents,status,created_at,intervention:{id,category,status,site_id}}`. Seulement dossiers dont client_id est le compte courant, sous RLS. Aucun nom/adresse/contact.

GET `/api/quotes/[id]` client propriétaire ; manager : `?organization_id=UUID&site_id=UUID` (organisation obligatoire, site facultatif quand contexte tous sites). Manager membre courant, site exact du dossier sous RLS dans organisation/contexte demandés, lecteur autorisé. Pas accès artisan/admin sur ces endpoints.

Détail `{quote,intervention,version:{current_quote_id,is_current}}` : quote = DTO exact ART-07 `{id,intervention_id,artisan_id,lines:[{label,quantity,unit_price_cents}],subtotal_cents,tax_rate,tax_cents,total_cents,status,created_at,accepted_at}` ; intervention = `{id,category,status,site_id}`. current_quote_id désigne l'unique devis sent/accepted du dossier, null si absence prouvée ; is_current est une information, JAMAIS une autorisation d'accepter. Une ancienne version rejetée reste lisible sans substitution. Les gardes d'approbation avancée/simple, validité et les commandes actuelles restent obligatoires. PDF via /api/quote-documents?quote_id=UUID puis téléchargement privé existant. Montant du devis seul, aucun total avenants/paiements inventé.

401 session,403 rôle,404 absent/étranger/périmètre,422 paramètres/curseur,503 lecture incohérente ou indisponible + Retry-After2. private no-store partout. Revalidation du périmètre courant avant réponse ; aucun write ni migration.

Plan/propriété Astra : nouvelles routes app/api/quotes/route.ts et [id]/route.ts seulement, lib/features/recipient-quotes, tests backend/SQL et ce contrat. Prouver >200 et >20 révisions, exact ancien ID, scope manager limité/retrait, refus tiers et montants. Pas UI/cloud/credentials.

Preuves locales : 4 tests des vrais handlers + TypeScript strict ; 13 assertions SQL sous RLS après migrations isolées (246 devis client sur plusieurs pages, 25 révisions et ancien ID hors20, propriétaire/tiers, manager lecteur limité et retrait). Les fixtures distinguent dossiers personnels et site : être client_id d'un dossier de site ne contourne pas sa RLS. Aucune migration ajoutée ; pg_cron stubé dans le harnais, aucune preuve fournisseur/cloud. Recette PostgREST sur preview assemblée encore nécessaire.
