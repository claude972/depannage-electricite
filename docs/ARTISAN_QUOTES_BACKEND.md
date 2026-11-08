# ART-07 / SYS-07 — liste privée des devis artisan

GET `/api/artisan/quotes?status=all&limit=50&cursor=…` sous session courante, sans clé service.
`status`: all (défaut), sent, accepted, rejected. `limit`: entier canonique 1–50, défaut 50. Curseur opaque lié au compte et au filtre ; ne pas le construire. Ordre `(created_at DESC, id DESC)`, précision PostgreSQL conservée. Une ligne supplémentaire détermine la suite ; aucune dépendance au bootstrap 100.

Réponse : `{items:[{id,intervention_id,status,total_cents,created_at,accepted_at,intervention:{id,category,status}}],page:{limit,has_more,next_cursor},order:'newest_first'}`. Vide = 200 et items vide. Le total est celui du devis, pas un montant payé ni le total des avenants.

L'UUID désigne le devis exact, y compris les anciens devis rejetés encore accessibles du dossier. Ouvrir la révision avec `GET /api/artisan/quotes/[id]`. Le dossier, ses documents et ses avenants gardent leurs routes. Les brouillons suivent leur parcours distinct.

Portée : rôle profil courant artisan, auteur exact du devis et attribution actuelle du dossier au même compte. RLS `quotes_read` et `interventions_read` restent appliquées. Une relation de membre/site ne remplace jamais l'attribution. Réaffectation : l'ancien artisan perd la ligne ; le nouvel artisan ne voit pas le devis d'un autre auteur dans cette liste. Aucune exigence d'agrément supplémentaire inventée pour la lecture historique (même règle de rôle que mission-history). Aucun changement de permissions/table/migration.

401 session absente ; 403 rôle non artisan ; 422 paramètres/curseur invalides ; 503 réponse invérifiable ou panne, Retry-After 2. Toutes réponses privées no-store. Pas de lignes du devis, identité client, adresse, contact, paiement, secret ou montant agrégé.

Tests : vrai handler avec client injecté, pagination/projection/erreurs ; PGlite isolé exécutant les migrations et jointures sous rôle authenticated, 123 devis, autre compte, réaffectation, retrait de rôle. Ce test SQL valide RLS et forme relationnelle ; la syntaxe d'embedding PostgREST doit encore être exercée en recette hébergée par ROOT. Aucun cloud/fournisseur appelé.

## Lecture du devis exact hors fenêtre 20

GET `/api/artisan/quotes/[id]` → `{quote:{id,intervention_id,artisan_id,lines:[{label,quantity,unit_price_cents}],subtotal_cents,tax_rate,tax_cents,total_cents,status,created_at,accepted_at},intervention:{id,category,status}}`.
Même portée que la liste, requête UUID exacte sans limite historique. Absence ou autre auteur/attribution : 404 identique. 401/403/422/503 et no-store identiques. Schéma du détail partagé réutilisé (normalisation des nombres décimaux stockés, TVA) ; contrôle des totaux par calculateQuote. Pas de total accepté avec avenants ni de statut paiement. Le front doit utiliser cette lecture pour le devis sélectionné, même s'il manque aux 20 devis du point-read dossier.
Preuve ciblée : 35 devis rejetés d'un même dossier, plus ancien absent des20 mais lisible exactement sous RLS ; vrais handlers et refus.
